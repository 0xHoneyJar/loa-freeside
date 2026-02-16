/**
 * Nonce Cleanup Cron Job
 *
 * Cleans up expired wallet link nonces:
 * - Unused expired nonces (expires_at < NOW) — immediate deletion
 * - Used nonces older than 24h — audit trail retained briefly
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Task 11.4
 *
 * @module jobs/nonce-cleanup
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

/** Retain used nonces for audit trail */
const USED_NONCE_RETENTION_HOURS = 24;

// =============================================================================
// Nonce Cleanup Job
// =============================================================================

export function createNonceCleanup(deps: {
  db: Database.Database;
}): { runOnce: () => { expiredDeleted: number; usedDeleted: number } } {
  const { db } = deps;

  function runOnce(): { expiredDeleted: number; usedDeleted: number } {
    // Delete expired unused nonces
    const expiredResult = db.prepare(`
      DELETE FROM wallet_link_nonces
      WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND used_at IS NULL
    `).run();

    // Delete used nonces older than 24h
    const usedResult = db.prepare(`
      DELETE FROM wallet_link_nonces
      WHERE used_at IS NOT NULL
        AND used_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${USED_NONCE_RETENTION_HOURS} hours')
    `).run();

    const expiredDeleted = expiredResult.changes;
    const usedDeleted = usedResult.changes;

    if (expiredDeleted > 0 || usedDeleted > 0) {
      logger.info({
        event: 'nonce.cleanup',
        expiredDeleted,
        usedDeleted,
      }, `Nonce cleanup: ${expiredDeleted} expired, ${usedDeleted} used`);
    }

    return { expiredDeleted, usedDeleted };
  }

  return { runOnce };
}
