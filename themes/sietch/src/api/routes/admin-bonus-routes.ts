/**
 * Admin Bonus Review Routes
 *
 * Endpoints for reviewing flagged referral bonuses with immutable audit logging.
 *
 * GET  /api/admin/bonuses/flagged     — List flagged bonuses
 * POST /api/admin/bonuses/:id/approve — Grant a flagged bonus
 * POST /api/admin/bonuses/:id/deny    — Deny a flagged bonus
 *
 * Auth: JWT-based admin auth (same as billing-admin-routes).
 * All actions logged to admin_audit_log (append-only, no deletes).
 *
 * SDD refs: §4.5 Admin Review Queue
 * Sprint refs: Task 4.5
 *
 * @module api/routes/admin-bonus-routes
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { logger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Router Setup
// =============================================================================

export const adminBonusRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let bonusDb: Database.Database | null = null;

export function setAdminBonusDb(db: Database.Database): void {
  bonusDb = db;
}

// =============================================================================
// Rate Limiting
// =============================================================================

const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req as any).adminId ?? req.ip ?? 'unknown',
  message: { error: 'Too many admin requests, try again later' },
});

// =============================================================================
// Admin Auth Middleware (shared pattern with billing-admin-routes)
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

  (req as any).adminId = payload.sub;
  (req as any).adminScopes = payload.scopes;
  next();
}

// =============================================================================
// Audit Logging (append-only)
// =============================================================================

function logAudit(
  action: string,
  req: Request,
  details: Record<string, unknown>,
): void {
  if (!bonusDb) return;

  try {
    bonusDb.prepare(
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
      }),
    );
  } catch (err) {
    logger.error({ err, action }, 'Failed to write audit log');
  }
}

// =============================================================================
// Pool & Grant Constants
// =============================================================================

const REFERRAL_SIGNUP_POOL = 'referral:signup';

// =============================================================================
// Routes
// =============================================================================

// Apply auth + rate limiting to all admin bonus routes
adminBonusRouter.use(requireAdminAuth);
adminBonusRouter.use(adminRateLimiter);

/**
 * GET /api/admin/bonuses/flagged — List flagged bonuses with reason and referrer info
 */
adminBonusRouter.get('/flagged', (req: Request, res: Response) => {
  if (!bonusDb) {
    res.status(503).json({ error: 'Service not initialized' });
    return;
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const bonuses = bonusDb.prepare(`
      SELECT
        b.id, b.referee_account_id, b.referrer_account_id,
        b.qualifying_action, b.amount_micro, b.status,
        b.risk_score, b.flag_reason, b.fraud_check_at, b.created_at
      FROM referral_bonuses b
      WHERE b.status IN ('flagged', 'withheld')
      ORDER BY b.created_at ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<Record<string, unknown>>;

    const total = bonusDb.prepare(
      `SELECT COUNT(*) as count FROM referral_bonuses WHERE status IN ('flagged', 'withheld')`
    ).get() as { count: number };

    res.json({
      bonuses,
      total: total.count,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list flagged bonuses');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/bonuses/:id/approve — Grant a flagged bonus
 */
adminBonusRouter.post('/:id/approve', (req: Request, res: Response) => {
  if (!bonusDb) {
    res.status(503).json({ error: 'Service not initialized' });
    return;
  }

  const bonusId = req.params.id;

  try {
    const bonus = bonusDb.prepare(
      `SELECT * FROM referral_bonuses WHERE id = ?`
    ).get(bonusId) as Record<string, unknown> | undefined;

    if (!bonus) {
      res.status(404).json({ error: 'Bonus not found' });
      return;
    }

    if (bonus.status !== 'flagged' && bonus.status !== 'withheld') {
      res.status(400).json({
        error: `Cannot approve bonus with status '${bonus.status}'`,
      });
      return;
    }

    const now = new Date().toISOString();
    const grantId = randomUUID();
    const adminId = (req as any).adminId;

    // Grant the bonus within a transaction
    bonusDb.transaction(() => {
      // Get next entry_seq for UNIQUE constraint
      const seqRow = bonusDb!.prepare(
        `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(bonus.referrer_account_id, REFERRAL_SIGNUP_POOL) as { next_seq: number };

      // Create ledger entry
      bonusDb!.prepare(`
        INSERT INTO credit_ledger
          (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
           amount_micro, description, created_at)
        VALUES (?, ?, ?, ?, ?, 'grant', ?, ?, ?)
      `).run(
        grantId,
        bonus.referrer_account_id,
        REFERRAL_SIGNUP_POOL,
        `bonus-${bonusId}`,
        seqRow.next_seq,
        bonus.amount_micro,
        `Admin-approved referral bonus from ${bonus.referee_account_id}`,
        now,
      );

      // Update bonus status
      bonusDb!.prepare(`
        UPDATE referral_bonuses
        SET status = 'granted', granted_at = ?, grant_id = ?, reviewed_by = ?
        WHERE id = ?
      `).run(now, grantId, adminId, bonusId);
    })();

    logAudit('bonus_approve', req, {
      targetType: 'referral_bonus',
      targetId: bonusId,
      referrerAccountId: bonus.referrer_account_id,
      amountMicro: bonus.amount_micro,
      previousStatus: bonus.status,
      grantId,
    });

    logger.info({
      event: 'admin.bonus.approved',
      bonusId,
      adminId,
      grantId,
    }, 'Admin approved flagged bonus');

    res.json({
      bonus_id: bonusId,
      status: 'granted',
      grant_id: grantId,
      approved_by: adminId,
    });
  } catch (err) {
    logger.error({ err, bonusId }, 'Failed to approve bonus');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/bonuses/:id/deny — Deny a flagged bonus (no grant, no ledger entry)
 */
adminBonusRouter.post('/:id/deny', (req: Request, res: Response) => {
  if (!bonusDb) {
    res.status(503).json({ error: 'Service not initialized' });
    return;
  }

  const bonusId = req.params.id;
  const reason = (req.body?.reason as string) ?? 'Admin denied';

  try {
    const bonus = bonusDb.prepare(
      `SELECT * FROM referral_bonuses WHERE id = ?`
    ).get(bonusId) as Record<string, unknown> | undefined;

    if (!bonus) {
      res.status(404).json({ error: 'Bonus not found' });
      return;
    }

    if (bonus.status !== 'flagged' && bonus.status !== 'withheld') {
      res.status(400).json({
        error: `Cannot deny bonus with status '${bonus.status}'`,
      });
      return;
    }

    const adminId = (req as any).adminId;

    // No ledger entry — just update status
    bonusDb.prepare(`
      UPDATE referral_bonuses
      SET status = 'denied', flag_reason = ?, reviewed_by = ?
      WHERE id = ?
    `).run(reason, adminId, bonusId);

    logAudit('bonus_deny', req, {
      targetType: 'referral_bonus',
      targetId: bonusId,
      referrerAccountId: bonus.referrer_account_id,
      amountMicro: bonus.amount_micro,
      previousStatus: bonus.status,
      reason,
    });

    logger.info({
      event: 'admin.bonus.denied',
      bonusId,
      adminId,
      reason,
    }, 'Admin denied flagged bonus');

    res.json({
      bonus_id: bonusId,
      status: 'denied',
      denied_by: adminId,
      reason,
    });
  } catch (err) {
    logger.error({ err, bonusId }, 'Failed to deny bonus');
    res.status(500).json({ error: 'Internal server error' });
  }
});
