/**
 * Balance Reconciliation Job
 *
 * Periodic job comparing Redis balance cache to SQLite source of truth.
 * Runs every 5 minutes, checks top-100 active accounts, corrects drift.
 *
 * SDD refs: §1.4 Background Jobs
 * Sprint refs: Task 3.4
 *
 * @module jobs/balance-reconciler
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface BalanceReconcilerConfig {
  /** SQLite database */
  db: Database.Database;
  /** Redis client (optional — skips if null) */
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<string>;
  } | null;
  /** Interval in milliseconds (default: 5 minutes) */
  intervalMs?: number;
  /** Max accounts to check per run (default: 100) */
  maxAccounts?: number;
}

export interface ReconciliationResult {
  accountsChecked: number;
  driftFound: number;
  driftCorrected: number;
  durationMs: number;
  drifts: Array<{
    accountId: string;
    poolId: string;
    redisAvailable: string;
    sqliteAvailable: string;
  }>;
}

// =============================================================================
// Balance Reconciler
// =============================================================================

const REDIS_BALANCE_PREFIX = 'billing:balance:';

export function createBalanceReconciler(config: BalanceReconcilerConfig) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const intervalMs = config.intervalMs ?? 5 * 60 * 1000;
  const maxAccounts = config.maxAccounts ?? 100;

  async function reconcile(): Promise<ReconciliationResult> {
    const start = Date.now();

    if (!config.redis) {
      return {
        accountsChecked: 0,
        driftFound: 0,
        driftCorrected: 0,
        durationMs: Date.now() - start,
        drifts: [],
      };
    }

    // Get top-N active accounts (most recent ledger activity)
    const accounts = config.db.prepare(
      `SELECT DISTINCT account_id, pool_id
       FROM credit_ledger
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(maxAccounts) as Array<{ account_id: string; pool_id: string }>;

    let driftFound = 0;
    let driftCorrected = 0;
    const drifts: ReconciliationResult['drifts'] = [];

    for (const { account_id, pool_id } of accounts) {
      const effectivePool = pool_id ?? 'general';
      const redisKey = `${REDIS_BALANCE_PREFIX}${account_id}:${effectivePool}`;

      try {
        // Get Redis value
        const cached = await config.redis.get(redisKey);
        if (!cached) continue; // No cache entry — skip

        const parsed = JSON.parse(cached);
        const redisAvailable = BigInt(parsed.availableMicro ?? '0');

        // Get SQLite truth
        const sqliteRow = config.db.prepare(
          `SELECT
             COALESCE(SUM(available_micro), 0) as available,
             COALESCE(SUM(reserved_micro), 0) as reserved
           FROM credit_lots
           WHERE account_id = ? AND (pool_id = ? OR pool_id IS NULL)`
        ).get(account_id, effectivePool) as { available: number; reserved: number };

        const sqliteAvailable = BigInt(sqliteRow.available);

        // Compare
        if (redisAvailable !== sqliteAvailable) {
          driftFound++;

          logger.warn({
            event: 'billing.reconcile.drift',
            accountId: account_id,
            poolId: effectivePool,
            redisAvailable: redisAvailable.toString(),
            sqliteAvailable: sqliteAvailable.toString(),
            delta: (sqliteAvailable - redisAvailable).toString(),
          }, 'Balance drift detected — correcting Redis');

          drifts.push({
            accountId: account_id,
            poolId: effectivePool,
            redisAvailable: redisAvailable.toString(),
            sqliteAvailable: sqliteAvailable.toString(),
          });

          // Correct: overwrite Redis with SQLite truth
          await config.redis.set(redisKey, JSON.stringify({
            availableMicro: sqliteAvailable.toString(),
            reservedMicro: BigInt(sqliteRow.reserved).toString(),
          }));

          driftCorrected++;
        }
      } catch (err) {
        logger.error({
          event: 'billing.reconcile.error',
          accountId: account_id,
          err,
        }, 'Error reconciling account balance');
      }
    }

    const durationMs = Date.now() - start;

    logger.info({
      event: 'billing.reconcile',
      accounts_checked: accounts.length,
      drift_found: driftFound,
      drift_corrected: driftCorrected,
      duration_ms: durationMs,
    }, `Reconciliation completed: ${driftFound} drifts found`);

    return {
      accountsChecked: accounts.length,
      driftFound,
      driftCorrected,
      durationMs,
      drifts,
    };
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(async () => {
        try {
          await reconcile();
        } catch (err) {
          logger.error({ err, event: 'billing.reconcile.unhandled' },
            'Unhandled reconciliation error');
        }
      }, intervalMs);
      logger.info({
        event: 'billing.reconcile.start',
        intervalMs,
      }, 'Balance reconciler started');
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        logger.info({ event: 'billing.reconcile.stop' },
          'Balance reconciler stopped');
      }
    },
    reconcileOnce: reconcile,
  };
}
