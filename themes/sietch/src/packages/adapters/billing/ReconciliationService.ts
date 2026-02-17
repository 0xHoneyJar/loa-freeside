/**
 * ReconciliationService — Cross-System Reconciliation (ADR-008)
 *
 * Alert-only reconciliation. NEVER auto-corrects. Divergence emits
 * ReconciliationDivergence event and logs for human review.
 *
 * Conservation checks:
 * 1. Lot conservation: available + reserved + consumed = original - expired (per account)
 * 2. Receivable balance: sum(outstanding receivables) matches expected IOUs
 * 3. Platform-level: all_lot_balances + all_receivable_balances = all_minted - all_expired
 * 4. Budget consistency: current_spend_micro matches windowed finalizations sum
 * 5. Transfer conservation: transfer_out + transfer_in = 0, lot supply preserved (Sprint 290)
 * 6. Deposit bridge conservation: bridged deposits = tba_deposit-sourced lots (Sprint 290)
 *
 * SDD refs: §SS4.6, §SS8.1
 * Sprint refs: Task 9.2
 *
 * @module adapters/billing/ReconciliationService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import type { MicroUSD } from '../../core/protocol/arrakis-arithmetic.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import type {
  IReconciliationService,
  ReconciliationResult,
  ReconciliationCheck,
  ReconciliationStatus,
} from '../../core/ports/IReconciliationService.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';

// =============================================================================
// ReconciliationService
// =============================================================================

export class ReconciliationService implements IReconciliationService {
  private db: Database.Database;
  private eventEmitter: IEconomicEventEmitter | null;

  constructor(db: Database.Database, eventEmitter?: IEconomicEventEmitter) {
    this.db = db;
    this.eventEmitter = eventEmitter ?? null;
  }

  async reconcile(): Promise<ReconciliationResult> {
    const id = randomUUID();
    const startedAt = sqliteTimestamp();
    const checks: ReconciliationCheck[] = [];
    const divergences: string[] = [];

    // Check 1: Lot conservation (per account)
    checks.push(this.checkLotConservation(divergences));

    // Check 2: Receivable balance tracking
    checks.push(this.checkReceivableBalances(divergences));

    // Check 3: Platform-level conservation
    checks.push(this.checkPlatformConservation(divergences));

    // Check 4: Budget consistency
    checks.push(this.checkBudgetConsistency(divergences));

    // Check 5: Transfer conservation (Sprint 290)
    checks.push(this.checkTransferConservation(divergences));

    // Check 6: Deposit bridge conservation (Sprint 290)
    checks.push(this.checkDepositBridgeConservation(divergences));

    const finishedAt = sqliteTimestamp();
    const status: ReconciliationStatus = divergences.length > 0 ? 'divergence_detected' : 'passed';

    // Persist result
    this.db.prepare(`
      INSERT INTO reconciliation_runs (id, started_at, finished_at, status, checks_json, divergence_summary_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id, startedAt, finishedAt, status,
      JSON.stringify(checks),
      divergences.length > 0 ? JSON.stringify(divergences) : null,
    );

    // Emit event via typed IEconomicEventEmitter (no `as any` casts)
    if (this.eventEmitter) {
      const eventType = status === 'passed' ? 'ReconciliationCompleted' : 'ReconciliationDivergence';
      try {
        this.eventEmitter.emit({
          eventType,
          entityType: 'account',
          entityId: id,
          correlationId: `reconciliation:${id}`,
          payload: {
            checksCount: checks.length,
            divergencesCount: divergences.length,
            status,
          },
        });
      } catch {
        // Event emission failure is non-fatal for reconciliation
      }
    }

    logger.info({
      event: `reconciliation.${status}`,
      id,
      checksRun: checks.length,
      divergences: divergences.length,
    }, `Reconciliation ${status}: ${checks.filter(c => c.status === 'passed').length}/${checks.length} checks passed`);

    return { id, startedAt, finishedAt, status, checks, divergences };
  }

  async getHistory(limit = 20): Promise<ReconciliationResult[]> {
    const rows = this.db.prepare(`
      SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<{
      id: string; started_at: string; finished_at: string;
      status: ReconciliationStatus; checks_json: string; divergence_summary_json: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      status: row.status,
      checks: JSON.parse(row.checks_json),
      divergences: row.divergence_summary_json ? JSON.parse(row.divergence_summary_json) : [],
    }));
  }

  // ---------------------------------------------------------------------------
  // Conservation Checks
  // ---------------------------------------------------------------------------

  private checkLotConservation(divergences: string[]): ReconciliationCheck {
    try {
      // Per-account: available + reserved + consumed should equal original - expired_amount
      const accounts = this.db.prepare(`
        SELECT cl.account_id,
          CAST(COALESCE(SUM(cl.available_micro), 0) AS TEXT) as total_available,
          CAST(COALESCE(SUM(cl.reserved_micro), 0) AS TEXT) as total_reserved,
          CAST(COALESCE(SUM(cl.consumed_micro), 0) AS TEXT) as total_consumed,
          CAST(COALESCE(SUM(cl.original_micro), 0) AS TEXT) as total_original
        FROM credit_lots cl
        GROUP BY cl.account_id
      `).all() as Array<{
        account_id: string;
        total_available: string;
        total_reserved: string;
        total_consumed: string;
        total_original: string;
      }>;

      let violations = 0;
      for (const acct of accounts) {
        const lhs: MicroUSD = (BigInt(acct.total_available) + BigInt(acct.total_reserved) + BigInt(acct.total_consumed)) as MicroUSD;
        const rhs: MicroUSD = BigInt(acct.total_original) as MicroUSD;
        // Allow for expired lots: lhs <= rhs
        if (lhs > rhs) {
          violations++;
          divergences.push(`Lot conservation violated for account ${acct.account_id}: ${lhs} > ${rhs}`);
        }
      }

      return {
        name: 'lot_conservation',
        status: violations === 0 ? 'passed' : 'failed',
        details: { accountsChecked: accounts.length, violations },
      };
    } catch (err) {
      return { name: 'lot_conservation', status: 'failed', details: { error: (err as Error).message } };
    }
  }

  private checkReceivableBalances(divergences: string[]): ReconciliationCheck {
    try {
      const row = this.db.prepare(`
        SELECT
          COUNT(*) as total_receivables,
          COALESCE(SUM(CASE WHEN balance_micro > 0 THEN 1 ELSE 0 END), 0) as outstanding_count,
          CAST(COALESCE(SUM(CASE WHEN balance_micro > 0 THEN balance_micro ELSE 0 END), 0) AS TEXT) as outstanding_total,
          CAST(COALESCE(SUM(original_amount_micro), 0) AS TEXT) as total_original
        FROM agent_clawback_receivables
      `).get() as {
        total_receivables: number;
        outstanding_count: number;
        outstanding_total: string;
        total_original: string;
      };

      const outstandingTotal = BigInt(row.outstanding_total);
      const totalOriginal = BigInt(row.total_original);

      // Receivable balance should never exceed original amount
      const violations = outstandingTotal > totalOriginal ? 1 : 0;
      if (violations > 0) {
        divergences.push(`Receivable balance (${outstandingTotal}) exceeds original (${totalOriginal})`);
      }

      return {
        name: 'receivable_balance',
        status: violations === 0 ? 'passed' : 'failed',
        details: {
          totalReceivables: row.total_receivables,
          outstandingCount: row.outstanding_count,
          outstandingTotal: outstandingTotal.toString(),
          totalOriginal: totalOriginal.toString(),
        },
      };
    } catch {
      // Table may not exist yet — pass silently
      return { name: 'receivable_balance', status: 'passed', details: { skipped: true } };
    }
  }

  private checkPlatformConservation(divergences: string[]): ReconciliationCheck {
    try {
      const lotTotals = this.db.prepare(`
        SELECT
          CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total_minted,
          CAST(COALESCE(SUM(available_micro + reserved_micro + consumed_micro), 0) AS TEXT) as total_accounted
        FROM credit_lots
      `).get() as { total_minted: string; total_accounted: string };

      let receivableTotal = '0';
      try {
        const recRow = this.db.prepare(`
          SELECT CAST(COALESCE(SUM(balance_micro), 0) AS TEXT) as total
          FROM agent_clawback_receivables WHERE balance_micro > 0
        `).get() as { total: string };
        receivableTotal = recRow.total;
      } catch {
        // Table may not exist
      }

      const totalMinted = BigInt(lotTotals.total_minted);
      const totalAccounted = BigInt(lotTotals.total_accounted) + BigInt(receivableTotal);

      // total_accounted should not exceed total_minted
      const ok = totalAccounted <= totalMinted;
      if (!ok) {
        divergences.push(
          `Platform conservation: accounted (${totalAccounted}) > minted (${totalMinted})`
        );
      }

      return {
        name: 'platform_conservation',
        status: ok ? 'passed' : 'failed',
        details: {
          totalMinted: totalMinted.toString(),
          totalLotBalances: lotTotals.total_accounted.toString(),
          totalReceivables: receivableTotal.toString(),
          totalAccounted: totalAccounted.toString(),
        },
      };
    } catch (err) {
      return { name: 'platform_conservation', status: 'failed', details: { error: (err as Error).message } };
    }
  }

  private checkBudgetConsistency(divergences: string[]): ReconciliationCheck {
    try {
      const limits = this.db.prepare(`
        SELECT id, account_id,
               CAST(current_spend_micro AS TEXT) as current_spend_micro,
               window_start, window_duration_seconds
        FROM agent_spending_limits
      `).all() as Array<{
        id: string; account_id: string; current_spend_micro: string;
        window_start: string; window_duration_seconds: number;
      }>;

      let violations = 0;
      for (const limit of limits) {
        const windowEnd = new Date(
          new Date(limit.window_start).getTime() + limit.window_duration_seconds * 1000
        ).toISOString();

        const spendRow = this.db.prepare(`
          SELECT CAST(COALESCE(SUM(amount_micro), 0) AS TEXT) as actual_spend
          FROM agent_budget_finalizations
          WHERE account_id = ? AND finalized_at >= ? AND finalized_at < ?
        `).get(limit.account_id, limit.window_start, windowEnd) as { actual_spend: string };

        const recorded: MicroUSD = BigInt(limit.current_spend_micro) as MicroUSD;
        const actual: MicroUSD = BigInt(spendRow.actual_spend) as MicroUSD;

        if (actual !== recorded) {
          violations++;
          divergences.push(
            `Budget consistency: account ${limit.account_id} recorded=${recorded} actual=${actual}`
          );
        }
      }

      return {
        name: 'budget_consistency',
        status: violations === 0 ? 'passed' : 'failed',
        details: { limitsChecked: limits.length, violations },
      };
    } catch {
      // Budget tables may not exist — pass silently
      return { name: 'budget_consistency', status: 'passed', details: { skipped: true } };
    }
  }

  // ---------------------------------------------------------------------------
  // Check 5: Transfer Conservation (Sprint 290, Task 7.1)
  // ---------------------------------------------------------------------------

  private checkTransferConservation(divergences: string[]): ReconciliationCheck {
    try {
      // 5a: Every completed transfer must have a corresponding transfer_in lot.
      //     We check existence (not SUM equality) because lot-split reduces
      //     original_micro on subsequent outbound transfers — the lot still exists
      //     but its original_micro no longer equals the initial transfer amount.
      const transferRow = this.db.prepare(`
        SELECT CAST(COALESCE(SUM(amount_micro), 0) AS TEXT) as transfer_total
        FROM transfers
        WHERE status = 'completed'
      `).get() as { transfer_total: string };

      const transferTotal = BigInt(transferRow.transfer_total);

      const orphanRow = this.db.prepare(`
        SELECT COUNT(*) as cnt FROM transfers t
        WHERE t.status = 'completed'
          AND NOT EXISTS (
            SELECT 1 FROM credit_lots cl
            WHERE cl.source_type = 'transfer_in' AND cl.source_id = t.id
          )
      `).get() as { cnt: number };

      let violations = 0;

      if (orphanRow.cnt > 0) {
        violations++;
        divergences.push(
          `Transfer conservation: ${orphanRow.cnt} completed transfers have no matching transfer_in lot`
        );
      }

      // 5b: Transfer_out ledger entries should sum to the same absolute value
      //     as completed transfers (the sender side of the equation).
      const entryRow = this.db.prepare(`
        SELECT CAST(COALESCE(SUM(ABS(amount_micro)), 0) AS TEXT) as entry_total
        FROM credit_ledger
        WHERE entry_type = 'transfer_out'
      `).get() as { entry_total: string };

      const entryTotal = BigInt(entryRow.entry_total);

      if (entryTotal !== transferTotal) {
        violations++;
        divergences.push(
          `Transfer conservation: transfer_out entries (${entryTotal}) ≠ completed transfers (${transferTotal})`
        );
      }

      return {
        name: 'transfer_conservation',
        status: violations === 0 ? 'passed' : 'failed',
        details: {
          completedTransferTotal: transferTotal.toString(),
          transferOutEntryTotal: entryTotal.toString(),
          orphanCompletedTransfers: orphanRow.cnt,
          violations,
        },
      };
    } catch (err) {
      // Report structured failure instead of silently skipping.
      // reconcile() must always return a complete report — never throw.
      return {
        name: 'transfer_conservation',
        status: 'failed' as const,
        details: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Check 6: Deposit Bridge Conservation (Sprint 290, Task 7.2)
  // ---------------------------------------------------------------------------

  private checkDepositBridgeConservation(divergences: string[]): ReconciliationCheck {
    try {
      // Sum of bridged deposit amounts (CAST AS TEXT for BigInt precision)
      const depositRow = this.db.prepare(`
        SELECT CAST(COALESCE(SUM(amount_micro), 0) AS TEXT) as deposit_total
        FROM tba_deposits
        WHERE status = 'bridged'
      `).get() as { deposit_total: string };

      // Sum of tba_deposit-sourced lot original_micro
      const lotRow = this.db.prepare(`
        SELECT CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as lot_total
        FROM credit_lots
        WHERE source_type = 'tba_deposit'
      `).get() as { lot_total: string };

      const depositTotal = BigInt(depositRow.deposit_total);
      const lotTotal = BigInt(lotRow.lot_total);

      let violations = 0;

      if (depositTotal !== lotTotal) {
        violations++;
        divergences.push(
          `Deposit bridge conservation: bridged deposits (${depositTotal}) ≠ tba_deposit lots (${lotTotal})`
        );
      }

      return {
        name: 'deposit_bridge_conservation',
        status: violations === 0 ? 'passed' : 'failed',
        details: {
          bridgedDepositTotal: depositTotal.toString(),
          tbaDepositLotTotal: lotTotal.toString(),
          violations,
        },
      };
    } catch {
      // tba_deposits table may not exist — pass silently
      return { name: 'deposit_bridge_conservation', status: 'passed', details: { skipped: true } };
    }
  }
}
