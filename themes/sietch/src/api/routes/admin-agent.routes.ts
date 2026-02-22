/**
 * Admin Agent Routes — Community Usage & Agent Dashboard
 * Sprint 5 (318), Task 5.1: Admin API — Usage Endpoints
 *
 * GET /admin/agents/community/:communityId/usage         — spend breakdown, projected depletion
 * GET /admin/agents/community/:communityId/billing        — billing history, credit lots, payments
 * GET /admin/agents/community/:communityId/agents         — active agents, thread counts, last active
 * GET /admin/agents/community/:communityId/audit          — JSONL audit trail export (Task 5.2)
 * GET /admin/agents/community/:communityId/conservation       — conservation guard status (Task 5.3)
 * GET /admin/agents/community/:communityId/pool-enforcement   — pool routing transparency (Task 5.4)
 * GET /admin/agents/payments                                  — payment dashboard (Task 5.5)
 * POST /admin/agents/payments/:paymentId/reconcile            — manual reconciliation (Task 5.5)
 *
 * All endpoints require admin auth (API key) and are rate limited.
 * Response data freshness: <60s (queries run against SQLite, no caching layer).
 *
 * SDD refs: §4b Admin Dashboard
 * PRD refs: FR-3.4–3.5
 *
 * @module api/routes/admin-agent
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getDatabase } from '../../db/connection.js';
import { logBillingAuditEvent } from '../../db/billing-queries.js';
import {
  isCryptoPaymentsEnabled,
  getNOWPaymentsClientConfig,
} from '../../config.js';
import { createCryptoPaymentProvider } from '../../packages/adapters/billing/index.js';
import type { ICryptoPaymentProvider } from '../../packages/core/ports/ICryptoPaymentProvider.js';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKeyAsync,
  ValidationError,
} from '../middleware.js';

// =============================================================================
// Router Setup
// =============================================================================

export const adminAgentRouter = Router();

// Apply admin rate limiting and authentication
adminAgentRouter.use(adminRateLimiter);
adminAgentRouter.use(requireApiKeyAsync);

// =============================================================================
// Database Access
// =============================================================================

function getDb() {
  return getDatabase();
}

// =============================================================================
// Schemas
// =============================================================================

const communityIdParam = z.object({
  communityId: z.string().min(1, 'communityId is required'),
});

const usageQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
  pool: z.string().optional(),
});

const billingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(['deposit', 'grant', 'purchase', 'finalize', 'reserve', 'release', 'refund']).optional(),
});

const agentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const auditQuerySchema = z.object({
  format: z.literal('jsonl'),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  entry_type: z.string().optional(),
});

const conservationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const poolEnforcementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  pool: z.string().optional(),
});

const paymentsQuerySchema = z.object({
  status: z.enum(['stuck', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const reconcileParamSchema = z.object({
  paymentId: z.string().min(1, 'paymentId is required'),
});

// =============================================================================
// Helpers
// =============================================================================

function pseudonymizeWallet(wallet?: string | null): string | null {
  if (!wallet) return null;
  return wallet.length > 10
    ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
    : wallet;
}

/** Check if a SQLite table exists (safe for migration-optional tables). */
function tableExists(db: ReturnType<typeof getDatabase>, tableName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
  ).get(tableName) as { name?: string } | undefined;
  return !!row?.name;
}

/** Terminal payment statuses — payments in these states are not "stuck". */
const TERMINAL_PAYMENT_STATUSES = ['finished', 'failed', 'refunded', 'expired'];

/** Lazy-initialized crypto provider for manual reconciliation. */
let _cryptoProvider: ICryptoPaymentProvider | null = null;

function getCryptoProvider(): ICryptoPaymentProvider | null {
  if (_cryptoProvider) return _cryptoProvider;
  if (!isCryptoPaymentsEnabled()) return null;
  try {
    const nowConfig = getNOWPaymentsClientConfig();
    if (!nowConfig) return null;
    _cryptoProvider = createCryptoPaymentProvider({
      provider: 'nowpayments',
      nowpayments: nowConfig,
    });
    return _cryptoProvider;
  } catch {
    return null;
  }
}

/** Check if a table has a specific column. tableName must be an internal constant. */
function tableHasColumn(
  db: ReturnType<typeof getDatabase>,
  tableName: string,
  columnName: string,
): boolean {
  if (!tableExists(db, tableName)) return false;
  // PRAGMA table_info does not support parameter binding; tableName is a trusted internal constant
  const cols = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  return cols.some(c => c.name === columnName);
}

function getPeriodStart(period: 'daily' | 'weekly' | 'monthly'): string {
  const now = new Date();
  switch (period) {
    case 'daily':
      return now.toISOString().split('T')[0]!;
    case 'weekly': {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return weekAgo.toISOString().split('T')[0]!;
    }
    case 'monthly': {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return monthAgo.toISOString().split('T')[0]!;
    }
  }
}

