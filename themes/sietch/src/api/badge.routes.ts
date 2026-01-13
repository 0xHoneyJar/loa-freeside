/**
 * Badge API Routes (v5.0 - Sprint 2 Paddle Migration)
 *
 * Handles score badge endpoints:
 * - GET /badge/entitlement/:memberId - Check badge access
 * - POST /badge/purchase - Initiate badge purchase (for lower tiers)
 * - GET /badge/display/:platform/:memberId - Get badge display string
 * - GET /badge/settings/:memberId - Get badge settings
 * - PUT /badge/settings/:memberId - Update badge settings
 *
 * All routes require authentication.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './middleware.js';
import {
  memberRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import { config, isPaddleEnabled } from '../config.js';
import { badgeService } from '../services/badge/BadgeService.js';
import { createBillingProvider } from '../packages/adapters/billing/index.js';
import { getMemberProfileById } from '../db/index.js';
import { logger } from '../utils/logger.js';
import type { IBillingProvider } from '../packages/core/ports/IBillingProvider.js';
import type {
  BadgeEntitlementResponse,
  BadgeDisplayResponse,
  BadgeSettingsResponse,
  BadgeStyle,
} from '../types/billing.js';

// =============================================================================
// Router Setup
// =============================================================================

export const badgeRouter = Router();

// Apply rate limiting to all routes
badgeRouter.use(memberRateLimiter);

// =============================================================================
// Billing Provider Initialization
// =============================================================================

let billingProvider: IBillingProvider | null = null;

/**
 * Get or initialize the billing provider
 */
function getBillingProvider(): IBillingProvider {
  if (!billingProvider) {
    if (!isPaddleEnabled()) {
      throw new Error('Paddle billing is not configured');
    }

    billingProvider = createBillingProvider({
      provider: 'paddle',
      paddle: config.paddle,
    });
  }
  return billingProvider;
}

// =============================================================================
// Middleware: Check Badge Feature Enabled
// =============================================================================

/**
 * Middleware to check if badge feature is enabled
 */
function requireBadgeEnabled(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!badgeService.isEnabled()) {
    res.status(503).json({
      error: 'Badge feature not enabled',
      message: 'Score badges are currently disabled',
    });
    return;
  }
  next();
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Badge purchase schema
 */
