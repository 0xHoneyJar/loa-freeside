/**
 * BonusProcessor — Delayed Bonus Processing
 *
 * Evaluates pending bonuses older than 7 days via FraudCheckService.
 * Grants cleared bonuses, flags/withholds suspicious ones.
 *
 * Designed to be called by a cron job (e.g., BullMQ repeatable).
 * Each invocation processes one batch of eligible bonuses.
 *
 * SDD refs: §4.4 Bonus Processing
 * Sprint refs: Task 4.4
 *
 * @module packages/adapters/billing/BonusProcessor
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { FraudCheckService } from './FraudCheckService.js';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps';

// =============================================================================
// Types
// =============================================================================

export interface BonusProcessResult {
  processed: number;
  granted: number;
  flagged: number;
  withheld: number;
  errors: number;
}

interface PendingBonusRow {
  id: string;
  referee_account_id: string;
  referrer_account_id: string;
  registration_id: string;
  qualifying_action: string;
  qualifying_action_id: string;
  amount_micro: number;
  created_at: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum age (days) before a bonus can be evaluated */
const HOLD_DAYS = 7;

/** Maximum bonuses to process per batch */
const BATCH_SIZE = 100;

/** Pool ID for referral signup bonuses */
const REFERRAL_SIGNUP_POOL = 'referral:signup';

// =============================================================================
// BonusProcessor
// =============================================================================

export class BonusProcessor {
  private db: Database.Database;
  private fraudService: FraudCheckService;

  constructor(db: Database.Database, fraudService: FraudCheckService) {
    this.db = db;
    this.fraudService = fraudService;
  }

  /**
   * Process pending bonuses that have passed the 7-day hold.
   * Returns summary of actions taken.
   */
  processDelayedBonuses(): BonusProcessResult {
    const result: BonusProcessResult = {
      processed: 0,
      granted: 0,
      flagged: 0,
      withheld: 0,
      errors: 0,
    };

    // Find pending bonuses older than HOLD_DAYS
    const pendingBonuses = this.db.prepare(`
      SELECT * FROM referral_bonuses
      WHERE status = 'pending'
        AND created_at < datetime('now', '-${HOLD_DAYS} days')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(BATCH_SIZE) as PendingBonusRow[];

    if (pendingBonuses.length === 0) {
      logger.debug({ event: 'bonus.processor.empty' }, 'No pending bonuses to process');
      return result;
    }

    logger.info({
      event: 'bonus.processor.batch_start',
      count: pendingBonuses.length,
    }, `Processing ${pendingBonuses.length} pending bonuses`);

    for (const bonus of pendingBonuses) {
      try {
        this.processBonus(bonus, result);
        result.processed++;
      } catch (err) {
        result.errors++;
        logger.error({
          event: 'bonus.processor.error',
          bonusId: bonus.id,
          error: err,
        }, 'Error processing bonus');
      }
    }

    logger.info({
      event: 'bonus.processor.batch_complete',
      ...result,
    }, `Batch complete: ${result.granted} granted, ${result.flagged} flagged, ${result.withheld} withheld`);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private processBonus(bonus: PendingBonusRow, result: BonusProcessResult): void {
    const score = this.fraudService.scoreBonusClaim(
      bonus.referee_account_id,
      bonus.created_at,
    );

    const now = sqliteTimestamp();

    // Update bonus with fraud check results
    this.db.prepare(`
      UPDATE referral_bonuses
      SET risk_score = ?, fraud_check_at = ?
      WHERE id = ?
    `).run(score.score, now, bonus.id);

    switch (score.verdict) {
      case 'clear': {
        // Grant the bonus via ledger
        this.grantBonus(bonus, now);
        result.granted++;
        break;
      }
      case 'flagged': {
        // Flag for manual review
        const reasons = score.signals
          .filter(s => s.value > 0)
          .map(s => `${s.name}: ${s.detail}`)
          .join('; ');

        this.db.prepare(`
          UPDATE referral_bonuses
          SET status = 'flagged', flag_reason = ?
          WHERE id = ?
        `).run(reasons, bonus.id);

        result.flagged++;
        logger.info({
          event: 'bonus.flagged',
          bonusId: bonus.id,
          score: score.score,
          reason: reasons,
        }, 'Bonus flagged for review');
        break;
      }
      case 'withheld': {
        const reasons = score.signals
          .filter(s => s.value > 0)
          .map(s => `${s.name}: ${s.detail}`)
          .join('; ');

        this.db.prepare(`
          UPDATE referral_bonuses
          SET status = 'withheld', flag_reason = ?
          WHERE id = ?
        `).run(reasons, bonus.id);

        result.withheld++;
        logger.warn({
          event: 'bonus.withheld',
          bonusId: bonus.id,
          score: score.score,
          reason: reasons,
        }, 'Bonus withheld (auto-blocked)');
        break;
      }
    }
  }

  private grantBonus(bonus: PendingBonusRow, now: string): void {
    const grantId = randomUUID();

    // Get next entry_seq for this account+pool to satisfy UNIQUE constraint
    const seqRow = this.db.prepare(
      `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
       FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
    ).get(bonus.referrer_account_id, REFERRAL_SIGNUP_POOL) as { next_seq: number };

    // Create ledger entry for the bonus grant
    this.db.prepare(`
      INSERT INTO credit_ledger
        (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
         amount_micro, description, created_at)
      VALUES (?, ?, ?, ?, ?, 'grant', ?, ?, ?)
    `).run(
      grantId,
      bonus.referrer_account_id,
      REFERRAL_SIGNUP_POOL,
      `bonus-${bonus.id}`,
      seqRow.next_seq,
      bonus.amount_micro,
      `Referral signup bonus from ${bonus.referee_account_id} (${bonus.qualifying_action})`,
      now,
    );

    // Update bonus status
    this.db.prepare(`
      UPDATE referral_bonuses
      SET status = 'granted', granted_at = ?, grant_id = ?
      WHERE id = ?
    `).run(now, grantId, bonus.id);

    logger.info({
      event: 'bonus.granted',
      bonusId: bonus.id,
      grantId,
      amount: bonus.amount_micro,
      referrer: bonus.referrer_account_id,
    }, 'Bonus granted via ledger');
  }
}
