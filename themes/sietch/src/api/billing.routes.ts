/**
 * Billing API Routes (v5.0 - Sprint 2 Paddle Migration)
 *
 * Handles billing-related endpoints:
 * - POST /checkout - Create Paddle Checkout session
 * - POST /portal - Create Paddle Customer Portal session
 * - GET /subscription - Get current subscription status
 * - GET /entitlements - Get feature entitlements (cached)
 * - POST /feature-check - Check access to specific feature
 * - POST /webhook - Handle Paddle webhooks
 *
 * All routes except webhook require authentication.
 * Webhook uses Paddle signature verification.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import type { AuthenticatedRequest, RawBodyRequest } from './middleware.js';
import {
  memberRateLimiter,
  webhookRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import { config, isBillingEnabled, isPaddleEnabled, SUBSCRIPTION_TIERS } from '../config.js';
import { createBillingProvider } from '../packages/adapters/billing/index.js';
import { webhookService, gatekeeperService } from '../services/billing/index.js';
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
import type { IBillingProvider } from '../packages/core/ports/IBillingProvider.js';

// =============================================================================
// Router Setup
// =============================================================================

export const billingRouter = Router();

// Apply rate limiting to all routes
billingRouter.use(memberRateLimiter);

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

    // Inject provider into webhook service
    webhookService.setBillingProvider(billingProvider);
  }
  return billingProvider;
}

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
// URL Validation
// =============================================================================

/**
 * Allowed domains for redirect URLs (security: prevent open redirects)
 * Add production domains and development localhost
 */
const ALLOWED_REDIRECT_DOMAINS = [
  'arrakis.thj.bot',
  'sietch.io',
  'app.sietch.io',
  'localhost',
  '127.0.0.1',
];

/**
 * Validate that a redirect URL points to an allowed domain
 * Prevents phishing attacks via malicious redirect URLs
 */
function validateRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Checkout session creation schema
 * Security: URL validation prevents open redirect attacks
 */
const createCheckoutSchema = z.object({
  tier: z.enum(['basic', 'premium', 'exclusive', 'elite']),
  success_url: z
    .string()
    .url()
    .max(2048, 'URL too long')
    .refine(validateRedirectUrl, { message: 'Invalid redirect domain - must be an allowed domain' }),
  cancel_url: z
    .string()
    .url()
    .max(2048, 'URL too long')
    .refine(validateRedirectUrl, { message: 'Invalid redirect domain - must be an allowed domain' }),
  community_id: z
    .string()
    .min(1, 'Community ID required')
    .max(128, 'Community ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Community ID must be alphanumeric'),
});

/**
 * Portal session creation schema
 * Security: URL validation prevents open redirect attacks
 */
const createPortalSchema = z.object({
  return_url: z
    .string()
    .url()
    .max(2048, 'URL too long')
    .refine(validateRedirectUrl, { message: 'Invalid redirect domain - must be an allowed domain' }),
  community_id: z
    .string()
    .min(1, 'Community ID required')
    .max(128, 'Community ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Community ID must be alphanumeric'),
});

/**
 * Subscription query schema
 */
const subscriptionQuerySchema = z.object({
  community_id: z
    .string()
    .max(128, 'Community ID too long')
    .regex(/^[a-zA-Z0-9_-]*$/, 'Community ID must be alphanumeric')
    .default('default'),
});

/**
 * Feature check schema
 */
const featureCheckSchema = z.object({
  community_id: z
    .string()
    .max(128, 'Community ID too long')
    .regex(/^[a-zA-Z0-9_-]*$/, 'Community ID must be alphanumeric')
    .default('default'),
  feature: z.string().min(1).max(64),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /billing/checkout
 * Create a Paddle Checkout session for subscription purchase
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
      const provider = getBillingProvider();
      const checkout: CheckoutResult = await provider.createCheckoutSession({
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
          provider: 'paddle',
        },
        community_id,
        req.adminName
      );

      res.json({
        session_id: checkout.sessionId,
        url: checkout.url,
        client_token: checkout.clientToken, // For Paddle.js embedded checkout
      });
    } catch (error) {
      logger.error({ error, tier, communityId: community_id }, 'Failed to create checkout session');
      throw error;
    }
  }
);

/**
 * POST /billing/portal
 * Create a Paddle Customer Portal session
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
      const provider = getBillingProvider();
      const portal: PortalResult = await provider.createPortalSession({
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
 * Handle Paddle webhooks
 *
 * SECURITY REQUIREMENTS:
 * 1. Raw body middleware MUST be configured in server.ts for this route
 * 2. Signature verification uses HMAC-SHA256 via Paddle SDK
 * 3. Content-Type must be application/json
 * 4. Rate limited to 1000 req/min per IP (Sprint 73 - HIGH-2)
 *
 * Configure Express with: express.raw({ type: 'application/json' }) for /billing/webhook
 */
billingRouter.post('/webhook', webhookRateLimiter, async (req: Request, res: Response) => {
  // Webhook doesn't require billing to be fully enabled
  // (we want to process events even if feature flags are off)

  // Security: Validate Content-Type header
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.status(400).json({ error: 'Invalid Content-Type - must be application/json' });
    return;
  }

  const signature = req.headers['paddle-signature'];

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing paddle-signature header' });
    return;
  }

  try {
    // Ensure billing provider is initialized for webhook processing
    getBillingProvider();

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
