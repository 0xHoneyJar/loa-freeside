/**
 * Idempotency Key Sweeper Job (Sprint 236, Task 7.3)
 *
 * Deletes expired idempotency keys from billing_idempotency_keys.
 * Follows the same pattern as reservation-sweeper.ts.
 * Batch deletes in chunks of 1000 to avoid long-held locks.
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 7.3
 *
 * @module jobs/idempotency-sweeper
 */

import type Database from 'better-sqlite3';
import { logger as defaultLogger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface IdempotencySweeperConfig {
  /** SQLite database instance */
  db: Database.Database;
  /** Sweep interval in milliseconds. Default: 3600000 (1 hour) */
  intervalMs?: number;
  /** Batch size for deletes. Default: 1000 */
  batchSize?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

// =============================================================================
// Sweeper Implementation
// =============================================================================

/**
 * Create and start the idempotency key sweeper.
 * Deletes expired keys in batches to avoid long-held locks.
 */
export function createIdempotencySweeper(config: IdempotencySweeperConfig) {
  const { db, intervalMs = 3_600_000, batchSize = 1000 } = config;
  const log = config.logger ?? defaultLogger;
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Execute one sweep cycle.
   * Deletes expired idempotency keys in chunks of batchSize.
   */
  function sweep(): { deletedCount: number; durationMs: number } {
    const start = Date.now();
    let totalDeleted = 0;

    // Delete in batches to avoid holding locks for too long
    while (true) {
      const result = db.prepare(`
        DELETE FROM billing_idempotency_keys
        WHERE rowid IN (
          SELECT rowid FROM billing_idempotency_keys
          WHERE expires_at < datetime('now')
          LIMIT ?
        )
      `).run(batchSize);

      totalDeleted += result.changes;

      // If fewer than batchSize were deleted, we're done
      if (result.changes < batchSize) break;
    }

    const durationMs = Date.now() - start;

    if (totalDeleted > 0) {
      log.info({
        event: 'billing.idempotency.sweep',
        deleted_count: totalDeleted,
        duration_ms: durationMs,
      }, `Idempotency sweep completed: ${totalDeleted} expired keys deleted`);
    }

    return { deletedCount: totalDeleted, durationMs };
  }

  return {
    /** Start the sweeper on the configured interval */
    start() {
      if (timer) return;
      log.info({
        intervalMs,
        batchSize,
        event: 'billing.idempotency.sweep.start',
      }, 'Idempotency sweeper started');
      timer = setInterval(() => {
        try {
          sweep();
        } catch (err) {
          log.error({ err, event: 'billing.idempotency.sweep.unhandled' },
            'Unhandled idempotency sweep error');
        }
      }, intervalMs);
    },

    /** Stop the sweeper */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info({ event: 'billing.idempotency.sweep.stop' },
          'Idempotency sweeper stopped');
      }
    },

    /** Run a single sweep (for testing) */
    sweepOnce: sweep,
  };
}
