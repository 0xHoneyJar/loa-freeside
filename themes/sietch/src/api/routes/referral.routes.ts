/**
 * Referral API Routes
 *
 * POST /api/referrals/code     — create referral code (auth required)
 * GET  /api/referrals/code     — get my referral code
 * POST /api/referrals/register — register as referee
 * DELETE /api/referrals/code/:id — revoke code (admin)
 * GET  /api/referrals/stats    — get referral stats
 *
 * SDD refs: §4.1 ReferralService
 * Sprint refs: Tasks 2.1, 2.3
 *
 * @module api/routes/referral.routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { IReferralService } from '../../packages/core/ports/IReferralService.js';
import { ReferralError } from '../../packages/adapters/billing/ReferralService.js';
import type { LeaderboardService, LeaderboardTimeframe } from '../../packages/adapters/billing/LeaderboardService.js';

// =============================================================================
// Router Setup
// =============================================================================

export const referralRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let referralService: IReferralService | null = null;
let leaderboardService: LeaderboardService | null = null;

/**
 * Set the referral service instance.
 * Called during server initialization.
 */
export function setReferralService(service: IReferralService): void {
  referralService = service;
}

export function setLeaderboardService(service: LeaderboardService): void {
  leaderboardService = service;
}

function getService(): IReferralService {
  if (!referralService) {
    throw new Error('Referral service not initialized');
  }
  return referralService;
}

// =============================================================================
// Rate Limiters
// =============================================================================

/** 10/min per IP for register endpoint */
const registerRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Registration rate limit: maximum 10 requests per minute.',
    });
  },
});

/** 1/hr per account for code creation */
const codeCreationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return (req as AuthenticatedRequest).caller?.userId ?? req.ip ?? 'unknown';
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Code creation rate limit: maximum 1 request per hour.',
    });
  },
});

// =============================================================================
// Schemas
// =============================================================================

const registerSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[0-9a-z]+$/, 'Invalid referral code format'),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /referrals/code — Create a referral code for authenticated user
 */
referralRouter.post(
  '/code',
  requireAuth,
  codeCreationRateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const caller = req.caller!;
    const service = getService();

    try {
      const code = await service.createCode(caller.userId);

      logger.info({
        event: 'referral.api.code_created',
        accountId: caller.userId,
        codeId: code.id,
      }, 'Referral code created via API');

      res.status(201).json({
        id: code.id,
        code: code.code,
        status: code.status,
        use_count: code.useCount,
        max_uses: code.maxUses,
        expires_at: code.expiresAt,
        created_at: code.createdAt,
      });
    } catch (error) {
      logger.error({ error, accountId: caller.userId }, 'Failed to create referral code');
      throw error;
    }
  }
);

/**
 * GET /referrals/code — Get authenticated user's active referral code
 */
referralRouter.get(
  '/code',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const caller = req.caller!;
    const service = getService();

    const code = await service.getCode(caller.userId);

    if (!code) {
      res.status(404).json({ error: 'No active referral code found' });
      return;
    }

    res.json({
      id: code.id,
      code: code.code,
      status: code.status,
      use_count: code.useCount,
      max_uses: code.maxUses,
      expires_at: code.expiresAt,
      created_at: code.createdAt,
    });
  }
);

/**
 * POST /referrals/register — Register as referee with a referral code
 */
referralRouter.post(
  '/register',
  requireAuth,
  registerRateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const caller = req.caller!;
    const service = getService();

    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: result.error.issues.map(i => i.message).join(', '),
      });
      return;
    }

    try {
      const registration = await service.register(caller.userId, result.data.code);

      logger.info({
        event: 'referral.api.registered',
        refereeAccountId: caller.userId,
        referrerAccountId: registration.referrerAccountId,
      }, 'Referral registration via API');

      res.status(201).json({
        id: registration.id,
        referrer_account_id: registration.referrerAccountId,
        attribution_expires_at: registration.attributionExpiresAt,
        created_at: registration.createdAt,
      });
    } catch (error) {
      if (error instanceof ReferralError) {
        const statusMap: Record<string, number> = {
          INVALID_CODE: 404,
          CODE_EXPIRED: 410,
          MAX_USES_REACHED: 410,
          SELF_REFERRAL: 400,
          ALREADY_BOUND: 409,
          ATTRIBUTION_LOCKED: 409,
        };
        res.status(statusMap[error.code] ?? 400).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      throw error;
    }
  }
);

/**
 * DELETE /referrals/code/:id — Revoke a referral code (admin only)
 */
referralRouter.delete(
  '/code/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const caller = req.caller!;
    const service = getService();

    // Admin check
    const isAdmin = caller.roles.includes('admin') || caller.roles.includes('qa_admin');
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    try {
      await service.revokeCode(req.params.id, caller.userId);

      logger.info({
        event: 'referral.api.code_revoked',
        codeId: req.params.id,
        revokedBy: caller.userId,
      }, 'Referral code revoked via API');

      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found or not active')) {
        res.status(404).json({ error: 'Code not found or already revoked' });
        return;
      }
      throw error;
    }
  }
);

/**
 * GET /referrals/stats — Get referral stats for authenticated user
 */
referralRouter.get(
  '/stats',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const caller = req.caller!;
    const service = getService();

    const stats = await service.getReferralStats(caller.userId);

    res.json({
      total_referees: stats.totalReferees,
      active_referees: stats.activeReferees,
      total_earnings_micro: stats.totalEarningsMicro.toString(),
      pending_bonuses: stats.pendingBonuses,
    });
  }
);

/**
 * GET /referrals/leaderboard — Public leaderboard rankings
 */
const VALID_TIMEFRAMES: LeaderboardTimeframe[] = ['daily', 'weekly', 'monthly', 'all_time'];

referralRouter.get(
  '/leaderboard',
  (req: Request, res: Response) => {
    if (!leaderboardService) {
      res.status(503).json({ error: 'Leaderboard service not initialized' });
      return;
    }

    const timeframe = (req.query.timeframe as string) ?? 'weekly';
    if (!VALID_TIMEFRAMES.includes(timeframe as LeaderboardTimeframe)) {
      res.status(400).json({
        error: 'Invalid timeframe',
        valid: VALID_TIMEFRAMES,
      });
      return;
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const entries = leaderboardService.getLeaderboard(
      timeframe as LeaderboardTimeframe,
      { limit, offset },
    );

    res.json({
      timeframe,
      entries: entries.map(e => ({
        rank: e.rank,
        display_name: e.displayName,
        referral_count: e.referralCount,
        total_earnings_micro: e.totalEarningsMicro.toString(),
      })),
      limit,
      offset,
    });
  }
);
