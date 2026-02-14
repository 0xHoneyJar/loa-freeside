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
import { randomUUID } from 'crypto';
import { createHmac } from 'crypto';
import { logger } from '../../utils/logger.js';
import { serializeBigInt } from '../../packages/core/utils/micro-usd.js';
import type { ICampaignService, GrantInput } from '../../packages/core/ports/ICampaignService.js';
import type { ICreditLedgerService } from '../../packages/core/ports/ICreditLedgerService.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Router Setup
// =============================================================================

export const billingAdminRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let campaignService: ICampaignService | null = null;
let ledgerService: ICreditLedgerService | null = null;
let adminDb: Database.Database | null = null;

export function setBillingAdminServices(services: {
  campaign: ICampaignService;
  ledger: ICreditLedgerService;
  db: Database.Database;
}): void {
  campaignService = services.campaign;
  ledgerService = services.ledger;
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

    if (signature !== parts[2]) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    ) as AdminTokenPayload;

    // Validate audience and expiry
    if (payload.aud !== 'arrakis-billing-admin') return null;
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 30;
    if (payload.exp < now - clockSkew) return null;

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
// Schemas
// =============================================================================

const batchGrantSchema = z.object({
  grants: z.array(z.object({
    accountId: z.string().min(1),
    amountMicro: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
    formulaInput: z.record(z.unknown()).optional(),
  })).min(1).max(1000),
});

const mintSchema = z.object({
  amountMicro: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
  sourceType: z.enum(['grant', 'deposit']).default('grant'),
  description: z.string().max(500).optional(),
  poolId: z.string().default('general'),
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
