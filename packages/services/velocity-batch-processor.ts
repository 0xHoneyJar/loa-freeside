/**
 * Velocity Batch Processor — Adaptive Parallelism (F-2)
 *
 * EventBridge-scheduled task (15min) computing velocity for all active
 * communities with backpressure monitoring.
 *
 * Design:
 *   - Batches of 100 communities (AC-3.4.1)
 *   - Adaptive parallelism: default 10, reduces to 1 under load (AC-3.4.2)
 *   - Recovery: restores parallelism after 3 cool batches (AC-3.4.3)
 *   - velocity_backpressure_active metric (AC-3.4.4)
 *   - Stores snapshots in community_velocity (AC-3.4.5)
 *
 * @see SDD §4.5 Temporal Dimension
 * @see Sprint 3, Task 3.4
 * @module packages/services/velocity-batch-processor
 */

import type { Pool } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { computeSnapshot, storeSnapshot } from './velocity-service.js';
import { emitEconomicMetric } from '../adapters/telemetry/economic-metrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Batch processing result */
export interface BatchResult {
  totalCommunities: number;
  processed: number;
  errors: number;
  backpressureActive: boolean;
  currentParallelism: number;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_PARALLELISM = 10;
const MIN_PARALLELISM = 1;
const BACKPRESSURE_THRESHOLD_MS = 500; // p95 > 500ms → reduce
const RECOVERY_THRESHOLD_MS = 200;     // p95 < 200ms → recover
const RECOVERY_BATCHES_REQUIRED = 3;   // 3 consecutive cool batches

// --------------------------------------------------------------------------
// Backpressure State
// --------------------------------------------------------------------------

let currentParallelism = DEFAULT_PARALLELISM;
let consecutiveCoolBatches = 0;
let backpressureActive = false;

// --------------------------------------------------------------------------
// Core Processor
// --------------------------------------------------------------------------

/**
 * Run velocity computation for all active communities.
 *
 * AC-3.4.1: Processes in batches of 100 with configurable parallelism.
 * AC-3.4.2: Reduces parallelism when p95 latency > 500ms.
 * AC-3.4.3: Restores when p95 < 200ms for 3 consecutive batches.
 *
 * @param pool - PostgreSQL connection pool
 * @returns Batch processing result
 */
export async function runVelocityBatch(pool: Pool): Promise<BatchResult> {
  // Get all communities with recent activity
  const communities = await pool.query<{ community_id: string }>(
    `SELECT DISTINCT community_id
     FROM community_debit_hourly
     WHERE hour >= NOW() - INTERVAL '7 days'
     ORDER BY community_id`,
  );

  const communityIds = communities.rows.map((r) => r.community_id);
  let processed = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < communityIds.length; i += DEFAULT_BATCH_SIZE) {
    const batch = communityIds.slice(i, i + DEFAULT_BATCH_SIZE);
    const latencies: bigint[] = [];

    // Process batch with adaptive parallelism
    const chunks = chunkArray(batch, currentParallelism);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (communityId) => {
          const start = process.hrtime.bigint();

          const snapshot = await computeSnapshot(pool, communityId);

          // Store snapshot (AC-3.4.5)
          await withCommunityScope(communityId, pool, async (client) => {
            await storeSnapshot(client, snapshot);
          });

          const elapsed = process.hrtime.bigint() - start;
          latencies.push(elapsed / 1_000_000n); // ns → ms
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          processed++;
        } else {
          errors++;
        }
      }
    }

    // Evaluate backpressure after each batch
    adjustParallelism(latencies);
  }

  // Emit backpressure metric (AC-3.4.4)
  emitEconomicMetric({
    name: 'usage_event_count',
    value: backpressureActive ? 1 : 0,
    unit: 'Count',
    dimensions: { operation: 'velocity_backpressure_active' },
  });

  return {
    totalCommunities: communityIds.length,
    processed,
    errors,
    backpressureActive,
    currentParallelism,
  };
}

// --------------------------------------------------------------------------
// Backpressure Logic
// --------------------------------------------------------------------------

/**
 * Adjust parallelism based on observed latencies.
 *
 * AC-3.4.2: Reduce to 1 when p95 > 500ms.
 * AC-3.4.3: Restore when p95 < 200ms for 3 consecutive batches.
 */
function adjustParallelism(latencies: bigint[]): void {
  if (latencies.length === 0) return;

  const sorted = [...latencies].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const p95Index = BigInt(sorted.length - 1) * 95n / 100n;
  const p95 = sorted[Number(p95Index)];

  if (p95 > BigInt(BACKPRESSURE_THRESHOLD_MS)) {
    // Enter backpressure mode
    currentParallelism = MIN_PARALLELISM;
    backpressureActive = true;
    consecutiveCoolBatches = 0;
  } else if (p95 < BigInt(RECOVERY_THRESHOLD_MS)) {
    consecutiveCoolBatches++;
    if (consecutiveCoolBatches >= RECOVERY_BATCHES_REQUIRED) {
      // Recovery: restore parallelism (AC-3.4.3)
      currentParallelism = DEFAULT_PARALLELISM;
      backpressureActive = false;
      consecutiveCoolBatches = 0;
    }
  } else {
    // Between thresholds — maintain current state
    consecutiveCoolBatches = 0;
  }
}

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

/**
 * Split array into chunks of given size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// --------------------------------------------------------------------------
// Reset (testing only)
// --------------------------------------------------------------------------

/** Reset backpressure state for testing. */
export function _resetBackpressureForTesting(): void {
  currentParallelism = DEFAULT_PARALLELISM;
  consecutiveCoolBatches = 0;
  backpressureActive = false;
}
