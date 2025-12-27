/**
 * Webhook Service (v4.0 - Sprint 24)
 *
 * Processes Stripe webhooks with idempotency guarantees:
 * - Signature verification (HMAC-SHA256)
 * - Idempotent event processing (Redis + database deduplication)
 * - Event-specific handlers for subscription lifecycle
 * - Grace period management on payment failures
 * - Entitlement cache invalidation on subscription changes
 *
 * Supported webhook events:
 * - checkout.session.completed
 * - invoice.paid
 * - invoice.payment_failed
 * - customer.subscription.updated
 * - customer.subscription.deleted
 */

import type Stripe from 'stripe';
import { stripeService } from './StripeService.js';
import { redisService } from '../cache/RedisService.js';
import {
  getSubscriptionByCommunityId,
  createSubscription,
  updateSubscription,
  isWebhookEventProcessed,
  recordWebhookEvent,
  logBillingAuditEvent,
} from '../../db/billing-queries.js';
import { boostService } from '../boost/BoostService.js';
import { logger } from '../../utils/logger.js';
import type { SubscriptionTier, SubscriptionStatus } from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/** Grace period duration in milliseconds (24 hours) */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** Supported webhook event types */
const SUPPORTED_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

type SupportedEventType = (typeof SUPPORTED_EVENTS)[number];

// =============================================================================
// Types
// =============================================================================

/**
 * Webhook processing result
 */
export interface WebhookResult {
  /** Processing status */
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  /** Stripe event ID */
  eventId: string;
  /** Event type */
  eventType: string;
  /** Optional message */
  message?: string;
  /** Error if failed */
  error?: string;
}

// =============================================================================
// Webhook Service Class
// =============================================================================

class WebhookService {
  // ---------------------------------------------------------------------------
  // Signature Verification
  // ---------------------------------------------------------------------------