const badgePurchaseSchema = z.object({
  memberId: z.string().min(1),
  communityId: z.string().min(1),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Badge settings update schema
 */
const badgeSettingsSchema = z.object({
  displayOnDiscord: z.boolean().optional(),
  displayOnTelegram: z.boolean().optional(),
  badgeStyle: z.enum(['default', 'minimal', 'detailed']).optional(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /badge/entitlement/:memberId
 * Check if a member has badge access
 */
badgeRouter.get(
  '/entitlement/:memberId',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const memberId: string = req.params.memberId!;
      const communityId: string = (req.query.communityId as string | undefined) ?? 'default';

      // Check badge entitlement
      const entitlement = await badgeService.checkBadgeEntitlement(communityId, memberId);

      // Build response
      const response: BadgeEntitlementResponse = {
        memberId,
        hasAccess: entitlement.hasAccess,
        reason: entitlement.reason,
        purchaseRequired: entitlement.purchaseRequired,
      };

      // Add price info if purchase required
      if (entitlement.purchaseRequired && entitlement.priceInCents) {
        response.price = `$${(entitlement.priceInCents / 100).toFixed(2)}`;
        if (entitlement.priceId) {
          response.purchaseUrl = `/api/badge/purchase`;
        }
      }

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Badge entitlement check failed');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check badge entitlement',
      });
    }
  }
);

/**
 * POST /badge/purchase
 * Initiate badge purchase flow via Paddle Checkout
 */
badgeRouter.post(
  '/purchase',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const validated = badgePurchaseSchema.safeParse(req.body);
      if (!validated.success) {
        throw new ValidationError(validated.error.message);
      }

      const { memberId, communityId, successUrl, cancelUrl } = validated.data;

      // Check if member already has access
      const hasAccess = await badgeService.hasBadgeAccess(communityId, memberId);
      if (hasAccess) {
        res.status(400).json({
          error: 'Badge already accessible',
          message: 'Member already has badge access',
        });
        return;
      }

      // Get member profile for metadata
      const profile = getMemberProfileById(memberId);
      if (!profile) {
        throw new NotFoundError('Member not found');
      }

      // Create Paddle Checkout session for badge purchase
      const priceId = config.paddle?.oneTimePriceIds?.badge;
      if (!priceId) {
        throw new Error('Badge price ID not configured');
      }

      const provider = getBillingProvider();

      // Get or create Paddle customer
      const customerId = await provider.getOrCreateCustomer(
        communityId,
        undefined, // email
        profile.nym // name
      );

      // Create checkout session using Paddle provider
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const result = await provider.createOneTimeCheckoutSession({
        customerId,
        priceId,
        successUrl: successUrl || `${baseUrl}/badge/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl || `${baseUrl}/badge/cancel`,
        metadata: {
          communityId,
          memberId,
          type: 'badge_purchase',
        },
      });

      logger.info({ memberId, communityId, sessionId: result.sessionId }, 'Badge purchase initiated');

      res.json({
        sessionId: result.sessionId,
        url: result.url,
        clientToken: result.clientToken,
      });
    } catch (error) {
      logger.error({ error }, 'Badge purchase failed');
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to initiate badge purchase',
      });
    }
  }
);

/**
 * GET /badge/display/:platform/:memberId
 * Get badge display string for a member
 */
badgeRouter.get(
  '/display/:platform/:memberId',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const platformRaw: string = req.params.platform!;
      const memberId: string = req.params.memberId!;
      const communityId: string = (req.query.communityId as string | undefined) ?? 'default';

      // Validate platform
      if (platformRaw !== 'discord' && platformRaw !== 'telegram') {
        throw new ValidationError('Invalid platform. Must be "discord" or "telegram"');
      }
      const platform: 'discord' | 'telegram' = platformRaw;

      // Check badge access
      const hasAccess = await badgeService.hasBadgeAccess(communityId, memberId);
      if (!hasAccess) {
        res.status(403).json({
          error: 'Badge not accessible',
          message: 'Member does not have badge access',
        });
        return;
      }

      // Get badge display
      const display = badgeService.getBadgeDisplay(memberId, platform);

      // Get member profile for additional context
      const profile = getMemberProfileById(memberId);
      const activity = require('../db/queries.js').getMemberActivity(memberId);

      // Build response
      const response: BadgeDisplayResponse = {
        memberId,
        platform,
        display: display.display,
        enabled: display.enabled,
        style: display.style,
      };

      if (profile && activity) {
        response.score = Math.round(activity.activityBalance);
        response.tier = profile.tier;
      }

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Badge display failed');
      if (error instanceof ValidationError) {
        throw error;
      }
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to get badge display',
      });
    }
  }
);

/**
 * GET /badge/settings/:memberId
 * Get badge settings for a member
 */
badgeRouter.get(
  '/settings/:memberId',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const memberId: string = req.params.memberId!;
      const communityId: string = (req.query.communityId as string | undefined) ?? 'default';

      // Check badge access
      const hasAccess = await badgeService.hasBadgeAccess(communityId, memberId);
      if (!hasAccess) {
        res.status(403).json({
          error: 'Badge not accessible',
          message: 'Member does not have badge access',
        });
        return;
      }

      // Get badge settings
      const settings = badgeService.getBadgeSettings(memberId);

      // Build response
      const response: BadgeSettingsResponse = {
        memberId: settings.memberId,
        displayOnDiscord: settings.displayOnDiscord,
        displayOnTelegram: settings.displayOnTelegram,
        badgeStyle: settings.badgeStyle,
      };

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Failed to get badge settings');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to get badge settings',
      });
    }
  }
);

/**
 * PUT /badge/settings/:memberId
 * Update badge settings for a member
 */
badgeRouter.put(
  '/settings/:memberId',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const memberId: string = req.params.memberId!;
      const communityId: string = (req.query.communityId as string | undefined) ?? 'default';

      // Validate request body
      const validated = badgeSettingsSchema.safeParse(req.body);
      if (!validated.success) {
        throw new ValidationError(validated.error.message);
      }

      // Check badge access
      const hasAccess = await badgeService.hasBadgeAccess(communityId, memberId);
      if (!hasAccess) {
        res.status(403).json({
          error: 'Badge not accessible',
          message: 'Member does not have badge access',
        });
        return;
      }

      // Update settings
      badgeService.updateBadgeSettings(memberId, validated.data);

      // Get updated settings
      const settings = badgeService.getBadgeSettings(memberId);

      // Build response
      const response: BadgeSettingsResponse = {
        memberId: settings.memberId,
        displayOnDiscord: settings.displayOnDiscord,
        displayOnTelegram: settings.displayOnTelegram,
        badgeStyle: settings.badgeStyle,
      };

      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Failed to update badge settings');
      if (error instanceof ValidationError) {
        throw error;
      }
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update badge settings',
      });
    }
  }
);

/**
 * GET /badge/price
 * Get badge purchase price information
 */
badgeRouter.get(
  '/price',
  requireBadgeEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const priceInfo = badgeService.getPriceInfo();

      res.json({
        cents: priceInfo.cents,
        formatted: priceInfo.formatted,
        currency: 'USD',
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get badge price');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to get badge price',
      });
    }
  }
);
