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
import { sqliteTimestamp } from './protocol/timestamps';
import type { IConstitutionalGovernanceService } from '../../core/ports/IConstitutionalGovernanceService.js';
import type { EntityType } from '../../core/protocol/billing-types.js';
import type { MicroUSD } from '../../core/protocol/arrakis-arithmetic.js';
import { CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';
import { BillingEventEmitter } from './BillingEventEmitter.js';

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

/**
 * Legacy constant — now resolved from system_config via ConstitutionalGovernanceService.
 * Kept only as inline documentation of the default value.
 * Actual value comes from: resolve('settlement.hold_seconds', entityType)
 */
const SETTLEMENT_HOLD_SECONDS_FALLBACK = 172_800; // 48 hours

/** Maximum earnings to process per batch */
const BATCH_SIZE = 50;

/** Pool ID for settled referral earnings */
const SETTLEMENT_POOL = 'referral:revenue_share';

// =============================================================================
// SettlementService
// =============================================================================

export class SettlementService {
  private db: Database.Database;
  private governance: IConstitutionalGovernanceService | null;
  private eventEmitter: BillingEventEmitter | null;

  constructor(db: Database.Database, governance?: IConstitutionalGovernanceService, eventEmitter?: BillingEventEmitter) {
    this.db = db;
    this.governance = governance ?? null;
    this.eventEmitter = eventEmitter ?? null;
  }

  /**
   * Settle pending earnings whose hold period has elapsed.
   * Each earning gets a `settlement` ledger entry as the authoritative finality record.
   * Idempotent: uses `settlement:{earning.id}` as idempotency key.
   *
   * @param opts.asOf — Timestamp to evaluate settlement eligibility against.
   *   Defaults to sqliteNow(). Pass a controlled timestamp for deterministic testing.
   * @param opts.entityType — Entity type for governance parameter resolution.
   *   Agent earnings settle with 0-second hold; human earnings retain 48-hour hold.
   */
  settleEarnings(opts?: { asOf?: string; entityType?: EntityType }): SettlementResult {
    const asOf = opts?.asOf ?? sqliteTimestamp();

    const result: SettlementResult = {
      processed: 0,
      settled: 0,
      errors: 0,
    };

    // Check if settled_at column exists, add it if not
    this.ensureSettlementColumns();

    // Resolve settlement hold from constitutional governance (seconds)
    const holdSeconds = this.resolveHoldSeconds(opts?.entityType);

    // Prefer settle_after (pre-computed) over wall-clock calculation
    const hasSettleAfter = this.hasColumn('settle_after');
    const pendingEarnings = hasSettleAfter
      ? this.db.prepare(`
          SELECT * FROM referrer_earnings
          WHERE settled_at IS NULL
            AND settle_after <= ?
          ORDER BY settle_after ASC
          LIMIT ?
        `).all(asOf, BATCH_SIZE) as EarningRow[]
      : this.db.prepare(`
          SELECT * FROM referrer_earnings
          WHERE settled_at IS NULL
            AND created_at < datetime(?, '-' || ? || ' seconds')
          ORDER BY created_at ASC
          LIMIT ?
        `).all(asOf, holdSeconds, BATCH_SIZE) as EarningRow[];

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
        this.settleEarning(earning, { entityType: opts?.entityType });
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

        const now = sqliteTimestamp();

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
   * Agent clawback with receivable tracking.
   * If clawback exceeds available balance, creates receivable for the deficit.
   * Conservation: applied + receivable = originalAmount
   */
  agentClawback(earningId: string, reason: string): ClawbackResult & { receivableId?: string } {
    this.ensureSettlementColumns();

    try {
      return this.db.transaction(() => {
        const earning = this.db.prepare(
          `SELECT * FROM referrer_earnings WHERE id = ? AND settled_at IS NULL`
        ).get(earningId) as EarningRow | undefined;

        if (!earning) {
          const exists = this.db.prepare(
            `SELECT settled_at FROM referrer_earnings WHERE id = ?`
          ).get(earningId) as { settled_at: string | null } | undefined;
          if (!exists) return { success: false, earningId, reason: 'Earning not found' };
          return { success: false, earningId, reason: 'Earning already settled — cannot clawback' };
        }

        const now = sqliteTimestamp();
        const balance = this.getSettledBalance(earning.referrer_account_id);
        const clawbackAmount = BigInt(earning.amount_micro);

        if (balance >= clawbackAmount) {
          // Full clawback — standard path
          this.writeClawbackEntry(earning, now, reason);
          return { success: true, earningId, reason };
        }

        // Partial clawback: apply what we can, create receivable for remainder
        const applied = balance > 0n ? balance : 0n;
        const receivableAmount = clawbackAmount - applied;

        if (applied > 0n) {
          // Write partial compensating ledger entry
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
            randomUUID(), earning.referrer_account_id, SETTLEMENT_POOL,
            earning.charge_reservation_id, seqRow.next_seq,
            -Number(applied),
            `Partial clawback: ${reason}`,
            `clawback:partial:${earningId}`,
            now,
          );
        }

        // Mark earning as clawed back
        this.db.prepare(`
          UPDATE referrer_earnings SET settled_at = ?, clawback_reason = ? WHERE id = ?
        `).run(now, reason, earningId);

        // Create receivable for unpaid remainder
        const receivableId = randomUUID();
        this.db.prepare(`
          INSERT INTO agent_clawback_receivables
            (id, account_id, source_clawback_id, original_amount_micro, balance_micro)
          VALUES (?, ?, ?, ?, ?)
        `).run(receivableId, earning.referrer_account_id, earningId,
          Number(receivableAmount), Number(receivableAmount));

        // Emit events
        if (this.eventEmitter) {
          this.eventEmitter.emit({
            type: 'AgentClawbackPartial',
            aggregateType: 'earning', aggregateId: earningId, timestamp: now, causationId: `clawback:partial:${earningId}`,
            payload: {
              accountId: earning.referrer_account_id,
              originalAmountMicro: String(clawbackAmount),
              appliedAmountMicro: String(applied),
              receivableAmountMicro: String(receivableAmount),
              earningId,
            },
          }, { db: this.db });
          this.eventEmitter.emit({
            type: 'AgentClawbackReceivableCreated',
            aggregateType: 'earning', aggregateId: receivableId, timestamp: now, causationId: `clawback:partial:${earningId}`,
            payload: {
              receivableId,
              accountId: earning.referrer_account_id,
              sourceClawbackId: earningId,
              balanceMicro: String(receivableAmount),
            },
          }, { db: this.db });
        }

        logger.info({
          event: 'settlement.agent_clawback_partial',
          earningId, applied: applied.toString(),
          receivableId, receivableAmount: receivableAmount.toString(),
        }, 'Partial agent clawback — receivable created');

        return { success: true, earningId, reason, receivableId };
      })();
    } catch (err) {
      logger.error({ err, earningId }, 'Agent clawback failed');
      return { success: false, earningId, reason: `Error: ${(err as Error).message}` };
    }
  }

  /**
   * Apply drip recovery from an agent earning to outstanding receivables.
   * Deducts agent.drip_recovery_pct from the earning and applies to oldest receivable.
   * Idempotent via drip:{earningId}:{receivableId} key.
   *
   * @returns Amount recovered (0 if no outstanding receivables)
   */
  applyDripRecovery(earningId: string, accountId: string, earningAmountMicro: bigint, entityType?: EntityType): bigint {
    try {
      return this.db.transaction(() => {
        // Check for outstanding receivables
        const receivable = this.db.prepare(`
          SELECT id, balance_micro FROM agent_clawback_receivables
          WHERE account_id = ? AND balance_micro > 0
          ORDER BY created_at ASC LIMIT 1
        `).get(accountId) as { id: string; balance_micro: number } | undefined;

        if (!receivable) return 0n;

        // Resolve drip percentage
        const dripPct = this.governance
          ? (() => { try { return this.governance!.resolveInTransaction<number>(this.db, 'agent.drip_recovery_pct', entityType).value; } catch { return 50; } })()
          : (CONFIG_FALLBACKS['agent.drip_recovery_pct'] as number) ?? 50;

        const dripAmount = (earningAmountMicro * BigInt(dripPct)) / 100n;
        if (dripAmount <= 0n) return 0n;

        const receivableBalance = BigInt(receivable.balance_micro);
        const recoveryAmount = dripAmount < receivableBalance ? dripAmount : receivableBalance;
        const newBalance = receivableBalance - recoveryAmount;

        // Idempotency check
        const idempKey = `drip:${earningId}:${receivable.id}`;
        const existingEntry = this.db.prepare(
          `SELECT 1 FROM credit_ledger WHERE idempotency_key = ?`
        ).get(idempKey);
        if (existingEntry) return 0n; // Already processed

        const now = sqliteTimestamp();

        // Write recovery ledger entry
        const seqRow = this.db.prepare(
          `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
           FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
        ).get(accountId, SETTLEMENT_POOL) as { next_seq: number };

        this.db.prepare(`
          INSERT INTO credit_ledger
            (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
             amount_micro, description, idempotency_key, created_at)
          VALUES (?, ?, ?, NULL, ?, 'refund', ?, ?, ?, ?)
        `).run(
          randomUUID(), accountId, SETTLEMENT_POOL,
          seqRow.next_seq,
          -Number(recoveryAmount),
          `Drip recovery for receivable ${receivable.id}`,
          idempKey, now,
        );

        // Update receivable balance
        this.db.prepare(`
          UPDATE agent_clawback_receivables SET balance_micro = ?, resolved_at = ?
          WHERE id = ?
        `).run(Number(newBalance), newBalance === 0n ? now : null, receivable.id);

        if (newBalance === 0n) {
          logger.info({ event: 'settlement.receivable_resolved', receivableId: receivable.id },
            'Receivable fully resolved via drip recovery');
        }

        return recoveryAmount;
      })();
    } catch (err) {
      logger.error({ err, earningId, accountId }, 'Drip recovery failed');
      return 0n;
    }
  }

  /**
   * Get settled balance for an account (non-withdrawable in Phase 1A).
   */
  getSettledBalance(accountId: string): MicroUSD {
    this.ensureSettlementColumns();

    try {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM referrer_earnings
        WHERE referrer_account_id = ?
          AND settled_at IS NOT NULL
          AND clawback_reason IS NULL
      `).get(accountId) as { total: number };

      return BigInt(row.total) as MicroUSD;
    } catch {
      return 0n as MicroUSD;
    }
  }

  /**
   * Get pending (unsettled) balance for an account.
   */
  getPendingBalance(accountId: string): MicroUSD {
    this.ensureSettlementColumns();

    try {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM referrer_earnings
        WHERE referrer_account_id = ?
          AND settled_at IS NULL
      `).get(accountId) as { total: number };

      return BigInt(row.total) as MicroUSD;
    } catch {
      return 0n as MicroUSD;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private settleEarning(earning: EarningRow, opts?: { entityType?: EntityType }): void {
    const now = sqliteTimestamp();
    const holdResolved = this.governance
      ? (() => { try { return this.governance!.resolveInTransaction<number>(this.db, 'settlement.hold_seconds', opts?.entityType); } catch { return null; } })()
      : null;
    const isInstant = holdResolved ? holdResolved.value === 0 : false;

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

      // Emit AgentSettlementInstant for 0-hold (agent) settlements
      if (isInstant && this.eventEmitter) {
        this.eventEmitter.emit({
          type: 'AgentSettlementInstant',
          aggregateType: 'earning',
          aggregateId: earning.id,
          timestamp: now,
          causationId: `settlement:${earning.id}`,
          payload: {
            referrerAccountId: earning.referrer_account_id,
            amountMicro: String(earning.amount_micro),
            earningId: earning.id,
            configVersion: holdResolved?.configVersion ?? 0,
          },
        }, { db: this.db });
      }
    })();
  }

  private hasColumn(name: string): boolean {
    try {
      const cols = this.db.prepare('PRAGMA table_info(referrer_earnings)').all() as Array<{ name: string }>;
      return cols.some(c => c.name === name);
    } catch {
      return false;
    }
  }

  /**
   * Write a full clawback compensating ledger entry and mark earning as clawed back.
   * Used by agentClawback when balance covers the full amount.
   */
  private writeClawbackEntry(earning: EarningRow, now: string, reason: string): void {
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
      randomUUID(), earning.referrer_account_id, SETTLEMENT_POOL,
      earning.charge_reservation_id, seqRow.next_seq,
      -earning.amount_micro,
      `Agent clawback: ${reason}`,
      `clawback:agent:${earning.id}`,
      now,
    );

    this.db.prepare(`
      UPDATE referrer_earnings SET settled_at = ?, clawback_reason = ? WHERE id = ?
    `).run(now, reason, earning.id);
  }

  /**
   * Resolve settlement hold period from constitutional governance.
   * Falls back to compile-time constant if governance unavailable.
   */
  private resolveHoldSeconds(entityType?: EntityType): number {
    if (this.governance) {
      try {
        const resolved = this.governance.resolveInTransaction<number>(
          this.db, 'settlement.hold_seconds', entityType,
        );
        return resolved.value;
      } catch {
        // Governance table may not exist yet — use fallback
      }
    }
    return (CONFIG_FALLBACKS['settlement.hold_seconds'] as number) ?? SETTLEMENT_HOLD_SECONDS_FALLBACK;
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
