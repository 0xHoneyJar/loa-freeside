/**
 * Spending Visibility API — Admin Billing Dashboard
 *
 * GET /admin/billing/spending-summary
 *   Query: period=daily|weekly|monthly, accountId (optional)
 *   Auth: Admin JWT
 *   Returns: aggregated spending data with top accounts
 *
 * Sprint refs: Task 6.2
 *
 * @module api/routes/spending-visibility
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { serializeBigInt } from '../../packages/core/protocol/arrakis-arithmetic.js';
import { logger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Router Setup
// =============================================================================

export const spendingRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let billingDb: Database.Database | null = null;

export function setSpendingDb(db: Database.Database): void {
  billingDb = db;
}

function getDb(): Database.Database {
  if (!billingDb) throw new Error('Spending visibility DB not initialized');
  return billingDb;
}

// =============================================================================
// Schemas
// =============================================================================

const summarySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']),
  accountId: z.string().optional(),
});

// =============================================================================
// Period Calculation
// =============================================================================

function getPeriodRange(period: 'daily' | 'weekly' | 'monthly'): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0]!;

  let startDate: string;
  switch (period) {
    case 'daily':
      startDate = endDate;
      break;
    case 'weekly': {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.toISOString().split('T')[0]!;
      break;
    }
    case 'monthly': {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      startDate = monthAgo.toISOString().split('T')[0]!;
      break;
    }
  }

  return { startDate, endDate };
}

// =============================================================================
// GET /spending-summary
// =============================================================================

spendingRouter.get(
  '/spending-summary',
  (req: Request, res: Response) => {
    const parsed = summarySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { period, accountId } = parsed.data;
    const { startDate, endDate } = getPeriodRange(period);
    const db = getDb();

    try {
      // Build query with optional account filter
      let whereClause = `WHERE date(created_at) >= ? AND date(created_at) <= ?
        AND entry_type IN ('finalize', 'shadow_finalize')`;
      const params: (string | number)[] = [startDate, endDate];

      if (accountId) {
        whereClause += ` AND account_id = ?`;
        params.push(accountId);
      }

      // Aggregate spending
      const summary = db.prepare(`
        SELECT
          COUNT(*) as transaction_count,
          COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as total_spent_micro
        FROM credit_ledger
        ${whereClause}
      `).get(...params) as { transaction_count: number; total_spent_micro: number } | undefined;

      const totalSpent = BigInt(summary?.total_spent_micro ?? 0);
      const txCount = summary?.transaction_count ?? 0;
      const avgTransaction = txCount > 0 ? totalSpent / BigInt(txCount) : 0n;

      // Top 10 accounts by spend
      const topAccounts = db.prepare(`
        SELECT
          account_id,
          SUM(CAST(amount_micro AS INTEGER)) as total_spent_micro
        FROM credit_ledger
        ${whereClause}
        GROUP BY account_id
        ORDER BY total_spent_micro DESC
        LIMIT 10
      `).all(...params) as Array<{ account_id: string; total_spent_micro: number }>;

      res.json(serializeBigInt({
        period,
        startDate,
        endDate,
        totalSpentMicro: totalSpent,
        transactionCount: txCount,
        avgTransactionMicro: avgTransaction,
        topAccounts: topAccounts.map(a => ({
          accountId: a.account_id,
          totalSpentMicro: BigInt(a.total_spent_micro),
        })),
      }));
    } catch (err) {
      logger.error({ event: 'spending.summary.error', err }, 'Spending summary query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
