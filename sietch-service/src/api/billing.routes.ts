/**
 * Billing API Routes (v4.0 - Sprint 25)
 *
 * Handles billing-related endpoints:
 * - POST /checkout - Create Stripe Checkout session
 * - POST /portal - Create Stripe Customer Portal session
 * - GET /subscription - Get current subscription status
 * - GET /entitlements - Get feature entitlements (cached)
 * - POST /feature-check - Check access to specific feature
 * - POST /webhook - Handle Stripe webhooks
 *
 * All routes except webhook require authentication.
 * Webhook uses Stripe signature verification.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import type { AuthenticatedRequest, RawBodyRequest } from './middleware.js';
import {
  memberRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import { config, isBillingEnabled, SUBSCRIPTION_TIERS } from '../config.js';
import { stripeService, webhookService, gatekeeperService } from '../services/billing/index.js';
import {
  getSubscriptionByCommunityId,
  getActiveFeeWaiver,
  getEffectiveTier,
  logBillingAuditEvent,
} from '../db/billing-queries.js';
import { logger } from '../utils/logger.js';
import type {
  SubscriptionTier,
  BillingStatusResponse,
  EntitlementsResponse,
  FeatureCheckResponse,
  CheckoutResult,
  PortalResult,
  Feature,
} from '../types/billing.js';

// =============================================================================
// Router Setup
// =============================================================================

export const billingRouter = Router();

// Apply rate limiting to all routes
billingRouter.use(memberRateLimiter);

// =============================================================================
// Middleware: Check Billing Enabled
// =============================================================================

/**
 * Middleware to check if billing is enabled
 */
function requireBillingEnabled(req: Request, res: Response, next: Function) {
  if (!isBillingEnabled()) {
    res.status(503).json({
      error: 'Billing system not enabled',
      message: 'The billing system is currently disabled',
    });
    return;
  }
  next();
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Checkout session creation schema
 */
const createCheckoutSchema = z.object({
  tier: z.enum(['basic', 'premium', 'exclusive', 'elite']),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  community_id: z.string().default('default'),
});

/**
 * Portal session creation schema
 */
const createPortalSchema = z.object({
  return_url: z.string().url(),
  community_id: z.string().default('default'),
});

/**
 * Subscription query schema
 */
const subscriptionQuerySchema = z.object({
  community_id: z.string().default('default'),
});

/**
 * Feature check schema
 */
const featureCheckSchema = z.object({
  community_id: z.string().default('default'),
  feature: z.string(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /billing/checkout
 * Create a Stripe Checkout session for subscription purchase
 */
billingRouter.post(
  '/checkout',
  requireBillingEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = createCheckoutSchema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { tier, success_url, cancel_url, community_id } = result.data;

    try {
      const checkout: CheckoutResult = await stripeService.createCheckoutSession({
        communityId: community_id,
        tier: tier as SubscriptionTier,
        successUrl: success_url,
        cancelUrl: cancel_url,
      });

      logBillingAuditEvent(
        'subscription_created',
        {
          tier,
          communityId: community_id,
          sessionId: checkout.sessionId,
        },
        community_id,
        req.adminName
      );

      res.json({
        session_id: checkout.sessionId,
        url: checkout.url,
      });
    } catch (error) {
      logger.error({ error, tier, communityId: community_id }, 'Failed to create checkout session');
      throw error;
    }
  }
);

/**
 * POST /billing/portal
 * Create a Stripe Customer Portal session
 */
billingRouter.post(
  '/portal',
  requireBillingEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = createPortalSchema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { return_url, community_id } = result.data;

    try {
      const portal: PortalResult = await stripeService.createPortalSession({
        communityId: community_id,
        returnUrl: return_url,
      });

      res.json({
        url: portal.url,
      });
    } catch (error) {
      logger.error({ error, communityId: community_id }, 'Failed to create portal session');
      throw error;
    }
  }
);

/**
 * GET /billing/subscription
 * Get current subscription status
 */
billingRouter.get(
  '/subscription',
  requireBillingEnabled,
  requireApiKey,
  (req: AuthenticatedRequest, res: Response) => {
    const result = subscriptionQuerySchema.safeParse(req.query);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { community_id } = result.data;

    const subscription = getSubscriptionByCommunityId(community_id);
    const waiver = getActiveFeeWaiver(community_id);
    const { tier: effectiveTier, source } = getEffectiveTier(community_id);

    const tierInfo = SUBSCRIPTION_TIERS[effectiveTier as keyof typeof SUBSCRIPTION_TIERS];

    const response: BillingStatusResponse = {
      enabled: true,
      subscription: subscription
        ? {
            tier: subscription.tier,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
            inGracePeriod: !!(
              subscription.graceUntil && subscription.graceUntil > new Date()
            ),
          }
        : undefined,
      waiver: waiver
        ? {
            tier: waiver.tier,
            expiresAt: waiver.expiresAt?.toISOString(),
          }
        : undefined,
      effectiveTier,
      maxMembers: tierInfo?.maxMembers ?? 100,
    };

    res.json(response);
  }
);

/**
 * GET /billing/entitlements
 * Get feature entitlements for a community (with caching)
 */
billingRouter.get(
  '/entitlements',
  requireBillingEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = subscriptionQuerySchema.safeParse(req.query);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { community_id } = result.data;

    try {
      // Use GatekeeperService for cached entitlement lookup
      const entitlements = await gatekeeperService.getEntitlements(community_id);
      const tierInfo = SUBSCRIPTION_TIERS[entitlements.tier as keyof typeof SUBSCRIPTION_TIERS];

      const response: EntitlementsResponse = {
        communityId: entitlements.communityId,
        tier: entitlements.tier,
        tierName: tierInfo?.name ?? 'Unknown',
        maxMembers: entitlements.maxMembers,
        features: entitlements.features,
        source: entitlements.source,
        inGracePeriod: entitlements.inGracePeriod,
        graceUntil: entitlements.graceUntil?.toISOString(),
      };

      res.json(response);
    } catch (error) {
      logger.error({ error, communityId: community_id }, 'Failed to get entitlements');
      throw error;
    }
  }
);

/**
 * POST /billing/feature-check
 * Check if a community has access to a specific feature
 */
billingRouter.post(
  '/feature-check',
  requireBillingEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = featureCheckSchema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { community_id, feature } = result.data;

    // Validate feature is a valid Feature type
    if (!isValidFeature(feature)) {
      throw new ValidationError(`Invalid feature: ${feature}`);
    }

    try {
      const accessResult = await gatekeeperService.checkAccess({
        communityId: community_id,
        feature: feature as Feature,
      });

      const response: FeatureCheckResponse = {
        feature: feature as Feature,
        canAccess: accessResult.canAccess,
        currentTier: accessResult.tier,
        requiredTier: accessResult.requiredTier,
        upgradeUrl: accessResult.upgradeUrl,
      };

      res.json(response);
    } catch (error) {
      logger.error({ error, communityId: community_id, feature }, 'Failed to check feature access');
      throw error;
    }
  }
);

