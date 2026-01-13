/**
 * Boost API Routes (v4.0 - Sprint 28)
 *
 * REST endpoints for community boost management:
 * - GET /boosts/:communityId/status - Get community boost status
 * - GET /boosts/:communityId/boosters - List community boosters
 * - GET /boosts/:communityId/pricing - Get boost pricing
 * - POST /boosts/:communityId/purchase - Initiate boost purchase
 * - GET /boosts/:communityId/members/:memberId - Get member boost info
 * - GET /boosts/:communityId/members/:memberId/perks - Get member perks
 * - POST /boosts/:communityId/grant - Admin: Grant free boost
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { boostService, BOOST_PERKS } from '../services/boost/BoostService.js';
import { logger } from '../utils/logger.js';
import { requireApiKey, adminRateLimiter, memberRateLimiter } from './middleware.js';
import type {
  BoostStatusResponse,
  BoosterListResponse,
  BoostPurchaseResponse,
  BoostPricingResponse,
  BoosterPerksResponse,
  BoostLevel,
} from '../types/billing.js';

// =============================================================================
// Request Validation Schemas
// =============================================================================

const communityIdSchema = z.string().min(1).max(100);
const memberIdSchema = z.string().min(1).max(100);

const purchaseBoostSchema = z.object({
  memberId: z.string().min(1),
  months: z.number().int().min(1).max(12),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const grantBoostSchema = z.object({
  memberId: z.string().min(1),
  months: z.number().int().min(1).max(12),
  grantedBy: z.string().min(1),
  reason: z.string().optional(),
});

const listBoostersSchema = z.object({
  activeOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// =============================================================================
// Router Setup
// =============================================================================

export const boostRouter = Router();

// Apply rate limiting to all boost routes
boostRouter.use(memberRateLimiter);

// =============================================================================
// Public Endpoints
// =============================================================================

/**
 * GET /boosts/:communityId/status
 * Get current boost status for a community
 */
boostRouter.get(
  '/:communityId/status',
  async (req: Request<{ communityId: string }>, res: Response<BoostStatusResponse | { error: string }>) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);

      const status = boostService.getCommunityBoostStatus(communityId);

      const response: BoostStatusResponse = {
        communityId: status.communityId,
        level: status.level,
        totalBoosters: status.totalBoosters,
        progressPercent: status.progressToNextLevel,
        boostersNeeded: status.boostsNeededForNextLevel,
        perks: status.perks.map((p) => p.id),
      };

      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get boost status');
      res.status(500).json({ error: 'Failed to get boost status' });
    }
  }
);

/**
 * GET /boosts/:communityId/boosters
 * List boosters for a community
 */
boostRouter.get(
  '/:communityId/boosters',
  async (
    req: Request<{ communityId: string }, unknown, unknown, { activeOnly?: string; limit?: string; offset?: string }>,
    res: Response<BoosterListResponse | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const { activeOnly, limit, offset } = listBoostersSchema.parse(req.query);

      const boosters = boostService.getBoosters(communityId, { activeOnly, limit });

      const response: BoosterListResponse = {
        communityId,
        boosters: boosters.map((b) => ({
          memberId: b.memberId,
          nym: b.nym,
          monthsBoosted: b.totalMonthsBoosted,
          isActive: b.isActive,
          boostExpiry: b.currentBoostExpiry?.toISOString(),
        })),
        totalCount: boosters.length,
      };

      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request parameters' });
        return;
      }
      logger.error({ error }, 'Failed to list boosters');
      res.status(500).json({ error: 'Failed to list boosters' });
    }
  }
);

/**
 * GET /boosts/:communityId/pricing
 * Get boost pricing information
 */
boostRouter.get(
  '/:communityId/pricing',
  async (req: Request<{ communityId: string }>, res: Response<BoostPricingResponse | { error: string }>) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);

      const pricing = boostService.getPricing();

      const response: BoostPricingResponse = {
        pricePerMonth: `$${(pricing.pricePerMonthCents / 100).toFixed(2)}`,
        bundles: pricing.bundles.map((b) => ({
          months: b.months,
          price: `$${(b.priceCents / 100).toFixed(2)}`,
          discountPercent: b.discountPercent,
        })),
      };

      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get boost pricing');
      res.status(500).json({ error: 'Failed to get boost pricing' });
    }
  }
);

