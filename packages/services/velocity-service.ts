/**
 * Velocity Service — Temporal Dimension (F-2)
 *
 * Computes spend velocity, acceleration, and exhaustion prediction
 * from pre-aggregated hourly rollups. ALL arithmetic uses BigInt —
 * no Number, parseFloat, or Math.* in the computation path.
 *
 * BigInt Truncation Bias (F-3 / Bridgebuilder):
 *   BigInt division truncates toward zero. This creates a systematic bias:
 *   - Velocity is systematically underestimated (floor)
 *   - Exhaustion time is systematically overestimated
 *   This is CONSERVATIVE for budget protection (we undercount spend rate)
 *   but OPTIMISTIC for alerting (we overcount time-to-exhaustion).
 *   For alerting use cases that need conservative-safe estimates, use
 *   `velocityCeilingMicroPerHour` — the truncation-corrected ceiling.
 *
 * Design:
 *   - Reads from community_debit_hourly (not raw lot_entries) (AC-3.3.1)
 *   - BigInt-only arithmetic (AC-3.3.2)
 *   - Exhaustion uses available_balance (AC-3.3.3, IMP-010)
 *   - Half-window acceleration (AC-3.3.4)
 *   - Confidence scoring: high (≥12), medium (≥4), low (<4) (AC-3.3.5)
 *
 * @see SDD §4.5 Temporal Dimension
 * @see Sprint 3, Task 3.3
 * @module packages/services/velocity-service
 */

import type { Pool, PoolClient } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { isFeatureEnabled } from './feature-flags.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Velocity snapshot for a community */
export interface VelocitySnapshot {
  communityId: string;
  computedAt: Date;
  windowHours: bigint;
  velocityMicroPerHour: bigint;
  /** Truncation-corrected ceiling velocity for alerting (F-3). */
  velocityCeilingMicroPerHour?: bigint;
  accelerationMicroPerHour2: bigint;
  availableBalanceMicro: bigint;
  estimatedExhaustionHours: bigint | null;
  confidence: 'high' | 'medium' | 'low';
  bucketCount: bigint;
}

