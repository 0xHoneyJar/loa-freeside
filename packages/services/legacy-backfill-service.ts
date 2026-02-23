/**
 * Legacy Backfill Service — Sequence Number Assignment (F-3)
 *
 * One-time backfill job assigning sequence_number to pre-existing lot_entries
 * that were created before event sourcing was enabled.
 *
 * Design:
 *   - Ordering: created_at ASC, id ASC for deterministic assignment (AC-4.6.1)
 *   - Idempotent: only updates WHERE sequence_number IS NULL (AC-4.6.2)
 *   - Atomic range reservation from community_event_sequences (AC-4.6.3)
 *   - Post-backfill verification: 0 NULL sequence_number rows (AC-4.6.4)
 *   - Per-community advisory lock prevents sequence overlap (AC-4.6.5)
 *   - Progress metric: backfill_communities_remaining (AC-4.6.7)
 *
 * @see SDD §4.6 Event Formalization
 * @see Sprint 4, Task 4.6
 * @module packages/services/legacy-backfill-service
 */

import type { Pool, PoolClient } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { emitEconomicMetric } from '../adapters/telemetry/economic-metrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Backfill result for a single community */
export interface CommunityBackfillResult {
  communityId: string;
  entriesBackfilled: number;
  sequenceRangeStart: bigint;
  sequenceRangeEnd: bigint;
  verificationPassed: boolean;
  durationMs: number;
}

/** Overall backfill job result */
export interface BackfillJobResult {
  totalCommunities: number;
  communitiesBackfilled: number;
  communitiesSkipped: number;
  communitiesFailed: number;
  totalEntriesBackfilled: number;
  results: CommunityBackfillResult[];
  errors: BackfillError[];
}