  /**
   * Verify Stripe webhook signature
   *
   * @param payload - Raw request body (string or Buffer)
   * @param signature - Stripe-Signature header value
   * @returns Verified Stripe event
   * @throws Error if signature invalid
   */
  verifySignature(payload: string | Buffer, signature: string): Stripe.Event {
    try {
      return stripeService.constructWebhookEvent(payload, signature);
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        'Invalid webhook signature'
      );
      throw new Error('Invalid webhook signature');
    }
  }

  // ---------------------------------------------------------------------------
  // Event Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a Stripe webhook event with idempotency
   *
   * Flow:
   * 1. Check Redis for event ID (fast)
   * 2. Check database for event ID (fallback)
   * 3. Acquire Redis lock for event
   * 4. Process event based on type
   * 5. Record event in database
   * 6. Mark event in Redis
   * 7. Release lock
   *
   * @param event - Verified Stripe event
   * @returns Processing result
   */
  async processEvent(event: Stripe.Event): Promise<WebhookResult> {
    const eventId = event.id;
    const eventType = event.type;

    logger.info({ eventId, eventType }, 'Processing webhook event');

    // Step 1: Check Redis for duplicate (fast path)
    if (await redisService.isEventProcessed(eventId)) {
      logger.debug({ eventId }, 'Event already processed (Redis cache hit)');
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event already processed (Redis)',
      };
    }

    // Step 2: Check database for duplicate (fallback)
    if (isWebhookEventProcessed(eventId)) {
      logger.debug({ eventId }, 'Event already processed (database check)');
      // Update Redis cache for future requests
      await redisService.markEventProcessed(eventId);
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event already processed (database)',
      };
    }

    // Step 3: Acquire lock for event processing
    const lockAcquired = await redisService.acquireEventLock(eventId);
    if (!lockAcquired) {
      logger.debug({ eventId }, 'Event lock held by another process');
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event being processed by another instance',
      };
    }

    try {
      // Step 4: Process event based on type
      if (!this.isSupportedEvent(eventType)) {
        logger.debug({ eventId, eventType }, 'Unsupported event type, skipping');
        return {
          status: 'skipped',
          eventId,
          eventType,
          message: 'Unsupported event type',
        };
      }

      await this.handleEvent(event);

      // Step 5: Record successful processing in database
      recordWebhookEvent(eventId, eventType, JSON.stringify(event.data), 'processed');

      // Step 6: Mark event in Redis for deduplication
      await redisService.markEventProcessed(eventId);

      logger.info({ eventId, eventType }, 'Webhook event processed successfully');

      return {
        status: 'processed',
        eventId,
        eventType,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(
        { eventId, eventType, error: errorMessage },
        'Failed to process webhook event'
      );

      // Record failed processing
      recordWebhookEvent(
        eventId,
        eventType,
        JSON.stringify(event.data),
        'failed',
        errorMessage
      );

      logBillingAuditEvent('webhook_failed', {
        eventId,
        eventType,
        error: errorMessage,
      });

      return {
        status: 'failed',
        eventId,
        eventType,
        error: errorMessage,
      };
    } finally {
      // Step 7: Always release lock
      await redisService.releaseEventLock(eventId);
    }
  }

  // ---------------------------------------------------------------------------
  // Event Routing
  // ---------------------------------------------------------------------------

  /**
   * Check if event type is supported
   */
  private isSupportedEvent(eventType: string): eventType is SupportedEventType {
    return (SUPPORTED_EVENTS as readonly string[]).includes(eventType);
  }

  /**
   * Route event to appropriate handler
   */
  private async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle checkout.session.completed
   * Routes to appropriate handler based on checkout type (subscription vs one-time payment)
   */
  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    const paymentType = session.metadata?.type;

    // Route to boost payment handler for boost purchases
    if (paymentType === 'boost_purchase') {
      await this.handleBoostPaymentCompleted(session);
      return;
    }

    // Route to badge payment handler for badge purchases
    if (paymentType === 'badge_purchase') {
      await this.handleBadgePaymentCompleted(session);
      return;
    }

    // Default: Handle as subscription checkout
    await this.handleSubscriptionCheckoutCompleted(session);
  }

  /**
   * Handle subscription checkout completion
   * Creates or updates subscription record when checkout succeeds
   */
  private async handleSubscriptionCheckoutCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    const communityId = session.metadata?.community_id;
    const tier = session.metadata?.tier as SubscriptionTier;

    if (!communityId) {
      logger.warn(
        { sessionId: session.id },
        'Checkout session missing community_id metadata'
      );
      return;
    }

    // Get or fetch subscription details from Stripe
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (!subscriptionId || !customerId) {
      logger.warn(
        { sessionId: session.id, communityId },
        'Checkout session missing subscription or customer'
      );
      return;
    }

    // Check if subscription already exists
    const existing = getSubscriptionByCommunityId(communityId);

    if (existing) {
      // Update existing subscription
      updateSubscription(communityId, {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        tier: tier || existing.tier,
        status: 'active',
        graceUntil: null, // Clear any grace period
      });
    } else {
      // Create new subscription
      createSubscription({
        communityId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        tier: tier || 'basic',
        status: 'active',
      });
    }

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'subscription_created',
      {
        communityId,
        tier,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      },
      communityId
    );

    logger.info(
      { communityId, tier, sessionId: session.id },
      'Checkout completed, subscription created/updated'
    );
  }

  /**
   * Handle boost purchase payment completion
   * Records boost purchase and updates community stats
   */
  private async handleBoostPaymentCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    const { metadata } = session;
    const communityId = metadata?.community_id;
    const memberId = metadata?.member_id;
    const months = parseInt(metadata?.months || '0', 10);

    if (!communityId || !memberId || !months) {
      logger.warn(
        { sessionId: session.id, metadata },
        'Boost checkout session missing required metadata'
      );
      return;
    }

    const amountPaid = session.amount_total || 0;
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    try {
      // Process the boost payment through BoostService
      const purchase = await boostService.processBoostPayment({
        stripeSessionId: session.id,
        stripePaymentId: paymentIntentId || session.id,
        memberId,
        communityId,
        months,
        amountPaidCents: amountPaid,
      });

      logger.info(
        {
          communityId,
          memberId,
          months,
          purchaseId: purchase.id,
          sessionId: session.id,
        },
        'Boost payment processed successfully'
      );
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          sessionId: session.id,
          communityId,
          memberId,
        },
        'Failed to process boost payment'
      );
      throw error;
    }
  }

  /**
   * Handle badge purchase payment completion
   * Records badge purchase for the member
   */
  private async handleBadgePaymentCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    const { metadata } = session;
    const communityId = metadata?.communityId;
    const memberId = metadata?.memberId;

    if (!communityId || !memberId) {
      logger.warn(
        { sessionId: session.id, metadata },
        'Badge checkout session missing required metadata'
      );
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    try {
      // Import badge service dynamically to avoid circular dependency
      const { badgeService } = await import('../badge/BadgeService.js');

      // Record the badge purchase
      badgeService.recordBadgePurchase({
        memberId,
        stripePaymentId: paymentIntentId || session.id,
      });

      logger.info(
        {
          communityId,
          memberId,
          sessionId: session.id,
        },
        'Badge payment processed successfully'
      );
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          sessionId: session.id,
          communityId,
          memberId,
        },
        'Failed to process badge payment'
      );
      throw error;
    }
  }

  /**
   * Handle invoice.paid
   * Updates subscription period and clears grace period
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      logger.debug({ invoiceId: invoice.id }, 'Invoice not associated with subscription');
      return;
    }

    const subscription = await stripeService.getStripeSubscription(subscriptionId);
    if (!subscription) {
      logger.warn({ subscriptionId }, 'Subscription not found in Stripe');
      return;
    }

    const communityId = subscription.metadata?.community_id;
    if (!communityId) {
      logger.warn({ subscriptionId }, 'Subscription missing community_id metadata');
      return;
    }

    // Update subscription: clear grace period, update period
    updateSubscription(communityId, {
      status: 'active',
      graceUntil: null,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    });

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'payment_succeeded',
      {
        communityId,
        invoiceId: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
      },
      communityId
    );

    logger.info(
      { communityId, invoiceId: invoice.id, amount: invoice.amount_paid },
      'Invoice paid, grace period cleared'
    );
  }

  /**
   * Handle invoice.payment_failed
   * Sets 24-hour grace period and updates status to past_due
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      logger.debug(
        { invoiceId: invoice.id },
        'Failed invoice not associated with subscription'
      );
      return;
    }

    const subscription = await stripeService.getStripeSubscription(subscriptionId);
    if (!subscription) {
      logger.warn({ subscriptionId }, 'Subscription not found in Stripe');
      return;
    }

    const communityId = subscription.metadata?.community_id;
    if (!communityId) {
      logger.warn({ subscriptionId }, 'Subscription missing community_id metadata');
      return;
    }

    // Set grace period (24 hours from now)
    const graceUntil = new Date(Date.now() + GRACE_PERIOD_MS);

    updateSubscription(communityId, {
      status: 'past_due',
      graceUntil,
    });

    // Invalidate entitlement cache (grace period affects entitlements)
    await redisService.invalidateEntitlements(communityId);

    // Log audit events
    logBillingAuditEvent(
      'payment_failed',
      {
        communityId,
        invoiceId: invoice.id,
        graceUntil: graceUntil.toISOString(),
        attemptCount: invoice.attempt_count,
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
      {
        communityId,
        invoiceId: invoice.id,
        graceUntil,
        attemptCount: invoice.attempt_count,
      },
      'Invoice payment failed, grace period started'
    );
  }

  /**
   * Handle customer.subscription.updated
   * Updates tier, status, and period information
   */
  private async handleSubscriptionUpdated(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const communityId = stripeSubscription.metadata?.community_id;

    if (!communityId) {
      logger.warn(
        { subscriptionId: stripeSubscription.id },
        'Subscription missing community_id metadata'
      );
      return;
    }

    const tier = stripeService.extractTierFromSubscription(stripeSubscription);
    const status = stripeService.mapSubscriptionStatus(stripeSubscription.status);

    updateSubscription(communityId, {
      tier: tier || undefined,
      status,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      // Clear grace period if subscription is now active
      graceUntil: status === 'active' ? null : undefined,
    });

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
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
      {
        communityId,
        tier,
        status,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
      'Subscription updated'
    );
  }

  /**
   * Handle customer.subscription.deleted
   * Downgrades to starter (free) tier and sets status to canceled
   */
  private async handleSubscriptionDeleted(
    stripeSubscription: Stripe.Subscription
  ): Promise<void> {
    const communityId = stripeSubscription.metadata?.community_id;

    if (!communityId) {
      logger.warn(
        { subscriptionId: stripeSubscription.id },
        'Subscription missing community_id metadata'
      );
      return;
    }

    // Downgrade to free tier
    updateSubscription(communityId, {
      status: 'canceled',
      tier: 'starter',
      graceUntil: null,
    });

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'subscription_canceled',
      {
        communityId,
        canceledAt: new Date().toISOString(),
      },
      communityId
    );

    logger.info({ communityId }, 'Subscription canceled, downgraded to starter tier');
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webhookService = new WebhookService();
