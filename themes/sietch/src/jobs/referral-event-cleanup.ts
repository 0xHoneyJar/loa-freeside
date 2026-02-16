/**
 * Referral Event Cleanup — 90-Day Retention Cron
 *
 * Deletes referral_events rows older than 90 days in batches
 * to avoid long-running transactions. Uses index on created_at
 * for efficient deletion.
 *
 * Designed for daily BullMQ cron execution at 03:00 UTC.
 *
 * SDD refs: §4.8 Data Retention
 * Sprint refs: Task 7.6
 *
 * @module jobs/referral-event-cleanup
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface CleanupResult {
  deletedTotal: number;
  iterations: number;
  durationMs: number;
  retainedBefore: string;
}

// =============================================================================
// Constants
// =============================================================================

const RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;
const MAX_ITERATIONS = 100;

// =============================================================================
// Referral Event Cleanup
// =============================================================================

export function createReferralEventCleanup(config: { db: Database.Database }) {
  const { db } = config;

  function runCleanup(): CleanupResult {
    const start = Date.now();
    let deletedTotal = 0;
    let iterations = 0;

    const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString();

    const deleteStmt = db.prepare(`
      DELETE FROM referral_events
      WHERE id IN (
        SELECT id FROM referral_events
        WHERE created_at < ?
        LIMIT ?
      )
    `);

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const result = deleteStmt.run(cutoffDate, BATCH_SIZE);

      if (result.changes === 0) break;
      deletedTotal += result.changes;
    }

    const durationMs = Date.now() - start;

    if (deletedTotal > 0) {
      logger.info({
        event: 'referral_events.cleanup',
        deletedTotal,
        iterations,
        durationMs,
        cutoffDate,
      }, `Cleaned up ${deletedTotal} referral events older than ${RETENTION_DAYS} days`);
    } else {
      logger.debug({
        event: 'referral_events.cleanup.noop',
        cutoffDate,
      }, 'No referral events to clean up');
    }

    return {
      deletedTotal,
      iterations,
      durationMs,
      retainedBefore: cutoffDate,
    };
  }

  return { runOnce: runCleanup };
}
