/**
 * Event Sourcing Service — Event Formalization (F-3)
 *
 * Per-community monotonic sequencing, replay, and consistency verification.
 * All sequence allocation is race-safe with INSERT ON CONFLICT DO NOTHING
 * for first-write initialization.
 *
 * Dual Replay Architecture (F-2 / Bridgebuilder):
 *   The ledger serves a dual purpose — economic events (credit, debit,
 *   expiry, credit_back) and governance events (governance_debit,
 *   governance_credit). This mirrors Ethereum's dual event log model:
 *   ERC-20 Transfer events serve both balance reconstruction and
 *   governance history (delegation, voting power snapshots).
 *
 *   - `replayState()`: Economic replay — reconstructs lot balances from
 *     the full event journal (balance reconstruction).
 *   - `replayGovernanceHistory()`: Governance replay — filters for
 *     governance entry types and returns a decision timeline
 *     (governance audit trail).
 *
 *   The distinction matters because economic replay aggregates by lot
 *   (per-lot balance state), while governance replay aggregates by time
 *   (chronological decision history). Same events, different projections.
 *
 * Design:
 *   - allocateSequence: race-safe per-community monotonic sequence (AC-4.3.1)
 *   - replayState: canonical posting model replay (AC-4.3.2)
 *   - replayGovernanceHistory: governance decision timeline (F-2)
 *   - verifyConsistency: compare replay vs lot_balances (AC-4.3.4)
 *   - sequenceGapReport: identify gaps with probable cause (AC-4.3.6)
 *   - Hard 10k event limit per replay invocation (AC-4.3.7)
 *
 * @see SDD §4.6 Event Formalization
 * @see Sprint 4, Task 4.3
 * @module packages/services/event-sourcing-service
 */

import type { Pool, PoolClient } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { isFeatureEnabled } from './feature-flags.js';
import { getSequenceLockMode } from './feature-flags.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Replay event from lot_entries */
export interface ReplayEvent {
  id: string;
  lotId: string;
  communityId: string;
  entryType: string;
  amountMicro: bigint;
  sequenceNumber: bigint;
  correlationId: string;
  causationId: string;
  createdAt: Date;
}

/** Replayed lot state */
export interface ReplayedLotState {
  lotId: string;
  creditedMicro: bigint;
  debitedMicro: bigint;
  expiredMicro: bigint;
  creditBackMicro: bigint;
  governanceDebitMicro: bigint;
  governanceCreditMicro: bigint;
  remainingMicro: bigint;
  entryCount: number;
}

/** Consistency verification result */
export interface ConsistencyResult {
  communityId: string;
  lotsChecked: number;
  lotsConsistent: number;
  lotsDrifted: number;
  drifts: LotDrift[];
  totalDriftMicro: bigint;
}

/** Individual lot drift */
export interface LotDrift {
  lotId: string;
  replayedRemaining: bigint;
  actualRemaining: bigint;
  driftMicro: bigint;
}

/** Sequence gap report entry */
export interface SequenceGap {
  afterSequence: bigint;
  beforeSequence: bigint;
  gapSize: bigint;
  probableCause: 'transaction_rollback' | 'range_allocation_skip' | 'backfill_gap' | 'unknown';
}

/** Governance replay event (F-2) */
export interface GovernanceReplayEvent {
  id: string;
  communityId: string;
  entryType: 'governance_debit' | 'governance_credit';
  amountMicro: bigint;
  sequenceNumber: bigint;
  correlationId: string;
  causationId: string;
  createdAt: Date;
}

