/**
 * Billing Admin Routes
 *
 * Admin endpoints for billing operations with scoped JWT auth,
 * rate limiting, and comprehensive audit logging.
 *
 * POST /admin/billing/campaigns/:id/grants/batch — batch grant creation
 * POST /admin/billing/accounts/:id/mint — admin credit mint
 * GET  /admin/billing/reconciliation — reconciliation status
 *
 * SDD refs: §5.5 Admin Endpoints, §5.7 Auth Model
 * Sprint refs: Task 4.3
 *
 * @module api/routes/billing-admin-routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger.js';
import { serializeBigInt } from '../../packages/core/protocol/arithmetic.js';
import type { ICampaignService, GrantInput } from '../../packages/core/ports/ICampaignService.js';
import type { ICreditLedgerService } from '../../packages/core/ports/ICreditLedgerService.js';
import type { IRevenueRulesService } from '../../packages/core/ports/IRevenueRulesService.js';
import type Database from 'better-sqlite3';
import {
  batchGrantSchema,
  adminMintSchema as mintSchema,
  proposeRuleSchema,
  rejectRuleSchema,
  overrideCooldownSchema,
} from '../../packages/core/contracts/admin-billing.js';

// =============================================================================
// Router Setup
// =============================================================================

export const billingAdminRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let campaignService: ICampaignService | null = null;
let ledgerService: ICreditLedgerService | null = null;
let revenueRulesService: IRevenueRulesService | null = null;
let adminDb: Database.Database | null = null;

export function setBillingAdminServices(services: {
  campaign: ICampaignService;
  ledger: ICreditLedgerService;
  revenueRules?: IRevenueRulesService;
  db: Database.Database;
}): void {
  campaignService = services.campaign;
  ledgerService = services.ledger;
  revenueRulesService = services.revenueRules ?? null;
  adminDb = services.db;
}

// =============================================================================
// JWT Auth Middleware
// =============================================================================

interface AdminTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  jti: string;
  exp: number;
  iat: number;
  scopes: string[];
}

/**
 * Verify admin JWT token with HS256.
 * Supports key rotation via BILLING_ADMIN_JWT_SECRET_PREV.
 */
function verifyAdminToken(token: string): AdminTokenPayload | null {
  const secret = process.env.BILLING_ADMIN_JWT_SECRET;
  if (!secret) return null;

  const secrets = [secret];
  const prevSecret = process.env.BILLING_ADMIN_JWT_SECRET_PREV;
  if (prevSecret) secrets.push(prevSecret);

  for (const s of secrets) {
    const payload = verifyHS256(token, s);
    if (payload) return payload;
  }

  return null;
}

function verifyHS256(token: string, secret: string): AdminTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const headerPayload = `${parts[0]}.${parts[1]}`;
    const signature = createHmac('sha256', secret)
      .update(headerPayload)
      .digest('base64url');

    const expected = Buffer.from(signature, 'utf-8');
    const actual = Buffer.from(parts[2], 'utf-8');
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    ) as AdminTokenPayload;

    // Validate required claims: iss, aud, exp, sub
    if (!payload.sub) return null;
    if (!payload.iss || payload.iss !== 'arrakis-admin') return null;
    if (payload.aud !== 'arrakis-billing-admin') return null;
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 30;
    if (!payload.exp || payload.exp < now - clockSkew) return null;

    return payload;
  } catch {
    return null;
  }
}

function requireAdminAuth(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyAdminToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Attach admin context
  (req as any).adminId = payload.sub;
  (req as any).adminScopes = payload.scopes;
  (req as any).adminJti = payload.jti;
  next();
}

// =============================================================================
// Audit Logging
// =============================================================================

