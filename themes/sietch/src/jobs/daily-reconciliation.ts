/**
 * Daily Reconciliation Job
 *
 * Comprehensive daily validation of billing system health:
 * 1. Lot balance match: SUM(available + reserved + consumed) = SUM(original)
 * 2. Orphan reservations: no pending reservations older than 2x TTL
 * 3. Zero-sum invariant: all distribution triads sum correctly
 * 4. Webhook deposit match: all finished crypto_payments have lots
 * 5. Results stored in billing_config for admin endpoint
 *
 * SDD refs: §1.4 Background Jobs
 * Sprint refs: Task 3.6
 *
 * @module jobs/daily-reconciliation
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface DailyReconciliationConfig {
  /** SQLite database */
  db: Database.Database;
  /** Reserve TTL in seconds for orphan detection (default: 300) */
  reserveTtlSeconds?: number;
}

export interface ReconciliationCheck {
  name: string;
  passed: boolean;
  details: string;
  severity: 'info' | 'warn' | 'error';
}

export interface DailyReconciliationResult {
  timestamp: string;
  passed: boolean;
  checks: ReconciliationCheck[];
  durationMs: number;
  /** Monotonic generation counter — increments on each successful run */
  generation: number;
}

// =============================================================================
// Helpers
// =============================================================================

import { sqliteTimestamp } from '../packages/adapters/billing/protocol/timestamps';

const sqliteNow = sqliteTimestamp;

// =============================================================================
// Daily Reconciliation
// =============================================================================