// =============================================================================
// GET /community/:communityId/usage
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/usage',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = usageQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { period, pool } = query.data;
    const periodStart = getPeriodStart(period);
    const db = getDb();

    try {
      // Find community account(s)
      const accounts = db.prepare(
        `SELECT id FROM credit_accounts WHERE entity_type = 'community' AND entity_id = ?`,
      ).all(communityId) as Array<{ id: string }>;

      if (accounts.length === 0) {
        res.json({
          communityId,
          period,
          totalSpendMicro: 0,
          transactionCount: 0,
          poolBreakdown: [],
          userBreakdown: [],
          projectedDepletion: null,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const accountIds = accounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');

      // Total spend for period
      let spendWhere = `account_id IN (${placeholders}) AND date(created_at) >= ? AND entry_type IN ('finalize', 'shadow_finalize')`;
      const spendParams: (string | number)[] = [...accountIds, periodStart];

      if (pool) {
        spendWhere += ` AND pool_id = ?`;
        spendParams.push(pool);
      }

      const totalSpend = db.prepare(`
        SELECT
          COUNT(*) as transaction_count,
          COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as total_spent_micro
        FROM credit_ledger
        WHERE ${spendWhere}
      `).get(...spendParams) as { transaction_count: number; total_spent_micro: number } | undefined;

      // Per-pool breakdown
      const poolBreakdown = db.prepare(`
        SELECT
          COALESCE(pool_id, '__unassigned__') as pool_id,
          COUNT(*) as transaction_count,
          COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as total_spent_micro
        FROM credit_ledger
        WHERE account_id IN (${placeholders}) AND date(created_at) >= ?
          AND entry_type IN ('finalize', 'shadow_finalize')
        GROUP BY pool_id
        ORDER BY total_spent_micro DESC
      `).all(...accountIds, periodStart) as Array<{
        pool_id: string;
        transaction_count: number;
        total_spent_micro: number;
      }>;

      // Per-user breakdown (from metadata or reservation references)
      // Use daily_agent_spending for per-agent breakdown
      const userBreakdown = db.prepare(`
        SELECT
          das.agent_account_id,
          ca.entity_id as agent_entity_id,
          SUM(das.total_spent_micro) as total_spent_micro
        FROM daily_agent_spending das
        JOIN credit_accounts ca ON ca.id = das.agent_account_id
        WHERE das.agent_account_id IN (
          SELECT id FROM credit_accounts WHERE entity_type = 'agent' AND entity_id LIKE ? || '%'
        )
        AND das.spending_date >= ?
        GROUP BY das.agent_account_id
        ORDER BY total_spent_micro DESC
        LIMIT 20
      `).all(communityId, periodStart) as Array<{
        agent_account_id: string;
        agent_entity_id: string;
        total_spent_micro: number;
      }>;

      // Projected depletion: current balance / daily burn rate
      const currentBalance = db.prepare(`
        SELECT COALESCE(SUM(available_micro), 0) as total_available
        FROM credit_balances
        WHERE account_id IN (${placeholders})
      `).get(...accountIds) as { total_available: number } | undefined;

      const dailySpend = db.prepare(`
        SELECT COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as daily_total
        FROM credit_ledger
        WHERE account_id IN (${placeholders})
          AND date(created_at) = date('now')
          AND entry_type IN ('finalize', 'shadow_finalize')
      `).get(...accountIds) as { daily_total: number } | undefined;

      let projectedDepletion: string | null = null;
      const balance = currentBalance?.total_available ?? 0;
      const dailyBurn = dailySpend?.daily_total ?? 0;

      if (dailyBurn > 0 && balance > 0) {
        const daysRemaining = Math.floor(balance / dailyBurn);
        const depletionDate = new Date();
        depletionDate.setDate(depletionDate.getDate() + daysRemaining);
        projectedDepletion = depletionDate.toISOString().split('T')[0]!;
      }

      res.json({
        communityId,
        period,
        totalSpendMicro: totalSpend?.total_spent_micro ?? 0,
        transactionCount: totalSpend?.transaction_count ?? 0,
        poolBreakdown: poolBreakdown.map(p => ({
          poolId: p.pool_id,
          transactionCount: p.transaction_count,
          totalSpendMicro: p.total_spent_micro,
        })),
        userBreakdown: userBreakdown.map(u => ({
          accountId: u.agent_account_id,
          entityId: pseudonymizeWallet(u.agent_entity_id),
          totalSpendMicro: u.total_spent_micro,
        })),
        projectedDepletion,
        currentBalanceMicro: balance,
        dailyBurnMicro: dailyBurn,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ event: 'admin.agent.usage.error', err, communityId }, 'Usage query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /community/:communityId/billing
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/billing',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = billingQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { limit, offset, type } = query.data;
    const db = getDb();

    try {
      // Find community account(s)
      const accounts = db.prepare(
        `SELECT id FROM credit_accounts WHERE entity_type = 'community' AND entity_id = ?`,
      ).all(communityId) as Array<{ id: string }>;

      if (accounts.length === 0) {
        res.json({
          communityId,
          ledgerEntries: [],
          creditLots: [],
          pagination: { limit, offset, total: 0, hasMore: false },
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const accountIds = accounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');

      // Ledger entries with pagination
      let ledgerWhere = `account_id IN (${placeholders})`;
      const ledgerParams: (string | number)[] = [...accountIds];

      if (type) {
        ledgerWhere += ` AND entry_type = ?`;
        ledgerParams.push(type);
      }

      const total = db.prepare(`
        SELECT COUNT(*) as count FROM credit_ledger WHERE ${ledgerWhere}
      `).get(...ledgerParams) as { count: number };

      const ledgerEntries = db.prepare(`
        SELECT
          id, account_id, pool_id, entry_type, amount_micro,
          description, created_at, pre_balance_micro, post_balance_micro
        FROM credit_ledger
        WHERE ${ledgerWhere}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...ledgerParams, limit, offset) as Array<{
        id: string;
        account_id: string;
        pool_id: string | null;
        entry_type: string;
        amount_micro: number;
        description: string | null;
        created_at: string;
        pre_balance_micro: number | null;
        post_balance_micro: number | null;
      }>;

      // Active credit lots
      const creditLots = db.prepare(`
        SELECT
          id, account_id, pool_id, source_type,
          original_micro, available_micro, reserved_micro, consumed_micro,
          expires_at, created_at
        FROM credit_lots
        WHERE account_id IN (${placeholders}) AND available_micro > 0
        ORDER BY (expires_at IS NULL) ASC, expires_at ASC, created_at ASC
        LIMIT 20
      `).all(...accountIds) as Array<{
        id: string;
        account_id: string;
        pool_id: string | null;
        source_type: string;
        original_micro: number;
        available_micro: number;
        reserved_micro: number;
        consumed_micro: number;
        expires_at: string | null;
        created_at: string;
      }>;

      res.json({
        communityId,
        ledgerEntries: ledgerEntries.map(e => ({
          id: e.id,
          accountId: e.account_id,
          poolId: e.pool_id,
          entryType: e.entry_type,
          amountMicro: e.amount_micro,
          description: e.description,
          createdAt: e.created_at,
          preBalanceMicro: e.pre_balance_micro,
          postBalanceMicro: e.post_balance_micro,
        })),
        creditLots: creditLots.map(l => ({
          id: l.id,
          accountId: l.account_id,
          poolId: l.pool_id,
          sourceType: l.source_type,
          originalMicro: l.original_micro,
          availableMicro: l.available_micro,
          reservedMicro: l.reserved_micro,
          consumedMicro: l.consumed_micro,
          expiresAt: l.expires_at,
          createdAt: l.created_at,
        })),
        pagination: {
          limit,
          offset,
          total: total.count,
          hasMore: offset + limit < total.count,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ event: 'admin.agent.billing.error', err, communityId }, 'Billing query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /community/:communityId/agents
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/agents',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = agentsQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { limit, offset } = query.data;
    const db = getDb();

    try {
      // agent_threads may not exist if migration 063 hasn't run
      if (!tableExists(db, 'agent_threads')) {
        res.json({
          communityId,
          summary: { activeThreads: 0, inactiveThreads: 0, lastActivity: null },
          threads: [],
          pagination: { limit, offset, total: 0, hasMore: false },
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // Total active threads for this community
      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM agent_threads
        WHERE community_id = ? AND is_active = 1
      `).get(communityId) as { count: number };

      // Active threads with details
      const threads = db.prepare(`
        SELECT
          id, nft_id, thread_id, owner_wallet, community_id,
          created_at, last_active_at, ownership_verified_at
        FROM agent_threads
        WHERE community_id = ? AND is_active = 1
        ORDER BY last_active_at DESC
        LIMIT ? OFFSET ?
      `).all(communityId, limit, offset) as Array<{
        id: string;
        nft_id: string;
        thread_id: string;
        owner_wallet: string;
        community_id: string;
        created_at: string;
        last_active_at: string;
        ownership_verified_at: string;
      }>;

      // Inactive (deactivated) thread count
      const inactiveCount = db.prepare(`
        SELECT COUNT(*) as count FROM agent_threads
        WHERE community_id = ? AND is_active = 0
      `).get(communityId) as { count: number };

      // Most recent activity timestamp across all threads
      const lastActivity = db.prepare(`
        SELECT MAX(last_active_at) as last_active
        FROM agent_threads
        WHERE community_id = ? AND is_active = 1
      `).get(communityId) as { last_active: string | null };

      res.json({
        communityId,
        summary: {
          activeThreads: totalResult.count,
          inactiveThreads: inactiveCount.count,
          lastActivity: lastActivity.last_active,
        },
        threads: threads.map(t => ({
          id: t.id,
          nftId: t.nft_id,
          threadId: t.thread_id,
          ownerWallet: pseudonymizeWallet(t.owner_wallet),
          createdAt: t.created_at,
          lastActiveAt: t.last_active_at,
          ownershipVerifiedAt: t.ownership_verified_at,
        })),
        pagination: {
          limit,
          offset,
          total: totalResult.count,
          hasMore: offset + limit < totalResult.count,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ event: 'admin.agent.agents.error', err, communityId }, 'Agents query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /community/:communityId/audit — JSONL Audit Trail Export (Task 5.2)
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/audit',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = auditQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { since, until, entry_type } = query.data;
    const db = getDb();

    try {
      // Find community account(s)
      const accounts = db.prepare(
        `SELECT id FROM credit_accounts WHERE entity_type = 'community' AND entity_id = ?`,
      ).all(communityId) as Array<{ id: string }>;

      const safeCommunityId = communityId.replace(/[^a-zA-Z0-9_-]/g, '_');

      if (accounts.length === 0) {
        // Empty JSONL — valid response
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Content-Disposition', `attachment; filename="audit-${safeCommunityId}.jsonl"`);
        res.end();
        return;
      }

      const accountIds = accounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');

      // Build WHERE clause
      let whereClause = `account_id IN (${placeholders})`;
      const queryParams: (string | number)[] = [...accountIds];

      if (since) {
        whereClause += ` AND date(created_at) >= ?`;
        queryParams.push(since);
      }

      if (until) {
        whereClause += ` AND date(created_at) <= ?`;
        queryParams.push(until);
      }

      if (entry_type) {
        whereClause += ` AND entry_type = ?`;
        queryParams.push(entry_type);
      }

      // Stream JSONL response — one line per ledger entry
      // Capped at 10,000 records to prevent excessive memory usage
      const rows = db.prepare(`
        SELECT
          cl.id,
          cl.account_id,
          cl.pool_id,
          cl.entry_type,
          cl.amount_micro,
          cl.reservation_id,
          cl.description,
          cl.metadata,
          cl.pre_balance_micro,
          cl.post_balance_micro,
          cl.created_at,
          cr.status as reservation_status
        FROM credit_ledger cl
        LEFT JOIN credit_reservations cr ON cr.id = cl.reservation_id
        WHERE ${whereClause}
        ORDER BY cl.created_at ASC
        LIMIT 10000
      `).all(...queryParams) as Array<{
        id: string;
        account_id: string;
        pool_id: string | null;
        entry_type: string;
        amount_micro: number;
        reservation_id: string | null;
        description: string | null;
        metadata: string | null;
        pre_balance_micro: number | null;
        post_balance_micro: number | null;
        created_at: string;
        reservation_status: string | null;
      }>;

      // Set JSONL headers for download
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${safeCommunityId}.jsonl"`);
      res.setHeader('X-Record-Count', String(rows.length));

      // Write one JSON object per line (JSONL format)
      for (const row of rows) {
        // Parse metadata for conservation_result and user wallet if present
        let conservationResult: string | null = null;
        let userWallet: string | null = null;
        if (row.metadata) {
          try {
            const meta = JSON.parse(row.metadata);
            conservationResult = meta?.conservation_result ?? null;
            userWallet = meta?.user_wallet ?? meta?.wallet ?? meta?.owner_wallet ?? null;
          } catch {
            // Malformed metadata — skip conservation and wallet fields
          }
        }

        const line = JSON.stringify({
          timestamp: row.created_at,
          operation_type: row.entry_type,
          amount_micro: row.amount_micro,
          pool: row.pool_id,
          user_wallet: pseudonymizeWallet(userWallet),
          pre_balance_micro: row.pre_balance_micro,
          post_balance_micro: row.post_balance_micro,
          reservation_id: row.reservation_id,
          reservation_status: row.reservation_status,
          conservation_result: conservationResult,
        });

        res.write(line + '\n');
      }

      res.end();

      logger.info(
        { event: 'admin.agent.audit.export', communityId, records: rows.length, since, until },
        'Audit trail exported',
      );
    } catch (err) {
      logger.error({ event: 'admin.agent.audit.error', err, communityId }, 'Audit export failed');
      // If headers already sent, can't send JSON error
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

// =============================================================================
// GET /community/:communityId/conservation — Conservation Guard Status (Task 5.3)
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/conservation',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = conservationQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { limit } = query.data;
    const db = getDb();

    try {
      // Find community account(s)
      const accounts = db.prepare(
        `SELECT id FROM credit_accounts WHERE entity_type = 'community' AND entity_id = ?`,
      ).all(communityId) as Array<{ id: string }>;

      if (accounts.length === 0) {
        res.json({
          communityId,
          status: 'no_account',
          lotSummary: null,
          driftAlert: false,
          lastReconciliation: null,
          reconciliationHistory: [],
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const accountIds = accounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');

      // ── Lot-level conservation summary ──
      // lot_invariant: available + reserved + consumed = original (enforced by CHECK)
      const defaultLotSummary = {
        total_lots: 0,
        total_created_micro: 0,
        total_consumed_micro: 0,
        total_available_micro: 0,
        total_reserved_micro: 0,
      };

      const lotSummary = tableExists(db, 'credit_lots')
        ? (db.prepare(`
            SELECT
              COUNT(*) as total_lots,
              COALESCE(SUM(original_micro), 0) as total_created_micro,
              COALESCE(SUM(consumed_micro), 0) as total_consumed_micro,
              COALESCE(SUM(available_micro), 0) as total_available_micro,
              COALESCE(SUM(reserved_micro), 0) as total_reserved_micro
            FROM credit_lots
            WHERE account_id IN (${placeholders})
          `).get(...accountIds) as typeof defaultLotSummary)
        : defaultLotSummary;

      // Compute drift: created - (consumed + available + reserved)
      // Should be 0 if lot_invariant holds for all lots
      const driftMicro =
        lotSummary.total_created_micro -
        (lotSummary.total_consumed_micro +
          lotSummary.total_available_micro +
          lotSummary.total_reserved_micro);

      // Alert if drift > 1% of total balance (available + reserved)
      const totalBalance =
        lotSummary.total_available_micro + lotSummary.total_reserved_micro;
      const driftPct = totalBalance > 0 ? Math.abs(driftMicro) / totalBalance : 0;
      const driftAlert = driftPct > 0.01;

      // ── Balance cache vs lot totals cross-check ──
      const cachedBalance = tableExists(db, 'credit_balances')
        ? (db.prepare(`
            SELECT COALESCE(SUM(available_micro), 0) as cached_available
            FROM credit_balances
            WHERE account_id IN (${placeholders})
          `).get(...accountIds) as { cached_available: number })
        : { cached_available: 0 };

      const balanceCacheDriftMicro =
        cachedBalance.cached_available - lotSummary.total_available_micro;

      // ── Last reconciliation from billing_config ──
      let lastReconciliationAt: string | null = null;
      let lastReconciliationResult: Record<string, unknown> | null = null;

      try {
        const configRow = db.prepare(
          `SELECT key, value FROM billing_config WHERE key IN ('last_reconciliation_at', 'last_reconciliation_result')`,
        ).all() as Array<{ key: string; value: string }>;

        for (const row of configRow) {
          if (row.key === 'last_reconciliation_at' && row.value) {
            lastReconciliationAt = row.value;
          }
          if (row.key === 'last_reconciliation_result' && row.value) {
            try {
              lastReconciliationResult = JSON.parse(row.value);
            } catch {
              // Malformed JSON — skip
            }
          }
        }
      } catch {
        // billing_config may not exist if migration 032 hasn't run
      }

      // ── Reconciliation run history ──
      // Scoped to community if column exists; otherwise system-wide with scope label
      let reconciliationHistory: Array<{
        id: string;
        startedAt: string;
        finishedAt: string | null;
        status: string;
        divergenceSummary: Record<string, unknown> | null;
      }> = [];
      let reconciliationScope: 'community' | 'system' = 'system';

      if (tableExists(db, 'reconciliation_runs')) {
        try {
          const hasCommunityCol = tableHasColumn(db, 'reconciliation_runs', 'community_id');
          reconciliationScope = hasCommunityCol ? 'community' : 'system';

          const runs = hasCommunityCol
            ? db.prepare(`
                SELECT id, started_at, finished_at, status, divergence_summary_json
                FROM reconciliation_runs
                WHERE community_id = ?
                ORDER BY started_at DESC
                LIMIT ?
              `).all(communityId, limit)
            : db.prepare(`
                SELECT id, started_at, finished_at, status, divergence_summary_json
                FROM reconciliation_runs
                ORDER BY started_at DESC
                LIMIT ?
              `).all(limit);

          reconciliationHistory = (runs as Array<{
            id: string;
            started_at: string;
            finished_at: string | null;
            status: string;
            divergence_summary_json: string | null;
          }>).map(r => {
            let divergenceSummary: Record<string, unknown> | null = null;
            if (r.divergence_summary_json) {
              try {
                divergenceSummary = JSON.parse(r.divergence_summary_json);
              } catch {
                // Malformed JSON — skip
              }
            }
            return {
              id: r.id,
              startedAt: r.started_at,
              finishedAt: r.finished_at,
              status: r.status,
              divergenceSummary,
            };
          });
        } catch {
          // Unexpected query failure — safe fallback
        }
      }

      // ── Lots with invariant violations (should be impossible with CHECK, but
      //    useful to surface if data was manually edited) ──
      let invariantViolations: Array<{
        lotId: string;
        originalMicro: number;
        sumMicro: number;
        deltaMicro: number;
      }> = [];

      if (tableExists(db, 'credit_lots')) {
        try {
          const violations = db.prepare(`
            SELECT
              id,
              original_micro,
              (available_micro + reserved_micro + consumed_micro) as sum_micro,
              original_micro - (available_micro + reserved_micro + consumed_micro) as delta_micro
            FROM credit_lots
            WHERE account_id IN (${placeholders})
              AND original_micro != (available_micro + reserved_micro + consumed_micro)
            LIMIT 20
          `).all(...accountIds) as Array<{
            id: string;
            original_micro: number;
            sum_micro: number;
            delta_micro: number;
          }>;

          invariantViolations = violations.map(v => ({
            lotId: v.id,
            originalMicro: v.original_micro,
            sumMicro: v.sum_micro,
            deltaMicro: v.delta_micro,
          }));
        } catch {
          // Query may fail if columns changed
        }
      }

      res.json({
        communityId,
        status: driftAlert ? 'drift_alert' : 'healthy',
        lotSummary: {
          totalLots: lotSummary.total_lots,
          totalCreatedMicro: lotSummary.total_created_micro,
          totalConsumedMicro: lotSummary.total_consumed_micro,
          totalAvailableMicro: lotSummary.total_available_micro,
          totalReservedMicro: lotSummary.total_reserved_micro,
          driftMicro,
          driftPercent: Math.round(driftPct * 10000) / 100, // 2 decimal places
        },
        balanceCacheDrift: {
          cachedAvailableMicro: cachedBalance.cached_available,
          lotAvailableMicro: lotSummary.total_available_micro,
          driftMicro: balanceCacheDriftMicro,
        },
        driftAlert,
        invariantViolations,
        lastReconciliation: {
          timestamp: lastReconciliationAt,
          result: lastReconciliationResult,
        },
        reconciliationHistory,
        reconciliationScope,
        generatedAt: new Date().toISOString(),
      });

      logger.info(
        {
          event: 'admin.agent.conservation.query',
          communityId,
          driftAlert,
          driftMicro,
          violations: invariantViolations.length,
        },
        'Conservation guard status queried',
      );
    } catch (err) {
      logger.error(
        { event: 'admin.agent.conservation.error', err, communityId },
        'Conservation guard query failed',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /community/:communityId/pool-enforcement — Pool Routing Transparency (Task 5.4)
// =============================================================================

adminAgentRouter.get(
  '/community/:communityId/pool-enforcement',
  (req: AuthenticatedRequest, res: Response) => {
    const params = communityIdParam.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const query = poolEnforcementQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { communityId } = params.data;
    const { limit, offset, since, until, pool } = query.data;
    const db = getDb();

    try {
      // Find community account(s)
      const accounts = db.prepare(
        `SELECT id FROM credit_accounts WHERE entity_type = 'community' AND entity_id = ?`,
      ).all(communityId) as Array<{ id: string }>;

      if (accounts.length === 0) {
        res.json({
          communityId,
          routingDecisions: [],
          poolUtilization: [],
          pagination: { limit, offset, total: 0, hasMore: false },
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const accountIds = accounts.map(a => a.id);
      const placeholders = accountIds.map(() => '?').join(',');

      // ── Recent routing decisions from finalize ledger entries ──
      // Finalize entries record which pool was used and cost
      let routingWhere = `cl.account_id IN (${placeholders}) AND cl.entry_type IN ('finalize', 'shadow_finalize')`;
      const routingParams: (string | number)[] = [...accountIds];

      if (since) {
        routingWhere += ` AND date(cl.created_at) >= ?`;
        routingParams.push(since);
      }

      if (until) {
        routingWhere += ` AND date(cl.created_at) <= ?`;
        routingParams.push(until);
      }

      if (pool) {
        routingWhere += ` AND cl.pool_id = ?`;
        routingParams.push(pool);
      }

      // Total count for pagination
      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM credit_ledger cl WHERE ${routingWhere}
      `).get(...routingParams) as { count: number };

      // Routing decisions — nft_id extracted from metadata (not JOIN)
      // credit_reservations has no thread_id column; nft_id is stored in
      // ledger metadata by the billing middleware when available.
      const rows = db.prepare(`
        SELECT
          cl.id,
          cl.pool_id as actual_pool,
          cl.amount_micro as cost_micro,
          cl.metadata,
          cl.created_at as timestamp
        FROM credit_ledger cl
        WHERE ${routingWhere}
        ORDER BY cl.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...routingParams, limit, offset) as Array<{
        id: string;
        actual_pool: string | null;
        cost_micro: number;
        metadata: string | null;
        timestamp: string;
      }>;

      const routingDecisions = rows.map(row => {
        let requestedPool: string | null = null;
        let reason: string | null = null;
        let model: string | null = null;
        let nftId: string | null = null;

        if (row.metadata) {
          try {
            const meta = JSON.parse(row.metadata);
            requestedPool = meta?.requested_pool ?? meta?.pool_alias ?? null;
            reason = meta?.routing_reason ?? meta?.reason ?? null;
            model = meta?.model ?? null;
            nftId = meta?.nft_id ?? meta?.nftId ?? null;
          } catch {
            // Malformed metadata — skip
          }
        }

        return {
          id: row.id,
          timestamp: row.timestamp,
          nftId,
          requestedPool,
          actualPool: row.actual_pool,
          reason,
          model,
          costMicro: row.cost_micro,
        };
      });

      // ── Pool utilization breakdown ──
      const utilizationRows = db.prepare(`
        SELECT
          COALESCE(cl.pool_id, '__unassigned__') as pool_id,
          COUNT(*) as operation_count,
          COALESCE(SUM(CAST(cl.amount_micro AS INTEGER)), 0) as total_cost_micro
        FROM credit_ledger cl
        WHERE ${routingWhere}
        GROUP BY cl.pool_id
        ORDER BY operation_count DESC
      `).all(...routingParams) as Array<{
        pool_id: string;
        operation_count: number;
        total_cost_micro: number;
      }>;

      const totalOperations = utilizationRows.reduce((sum, r) => sum + r.operation_count, 0);

      const poolUtilization = utilizationRows.map(r => ({
        poolId: r.pool_id,
        operationCount: r.operation_count,
        totalCostMicro: r.total_cost_micro,
        utilizationPercent:
          totalOperations > 0
            ? Math.round((r.operation_count / totalOperations) * 10000) / 100
            : 0,
      }));

      res.json({
        communityId,
        routingDecisions,
        poolUtilization,
        pagination: {
          limit,
          offset,
          total: totalResult.count,
          hasMore: offset + limit < totalResult.count,
        },
        generatedAt: new Date().toISOString(),
      });

      logger.info(
        {
          event: 'admin.agent.pool-enforcement.query',
          communityId,
          results: rows.length,
          pools: utilizationRows.length,
        },
        'Pool enforcement queried',
      );
    } catch (err) {
      logger.error(
        { event: 'admin.agent.pool-enforcement.error', err, communityId },
        'Pool enforcement query failed',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /payments — Admin Payment Dashboard (Task 5.5)
// =============================================================================

adminAgentRouter.get(
  '/payments',
  (req: AuthenticatedRequest, res: Response) => {
    const query = paymentsQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new ValidationError(query.error.issues.map(i => i.message).join(', '));
    }

    const { status, limit, offset } = query.data;
    const db = getDb();

    try {
      if (!tableExists(db, 'crypto_payments')) {
        res.json({
          payments: [],
          pagination: { limit, offset, total: 0, hasMore: false },
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      // "Stuck" = non-terminal status AND created >30 minutes ago
      const isStuck = status === 'stuck';

      let whereClause = '1=1';
      const params: (string | number)[] = [];

      if (isStuck) {
        const terminalPlaceholders = TERMINAL_PAYMENT_STATUSES.map(() => '?').join(',');
        whereClause = `status NOT IN (${terminalPlaceholders}) AND created_at < datetime('now', '-30 minutes')`;
        params.push(...TERMINAL_PAYMENT_STATUSES);
      }

      const totalResult = db.prepare(`
        SELECT COUNT(*) as count FROM crypto_payments WHERE ${whereClause}
      `).get(...params) as { count: number };

      const payments = db.prepare(`
        SELECT
          id, payment_id, community_id, tier,
          price_amount, price_currency,
          pay_amount, pay_currency,
          status, actually_paid,
          order_id,
          created_at, updated_at, expires_at, finished_at
        FROM crypto_payments
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as Array<{
        id: string;
        payment_id: string;
        community_id: string;
        tier: string;
        price_amount: number;
        price_currency: string;
        pay_amount: number | null;
        pay_currency: string | null;
        status: string;
        actually_paid: number | null;
        order_id: string | null;
        created_at: string;
        updated_at: string;
        expires_at: string | null;
        finished_at: string | null;
      }>;

      res.json({
        filter: status,
        payments: payments.map(p => ({
          id: p.id,
          externalPaymentId: p.payment_id,
          communityId: p.community_id,
          tier: p.tier,
          priceAmount: p.price_amount,
          priceCurrency: p.price_currency,
          payAmount: p.pay_amount,
          payCurrency: p.pay_currency,
          status: p.status,
          actuallyPaid: p.actually_paid,
          orderId: p.order_id,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          expiresAt: p.expires_at,
          finishedAt: p.finished_at,
          isStuck: !TERMINAL_PAYMENT_STATUSES.includes(p.status) &&
            new Date(p.created_at).getTime() < Date.now() - 30 * 60 * 1000,
        })),
        pagination: {
          limit,
          offset,
          total: totalResult.count,
          hasMore: offset + limit < totalResult.count,
        },
        generatedAt: new Date().toISOString(),
      });

      logger.info(
        { event: 'admin.payments.list', filter: status, results: payments.length },
        'Payment dashboard queried',
      );
    } catch (err) {
      logger.error({ event: 'admin.payments.list.error', err }, 'Payment dashboard query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// POST /payments/:paymentId/reconcile — Manual Reconciliation (Task 5.5)
// =============================================================================

adminAgentRouter.post(
  '/payments/:paymentId/reconcile',
  async (req: AuthenticatedRequest, res: Response) => {
    const params = reconcileParamSchema.safeParse(req.params);
    if (!params.success) {
      throw new ValidationError(params.error.issues.map(i => i.message).join(', '));
    }

    const { paymentId } = params.data;
    const db = getDb();

    try {
      if (!tableExists(db, 'crypto_payments')) {
        res.status(404).json({ error: 'Crypto payments not available' });
        return;
      }

      // Look up payment by internal ID
      const payment = db.prepare(`
        SELECT id, payment_id, community_id, status, credits_minted_at
        FROM crypto_payments
        WHERE id = ?
      `).get(paymentId) as {
        id: string;
        payment_id: string;
        community_id: string;
        status: string;
        credits_minted_at: string | null;
      } | undefined;

      if (!payment) {
        res.status(404).json({ error: 'Payment not found' });
        return;
      }

      // Check if already in terminal state
      if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) {
        res.json({
          paymentId: payment.id,
          status: payment.status,
          reconciled: false,
          message: `Payment already in terminal state: ${payment.status}`,
          creditsMinted: !!payment.credits_minted_at,
        });
        return;
      }

      // Check crypto provider availability
      const provider = getCryptoProvider();
      if (!provider) {
        res.status(503).json({
          error: 'Crypto payment provider not available',
          message: 'NOWPayments API key may not be configured',
        });
        return;
      }

      // Query NOWPayments API for current status
      const externalStatus = await provider.getPaymentStatus(payment.payment_id);

      if (!externalStatus) {
        res.status(502).json({
          error: 'Could not retrieve payment status from provider',
          paymentId: payment.id,
          externalPaymentId: payment.payment_id,
        });
        return;
      }

      const previousStatus = payment.status;
      const newStatus = externalStatus.status;

      // Update local record if status changed
      if (newStatus !== previousStatus) {
        const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const isFinished = newStatus === 'finished';

        db.prepare(`
          UPDATE crypto_payments
          SET status = ?, updated_at = ?${isFinished ? ', finished_at = ?' : ''}
          WHERE id = ?
        `).run(
          ...(isFinished
            ? [newStatus, now, now, payment.id]
            : [newStatus, now, payment.id]),
        );
      }

      // Log reconciliation to audit trail
      logBillingAuditEvent(
        'admin_manual_reconciliation',
        {
          paymentId: payment.id,
          externalPaymentId: payment.payment_id,
          previousStatus,
          newStatus,
          statusChanged: newStatus !== previousStatus,
          reconciliationTimestamp: new Date().toISOString(),
        },
        payment.community_id,
        'admin', // admin actor
      );

      logger.info(
        {
          event: 'admin.payments.reconcile',
          paymentId: payment.id,
          previousStatus,
          newStatus,
          changed: newStatus !== previousStatus,
        },
        'Manual reconciliation completed',
      );

      res.json({
        paymentId: payment.id,
        externalPaymentId: payment.payment_id,
        previousStatus,
        newStatus,
        reconciled: true,
        statusChanged: newStatus !== previousStatus,
        creditsMinted: !!payment.credits_minted_at,
      });
    } catch (err) {
      logger.error(
        { event: 'admin.payments.reconcile.error', err, paymentId },
        'Manual reconciliation failed',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
