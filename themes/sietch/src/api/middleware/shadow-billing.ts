/**
 * Shadow Billing Hook — Lightweight Shadow Charge Logger
 *
 * Captures hypothetical charges in shadow mode without blocking inference.
 * Creates shadow_reserve and shadow_finalize ledger entries for observability.
 *
 * SDD refs: §1.4 BillingMiddleware (shadow mode)
 * Sprint refs: Task 3.2
 *
 * @module api/middleware/shadow-billing
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ShadowChargeEntry {
  id: string;
  accountId: string;
  poolId: string;
  entryType: 'shadow_reserve' | 'shadow_finalize';
  amountMicro: bigint;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  overheadMs?: number;
  createdAt: string;
}

export interface ShadowBillingConfig {
  /** SQLite database for ledger entries */
  db: Database.Database;
}

// =============================================================================
// Shadow Billing Service
// =============================================================================

export class ShadowBillingService {
  private db: Database.Database;

  constructor(config: ShadowBillingConfig) {
    this.db = config.db;
  }

  /**
   * Log a shadow reserve entry.
   * Never blocks or throws — all errors are swallowed.
   */
  logShadowReserve(
    accountId: string,
    poolId: string,
    estimatedCostMicro: bigint,
    metadata?: { model?: string; maxTokens?: number },
  ): string | null {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    try {
      // Get next sequence number for this account+pool
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), 0) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(accountId, poolId) as { next_seq: number } | undefined;

      const seq = seqRow?.next_seq ?? 1;

      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, entry_seq, entry_type, amount_micro,
          description, metadata, created_at)
         VALUES (?, ?, ?, ?, 'shadow_reserve', ?, ?, ?, ?)`
      ).run(
        id, accountId, poolId, seq,
        estimatedCostMicro.toString(),
        'Shadow mode: hypothetical reserve',
        metadata ? JSON.stringify(metadata) : null,
        now,
      );

      logger.debug({
        event: 'billing.shadow.reserve',
        id,
        accountId,
        estimatedCostMicro: estimatedCostMicro.toString(),
      }, 'Shadow reserve logged');

      return id;
    } catch (err) {
      logger.warn({
        event: 'billing.shadow.reserve.error',
        accountId,
        err,
      }, 'Failed to log shadow reserve — non-blocking');
      return null;
    }
  }

  /**
   * Log a shadow finalize entry.
   * Never blocks or throws — all errors are swallowed.
   */
  logShadowFinalize(
    accountId: string,
    poolId: string,
    actualCostMicro: bigint,
    metadata?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      overheadMs?: number;
      reserveEntryId?: string;
    },
  ): string | null {
    const id = randomUUID();
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

    try {
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), 0) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(accountId, poolId) as { next_seq: number } | undefined;

      const seq = seqRow?.next_seq ?? 1;

      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, entry_seq, entry_type, amount_micro,
          description, metadata, created_at)
         VALUES (?, ?, ?, ?, 'shadow_finalize', ?, ?, ?, ?)`
      ).run(
        id, accountId, poolId, seq,
        actualCostMicro.toString(),
        'Shadow mode: hypothetical finalize',
        metadata ? JSON.stringify(metadata) : null,
        now,
      );

      logger.debug({
        event: 'billing.shadow.finalize',
        id,
        accountId,
        actualCostMicro: actualCostMicro.toString(),
        overheadMs: metadata?.overheadMs,
      }, 'Shadow finalize logged');

      return id;
    } catch (err) {
      logger.warn({
        event: 'billing.shadow.finalize.error',
        accountId,
        err,
      }, 'Failed to log shadow finalize — non-blocking');
      return null;
    }
  }

  /**
   * Get shadow billing summary for an account.
   * Useful for shadow mode analytics before going live.
   */
  getShadowSummary(accountId: string): {
    totalReserves: number;
    totalFinalizes: number;
    totalShadowCostMicro: bigint;
  } {
    const result = this.db.prepare(
      `SELECT
         SUM(CASE WHEN entry_type = 'shadow_reserve' THEN 1 ELSE 0 END) as reserves,
         SUM(CASE WHEN entry_type = 'shadow_finalize' THEN 1 ELSE 0 END) as finalizes,
         SUM(CASE WHEN entry_type = 'shadow_finalize' THEN CAST(amount_micro AS INTEGER) ELSE 0 END) as total_cost
       FROM credit_ledger
       WHERE account_id = ? AND entry_type IN ('shadow_reserve', 'shadow_finalize')`
    ).get(accountId) as { reserves: number; finalizes: number; total_cost: number } | undefined;

    return {
      totalReserves: result?.reserves ?? 0,
      totalFinalizes: result?.finalizes ?? 0,
      totalShadowCostMicro: BigInt(result?.total_cost ?? 0),
    };
  }
}