export function createDailyReconciliation(config: DailyReconciliationConfig) {
  const reserveTtl = config.reserveTtlSeconds ?? 300;

  function runChecks(): DailyReconciliationResult {
    const start = Date.now();
    const checks: ReconciliationCheck[] = [];

    // -----------------------------------------------------------------------
    // Check 1: Lot Balance Invariant
    // SUM(available + reserved + consumed) = SUM(original) across all lots
    // -----------------------------------------------------------------------
    try {
      const lotCheck = config.db.prepare(
        `SELECT
           COUNT(*) as total_lots,
           SUM(original_micro) as sum_original,
           SUM(available_micro + reserved_micro + consumed_micro) as sum_parts,
           SUM(CASE WHEN available_micro + reserved_micro + consumed_micro != original_micro
                    THEN 1 ELSE 0 END) as violated
         FROM credit_lots`
      ).get() as {
        total_lots: number;
        sum_original: number;
        sum_parts: number;
        violated: number;
      };

      const passed = lotCheck.violated === 0;
      checks.push({
        name: 'lot_balance_invariant',
        passed,
        details: passed
          ? `${lotCheck.total_lots} lots, all invariants hold`
          : `${lotCheck.violated}/${lotCheck.total_lots} lots violate invariant`,
        severity: passed ? 'info' : 'error',
      });
    } catch (err) {
      checks.push({
        name: 'lot_balance_invariant',
        passed: false,
        details: `Check failed: ${(err as Error).message}`,
        severity: 'error',
      });
    }

    // -----------------------------------------------------------------------
    // Check 2: Orphan Reservations
    // No pending reservations older than 2x TTL
    // -----------------------------------------------------------------------
    try {
      const orphanThreshold = sqliteNow(); // current time
      const twoTtlAgo = new Date(Date.now() - reserveTtl * 2 * 1000)
        .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      const orphanCheck = config.db.prepare(
        `SELECT COUNT(*) as orphan_count
         FROM credit_reservations
         WHERE status = 'pending' AND created_at < ?`
      ).get(twoTtlAgo) as { orphan_count: number };

      const passed = orphanCheck.orphan_count === 0;
      checks.push({
        name: 'orphan_reservations',
        passed,
        details: passed
          ? 'No orphan reservations found'
          : `${orphanCheck.orphan_count} pending reservations older than 2x TTL (${reserveTtl * 2}s)`,
        severity: passed ? 'info' : 'warn',
      });
    } catch (err) {
      checks.push({
        name: 'orphan_reservations',
        passed: false,
        details: `Check failed: ${(err as Error).message}`,
        severity: 'error',
      });
    }

    // -----------------------------------------------------------------------
    // Check 3: Zero-Sum Distribution Invariant
    // Revenue distribution entries should sum correctly per reservation
    // -----------------------------------------------------------------------
    try {
      // Check that commons + community + foundation = finalize amount
      // for each reservation that has distribution entries
      const distCheck = config.db.prepare(
        `SELECT
           r.id as reservation_id,
           fin.amount_micro as finalize_amount,
           COALESCE(SUM(dist.amount_micro), 0) as distribution_total
         FROM credit_reservations r
         JOIN credit_ledger fin ON fin.reservation_id = r.id AND fin.entry_type = 'finalize'
         LEFT JOIN credit_ledger dist ON dist.reservation_id = r.id
           AND dist.entry_type IN ('commons_contribution', 'revenue_share')
         WHERE r.status = 'finalized'
         GROUP BY r.id, fin.amount_micro
         HAVING distribution_total > 0 AND distribution_total != CAST(finalize_amount AS INTEGER)`
      ).all() as Array<{ reservation_id: string; finalize_amount: number; distribution_total: number }>;

      const passed = distCheck.length === 0;
      checks.push({
        name: 'zero_sum_distribution',
        passed,
        details: passed
          ? 'All distribution triads sum correctly'
          : `${distCheck.length} reservations have mismatched distributions`,
        severity: passed ? 'info' : 'error',
      });
    } catch (err) {
      checks.push({
        name: 'zero_sum_distribution',
        passed: false,
        details: `Check failed: ${(err as Error).message}`,
        severity: 'error',
      });
    }

    // -----------------------------------------------------------------------
    // Check 4: Webhook Deposit Match
    // All finished crypto_payments should have corresponding lots
    // -----------------------------------------------------------------------
    try {
      const depositCheck = config.db.prepare(
        `SELECT COUNT(*) as missing_lots
         FROM crypto_payments
         WHERE status = 'finished' AND lot_id IS NULL AND amount_usd_micro IS NOT NULL`
      ).get() as { missing_lots: number };

      const passed = depositCheck.missing_lots === 0;
      checks.push({
        name: 'webhook_deposit_match',
        passed,
        details: passed
          ? 'All finished payments have corresponding lots'
          : `${depositCheck.missing_lots} finished payments missing lot records`,
        severity: passed ? 'info' : 'warn',
      });
    } catch (err) {
      checks.push({
        name: 'webhook_deposit_match',
        passed: false,
        details: `Check failed: ${(err as Error).message}`,
        severity: 'error',
      });
    }

    // -----------------------------------------------------------------------
    // Store results
    // -----------------------------------------------------------------------
    const now = sqliteNow();
    const allPassed = checks.every(c => c.passed);
    const durationMs = Date.now() - start;

    // -----------------------------------------------------------------------
    // Generation counter (Task 9.5)
    // -----------------------------------------------------------------------
    let generation = 0;
    try {
      const genRow = config.db.prepare(
        `SELECT value FROM billing_config WHERE key = 'reconciliation_generation'`
      ).get() as { value: string } | undefined;

      generation = genRow ? parseInt(genRow.value, 10) + 1 : 1;

      if (genRow) {
        config.db.prepare(
          `UPDATE billing_config SET value = ?, updated_at = ? WHERE key = 'reconciliation_generation'`
        ).run(String(generation), now);
      } else {
        config.db.prepare(
          `INSERT INTO billing_config (key, value, updated_at) VALUES ('reconciliation_generation', ?, ?)`
        ).run(String(generation), now);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to update reconciliation generation counter');
    }

    const result: DailyReconciliationResult = {
      timestamp: now,
      passed: allPassed,
      checks,
      durationMs,
      generation,
    };

    try {
      config.db.prepare(
        `UPDATE billing_config SET value = ?, updated_at = ? WHERE key = 'last_reconciliation_at'`
      ).run(now, now);

      config.db.prepare(
        `UPDATE billing_config SET value = ?, updated_at = ? WHERE key = 'last_reconciliation_result'`
      ).run(JSON.stringify(result), now);
    } catch (err) {
      logger.warn({ err }, 'Failed to store reconciliation results in billing_config');
    }

    logger.info({
      event: 'billing.daily_reconciliation',
      passed: allPassed,
      checks: checks.map(c => ({ name: c.name, passed: c.passed })),
      durationMs,
      generation,
    }, `Daily reconciliation ${allPassed ? 'PASSED' : 'FAILED'}`);

    return result;
  }

  return {
    runOnce: runChecks,
  };
}
