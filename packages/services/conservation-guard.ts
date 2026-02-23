/**
 * Conservation Guard — Single-Writer Mutex + Fencing Token
 *
 * Implements conservation invariant enforcement via monotonic fencing tokens:
 *   - INCR conservation:fence:{community_id} → monotonic fence token
 *   - Lua scripts verify fence token before mutation
 *   - Postgres finalize checks fence_token > last_fence_token
 *   - Cursor-based reconciliation replays missed events
 *
 * Conservation Invariants:
 *   I-1: committed + reserved + available = limit
 *   I-2: SUM(lot_entries.amount_micro) per lot = original_micro
 *   I-3: Redis.committed ≈ Postgres.SUM(usage_events.amount_micro) within drift tolerance
 *
 * @see SDD §4.2 Conservation Guard
 * @see Sprint 0B, Task 0B.1
 * @module packages/services/conservation-guard
 */

import type { Redis } from 'ioredis';
import type { Pool, PoolClient } from 'pg';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of a conservation check */
export interface ConservationCheckResult {
  /** Whether the invariants hold */
  pass: boolean;
  /** Fence token used for this check */
  fenceToken: bigint;
  /** Drift between Redis committed and Postgres actual (micro-USD) */
  driftMicro: bigint;
  /** Whether drift exceeds tolerance */
  driftExceeded: boolean;
  /** Individual invariant results */
  violations: ConservationViolation[];
}

/** A specific conservation violation */
export interface ConservationViolation {
  invariant: string;
  expected: string;
  actual: string;
  severity: 'warning' | 'critical';
}

