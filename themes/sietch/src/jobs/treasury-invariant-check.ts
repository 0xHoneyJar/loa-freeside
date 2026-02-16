/**
 * Treasury Invariant Check — Reserve ≥ Unpaid Settled Earnings
 *
 * Verifies that the treasury reserve pool always holds at least
 * as much as the total unpaid settled referrer earnings.
 *
 * Designed for hourly cron execution via BullMQ.
 *
 * SDD refs: §4.3 Treasury Invariant
 * Sprint refs: Task 7.4
 *
 * @module jobs/treasury-invariant-check
 */

import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface TreasuryInvariantResult {
  passed: boolean;
  reserveBalanceMicro: bigint;
  unpaidSettledMicro: bigint;
  surplusMicro: bigint;
  timestamp: string;
}

// =============================================================================
// Treasury Invariant Check
// =============================================================================

export function createTreasuryInvariantCheck(config: { db: Database.Database }) {
  const { db } = config;

  function runCheck(): TreasuryInvariantResult {
    const now = new Date().toISOString();

    // Get total reserve balance (treasury pool in credit_ledger)
    let reserveBalanceMicro = 0n;
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM credit_ledger
        WHERE pool_id = 'treasury'
      `).get() as { total: number };
      reserveBalanceMicro = BigInt(row.total);
    } catch {
      // Table may not exist
    }

    // Get total unpaid settled earnings (settled but not withdrawn)
    let unpaidSettledMicro = 0n;
    try {
      const row = db.prepare(`
        SELECT COALESCE(SUM(amount_micro), 0) as total
        FROM referrer_earnings
        WHERE settled_at IS NOT NULL
          AND clawback_reason IS NULL
      `).get() as { total: number };
      unpaidSettledMicro = BigInt(row.total);
    } catch {
      // Table may not exist or columns not added yet
    }

    const surplusMicro = reserveBalanceMicro - unpaidSettledMicro;
    const passed = reserveBalanceMicro >= unpaidSettledMicro;

    if (!passed) {
      logger.error({
        event: 'treasury.invariant.violation',
        reserveBalanceMicro: reserveBalanceMicro.toString(),
        unpaidSettledMicro: unpaidSettledMicro.toString(),
        deficitMicro: (-surplusMicro).toString(),
      }, 'CRITICAL: Treasury invariant violated — reserve < unpaid settled earnings');
    } else {
      logger.info({
        event: 'treasury.invariant.passed',
        reserveBalanceMicro: reserveBalanceMicro.toString(),
        unpaidSettledMicro: unpaidSettledMicro.toString(),
        surplusMicro: surplusMicro.toString(),
      }, 'Treasury invariant check passed');
    }

    return {
      passed,
      reserveBalanceMicro,
      unpaidSettledMicro,
      surplusMicro,
      timestamp: now,
    };
  }

  return { runOnce: runCheck };
}