/** Hourly bucket from rollup table */
interface HourlyBucket {
  hour: Date;
  totalMicro: bigint;
  entryCount: bigint;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const DEFAULT_WINDOW_HOURS = 24n;
const HIGH_CONFIDENCE_THRESHOLD = 12n;
const MEDIUM_CONFIDENCE_THRESHOLD = 4n;

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create a velocity service instance.
 *
 * @param pool - PostgreSQL connection pool
 * @returns Velocity service methods
 */
export function createVelocityService(pool: Pool) {
  return {
    computeSnapshot: (communityId: string, windowHours?: bigint) =>
      computeSnapshot(pool, communityId, windowHours),
    getLatestSnapshot: (communityId: string) =>
      getLatestSnapshot(pool, communityId),
  };
}

// --------------------------------------------------------------------------
// Core Computation
// --------------------------------------------------------------------------

/**
 * Compute velocity snapshot for a community.
 *
 * AC-3.3.1: Reads from community_debit_hourly (pre-aggregated).
 * AC-3.3.2: All arithmetic uses BigInt.
 * AC-3.3.3: Exhaustion uses available_balance (total - reserved).
 * AC-3.3.4: Acceleration from half-window comparison.
 * AC-3.3.5: Confidence scoring.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @param windowHours - Lookback window (default: 24)
 * @returns Velocity snapshot
 */
export async function computeSnapshot(
  pool: Pool,
  communityId: string,
  windowHours: bigint = DEFAULT_WINDOW_HOURS,
): Promise<VelocitySnapshot> {
  // Guard: ensure positive window to prevent division by zero and invalid SQL intervals
  const effectiveWindow = windowHours > 0n ? windowHours : DEFAULT_WINDOW_HOURS;

  if (!isFeatureEnabled('FEATURE_VELOCITY_ALERTS')) {
    return createEmptySnapshot(communityId, effectiveWindow);
  }

  return withCommunityScope(communityId, pool, async (client) => {
    // Step 1: Fetch hourly buckets from rollup table (AC-3.3.1)
    const buckets = await fetchHourlyBuckets(client, communityId, effectiveWindow);
    const bucketCount = BigInt(buckets.length);

    // Step 2: Compute velocity (total spend / window hours) — BigInt only
    const totalSpend = buckets.reduce(
      (sum, b) => sum + b.totalMicro,
      0n,
    );
    const velocityMicroPerHour = bucketCount > 0n
      ? totalSpend / effectiveWindow
      : 0n;

    // F-3: Truncation-corrected ceiling for alerting use cases
    const velocityCeilingMicroPerHour = velocityMicroPerHour +
      (totalSpend % effectiveWindow > 0n ? 1n : 0n);

    // Step 3: Compute acceleration from half-window comparison (AC-3.3.4)
    const accelerationMicroPerHour2 = computeAcceleration(
      buckets,
      effectiveWindow,
    );

    // Step 4: Get available balance (AC-3.3.3, IMP-010)
    const availableBalanceMicro = await getAvailableBalance(
      client,
      communityId,
    );

    // Step 5: Compute exhaustion prediction
    const estimatedExhaustionHours = computeExhaustion(
      availableBalanceMicro,
      velocityMicroPerHour,
    );

    // Step 6: Confidence scoring (AC-3.3.5)
    const confidence = scoreConfidence(bucketCount);

    return {
      communityId,
      computedAt: new Date(),
      windowHours: effectiveWindow,
      velocityMicroPerHour,
      velocityCeilingMicroPerHour,
      accelerationMicroPerHour2,
      availableBalanceMicro,
      estimatedExhaustionHours,
      confidence,
      bucketCount,
    };
  });
}

// --------------------------------------------------------------------------
// Helpers — all BigInt arithmetic
// --------------------------------------------------------------------------

/**
 * Fetch hourly debit buckets from rollup table.
 * AC-3.3.1: Reads from community_debit_hourly, NOT raw lot_entries.
 */
async function fetchHourlyBuckets(
  client: PoolClient,
  communityId: string,
  windowHours: bigint,
): Promise<HourlyBucket[]> {
  const result = await client.query<{
    hour: Date;
    total_micro: string;
    entry_count: string;
  }>(
    `SELECT hour, total_micro, entry_count
     FROM community_debit_hourly
     WHERE community_id = $1
       AND hour >= NOW() - ($2 || ' hours')::INTERVAL
     ORDER BY hour ASC`,
    [communityId, windowHours.toString()],
  );

  return result.rows.map((row) => ({
    hour: row.hour,
    totalMicro: BigInt(row.total_micro),
    entryCount: BigInt(row.entry_count),
  }));
}

/**
 * Compute acceleration from half-window comparison.
 *
 * AC-3.3.4: Splits buckets into first-half and second-half,
 * computes velocity for each half, then acceleration =
 * (v_second - v_first) / half_window_hours.
 */
function computeAcceleration(
  buckets: HourlyBucket[],
  windowHours: bigint,
): bigint {
  if (buckets.length < 2) return 0n;

  const midpoint = buckets.length >> 1; // integer division by 2
  const halfWindowHours = windowHours / 2n || 1n;

  const firstHalf = buckets.slice(0, midpoint);
  const secondHalf = buckets.slice(midpoint);

  const firstSpend = firstHalf.reduce((s, b) => s + b.totalMicro, 0n);
  const secondSpend = secondHalf.reduce((s, b) => s + b.totalMicro, 0n);

  const firstVelocity = firstSpend / halfWindowHours;
  const secondVelocity = secondSpend / halfWindowHours;

  // acceleration = change in velocity / time
  return (secondVelocity - firstVelocity) / halfWindowHours;
}

/**
 * Get available balance for a community.
 *
 * AC-3.3.3 (IMP-010): available = total_balance - total_reserved.
 * Uses lot_balances view for total, budgets table for reserved.
 */
async function getAvailableBalance(
  client: PoolClient,
  communityId: string,
): Promise<bigint> {
  // Total balance from lot_balances view
  const balanceResult = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(remaining_micro), 0) AS total
     FROM lot_balances
     WHERE community_id = $1 AND status = 'active'`,
    [communityId],
  );
  const totalBalance = BigInt(balanceResult.rows[0].total);

  // Total reserved from Redis-synced budgets
  // In Postgres-first mode, reserved amount is tracked in budget table
  const reservedResult = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(reserved_micro), 0) AS total
     FROM budgets
     WHERE community_id = $1`,
    [communityId],
  );
  const totalReserved = BigInt(reservedResult.rows[0].total);

  // available = total - reserved (floor at 0)
  const available = totalBalance - totalReserved;
  return available > 0n ? available : 0n;
}