/**
 * POST /boosts/:communityId/purchase
 * Initiate a boost purchase
 */
boostRouter.post(
  '/:communityId/purchase',
  async (
    req: Request<{ communityId: string }, unknown, z.infer<typeof purchaseBoostSchema>>,
    res: Response<BoostPurchaseResponse | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const body = purchaseBoostSchema.parse(req.body);

      const result = await boostService.purchaseBoost({
        communityId,
        memberId: body.memberId,
        months: body.months,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      });

      if (!result.success || !result.purchaseId) {
        res.status(400).json({ error: result.error ?? 'Purchase failed' });
        return;
      }

      const response: BoostPurchaseResponse = {
        purchaseId: result.purchaseId,
        checkoutUrl: result.checkoutUrl,
        success: true,
      };

      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: `Validation error: ${fieldErrors.join(', ')}` });
        return;
      }
      logger.error({ error }, 'Failed to initiate boost purchase');
      res.status(500).json({ error: 'Failed to initiate purchase' });
    }
  }
);

/**
 * GET /boosts/:communityId/members/:memberId
 * Get boost info for a specific member
 */
boostRouter.get(
  '/:communityId/members/:memberId',
  async (
    req: Request<{ communityId: string; memberId: string }>,
    res: Response<{
      memberId: string;
      isBooster: boolean;
      totalMonthsBoosted: number;
      currentBoostExpiry?: string;
      firstBoostDate?: string;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const memberId = memberIdSchema.parse(req.params.memberId);

      const boosterInfo = boostService.getBoosterInfo(memberId, communityId);

      if (!boosterInfo) {
        res.json({
          memberId,
          isBooster: false,
          totalMonthsBoosted: 0,
        });
        return;
      }

      res.json({
        memberId,
        isBooster: boosterInfo.isActive,
        totalMonthsBoosted: boosterInfo.totalMonthsBoosted,
        currentBoostExpiry: boosterInfo.currentBoostExpiry?.toISOString(),
        firstBoostDate: boosterInfo.firstBoostDate?.toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request parameters' });
        return;
      }
      logger.error({ error }, 'Failed to get member boost info');
      res.status(500).json({ error: 'Failed to get member info' });
    }
  }
);

/**
 * GET /boosts/:communityId/members/:memberId/perks
 * Get perks available to a member
 */
boostRouter.get(
  '/:communityId/members/:memberId/perks',
  async (
    req: Request<{ communityId: string; memberId: string }>,
    res: Response<BoosterPerksResponse | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const memberId = memberIdSchema.parse(req.params.memberId);

      const { boosterPerks, communityPerks, isBooster } = boostService.getBoosterPerks(
        memberId,
        communityId
      );

      const memberBoost = boostService.getMemberBoost(memberId, communityId);

      const response: BoosterPerksResponse = {
        memberId,
        isBooster,
        boosterPerks: boosterPerks.map((p) => p.id),
        communityPerks: communityPerks.map((p) => p.id),
        boostExpiry: memberBoost?.expiresAt?.toISOString(),
      };

      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request parameters' });
        return;
      }
      logger.error({ error }, 'Failed to get member perks');
      res.status(500).json({ error: 'Failed to get member perks' });
    }
  }
);

/**
 * GET /boosts/:communityId/perks
 * Get all available perks and their requirements
 */