/**
 * POST /billing/webhook
 * Handle Stripe webhooks
 *
 * Note: This endpoint needs raw body for signature verification.
 * Configure Express with a raw body parser for this route.
 */
billingRouter.post('/webhook', async (req: Request, res: Response) => {
  // Webhook doesn't require billing to be fully enabled
  // (we want to process events even if feature flags are off)

  const signature = req.headers['stripe-signature'];

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  try {
    // Verify webhook signature and get event
    // Note: req.body should be raw Buffer for signature verification
    // The raw body middleware is configured in server.ts
    const rawBody = (req as RawBodyRequest).rawBody;

    if (!rawBody) {
      logger.error('Webhook received without raw body - check middleware configuration');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Server misconfiguration - raw body not available',
      });
      return;
    }

    const event = webhookService.verifySignature(rawBody, signature);

    // Process the event through WebhookService (handles idempotency, locking, etc.)
    const result = await webhookService.processEvent(event);

    // Return appropriate response
    res.json({
      received: true,
      status: result.status,
      eventId: result.eventId,
      eventType: result.eventType,
      message: result.message,
    });
  } catch (error) {
    logger.warn({ error }, 'Webhook processing failed at handler level');
    res.status(400).json({
      error: 'Webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Note: Webhook event processing is now handled by WebhookService
// (Sprint 24) for better separation of concerns and testability

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a string is a valid Feature type
 */
function isValidFeature(feature: string): feature is Feature {
  const validFeatures = [
    'discord_bot',
    'basic_onboarding',
    'member_profiles',
    'stats_leaderboard',
    'position_alerts',
    'custom_nym',
    'nine_tier_system',
    'custom_pfp',
    'weekly_digest',
    'activity_tracking',
    'score_badge',
    'admin_analytics',
    'naib_dynamics',
    'water_sharer_badge',
    'custom_branding',
    'priority_support',
    'api_access',
    'white_label',
    'dedicated_support',
    'custom_integrations',
  ];
  return validFeatures.includes(feature);
}