function logAudit(
  action: string,
  req: Request,
  details: Record<string, unknown>,
): void {
  if (!adminDb) return;

  try {
    adminDb.prepare(
      `INSERT INTO admin_audit_log
       (id, actor_type, actor_id, action, target_type, target_id, details, created_at)
       VALUES (?, 'admin', ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      randomUUID(),
      (req as any).adminId ?? 'unknown',
      action,
      details.targetType as string ?? null,
      details.targetId as string ?? null,
      JSON.stringify({
        ...details,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        correlationId: req.headers['x-correlation-id'] ?? randomUUID(),
      }),
    );
  } catch (err) {
    logger.error({ err, action }, 'Failed to write audit log');
  }
}

// =============================================================================
// Rate Limiter
// =============================================================================

import rateLimit from 'express-rate-limit';

const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as any).adminId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Admin rate limit: maximum 30 requests per minute.',
    });
  },
});

// =============================================================================
// POST /admin/billing/campaigns/:id/grants/batch
// =============================================================================

billingAdminRouter.post(
  '/campaigns/:id/grants/batch',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    if (!campaignService) {
      res.status(503).json({ error: 'Campaign service not initialized' });
      return;
    }

    const result = batchGrantSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const campaignId = req.params.id;

    try {
      const grants: GrantInput[] = result.data.grants.map(g => ({
        accountId: g.accountId,
        amountMicro: BigInt(g.amountMicro),
        formulaInput: g.formulaInput,
      }));

      const batchResult = await campaignService.batchGrant(campaignId, grants);

      logAudit('batch_grant', req, {
        targetType: 'campaign',
        targetId: campaignId,
        totalGranted: batchResult.totalGranted,
        totalFailed: batchResult.totalFailed,
        totalAmountMicro: batchResult.totalAmountMicro.toString(),
      });

      res.status(201).json(serializeBigInt(batchResult));
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ event: 'admin.batch_grant.error', campaignId, err }, msg);

      if (msg.includes('not found')) {
        res.status(404).json({ error: 'Campaign not found' });
      } else if (msg.includes('must be active')) {
        res.status(409).json({ error: 'Campaign not active', message: msg });
      } else if (msg.includes('exceed budget') || msg.includes('exceeds per-wallet cap')) {
        res.status(422).json({ error: 'Budget/Cap Exceeded', message: msg });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

// =============================================================================
// POST /admin/billing/accounts/:id/mint
// =============================================================================

billingAdminRouter.post(
  '/accounts/:id/mint',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    if (!ledgerService) {
      res.status(503).json({ error: 'Ledger service not initialized' });
      return;
    }

    const result = mintSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const accountId = req.params.id;
    const { amountMicro, sourceType, description, poolId } = result.data;

    try {
      const lot = await ledgerService.mintLot(
        accountId,
        BigInt(amountMicro),
        sourceType,
        {
          sourceId: `admin-mint-${randomUUID().slice(0, 8)}`,
          poolId,
          description: description ?? `Admin mint by ${(req as any).adminId}`,
        },
      );

      logAudit('admin_mint', req, {
        targetType: 'account',
        targetId: accountId,
        amountMicro,
        lotId: lot.id,
      });

      res.status(201).json(serializeBigInt({
        lotId: lot.id,
        accountId,
        amountMicro: lot.originalMicro,
        poolId,
      }));
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ event: 'admin.mint.error', accountId, err }, msg);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /admin/billing/reconciliation
// =============================================================================

billingAdminRouter.get(
  '/reconciliation',
  requireAdminAuth,
  adminRateLimiter,
  (_req: Request, res: Response) => {
    if (!adminDb) {
      res.status(503).json({ error: 'Database not initialized' });
      return;
    }

    try {
      const lastAt = adminDb.prepare(
        `SELECT value FROM billing_config WHERE key = 'last_reconciliation_at'`
      ).get() as { value: string } | undefined;

      const lastResult = adminDb.prepare(
        `SELECT value FROM billing_config WHERE key = 'last_reconciliation_result'`
      ).get() as { value: string } | undefined;

      res.json({
        lastReconciliationAt: lastAt?.value || null,
        result: lastResult?.value ? JSON.parse(lastResult.value) : null,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch reconciliation status');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// Revenue Rules Endpoints (Sprint 8, Task 8.3)
// =============================================================================

function getRevenueRulesService(res: Response): IRevenueRulesService | null {
  if (!revenueRulesService) {
    res.status(503).json({ error: 'Revenue rules service not initialized' });
    return null;
  }
  return revenueRulesService;
}

// POST /admin/billing/revenue-rules — propose a new rule
billingAdminRouter.post(
  '/revenue-rules',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    const result = proposeRuleSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    try {
      const rule = await service.proposeRule({
        ...result.data,
        proposedBy: (req as any).adminId ?? 'unknown',
      });

      logAudit('revenue_rule_proposed', req, {
        targetType: 'revenue_rule',
        targetId: rule.id,
        commonsBps: rule.commonsBps,
        communityBps: rule.communityBps,
        foundationBps: rule.foundationBps,
      });

      res.status(201).json(rule);
    } catch (err) {
      logger.error({ event: 'admin.revenue_rule.propose.error', err },
        (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// PATCH /admin/billing/revenue-rules/:id/submit — submit for approval
billingAdminRouter.patch(
  '/revenue-rules/:id/submit',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    try {
      const rule = await service.submitForApproval(
        req.params.id,
        (req as any).adminId ?? 'unknown',
      );
      res.json(rule);
    } catch (err) {
      handleRuleError(err, res);
    }
  },
);

// PATCH /admin/billing/revenue-rules/:id/approve — approve a pending rule
billingAdminRouter.patch(
  '/revenue-rules/:id/approve',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    try {
      const rule = await service.approveRule(
        req.params.id,
        (req as any).adminId ?? 'unknown',
      );

      logAudit('revenue_rule_approved', req, {
        targetType: 'revenue_rule',
        targetId: rule.id,
        activatesAt: rule.activatesAt,
      });

      res.json(rule);
    } catch (err) {
      handleRuleError(err, res);
    }
  },
);

// PATCH /admin/billing/revenue-rules/:id/reject — reject with reason
billingAdminRouter.patch(
  '/revenue-rules/:id/reject',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    const result = rejectRuleSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    try {
      const rule = await service.rejectRule(
        req.params.id,
        (req as any).adminId ?? 'unknown',
        result.data.reason,
      );

      logAudit('revenue_rule_rejected', req, {
        targetType: 'revenue_rule',
        targetId: rule.id,
        reason: result.data.reason,
      });

      res.json(rule);
    } catch (err) {
      handleRuleError(err, res);
    }
  },
);

// PATCH /admin/billing/revenue-rules/:id/override-cooldown — emergency override
billingAdminRouter.patch(
  '/revenue-rules/:id/override-cooldown',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    const result = overrideCooldownSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    try {
      const rule = await service.overrideCooldown(
        req.params.id,
        (req as any).adminId ?? 'unknown',
        result.data.reason,
      );

      logAudit('revenue_rule_cooldown_override', req, {
        targetType: 'revenue_rule',
        targetId: rule.id,
        reason: result.data.reason,
      });

      res.json(rule);
    } catch (err) {
      handleRuleError(err, res);
    }
  },
);

// GET /admin/billing/revenue-rules — list rules (with optional status filter)
billingAdminRouter.get(
  '/revenue-rules',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    try {
      const status = req.query.status as string | undefined;
      if (status === 'pending') {
        const rules = await service.getPendingRules();
        res.json({ rules });
      } else {
        const rawLimit = Number.parseInt(req.query.limit as string, 10);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
        const rules = await service.getRuleHistory(limit);
        res.json({ rules });
      }
    } catch (err) {
      logger.error({ event: 'admin.revenue_rules.list.error', err },
        (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// GET /admin/billing/revenue-rules/active — get currently active rule
billingAdminRouter.get(
  '/revenue-rules/active',
  requireAdminAuth,
  adminRateLimiter,
  async (_req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    try {
      const rule = await service.getActiveRule();
      if (!rule) {
        res.status(404).json({ error: 'No active revenue rule' });
        return;
      }
      res.json(rule);
    } catch (err) {
      logger.error({ event: 'admin.revenue_rules.active.error', err },
        (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// GET /admin/billing/revenue-rules/:id/audit — audit log for a rule
billingAdminRouter.get(
  '/revenue-rules/:id/audit',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    const service = getRevenueRulesService(res);
    if (!service) return;
    try {
      const entries = await service.getRuleAudit(req.params.id);
      res.json({ ruleId: req.params.id, entries });
    } catch (err) {
      logger.error({ event: 'admin.revenue_rules.audit.error', err },
        (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /admin/billing/notifications — governance event notifications
// =============================================================================

billingAdminRouter.get(
  '/notifications',
  requireAdminAuth,
  adminRateLimiter,
  (_req: Request, res: Response) => {
    if (!adminDb) {
      res.status(503).json({ error: 'Database not initialized' });
      return;
    }

    try {
      const rows = adminDb.prepare(
        `SELECT id, rule_id, transition, old_splits, new_splits,
                actor_id, urgency, created_at
         FROM billing_notifications
         ORDER BY created_at DESC
         LIMIT 100`
      ).all() as Array<{
        id: string; rule_id: string; transition: string;
        old_splits: string | null; new_splits: string;
        actor_id: string; urgency: string; created_at: string;
      }>;

      const notifications = rows.map(r => ({
        id: r.id,
        ruleId: r.rule_id,
        transition: r.transition,
        oldSplits: r.old_splits ? JSON.parse(r.old_splits) : null,
        newSplits: JSON.parse(r.new_splits),
        actorId: r.actor_id,
        urgency: r.urgency,
        createdAt: r.created_at,
      }));

      res.json({ notifications });
    } catch (err) {
      logger.error({ event: 'admin.notifications.list.error', err },
        (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// POST /admin/billing/agents/:id/rotate-anchor (Sprint 243, Task 5.4)
// =============================================================================

const rotateAnchorSchema = z.object({
  newAnchor: z.string().min(1).max(256),
});

billingAdminRouter.post(
  '/agents/:id/rotate-anchor',
  requireAdminAuth,
  adminRateLimiter,
  async (req: Request, res: Response) => {
    if (!adminDb) {
      res.status(503).json({ error: 'Database not initialized' });
      return;
    }

    const result = rotateAnchorSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const agentAccountId = req.params.id;
    const rotator = (req as any).adminId ?? 'unknown';
    const { newAnchor } = result.data;

    try {
      // Look up existing anchor
      const existing = adminDb.prepare(
        `SELECT identity_anchor, created_by FROM agent_identity_anchors WHERE agent_account_id = ?`
      ).get(agentAccountId) as { identity_anchor: string; created_by: string } | undefined;

      if (!existing) {
        res.status(404).json({ error: 'No identity anchor found for this agent' });
        return;
      }

      // Four-eyes: rotator must differ from created_by
      if (existing.created_by === rotator) {
        res.status(403).json({
          error: 'four_eyes_violation',
          message: `Anchor rotation requires a different actor than the creator '${rotator}'`,
        });
        return;
      }

      // Perform rotation
      adminDb.prepare(`
        UPDATE agent_identity_anchors
        SET identity_anchor = ?, rotated_at = datetime('now'), rotated_by = ?
        WHERE agent_account_id = ?
      `).run(newAnchor, rotator, agentAccountId);

      logAudit('anchor_rotated', req, {
        targetType: 'agent_identity',
        targetId: agentAccountId,
        oldAnchorPrefix: existing.identity_anchor.slice(0, 8) + '...',
        newAnchorPrefix: newAnchor.slice(0, 8) + '...',
        createdBy: existing.created_by,
        rotatedBy: rotator,
      });

      res.json({
        agentAccountId,
        rotatedAt: new Date().toISOString(),
        rotatedBy: rotator,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'Anchor already in use by another agent' });
      } else {
        logger.error({ event: 'admin.anchor_rotation.error', agentAccountId, err }, msg);
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

// Error handler for revenue rule operations
function handleRuleError(err: unknown, res: Response): void {
  const msg = (err as Error).message;
  const name = (err as Error).name;
  if (name === 'FourEyesViolationError') {
    res.status(403).json({ error: 'four_eyes_violation', message: msg });
  } else if (msg.includes('not found')) {
    res.status(404).json({ error: 'Revenue rule not found' });
  } else if (msg.includes('Invalid state') || msg.includes('Cannot')) {
    res.status(409).json({ error: 'Invalid state transition', message: msg });
  } else {
    logger.error({ event: 'admin.revenue_rule.error', err }, msg);
    res.status(500).json({ error: 'Internal server error' });
  }
}
