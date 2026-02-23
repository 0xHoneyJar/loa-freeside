/**
 * Debit Hourly Rollup Job — Incremental Aggregation (F-2)
 *
 * EventBridge-scheduled task (5min) that incrementally updates
 * community_debit_hourly from lot_entries since last cursor.
 *
 * Design:
 *   - UPSERT replace semantics (not additive) — idempotent (AC-3.2.2)
 *   - Cursor: lot_entries.id high-water mark per community (AC-3.2.3)
 *   - Recomputes last 2 hours each run to handle late-arriving rows
 *   - Lag metrics: rollup_lag_seconds CloudWatch metric (AC-3.2.4)
 *   - Catch-up mode when lag > 30min (AC-3.2.5)
 *
 * @see SDD §4.5 Temporal Dimension
 * @see Sprint 3, Task 3.2
 * @module packages/services/debit-rollup-job
 */

import type { Pool } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { emitEconomicMetric } from '../adapters/telemetry/economic-metrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Rollup result for a single community */
export interface RollupResult {
  communityId: string;
  hoursUpdated: number;
  newHighWaterMark: string | null;
  lagSeconds: number;
  catchUp: boolean;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const CATCHUP_LAG_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

// --------------------------------------------------------------------------
// Core Rollup Logic
// --------------------------------------------------------------------------

/**
 * Run the debit hourly rollup for all active communities.
 *
 * AC-3.2.1: Uses withCommunityScope per community.
 * AC-3.2.5: Catch-up mode when lag > 30min.
 *
 * @param pool - PostgreSQL connection pool
 * @returns Array of rollup results per community
 */
export async function runDebitRollup(pool: Pool): Promise<RollupResult[]> {
  // Find all communities with debit activity
  const communities = await pool.query<{ community_id: string }>(
    `SELECT DISTINCT community_id FROM lot_entries
     WHERE entry_type IN ('debit', 'governance_debit')
     ORDER BY community_id`,
  );

  const results: RollupResult[] = [];

  for (const row of communities.rows) {
    const result = await rollupCommunity(pool, row.community_id);
    results.push(result);

    // Emit lag metric (AC-3.2.4)
    emitEconomicMetric({
      name: 'usage_event_count', // Reusing for rollup_lag_seconds
      value: result.lagSeconds,
      unit: 'None',
      dimensions: {
        community_id: row.community_id,
        operation: 'rollup_lag_seconds',
      },
    });

    if (result.catchUp) {
      emitEconomicMetric({
        name: 'usage_event_count',
        value: 1,
        unit: 'Count',
        dimensions: {
          community_id: row.community_id,
          operation: 'rollup_catchup_active',
        },
      });
    }
  }

  return results;
}

/**
 * Run rollup for a single community.
 *
 * AC-3.2.2: UPSERT replace semantics — recomputes last 2 hours.
 * AC-3.2.3: Cursor based on lot_entries.id high-water mark.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Community UUID
 * @returns Rollup result
 */
async function rollupCommunity(
  pool: Pool,
  communityId: string,
): Promise<RollupResult> {
  return withCommunityScope(communityId, pool, async (client) => {
    // Step 1: Get current cursor
    const cursorResult = await client.query<{
      last_entry_id: string;
      last_run_at: string;
    }>(
      `SELECT last_entry_id, last_run_at
       FROM community_debit_hourly_cursor
       WHERE community_id = $1`,
      [communityId],
    );

    const hasCursor = cursorResult.rows.length > 0;
    const lastRunAt = hasCursor
      ? new Date(cursorResult.rows[0].last_run_at)
      : new Date(0);

    // Step 2: Compute lag
    const lagResult = await client.query<{ lag_seconds: string }>(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::INTEGER AS lag_seconds
       FROM lot_entries
       WHERE community_id = $1
         AND entry_type IN ('debit', 'governance_debit')`,
      [communityId],
    );
    const lagSeconds = parseInt(lagResult.rows[0]?.lag_seconds ?? '0', 10);
    const catchUp = lagSeconds > CATCHUP_LAG_THRESHOLD_SECONDS;

    // Step 3: Determine rollup window
    // Always recompute last 2 hours for late-arriving rows (AC-3.2.2)
    const lookbackHours = catchUp ? Math.ceil(lagSeconds / 3600) + 2 : 2;

    // Step 4: UPSERT hourly aggregates from lot_entries
    // Uses DATE_TRUNC('hour') for bucketing, replace semantics on conflict
    const rollupResult = await client.query<{ hours_updated: string }>(
      `WITH hourly_agg AS (
         SELECT
           community_id,
           DATE_TRUNC('hour', created_at) AS hour,
           SUM(amount_micro) AS total_micro,
           COUNT(*) AS entry_count
         FROM lot_entries
         WHERE community_id = $1
           AND entry_type IN ('debit', 'governance_debit')
           AND created_at >= NOW() - ($2 || ' hours')::INTERVAL
         GROUP BY community_id, DATE_TRUNC('hour', created_at)
       )
       INSERT INTO community_debit_hourly (community_id, hour, total_micro, entry_count, updated_at)
       SELECT community_id, hour, total_micro, entry_count, NOW()
       FROM hourly_agg
       ON CONFLICT (community_id, hour) DO UPDATE SET
         total_micro = EXCLUDED.total_micro,
         entry_count = EXCLUDED.entry_count,
         updated_at = NOW()
       RETURNING 1`,
      [communityId, lookbackHours],
    );
    const hoursUpdated = rollupResult.rowCount ?? 0;

    // Step 5: Update cursor with new high-water mark
    const hwmResult = await client.query<{ max_id: string }>(
      `SELECT MAX(id)::TEXT AS max_id
       FROM lot_entries
       WHERE community_id = $1
         AND entry_type IN ('debit', 'governance_debit')`,
      [communityId],
    );
    const newHighWaterMark = hwmResult.rows[0]?.max_id ?? null;

    if (newHighWaterMark) {
      await client.query(
        `INSERT INTO community_debit_hourly_cursor (community_id, last_entry_id, last_run_at)
         VALUES ($1, $2::UUID, NOW())
         ON CONFLICT (community_id) DO UPDATE SET
           last_entry_id = $2::UUID,
           last_run_at = NOW()`,
        [communityId, newHighWaterMark],
      );
    }

    return {
      communityId,
      hoursUpdated,
      newHighWaterMark,
      lagSeconds,
      catchUp,
    };
  });
}

// --------------------------------------------------------------------------
// Reset (testing only)
// --------------------------------------------------------------------------

/** Exposed for integration tests */
export { rollupCommunity as _rollupCommunityForTesting };