/** Backfill error for a community */
export interface BackfillError {
  communityId: string;
  error: string;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Batch size for fetching NULL-sequence entries per community */
const BACKFILL_BATCH_SIZE = 1000;

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create a legacy backfill service instance.
 */
export function createLegacyBackfillService(pool: Pool) {
  return {
    backfillCommunity: (communityId: string) =>
      backfillCommunity(pool, communityId),
    backfillAll: () => backfillAll(pool),
    verifyBackfill: (communityId: string) =>
      verifyBackfill(pool, communityId),
  };
}

// --------------------------------------------------------------------------
// Per-Community Backfill (AC-4.6.1 through AC-4.6.5)
// --------------------------------------------------------------------------

/**
 * Backfill sequence numbers for a single community.
 *
 * AC-4.6.5: Acquires per-community advisory lock to prevent overlap
 * between backfill and live writes. Lock is held for the entire backfill
 * duration, then released when the transaction commits.
 */
export async function backfillCommunity(
  pool: Pool,
  communityId: string,
): Promise<CommunityBackfillResult> {
  const startTime = Date.now();

  return withCommunityScope(communityId, pool, async (client) => {
    // AC-4.6.5: Acquire advisory lock to prevent live writes during backfill
    const lockKey = await acquireBackfillLock(client, communityId);

    // AC-4.6.2: Count entries needing backfill (idempotent — only NULL sequence)
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM lot_entries
       WHERE community_id = $1
         AND sequence_number IS NULL
         AND lot_id IS NOT NULL`,
      [communityId],
    );

    const totalToBackfill = parseInt(countResult.rows[0].count, 10);

    if (totalToBackfill === 0) {
      return {
        communityId,
        entriesBackfilled: 0,
        sequenceRangeStart: 0n,
        sequenceRangeEnd: 0n,
        verificationPassed: true,
        durationMs: Date.now() - startTime,
      };
    }

    // AC-4.6.3: Atomic range reservation from community_event_sequences
    // First ensure the sequence row exists
    await client.query(
      `INSERT INTO community_event_sequences (community_id, last_sequence)
       VALUES ($1, 0)
       ON CONFLICT (community_id) DO NOTHING`,
      [communityId],
    );

    // Reserve the entire range atomically
    const rangeResult = await client.query<{
      range_start: string;
      range_end: string;
    }>(
      `UPDATE community_event_sequences
       SET last_sequence = last_sequence + $2,
           updated_at = NOW()
       WHERE community_id = $1
       RETURNING (last_sequence - $2 + 1)::text AS range_start,
                 last_sequence::text AS range_end`,
      [communityId, totalToBackfill.toString()],
    );

    const rangeStart = BigInt(rangeResult.rows[0].range_start);
    const rangeEnd = BigInt(rangeResult.rows[0].range_end);

    // AC-4.6.1: Assign sequence numbers ordered by created_at ASC, id ASC
    // Process in batches for memory safety
    let assigned = 0;
    let currentSeq = rangeStart;

    while (assigned < totalToBackfill) {
      const batchSize = Math.min(BACKFILL_BATCH_SIZE, totalToBackfill - assigned);

      // Fetch the next batch of unsequenced entries in deterministic order
      const batchResult = await client.query<{ id: string }>(
        `SELECT id
         FROM lot_entries
         WHERE community_id = $1
           AND sequence_number IS NULL
           AND lot_id IS NOT NULL
         ORDER BY created_at ASC, id ASC
         LIMIT $2`,
        [communityId, batchSize],
      );

      if (batchResult.rows.length === 0) break;

      // Assign sequence numbers to this batch
      for (const row of batchResult.rows) {
        await client.query(
          `UPDATE lot_entries
           SET sequence_number = $1
           WHERE id = $2
             AND sequence_number IS NULL`,
          [currentSeq.toString(), row.id],
        );
        currentSeq++;
        assigned++;
      }
    }

    // AC-4.6.4: Post-backfill verification within the same transaction
    const verification = await verifyBackfillWithClient(client, communityId);

    return {
      communityId,
      entriesBackfilled: assigned,
      sequenceRangeStart: rangeStart,
      sequenceRangeEnd: rangeEnd,
      verificationPassed: verification,
      durationMs: Date.now() - startTime,
    };
  });
}

// --------------------------------------------------------------------------
// Backfill All Communities (AC-4.6.7)
// --------------------------------------------------------------------------

/**
 * Backfill all communities that have unsequenced entries.
 *
 * AC-4.6.7: Emits backfill_communities_remaining metric for monitoring.
 */
export async function backfillAll(pool: Pool): Promise<BackfillJobResult> {
  // Find all communities with NULL sequence entries
  const client = await pool.connect();
  let communities: string[];
  try {
    const result = await client.query<{ community_id: string }>(
      `SELECT DISTINCT community_id
       FROM lot_entries
       WHERE sequence_number IS NULL
         AND lot_id IS NOT NULL
       ORDER BY community_id`,
    );
    communities = result.rows.map((r) => r.community_id);
  } finally {
    client.release();
  }

  const jobResult: BackfillJobResult = {
    totalCommunities: communities.length,
    communitiesBackfilled: 0,
    communitiesSkipped: 0,
    communitiesFailed: 0,
    totalEntriesBackfilled: 0,
    results: [],
    errors: [],
  };

  // AC-4.6.7: Emit initial remaining count
  emitBackfillMetric(communities.length);

  // Process communities sequentially to avoid overwhelming the DB
  for (let i = 0; i < communities.length; i++) {
    const communityId = communities[i];
    try {
      const result = await backfillCommunity(pool, communityId);

      if (result.entriesBackfilled === 0) {
        jobResult.communitiesSkipped++;
      } else {
        jobResult.communitiesBackfilled++;
        jobResult.totalEntriesBackfilled += result.entriesBackfilled;
      }

      jobResult.results.push(result);
    } catch (err) {
      jobResult.communitiesFailed++;
      jobResult.errors.push({
        communityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // AC-4.6.7: Emit remaining count after each community
    const remaining = communities.length - (i + 1);
    emitBackfillMetric(remaining);
  }

  return jobResult;
}

// --------------------------------------------------------------------------
// Verification (AC-4.6.4)
// --------------------------------------------------------------------------

/**
 * Verify that a community has no NULL sequence_number rows
 * (excluding governance entries without lot_id).
 */
export async function verifyBackfill(
  pool: Pool,
  communityId: string,
): Promise<boolean> {
  return withCommunityScope(communityId, pool, async (client) => {
    return verifyBackfillWithClient(client, communityId);
  });
}

async function verifyBackfillWithClient(
  client: PoolClient,
  communityId: string,
): Promise<boolean> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM lot_entries
     WHERE community_id = $1
       AND sequence_number IS NULL
       AND lot_id IS NOT NULL`,
    [communityId],
  );

  return result.rows[0].count === '0';
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * AC-4.6.5: Acquire per-community advisory lock for backfill isolation.
 * Uses a distinct namespace (hash of 'backfill:' + communityId) to avoid
 * collision with sequence allocation locks.
 */
async function acquireBackfillLock(
  client: PoolClient,
  communityId: string,
): Promise<string> {
  const lockResult = await client.query<{ lock_key: string }>(
    `SELECT hashtext('backfill:' || $1)::bigint AS lock_key`,
    [communityId],
  );
  const lockKey = lockResult.rows[0].lock_key;

  await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

  return lockKey;
}

/**
 * AC-4.6.7: Emit backfill progress metric.
 */
function emitBackfillMetric(remaining: number): void {
  try {
    emitEconomicMetric(
      'backfill_communities_remaining' as any,
      remaining,
      { unit: 'Count' },
    );
  } catch {
    // Best-effort metric emission
  }
}