/**
 * Compute estimated exhaustion hours.
 *
 * If velocity is zero or negative, returns null (not exhausting).
 * Uses BigInt division — no floating-point.
 */
function computeExhaustion(
  availableBalanceMicro: bigint,
  velocityMicroPerHour: bigint,
): bigint | null {
  if (velocityMicroPerHour <= 0n) return null;
  return availableBalanceMicro / velocityMicroPerHour;
}

/**
 * Score confidence based on bucket count.
 *
 * AC-3.3.5:
 *   - high: ≥12 buckets
 *   - medium: ≥4 buckets
 *   - low: <4 buckets
 */
function scoreConfidence(
  bucketCount: bigint,
): 'high' | 'medium' | 'low' {
  if (bucketCount >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (bucketCount >= MEDIUM_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}

/**
 * Create an empty snapshot when feature is disabled.
 */
function createEmptySnapshot(
  communityId: string,
  windowHours: bigint,
): VelocitySnapshot {
  return {
    communityId,
    computedAt: new Date(),
    windowHours,
    velocityMicroPerHour: 0n,
    accelerationMicroPerHour2: 0n,
    availableBalanceMicro: 0n,
    estimatedExhaustionHours: null,
    confidence: 'low',
    bucketCount: 0n,
  };
}

// --------------------------------------------------------------------------
// Latest Snapshot Query
// --------------------------------------------------------------------------

/**
 * Get the most recent velocity snapshot for a community.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @returns Latest velocity snapshot or null
 */
export async function getLatestSnapshot(
  pool: Pool,
  communityId: string,
): Promise<VelocitySnapshot | null> {
  return withCommunityScope(communityId, pool, async (client) => {
    const result = await client.query<{
      community_id: string;
      computed_at: Date;
      window_hours: string;
      velocity_micro_per_hour: string;
      acceleration_micro_per_hour2: string;
      available_balance_micro: string;
      estimated_exhaustion_hours: string | null;
      confidence: string;
      bucket_count: string;
    }>(
      `SELECT *
       FROM community_velocity
       WHERE community_id = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [communityId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      communityId: row.community_id,
      computedAt: row.computed_at,
      windowHours: BigInt(row.window_hours),
      velocityMicroPerHour: BigInt(row.velocity_micro_per_hour),
      accelerationMicroPerHour2: BigInt(row.acceleration_micro_per_hour2),
      availableBalanceMicro: BigInt(row.available_balance_micro),
      estimatedExhaustionHours: row.estimated_exhaustion_hours
        ? BigInt(row.estimated_exhaustion_hours)
        : null,
      confidence: row.confidence as 'high' | 'medium' | 'low',
      bucketCount: BigInt(row.bucket_count),
    };
  });
}

// --------------------------------------------------------------------------
// Store Snapshot
// --------------------------------------------------------------------------

/**
 * Store a velocity snapshot in the database.
 *
 * @param client - PostgreSQL client (within transaction)
 * @param snapshot - Velocity snapshot to store
 */
export async function storeSnapshot(
  client: PoolClient,
  snapshot: VelocitySnapshot,
): Promise<void> {
  await client.query(
    `INSERT INTO community_velocity (
       community_id, computed_at, window_hours,
       velocity_micro_per_hour, acceleration_micro_per_hour2,
       available_balance_micro, estimated_exhaustion_hours,
       confidence, bucket_count
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      snapshot.communityId,
      snapshot.computedAt,
      snapshot.windowHours.toString(),
      snapshot.velocityMicroPerHour.toString(),
      snapshot.accelerationMicroPerHour2.toString(),
      snapshot.availableBalanceMicro.toString(),
      snapshot.estimatedExhaustionHours?.toString() ?? null,
      snapshot.confidence,
      snapshot.bucketCount.toString(),
    ],
  );
}