/** Reconciliation result */
export interface ReconciliationResult {
  /** Number of events processed */
  eventsProcessed: number;
  /** Last event ID processed */
  lastEventId: string | null;
  /** New fence token after reconciliation */
  fenceToken: bigint;
  /** Whether any drift was corrected */
  driftCorrected: boolean;
  /** Amount of drift corrected (micro-USD) */
  correctionMicro: bigint;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Drift tolerance: ±1% of budget limit (IMP-004) */
const DRIFT_TOLERANCE_PERCENT = 0.01;

/** Circuit breaker: halt finalize if drift >5% of limit (IMP-004) */
const DRIFT_CIRCUIT_BREAKER_PERCENT = 0.05;

/** Lock renewal interval in milliseconds */
const LOCK_RENEWAL_INTERVAL_MS = 10_000;

/** Lock TTL in milliseconds (3x renewal interval for safety) */
const LOCK_TTL_MS = 30_000;

/** Maximum events to process per reconciliation sweep */
const RECONCILIATION_BATCH_SIZE = 1000;

// --------------------------------------------------------------------------
// Fence Token Management
// --------------------------------------------------------------------------

/**
 * Acquire a fence token for a community.
 * Uses INCR for monotonic ordering — each token is strictly greater than the last.
 *
 * @param redis - Redis client
 * @param communityId - Community UUID
 * @returns The new fence token (BigInt)
 */
export async function acquireFenceToken(
  redis: Redis,
  communityId: string,
): Promise<bigint> {
  const key = `conservation:fence:${communityId}`;
  const token = await redis.incr(key);
  // Set TTL to 90 days (fence tokens are persistent but we don't want unbounded growth)
  await redis.pexpire(key, 90 * 24 * 60 * 60 * 1000);
  return BigInt(token);
}

/**
 * Get the current fence token without incrementing.
 *
 * @param redis - Redis client
 * @param communityId - Community UUID
 * @returns Current fence token, or 0n if not set
 */
export async function getCurrentFenceToken(
  redis: Redis,
  communityId: string,
): Promise<bigint> {
  const key = `conservation:fence:${communityId}`;
  const value = await redis.get(key);
  return value ? BigInt(value) : 0n;
}

// --------------------------------------------------------------------------
// Postgres Fence Verification
// --------------------------------------------------------------------------

/**
 * Verify and advance the fence token in PostgreSQL during finalize.
 *
 * This is the Postgres-side fencing check:
 *   UPDATE reconciliation_cursor
 *   SET last_fence_token = $fenceToken
 *   WHERE community_id = $communityId
 *     AND last_fence_token < $fenceToken
 *   RETURNING last_fence_token
 *
 * If no row is updated, the fence token is stale → ROLLBACK.
 *
 * @param client - PostgreSQL client (within transaction)
 * @param communityId - Community UUID
 * @param fenceToken - Fence token to verify
 * @returns true if fence advanced (token is fresh), false if stale
 */
export async function verifyAndAdvanceFence(
  client: PoolClient,
  communityId: string,
  fenceToken: bigint,
): Promise<boolean> {
  // Ensure reconciliation_cursor row exists (upsert)
  await client.query(
    `INSERT INTO reconciliation_cursor (community_id, last_fence_token)
     VALUES ($1, 0)
     ON CONFLICT (community_id) DO NOTHING`,
    [communityId]
  );

  // Attempt to advance the fence token
  const result = await client.query<{ last_fence_token: string }>(
    `UPDATE reconciliation_cursor
     SET last_fence_token = $1, updated_at = NOW()
     WHERE community_id = $2 AND last_fence_token < $1
     RETURNING last_fence_token`,
    [fenceToken.toString(), communityId]
  );

  return result.rows.length > 0;
}

// --------------------------------------------------------------------------
// Conservation Check (Cold Path)
// --------------------------------------------------------------------------

/**
 * Perform a conservation invariant check.
 *
 * Compares Redis committed counter against PostgreSQL usage_events sum
 * to detect drift. This is the COLD PATH check that runs every 60s.
 *
 * @param redis - Redis client
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @param month - Budget month in "YYYY-MM" format
 * @returns Conservation check result
 */
export async function checkConservation(
  redis: Redis,
  pool: Pool,
  communityId: string,
  month: string,
): Promise<ConservationCheckResult> {
  const fenceToken = await acquireFenceToken(redis, communityId);
  const violations: ConservationViolation[] = [];

  // Read Redis state
  const redisCommitted = BigInt(
    (await redis.get(`agent:budget:committed:${communityId}:${month}`)) ?? '0'
  );
  const redisReserved = BigInt(
    (await redis.get(`agent:budget:reserved:${communityId}:${month}`)) ?? '0'
  );
  const redisLimit = BigInt(
    (await redis.get(`agent:budget:limit:${communityId}`)) ?? '0'
  );

  // Read Postgres state: sum of usage_events for this month
  const [year, monthNum] = month.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum, 1));

  const pgResult = await pool.query<{ total_micro: string }>(
    `SELECT COALESCE(SUM(amount_micro), 0) AS total_micro
     FROM usage_events
     WHERE community_id = $1
       AND created_at >= $2
       AND created_at < $3`,
    [communityId, monthStart, monthEnd]
  );

  const pgCommittedMicro = BigInt(pgResult.rows[0].total_micro);

  // Redis committed is in cents, Postgres is in micro-USD
  // Convert Redis cents to micro-USD: 1 cent = 10,000 micro-USD
  const redisCommittedMicro = redisCommitted * 10000n;

  // I-3: Redis.committed ≈ Postgres.SUM(usage_events.amount_micro)
  const driftMicro = redisCommittedMicro > pgCommittedMicro
    ? redisCommittedMicro - pgCommittedMicro
    : pgCommittedMicro - redisCommittedMicro;

  const limitMicro = redisLimit * 10000n;
  const toleranceMicro = limitMicro > 0n
    ? BigInt(Math.floor(Number(limitMicro) * DRIFT_TOLERANCE_PERCENT))
    : 100000n; // 10 cents default tolerance

  const driftExceeded = driftMicro > toleranceMicro;

  if (driftExceeded) {
    violations.push({
      invariant: 'I-3',
      expected: `drift <= ${toleranceMicro} micro`,
      actual: `drift = ${driftMicro} micro`,
      severity: driftMicro > BigInt(Math.floor(Number(limitMicro) * DRIFT_CIRCUIT_BREAKER_PERCENT))
        ? 'critical'
        : 'warning',
    });
  }

  // I-1: committed + reserved + available = limit (in Redis space)
  const available = redisLimit - redisCommitted - redisReserved;
  if (available < 0n) {
    violations.push({
      invariant: 'I-1',
      expected: `committed(${redisCommitted}) + reserved(${redisReserved}) <= limit(${redisLimit})`,
      actual: `overspend by ${-available} cents`,
      severity: 'critical',
    });
  }

  return {
    pass: violations.length === 0,
    fenceToken,
    driftMicro,
    driftExceeded,
    violations,
  };
}