/** Allocated sequence result */
export interface AllocatedSequence {
  sequenceNumber: bigint;
  communityId: string;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** AC-4.3.7: Hard limit on replay events per invocation */
const MAX_REPLAY_EVENTS = 10_000;

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create an event sourcing service instance.
 */
export function createEventSourcingService(pool: Pool) {
  return {
    allocateSequence: (communityId: string) =>
      allocateSequence(pool, communityId),
    replayState: (communityId: string, fromSequence?: bigint, limit?: number) =>
      replayState(pool, communityId, fromSequence, limit),
    replayGovernanceHistory: (communityId: string, fromSequence?: bigint, limit?: number) =>
      replayGovernanceHistory(pool, communityId, fromSequence, limit),
    verifyConsistency: (communityId: string) =>
      verifyConsistency(pool, communityId),
    sequenceGapReport: (communityId: string) =>
      sequenceGapReport(pool, communityId),
  };
}

// --------------------------------------------------------------------------
// Sequence Allocation (AC-4.3.1)
// --------------------------------------------------------------------------

/**
 * Allocate the next monotonic sequence number for a community.
 *
 * AC-4.3.1: Uses INSERT ON CONFLICT DO NOTHING for first-write safety.
 * Race condition: if two transactions both try to initialize, only one wins.
 * Both then proceed to the UPDATE RETURNING which is serialized by row lock.
 *
 * Lock mode controlled by SEQUENCE_LOCK_MODE feature flag:
 *   - for_update: SELECT FOR UPDATE + UPDATE RETURNING (AC-4.4.1)
 *   - advisory_lock: pg_advisory_xact_lock + UPDATE RETURNING (AC-4.4.2)
 *   - range_allocation: atomic range reservation (AC-4.4.3)
 */
export async function allocateSequence(
  pool: Pool,
  communityId: string,
): Promise<AllocatedSequence> {
  return withCommunityScope(communityId, pool, async (client) => {
    // First-write safety: initialize row if not exists (AC-4.3.1)
    await client.query(
      `INSERT INTO community_event_sequences (community_id, last_sequence)
       VALUES ($1, 0)
       ON CONFLICT (community_id) DO NOTHING`,
      [communityId],
    );

    const lockMode = getSequenceLockMode();
    let nextSequence: bigint;

    switch (lockMode) {
      case 'for_update':
        nextSequence = await allocateForUpdate(client, communityId);
        break;
      case 'advisory_lock':
        nextSequence = await allocateAdvisoryLock(client, communityId);
        break;
      case 'range_allocation':
        nextSequence = await allocateRange(client, communityId);
        break;
      default:
        nextSequence = await allocateForUpdate(client, communityId);
    }

    return { sequenceNumber: nextSequence, communityId };
  });
}

/**
 * Tier 1: SELECT FOR UPDATE + UPDATE RETURNING (AC-4.4.1)
 * Simple pessimistic locking. Blocks concurrent allocations.
 */
async function allocateForUpdate(
  client: PoolClient,
  communityId: string,
): Promise<bigint> {
  const result = await client.query<{ next_seq: string }>(
    `UPDATE community_event_sequences
     SET last_sequence = last_sequence + 1, updated_at = NOW()
     WHERE community_id = $1
     RETURNING last_sequence AS next_seq`,
    [communityId],
  );

  if (result.rows.length === 0) {
    throw new Error(`No sequence row for community ${communityId}`);
  }

  return BigInt(result.rows[0].next_seq);
}

/**
 * Tier 2: Advisory lock + UPDATE RETURNING (AC-4.4.2)
 * Uses pg_advisory_xact_lock to serialize without row-level locks.
 * Lock is released when the transaction ends.
 */
async function allocateAdvisoryLock(
  client: PoolClient,
  communityId: string,
): Promise<bigint> {
  // Hash communityId to get a stable lock key
  const lockResult = await client.query<{ lock_key: string }>(
    `SELECT hashtext($1)::bigint AS lock_key`,
    [communityId],
  );
  const lockKey = lockResult.rows[0].lock_key;

  // Acquire advisory lock (released at transaction end)
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

  // Now safe to update without row lock contention
  return allocateForUpdate(client, communityId);
}

/**
 * Tier 3: Range allocation (AC-4.4.3)
 * Reserves a range of sequence numbers atomically. Reduces lock contention
 * for high-throughput communities by amortizing the lock across N allocations.
 *
 * For simplicity, this allocates 1 at a time but uses the range tracking
 * infrastructure. A future optimization can allocate ranges of N.
 */
async function allocateRange(
  client: PoolClient,
  communityId: string,
): Promise<bigint> {
  const rangeSize = 1n;

  const result = await client.query<{ range_start: string; range_end: string }>(
    `UPDATE community_event_sequences
     SET last_sequence = last_sequence + $2,
         allocated_ranges = allocated_ranges || jsonb_build_array(
           jsonb_build_object(
             'start', last_sequence + 1,
             'end', last_sequence + $2,
             'allocated_at', NOW()
           )
         ),
         updated_at = NOW()
     WHERE community_id = $1
     RETURNING (last_sequence - $2 + 1)::text AS range_start,
               last_sequence::text AS range_end`,
    [communityId, rangeSize.toString()],
  );

  if (result.rows.length === 0) {
    throw new Error(`No sequence row for community ${communityId}`);
  }

  return BigInt(result.rows[0].range_start);
}

// --------------------------------------------------------------------------
// Replay (AC-4.3.2)
// --------------------------------------------------------------------------

/**
 * Clamp limit to a safe non-negative integer within MAX_REPLAY_EVENTS.
 * Prevents negative LIMIT (which PostgreSQL treats as unbounded).
 */
function clampReplayLimit(limit: number): number {
  const normalized = Number.isFinite(limit) ? Math.floor(limit) : MAX_REPLAY_EVENTS;
  return Math.min(Math.max(normalized, 0), MAX_REPLAY_EVENTS);
}

/**
 * Internal replay implementation that operates on an existing client.
 * Used by both replayState (public) and verifyConsistency (same-transaction).
 */
async function replayStateWithClient(
  client: PoolClient,
  communityId: string,
  fromSequence: bigint = 1n,
  limit: number = MAX_REPLAY_EVENTS,
): Promise<Map<string, ReplayedLotState>> {
  const effectiveLimit = clampReplayLimit(limit);

  const result = await client.query<{
    id: string;
    lot_id: string;
    community_id: string;
    entry_type: string;
    amount_micro: string;
    sequence_number: string;
    correlation_id: string;
    causation_id: string;
    created_at: Date;
  }>(
    `SELECT id, lot_id, community_id, entry_type, amount_micro,
            sequence_number, correlation_id, causation_id, created_at
     FROM lot_entries
     WHERE community_id = $1
       AND sequence_number IS NOT NULL
       AND sequence_number >= $2
     ORDER BY sequence_number ASC
     LIMIT $3`,
    [communityId, fromSequence.toString(), effectiveLimit],
  );

  const lotStates = new Map<string, ReplayedLotState>();

  for (const row of result.rows) {
    const lotId = row.lot_id;
    if (!lotId) continue; // governance entries without lot_id

    let state = lotStates.get(lotId);
    if (!state) {
      state = {
        lotId,
        creditedMicro: 0n,
        debitedMicro: 0n,
        expiredMicro: 0n,
        creditBackMicro: 0n,
        governanceDebitMicro: 0n,
        governanceCreditMicro: 0n,
        remainingMicro: 0n,
        entryCount: 0,
      };
      lotStates.set(lotId, state);
    }

    const amount = BigInt(row.amount_micro);
    state.entryCount++;

    // AC-4.3.2: Canonical posting model
    switch (row.entry_type) {
      case 'credit':
        state.creditedMicro += amount;
        state.remainingMicro += amount;
        break;
      case 'credit_back':
        state.creditBackMicro += amount;
        state.remainingMicro += amount;
        break;
      case 'debit':
        state.debitedMicro += amount;
        state.remainingMicro -= amount;
        break;
      case 'expiry':
        // AC-4.3.3: Uses explicit amount_micro, not derived from state
        state.expiredMicro += amount;
        state.remainingMicro -= amount;
        break;
      case 'governance_debit':
        state.governanceDebitMicro += amount;
        state.remainingMicro -= amount;
        break;
      case 'governance_credit':
        state.governanceCreditMicro += amount;
        state.remainingMicro += amount;
        break;
    }
  }

  return lotStates;
}

/**
 * Replay events to compute lot state from the event journal.
 *
 * AC-4.3.2: Follows canonical posting model:
 *   credit → adds to lot balance
 *   credit_back → adds to lot balance
 *   debit → subtracts from lot balance
 *   expiry → subtracts from lot balance (uses explicit amount_micro, AC-4.3.3)
 *   governance_debit → subtracts from lot balance
 *   governance_credit → adds to lot balance
 *
 * AC-4.3.7: Hard limit of 10k events per invocation.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @param fromSequence - Start replay from this sequence (inclusive)
 * @param limit - Max events to replay (capped at 10k)
 * @returns Map of lot states keyed by lotId
 */
export async function replayState(
  pool: Pool,
  communityId: string,
  fromSequence: bigint = 1n,
  limit: number = MAX_REPLAY_EVENTS,
): Promise<Map<string, ReplayedLotState>> {
  return withCommunityScope(communityId, pool, async (client) => {
    return replayStateWithClient(client, communityId, fromSequence, limit);
  });
}

// --------------------------------------------------------------------------
// Governance Replay (F-2)
// --------------------------------------------------------------------------

/**
 * Replay governance-specific history for a community.
 *
 * Unlike `replayState()` which reconstructs per-lot balances from ALL event
 * types, this method filters for governance entry types only and returns a
 * chronological decision timeline. Think of it as the governance audit trail:
 * when were limits changed, by how much, and in what sequence?
 *
 * Entry types: `governance_debit` and `governance_credit` (confirmed from
 * the `replayStateWithClient` switch cases at lines 339-346).
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @param fromSequence - Start from this sequence (inclusive)
 * @param limit - Max events to return (capped at 10k)
 * @returns Chronological governance decision timeline
 */
export async function replayGovernanceHistory(
  pool: Pool,
  communityId: string,
  fromSequence: bigint = 1n,
  limit: number = MAX_REPLAY_EVENTS,
): Promise<GovernanceReplayEvent[]> {
  return withCommunityScope(communityId, pool, async (client) => {
    const effectiveLimit = clampReplayLimit(limit);

    const result = await client.query<{
      id: string;
      community_id: string;
      entry_type: string;
      amount_micro: string;
      sequence_number: string;
      correlation_id: string;
      causation_id: string;
      created_at: Date;
    }>(
      `SELECT id, community_id, entry_type, amount_micro,
              sequence_number, correlation_id, causation_id, created_at
       FROM lot_entries
       WHERE community_id = $1
         AND sequence_number IS NOT NULL
         AND sequence_number >= $2
         AND entry_type IN ('governance_debit', 'governance_credit')
       ORDER BY sequence_number ASC
       LIMIT $3`,
      [communityId, fromSequence.toString(), effectiveLimit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      communityId: row.community_id,
      entryType: row.entry_type as 'governance_debit' | 'governance_credit',
      amountMicro: BigInt(row.amount_micro),
      sequenceNumber: BigInt(row.sequence_number),
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      createdAt: row.created_at,
    }));
  });
}

