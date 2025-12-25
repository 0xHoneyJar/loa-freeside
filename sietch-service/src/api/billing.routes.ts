/**
 * Billing API Routes (v4.0 - Sprint 23)
 *
 * Handles billing-related endpoints:
 * - POST /checkout - Create Stripe Checkout session
 * - POST /portal - Create Stripe Customer Portal session
 * - GET /subscription - Get current subscription status
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
import { stripeService } from '../services/billing/index.js';
import {
  getSubscriptionByCommunityId,
  getActiveFeeWaiver,
  getEffectiveTier,
  createSubscription,
  updateSubscription,
  isWebhookEventProcessed,
  recordWebhookEvent,
  logBillingAuditEvent,
} from '../db/billing-queries.js';
import { logger } from '../utils/logger.js';
import type {
  SubscriptionTier,
  BillingStatusResponse,
  EntitlementsResponse,
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
 * Get feature entitlements for a community
 */
billingRouter.get(
  '/entitlements',
  requireBillingEnabled,
  requireApiKey,
  (req: AuthenticatedRequest, res: Response) => {
    const result = subscriptionQuerySchema.safeParse(req.query);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { community_id } = result.data;

    const { tier, source } = getEffectiveTier(community_id);
    const tierInfo = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
    const subscription = getSubscriptionByCommunityId(community_id);

    // Determine features based on tier
    const features = getFeaturesByTier(tier);

    const inGracePeriod = !!(
      subscription?.graceUntil && subscription.graceUntil > new Date()
    );

    const response: EntitlementsResponse = {
      communityId: community_id,
      tier,
      tierName: tierInfo?.name ?? 'Unknown',
      maxMembers: tierInfo?.maxMembers ?? 100,
      features,
      source,
      inGracePeriod,
      graceUntil: subscription?.graceUntil?.toISOString(),
    };

    res.json(response);
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

  let event;

  try {
    // Verify webhook signature
    // Note: req.body should be raw Buffer for signature verification
    // The raw body middleware is configured in server.ts - we require it explicitly
    // to prevent signature bypass if middleware misconfigured
    const rawBody = (req as RawBodyRequest).rawBody;

    if (!rawBody) {
      logger.error('Webhook received without raw body - check middleware configuration');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Server misconfiguration - raw body not available',
      });
      return;
    }

    event = stripeService.constructWebhookEvent(rawBody, signature);
  } catch (error) {
    logger.warn({ error }, 'Invalid Stripe webhook signature');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  // Idempotency check
  if (isWebhookEventProcessed(event.id)) {
    logger.debug({ eventId: event.id }, 'Webhook event already processed');
    res.json({ received: true, status: 'already_processed' });
    return;
  }

  try {
    // Process the event
    await processWebhookEvent(event);

    // Record successful processing
    recordWebhookEvent(
      event.id,
      event.type,
      JSON.stringify(event.data),
      'processed'
    );

    res.json({ received: true, status: 'processed' });
  } catch (error) {
    logger.error({ eventId: event.id, eventType: event.type, error }, 'Failed to process webhook');

    // Record failed processing
    recordWebhookEvent(
      event.id,
      event.type,
      JSON.stringify(event.data),
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );

    logBillingAuditEvent('webhook_failed', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return 200 to prevent Stripe retries for unrecoverable errors
    // Stripe will retry on 4xx/5xx, which can cause loops
    res.json({ received: true, status: 'failed' });
  }
});

// =============================================================================
// Webhook Event Processing
// =============================================================================

/**
 * Process a Stripe webhook event
 */
async function processWebhookEvent(event: any): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;

    case 'invoice.paid':
      await handleInvoicePaid(event.data.object);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;

    default:
      logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
  }
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session: any): Promise<void> {
  const communityId = session.metadata?.community_id;
  const tier = session.metadata?.tier as SubscriptionTier;

  if (!communityId) {
    logger.warn({ sessionId: session.id }, 'Checkout session missing community_id');
    return;
  }

  // Check if subscription already exists
  const existing = getSubscriptionByCommunityId(communityId);

  if (existing) {
    // Update existing subscription
    updateSubscription(communityId, {
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      tier: tier || existing.tier,
      status: 'active',
      graceUntil: null,
    });
  } else {
    // Create new subscription
    createSubscription({
      communityId,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      tier: tier || 'basic',
      status: 'active',
    });
  }

  logBillingAuditEvent(
    'subscription_created',
    {
      communityId,
      tier,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
    },
    communityId
  );

  logger.info(
    { communityId, tier, sessionId: session.id },
    'Checkout completed, subscription created'
  );
}