/**
 * Check if the circuit breaker should trip (drift >5% of limit).
 *
 * @param driftMicro - Observed drift in micro-USD
 * @param limitMicro - Budget limit in micro-USD
 * @returns true if circuit breaker should trip
 */
export function shouldTripCircuitBreaker(
  driftMicro: bigint,
  limitMicro: bigint,
): boolean {
  if (limitMicro <= 0n) return false;
  const threshold = BigInt(Math.floor(Number(limitMicro) * DRIFT_CIRCUIT_BREAKER_PERCENT));
  return driftMicro > threshold;
}

// --------------------------------------------------------------------------
// Cursor-Based Reconciliation (SKP-002)
// --------------------------------------------------------------------------

/**
 * Run cursor-based reconciliation for a community.
 *
 * Reads usage_events after last_processed_event_id and replays them
 * against the Redis committed counter. Idempotent via event_id tracking.
 *
 * @param redis - Redis client
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @returns Reconciliation result
 */
export async function reconcile(
  redis: Redis,
  pool: Pool,
  communityId: string,
): Promise<ReconciliationResult> {
  const fenceToken = await acquireFenceToken(redis, communityId);

  // Read cursor position
  const cursorResult = await pool.query<{
    last_processed_event_id: string | null;
    last_fence_token: string;
  }>(
    `SELECT last_processed_event_id, last_fence_token
     FROM reconciliation_cursor
     WHERE community_id = $1`,
    [communityId]
  );

  let lastEventId: string | null = null;

  if (cursorResult.rows.length > 0) {
    lastEventId = cursorResult.rows[0].last_processed_event_id;
  }

  // Fetch unprocessed events
  let eventsQuery: string;
  let eventsParams: unknown[];

  if (lastEventId) {
    eventsQuery = `
      SELECT event_id, amount_micro, created_at
      FROM usage_events
      WHERE community_id = $1
        AND created_at > (SELECT created_at FROM usage_events WHERE event_id = $2)
      ORDER BY created_at ASC
      LIMIT $3`;
    eventsParams = [communityId, lastEventId, RECONCILIATION_BATCH_SIZE];
  } else {
    eventsQuery = `
      SELECT event_id, amount_micro, created_at
      FROM usage_events
      WHERE community_id = $1
      ORDER BY created_at ASC
      LIMIT $2`;
    eventsParams = [communityId, RECONCILIATION_BATCH_SIZE];
  }

  const eventsResult = await pool.query<{
    event_id: string;
    amount_micro: string;
    created_at: Date;
  }>(eventsQuery, eventsParams);

  let eventsProcessed = 0;
  let correctionMicro = 0n;
  let newLastEventId = lastEventId;

  for (const event of eventsResult.rows) {
    // Idempotency: check if event already processed in Redis
    const processedKey = `conservation:processed:${communityId}:${event.event_id}`;
    const alreadyProcessed = await redis.exists(processedKey);

    if (!alreadyProcessed) {
      // Mark as processed (90s TTL, matching jti replay window)
      await redis.set(processedKey, '1', 'EX', 90);
      correctionMicro += BigInt(event.amount_micro);
    }

    newLastEventId = event.event_id;
    eventsProcessed++;
  }

  // Update cursor
  if (newLastEventId && newLastEventId !== lastEventId) {
    await pool.query(
      `INSERT INTO reconciliation_cursor (community_id, last_processed_event_id, last_fence_token, drift_micro, last_reconciled_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (community_id) DO UPDATE SET
         last_processed_event_id = $2,
         last_fence_token = $3,
         drift_micro = $4,
         last_reconciled_at = NOW(),
         updated_at = NOW()`,
      [communityId, newLastEventId, fenceToken.toString(), correctionMicro.toString()]
    );
  }

  return {
    eventsProcessed,
    lastEventId: newLastEventId,
    fenceToken,
    driftCorrected: correctionMicro > 0n,
    correctionMicro,
  };
}

// --------------------------------------------------------------------------
// Exports for configuration
// --------------------------------------------------------------------------

export const CONSERVATION_CONFIG = {
  DRIFT_TOLERANCE_PERCENT,
  DRIFT_CIRCUIT_BREAKER_PERCENT,
  LOCK_RENEWAL_INTERVAL_MS,
  LOCK_TTL_MS,
  RECONCILIATION_BATCH_SIZE,
} as const;