// --------------------------------------------------------------------------
// Consistency Verification (AC-4.3.4)
// --------------------------------------------------------------------------

/**
 * Compare replayed state vs lot_balances view.
 *
 * AC-4.3.4: Drift reported as BigInt. Only checks lots with sequenced events.
 *
 * @returns Consistency result with per-lot drift details
 */
export async function verifyConsistency(
  pool: Pool,
  communityId: string,
): Promise<ConsistencyResult> {
  return withCommunityScope(communityId, pool, async (client) => {
    // Replay within the same transaction snapshot as balance query
    const replayedStates = await replayStateWithClient(client, communityId);

    // Fetch actual balances from lot_balances view (same transaction)
    const balances = await client.query<{
      lot_id: string;
      remaining_micro: string;
    }>(
      `SELECT lot_id, remaining_micro
       FROM lot_balances
       WHERE community_id = $1`,
      [communityId],
    );

    const actualMap = new Map<string, bigint>();
    for (const row of balances.rows) {
      actualMap.set(row.lot_id, BigInt(row.remaining_micro));
    }

    const drifts: LotDrift[] = [];
    let totalDriftMicro = 0n;

    for (const [lotId, state] of replayedStates) {
      const actual = actualMap.get(lotId) ?? 0n;
      const drift = state.remainingMicro - actual;

      if (drift !== 0n) {
        const absDrift = drift < 0n ? -drift : drift;
        drifts.push({
          lotId,
          replayedRemaining: state.remainingMicro,
          actualRemaining: actual,
          driftMicro: drift,
        });
        totalDriftMicro += absDrift;
      }
    }

    return {
      communityId,
      lotsChecked: replayedStates.size,
      lotsConsistent: replayedStates.size - drifts.length,
      lotsDrifted: drifts.length,
      drifts,
      totalDriftMicro,
    };
  });
}