/**
 * Handle invoice.paid event
 */
async function handleInvoicePaid(invoice: any): Promise<void> {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    return;
  }

  const subscription = await stripeService.getStripeSubscription(subscriptionId);
  if (!subscription) {
    return;
  }

  const communityId = subscription.metadata?.community_id;
  if (!communityId) {
    return;
  }

  // Clear grace period and update status
  updateSubscription(communityId, {
    status: 'active',
    graceUntil: null,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });

  logBillingAuditEvent(
    'payment_succeeded',
    {
      communityId,
      invoiceId: invoice.id,
      amount: invoice.amount_paid,
    },
    communityId
  );

  logger.info({ communityId, invoiceId: invoice.id }, 'Invoice paid');
}

/**
 * Handle invoice.payment_failed event
 */
async function handleInvoicePaymentFailed(invoice: any): Promise<void> {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) {
    return;
  }

  const subscription = await stripeService.getStripeSubscription(subscriptionId);
  if (!subscription) {
    return;
  }

  const communityId = subscription.metadata?.community_id;
  if (!communityId) {
    return;
  }

  // Set grace period (24 hours from now)
  const graceUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

  updateSubscription(communityId, {
    status: 'past_due',
    graceUntil,
  });

  logBillingAuditEvent(
    'payment_failed',
    {
      communityId,
      invoiceId: invoice.id,
      graceUntil: graceUntil.toISOString(),
    },
    communityId
  );

  logBillingAuditEvent(
    'grace_period_started',
    {
      communityId,
      graceUntil: graceUntil.toISOString(),
    },
    communityId
  );

  logger.warn(
    { communityId, invoiceId: invoice.id, graceUntil },
    'Invoice payment failed, grace period started'
  );
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(stripeSubscription: any): Promise<void> {
  const communityId = stripeSubscription.metadata?.community_id;

  if (!communityId) {
    return;
  }

  const tier = stripeService.extractTierFromSubscription(stripeSubscription);
  const status = stripeService.mapSubscriptionStatus(stripeSubscription.status);

  updateSubscription(communityId, {
    tier: tier || undefined,
    status,
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    graceUntil: status === 'active' ? null : undefined,
  });

  logBillingAuditEvent(
    'subscription_updated',
    {
      communityId,
      tier,
      status,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    },
    communityId
  );

  logger.info(
    { communityId, tier, status },
    'Subscription updated'
  );
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(stripeSubscription: any): Promise<void> {
  const communityId = stripeSubscription.metadata?.community_id;

  if (!communityId) {
    return;
  }

  updateSubscription(communityId, {
    status: 'canceled',
    tier: 'starter', // Downgrade to free tier
  });

  logBillingAuditEvent(
    'subscription_canceled',
    {
      communityId,
      canceledAt: new Date().toISOString(),
    },
    communityId
  );

  logger.info({ communityId }, 'Subscription canceled');
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get features available for a tier
 */
function getFeaturesByTier(tier: SubscriptionTier): Feature[] {
  const features: Feature[] = [];

  // Starter features (all tiers)
  features.push('discord_bot', 'basic_onboarding', 'member_profiles');

  if (['basic', 'premium', 'exclusive', 'elite', 'enterprise'].includes(tier)) {
    features.push('stats_leaderboard', 'position_alerts', 'custom_nym');
  }

  if (['premium', 'exclusive', 'elite', 'enterprise'].includes(tier)) {
    features.push(
      'nine_tier_system',
      'custom_pfp',
      'weekly_digest',
      'activity_tracking',
      'score_badge'
    );
  }

  if (['exclusive', 'elite', 'enterprise'].includes(tier)) {
    features.push('admin_analytics', 'naib_dynamics', 'water_sharer_badge');
  }

  if (['elite', 'enterprise'].includes(tier)) {
    features.push('custom_branding', 'priority_support', 'api_access');
  }

  if (tier === 'enterprise') {
    features.push('white_label', 'dedicated_support', 'custom_integrations');
  }

  return features;
}
