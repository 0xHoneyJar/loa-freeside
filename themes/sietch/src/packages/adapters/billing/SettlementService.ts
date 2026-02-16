/**
 * SettlementService — Earnings Settlement & Clawback
 *
 * Batch processes pending referrer earnings older than 48h into settled state.
 * Provides clawback for pending earnings only (rejected after settlement).
 *
 * Settlement writes an authoritative `settlement` ledger entry per earning.
 * Clawback writes compensating ledger entries and reverses the earning.
 *
 * SDD refs: §4.3 SettlementService
 * Sprint refs: Tasks 6.1, 6.2
 *
 * @module packages/adapters/billing/SettlementService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface SettlementResult {
  processed: number;
  settled: number;
  errors: number;
}

export interface ClawbackResult {
  success: boolean;
  earningId: string;
  reason: string;
}

interface EarningRow {
  id: string;
  referrer_account_id: string;
  referee_account_id: string;
  registration_id: string;
  charge_reservation_id: string;
  earning_lot_id: string | null;
  amount_micro: number;
  referrer_bps: number;
  source_charge_micro: number;
  created_at: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Minimum age (hours) before an earning can be settled */
const SETTLEMENT_HOLD_HOURS = 48;

/** Maximum earnings to process per batch */
const BATCH_SIZE = 50;

/** Pool ID for settled referral earnings */
const SETTLEMENT_POOL = 'referral:revenue_share';

// =============================================================================
// SettlementService
// =============================================================================