// --------------------------------------------------------------------------
// Sequence Gap Report (AC-4.3.6)
// --------------------------------------------------------------------------

/**
 * Identify gaps in the sequence number series for a community.
 *
 * AC-4.3.6: Reports gaps with probable cause classification.
 */
export async function sequenceGapReport(
  pool: Pool,
  communityId: string,
): Promise<SequenceGap[]> {
  return withCommunityScope(communityId, pool, async (client) => {
    // Use window function to find gaps between consecutive sequences
    const result = await client.query<{
      prev_seq: string;
      curr_seq: string;
      gap_size: string;
    }>(
      `WITH sequenced AS (
        SELECT sequence_number,
               LAG(sequence_number) OVER (ORDER BY sequence_number) AS prev_seq
        FROM lot_entries
        WHERE community_id = $1
          AND sequence_number IS NOT NULL
        ORDER BY sequence_number ASC
        LIMIT $2
      )
      SELECT prev_seq::text, sequence_number::text AS curr_seq,
             (sequence_number - prev_seq - 1)::text AS gap_size
      FROM sequenced
      WHERE prev_seq IS NOT NULL
        AND sequence_number - prev_seq > 1`,
      [communityId, MAX_REPLAY_EVENTS],
    );

    return result.rows.map((row) => {
      const gapSize = BigInt(row.gap_size);
      return {
        afterSequence: BigInt(row.prev_seq),
        beforeSequence: BigInt(row.curr_seq),
        gapSize,
        probableCause: classifyGap(gapSize),
      };
    });
  });
}

/**
 * Classify probable cause of a sequence gap.
 */
function classifyGap(gapSize: bigint): SequenceGap['probableCause'] {
  if (gapSize === 1n) return 'transaction_rollback';
  if (gapSize <= 10n) return 'transaction_rollback';
  if (gapSize <= 100n) return 'range_allocation_skip';
  if (gapSize > 1000n) return 'backfill_gap';
  return 'unknown';
}