boostRouter.get(
  '/:communityId/perks',
  async (
    req: Request<{ communityId: string }>,
    res: Response<{
      currentLevel: BoostLevel | 0;
      unlockedPerks: string[];
      allPerks: Array<{
        id: string;
        name: string;
        description: string;
        minLevel: BoostLevel;
        scope: 'community' | 'booster';
        unlocked: boolean;
      }>;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);

      const currentLevel = boostService.getBoostLevel(communityId);
      const unlockedPerks = boostService.getPerksForLevel(currentLevel);

      res.json({
        currentLevel,
        unlockedPerks: unlockedPerks.map((p) => p.id),
        allPerks: BOOST_PERKS.map((p) => ({
          ...p,
          unlocked: currentLevel >= p.minLevel,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get perks');
      res.status(500).json({ error: 'Failed to get perks' });
    }
  }
);

/**
 * GET /boosts/:communityId/thresholds
 * Get boost level thresholds
 */
boostRouter.get(
  '/:communityId/thresholds',
  async (
    req: Request<{ communityId: string }>,
    res: Response<{
      level1: number;
      level2: number;
      level3: number;
      currentBoosters: number;
      currentLevel: BoostLevel | 0;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);

      const thresholds = boostService.getThresholds();
      const status = boostService.getCommunityBoostStatus(communityId);

      res.json({
        ...thresholds,
        currentBoosters: status.totalBoosters,
        currentLevel: status.level,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get thresholds');
      res.status(500).json({ error: 'Failed to get thresholds' });
    }
  }
);

// =============================================================================
// Admin Endpoints (require authentication)
// =============================================================================

/**
 * POST /boosts/:communityId/grant
 * Admin: Grant a free boost to a member
 * Requires admin API key authentication
 */
boostRouter.post(
  '/:communityId/grant',
  adminRateLimiter,
  requireApiKey,
  async (
    req: Request<{ communityId: string }, unknown, z.infer<typeof grantBoostSchema>>,
    res: Response<{
      success: boolean;
      purchaseId: string;
      expiresAt: string;
      newLevel: BoostLevel | 0;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const body = grantBoostSchema.parse(req.body);

      const purchase = boostService.grantFreeBoost(
        body.memberId,
        communityId,
        body.months,
        body.grantedBy
      );

      const newLevel = boostService.getBoostLevel(communityId);

      logger.info(
        {
          communityId,
          memberId: body.memberId,
          months: body.months,
          grantedBy: body.grantedBy,
          reason: body.reason,
        },
        'Admin granted free boost'
      );

      res.json({
        success: true,
        purchaseId: purchase.id,
        expiresAt: purchase.expiresAt.toISOString(),
        newLevel,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        res.status(400).json({ error: `Validation error: ${fieldErrors.join(', ')}` });
        return;
      }
      logger.error({ error }, 'Failed to grant free boost');
      res.status(500).json({ error: 'Failed to grant boost' });
    }
  }
);

/**
 * GET /boosts/:communityId/stats
 * Admin: Get boost statistics for a community
 */
boostRouter.get(
  '/:communityId/stats',
  async (
    req: Request<{ communityId: string }>,
    res: Response<{
      totalPurchases: number;
      totalRevenue: string;
      averagePurchaseMonths: number;
      uniqueBoosters: number;
      activeBoosters: number;
      currentLevel: BoostLevel | 0;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);

      const stats = boostService.getBoostStats(communityId);

      res.json({
        totalPurchases: stats.totalPurchases,
        totalRevenue: `$${(stats.totalRevenueCents / 100).toFixed(2)}`,
        averagePurchaseMonths: stats.averagePurchaseMonths,
        uniqueBoosters: stats.uniqueBoosters,
        activeBoosters: stats.activeBoosters,
        currentLevel: stats.currentLevel,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get boost stats');
      res.status(500).json({ error: 'Failed to get stats' });
    }
  }
);

/**
 * GET /boosts/:communityId/top
 * Get top boosters leaderboard
 */
boostRouter.get(
  '/:communityId/top',
  async (
    req: Request<{ communityId: string }, unknown, unknown, { limit?: string }>,
    res: Response<{
      communityId: string;
      topBoosters: Array<{
        rank: number;
        memberId: string;
        totalMonths: number;
        isActive: boolean;
      }>;
    } | { error: string }>
  ) => {
    try {
      const communityId = communityIdSchema.parse(req.params.communityId);
      const limit = Math.min(parseInt(req.query.limit ?? '10'), 50);

      const topBoosters = boostService.getTopBoosters(communityId, limit);

      res.json({
        communityId,
        topBoosters: topBoosters.map((b, index) => ({
          rank: index + 1,
          memberId: b.memberId,
          totalMonths: b.totalMonthsBoosted,
          isActive: b.isActive,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid community ID' });
        return;
      }
      logger.error({ error }, 'Failed to get top boosters');
      res.status(500).json({ error: 'Failed to get top boosters' });
    }
  }
);