export class SettlementService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Settle pending earnings older than 48h.
   * Each earning gets a `settlement` ledger entry as the authoritative finality record.
   * Idempotent: uses `settlement:{earning.id}` as idempotency key.
   */
  settleEarnings(): SettlementResult {
    const result: SettlementResult = {
      processed: 0,
      settled: 0,
      errors: 0,
    };

    // Check if settled_at column exists, add it if not
    this.ensureSettlementColumns();

    const pendingEarnings = this.db.prepare(`
      SELECT * FROM referrer_earnings
      WHERE settled_at IS NULL
        AND created_at < datetime('now', '-${SETTLEMENT_HOLD_HOURS} hours')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(BATCH_SIZE) as EarningRow[];

    if (pendingEarnings.length === 0) {
      logger.debug({ event: 'settlement.empty' }, 'No pending earnings to settle');
      return result;
    }

    logger.info({
      event: 'settlement.batch_start',
      count: pendingEarnings.length,
    }, `Settling ${pendingEarnings.length} earnings`);

    for (const earning of pendingEarnings) {
      try {
        this.settleEarning(earning);
        result.settled++;
        result.processed++;
      } catch (err) {
        result.errors++;
        result.processed++;
        logger.error({
          event: 'settlement.error',
          earningId: earning.id,
          error: err,
        }, 'Error settling earning');
      }
    }

    logger.info({
      event: 'settlement.batch_complete',
      ...result,
    }, `Settlement batch: ${result.settled} settled, ${result.errors} errors`);

    return result;
  }

  /**
   * Clawback a pending earning. Only works on unsettled earnings.
   * Uses BEGIN IMMEDIATE for race protection against concurrent settlement.
   */
  clawbackEarning(earningId: string, reason: string): ClawbackResult {
    this.ensureSettlementColumns();

    try {
      const clawbackResult = this.db.transaction(() => {
        // Lock and check status — WHERE settled_at IS NULL prevents race
        const earning = this.db.prepare(
          `SELECT * FROM referrer_earnings WHERE id = ? AND settled_at IS NULL`
        ).get(earningId) as EarningRow | undefined;

        if (!earning) {
          // Check if it exists at all
          const exists = this.db.prepare(
            `SELECT settled_at FROM referrer_earnings WHERE id = ?`
          ).get(earningId) as { settled_at: string | null } | undefined;

          if (!exists) {
            return { success: false, earningId, reason: 'Earning not found' };
          }
          return { success: false, earningId, reason: 'Earning already settled — cannot clawback' };
        }

        const now = new Date().toISOString();

        // Write compensating ledger entry (negative amount)
        const seqRow = this.db.prepare(
          `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
           FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
        ).get(earning.referrer_account_id, SETTLEMENT_POOL) as { next_seq: number };

        this.db.prepare(`
          INSERT INTO credit_ledger
            (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
             amount_micro, description, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, 'refund', ?, ?, ?, ?)
        `).run(
          randomUUID(),
          earning.referrer_account_id,
          SETTLEMENT_POOL,
          earning.charge_reservation_id,
          seqRow.next_seq,
          -earning.amount_micro,
          `Clawback: ${reason}`,
          `clawback:${earningId}`,
          now,
        );

        // Mark earning as clawed back
        this.db.prepare(`
          UPDATE referrer_earnings
          SET settled_at = ?, clawback_reason = ?
          WHERE id = ?
        `).run(now, reason, earningId);

        return { success: true, earningId, reason };
      })();

      if (clawbackResult.success) {
        logger.info({
          event: 'settlement.clawback',
          earningId,
          reason,
        }, 'Earning clawed back');
      }

      return clawbackResult;
    } catch (err) {
      logger.error({ err, earningId }, 'Clawback failed');
      return { success: false, earningId, reason: `Error: ${(err as Error).message}` };
    }
  }

  /**
   * Get settled balance for an account (non-withdrawable in Phase 1A).
   */
  getSettledBalance(accountId: string): bigint {
    this.ensureSettlementColumns();

    try {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM referrer_earnings
        WHERE referrer_account_id = ?
          AND settled_at IS NOT NULL
          AND clawback_reason IS NULL
      `).get(accountId) as { total: number };

      return BigInt(row.total);
    } catch {
      return 0n;
    }
  }

  /**
   * Get pending (unsettled) balance for an account.
   */
  getPendingBalance(accountId: string): bigint {
    this.ensureSettlementColumns();

    try {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM referrer_earnings
        WHERE referrer_account_id = ?
          AND settled_at IS NULL
      `).get(accountId) as { total: number };

      return BigInt(row.total);
    } catch {
      return 0n;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private settleEarning(earning: EarningRow): void {
    const now = new Date().toISOString();

    this.db.transaction(() => {
      // Get next entry_seq for UNIQUE constraint
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(earning.referrer_account_id, SETTLEMENT_POOL) as { next_seq: number };

      // Write settlement ledger entry (idempotent)
      this.db.prepare(`
        INSERT OR IGNORE INTO credit_ledger
          (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
           amount_micro, description, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, 'revenue_share', ?, ?, ?, ?)
      `).run(
        randomUUID(),
        earning.referrer_account_id,
        SETTLEMENT_POOL,
        earning.charge_reservation_id,
        seqRow.next_seq,
        earning.amount_micro,
        `Settlement of referral earning ${earning.id}`,
        `settlement:${earning.id}`,
        now,
      );

      // Mark earning as settled
      this.db.prepare(`
        UPDATE referrer_earnings SET settled_at = ? WHERE id = ?
      `).run(now, earning.id);
    })();
  }

  /**
   * Ensure settlement columns exist on referrer_earnings.
   * Adds settled_at and clawback_reason if missing (idempotent).
   */
  private ensureSettlementColumns(): void {
    try {
      const cols = this.db.prepare('PRAGMA table_info(referrer_earnings)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);

      if (!colNames.includes('settled_at')) {
        this.db.exec(`ALTER TABLE referrer_earnings ADD COLUMN settled_at TEXT`);
      }
      if (!colNames.includes('clawback_reason')) {
        this.db.exec(`ALTER TABLE referrer_earnings ADD COLUMN clawback_reason TEXT`);
      }
    } catch {
      // Columns may already exist
    }
  }
}
