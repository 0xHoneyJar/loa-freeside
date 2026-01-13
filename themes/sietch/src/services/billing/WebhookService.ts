/**
 * Webhook Service (v5.1 - Sprint 67 LVVER Pattern Fix)
 *
 * Processes Paddle webhooks with idempotency guarantees:
 * - Signature verification via IBillingProvider
 * - Idempotent event processing (Redis + database deduplication)
 * - Event-specific handlers for subscription lifecycle
 * - Grace period management on payment failures
 * - Entitlement cache invalidation on subscription changes
 *
 * LVVER Pattern (Lock-Verify-Validate-Execute-Record):
 * 1. LOCK: Acquire distributed lock FIRST (prevents TOCTOU)
 * 2. VERIFY: Check Redis and database for duplicates UNDER LOCK
 * 3. VALIDATE: Validate event type is supported
 * 4. EXECUTE: Process the event
 * 5. RECORD: Persist to database and mark in Redis
 * 6. UNLOCK: Release lock in finally block (guaranteed)
 *
 * Supported webhook events (normalized):
 * - subscription.created
 * - subscription.activated
 * - subscription.updated
 * - subscription.canceled
 * - payment.completed
 * - payment.failed
 */

import { redisService } from '../cache/RedisService.js';
import {
  getSubscriptionByCommunityId,
  getSubscriptionByPaymentId,
  createSubscription,
  updateSubscription,
  isWebhookEventProcessed,
  recordWebhookEvent,
  logBillingAuditEvent,
} from '../../db/billing-queries.js';
import { boostService } from '../boost/BoostService.js';
import { logger } from '../../utils/logger.js';
import type {
  IBillingProvider,
  ProviderWebhookEvent,
  NormalizedEventType,
  ProviderSubscription,
} from '../../packages/core/ports/IBillingProvider.js';
import type { SubscriptionTier, SubscriptionStatus } from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/** Grace period duration in milliseconds (24 hours) */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** Default lock TTL in seconds (30 seconds for standard webhooks) */
const DEFAULT_LOCK_TTL = 30;

/** Extended lock TTL for boost/badge operations (60 seconds) */
const EXTENDED_LOCK_TTL = 60;

/**
 * Maximum event age in milliseconds (5 minutes)
 *
 * CRIT-4 FIX: Replay attack prevention
 * Events older than this threshold are rejected to prevent replay attacks.
 * This ensures that even if an attacker captures a webhook payload,
 * they cannot replay it after this window expires.
 *
 * 5 minutes allows for reasonable clock drift and network latency
 * while maintaining security against replay attacks.
 */
const MAX_EVENT_AGE_MS = 5 * 60 * 1000;

/** Supported webhook event types (normalized) */
const SUPPORTED_EVENTS: NormalizedEventType[] = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'payment.completed',
  'payment.failed',
];

// =============================================================================
// Types
// =============================================================================

/**
 * Webhook processing result
 */
export interface WebhookResult {
  /** Processing status */
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  /** Provider event ID */
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
  private billingProvider: IBillingProvider | null = null;

  /**
   * Set the billing provider (dependency injection)
   */
  setBillingProvider(provider: IBillingProvider): void {
    this.billingProvider = provider;
  }

  /**
   * Get the billing provider
   */
  private getProvider(): IBillingProvider {
    if (!this.billingProvider) {
      throw new Error('Billing provider not configured. Call setBillingProvider first.');
    }
    return this.billingProvider;
  }

  // ---------------------------------------------------------------------------
  // Signature Verification
  // ---------------------------------------------------------------------------

  /**
   * Verify webhook signature and parse event
   *
   * @param payload - Raw request body (string or Buffer)
   * @param signature - Paddle-Signature header value
   * @returns Verified provider event
   * @throws Error if signature invalid
   */
  verifySignature(payload: string | Buffer, signature: string): ProviderWebhookEvent {
    const provider = this.getProvider();
    const result = provider.verifyWebhook(payload, signature);

    if (!result.valid || !result.event) {
      logger.warn(
        { error: result.error },
        'Invalid webhook signature'
      );
      throw new Error(result.error || 'Invalid webhook signature');
    }

    return result.event;
  }

  // ---------------------------------------------------------------------------
  // Event Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a webhook event with idempotency using LVVER pattern
   *
   * LVVER Flow (Lock-Verify-Validate-Execute-Record):
   * 1. LOCK: Acquire Redis lock for event (FIRST - prevents TOCTOU)
   * 2. VERIFY: Check Redis for event ID (fast)
   * 3. VERIFY: Check database for event ID (fallback)
   * 4. VALIDATE: Verify event type is supported
   * 5. EXECUTE: Process event based on type
   * 6. RECORD: Record event in database + mark in Redis
   * 7. UNLOCK: Release lock (in finally block - guaranteed)
   *
   * Security: Lock acquisition MUST happen BEFORE any verification checks
   * to prevent Time-of-Check-Time-of-Use (TOCTOU) race conditions.
   *
   * @param event - Verified provider event
   * @returns Processing result
   */
  async processEvent(event: ProviderWebhookEvent): Promise<WebhookResult> {
    const eventId = event.id;
    const eventType = event.type;

    logger.info({ eventId, eventType, rawType: event.rawType }, 'Processing webhook event');

    // ==========================================================================
    // STEP 1 - LOCK: Acquire distributed lock FIRST (LVVER pattern)
    // This MUST happen before any verification to prevent TOCTOU attacks
    // Use extended TTL for boost/badge operations that involve external API calls
    // ==========================================================================
    const lockTtl = this.getLockTtlForEvent(event);
    const lockAcquired = await redisService.acquireEventLock(eventId, lockTtl);
    if (!lockAcquired) {
      logger.debug({ eventId }, 'Event lock held by another process');
      // Emit metric for lock contention monitoring
      this.emitLockContentionMetric(eventId, eventType);
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event being processed by another instance',
      };
    }

    try {
      // ========================================================================
      // STEP 1.5 - TIMESTAMP CHECK: Reject stale events (CRIT-4 replay prevention)
      // ========================================================================
      const eventAge = Date.now() - event.timestamp.getTime();
      if (eventAge > MAX_EVENT_AGE_MS) {
        logger.warn(
          {
            eventId,
            eventType,
            eventTimestamp: event.timestamp.toISOString(),
            ageMs: eventAge,
            maxAgeMs: MAX_EVENT_AGE_MS,
          },
          'Rejecting stale webhook event (potential replay attack)'
        );
        return {
          status: 'failed',
          eventId,
          eventType,
          error: 'Event timestamp too old - possible replay attack',
        };
      }

      // ========================================================================
      // STEP 2 - VERIFY: Check Redis for duplicate (fast path, UNDER LOCK)
      // ========================================================================
      if (await redisService.isEventProcessed(eventId)) {
        logger.debug({ eventId }, 'Event already processed (Redis cache hit)');
        return {
          status: 'duplicate',
          eventId,
          eventType,
          message: 'Event already processed (Redis)',
        };
      }

      // ========================================================================
      // STEP 3 - VERIFY: Check database for duplicate (fallback, UNDER LOCK)
      // ========================================================================
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

      // ========================================================================
      // STEP 4 - VALIDATE: Verify event type is supported
      // ========================================================================
      if (!this.isSupportedEvent(eventType)) {
        logger.debug({ eventId, eventType }, 'Unsupported event type, skipping');
        return {
          status: 'skipped',
          eventId,
          eventType,
          message: 'Unsupported event type',
        };
      }

      // ========================================================================
      // STEP 5 - EXECUTE: Process the event
      // ========================================================================
      await this.handleEvent(event);

      // ========================================================================
      // STEP 6 - RECORD: Persist to database and mark in Redis
      // ========================================================================
      recordWebhookEvent(eventId, eventType, JSON.stringify(event.data), 'processed');
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
        provider: 'paddle',
      });

      return {
        status: 'failed',
        eventId,
        eventType,
        error: errorMessage,
      };
    } finally {
      // ========================================================================
      // STEP 7 - UNLOCK: Release lock (guaranteed cleanup)
      // ========================================================================
      await redisService.releaseEventLock(eventId);
    }
  }

  /**
   * Emit metric for lock contention monitoring
   * In production, this would increment a Prometheus counter
   */
  private emitLockContentionMetric(eventId: string, eventType: string): void {
    logger.info(
      { eventId, eventType, metric: 'sietch_webhook_lock_contention_total' },
      'Lock contention detected'
    );
    // TODO: Increment Prometheus counter when metrics are implemented
    // metricsService.incrementCounter('sietch_webhook_lock_contention_total', { eventType });
  }

  /**
   * Get appropriate lock TTL based on event type
   *
   * Extended TTL (60s) for:
   * - Boost purchases: External Paddle API calls, database writes
   * - Badge purchases: Similar external API interaction
   *
   * Default TTL (30s) for:
   * - Standard subscription events
   * - Payment notifications (subscription-related)
   */
  private getLockTtlForEvent(event: ProviderWebhookEvent): number {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const paymentType = customData?.type;

    // Boost and badge operations need extended TTL due to external API calls
    if (paymentType === 'boost_purchase' || paymentType === 'badge_purchase') {
      logger.debug(
        { eventId: event.id, paymentType, ttl: EXTENDED_LOCK_TTL },
        'Using extended lock TTL for payment operation'
      );
      return EXTENDED_LOCK_TTL;
    }

    return DEFAULT_LOCK_TTL;
  }

  // ---------------------------------------------------------------------------
  // Event Routing
  // ---------------------------------------------------------------------------

  /**
   * Check if event type is supported
   */
  private isSupportedEvent(eventType: string): eventType is NormalizedEventType {
    return (SUPPORTED_EVENTS as string[]).includes(eventType);
  }

  /**
   * Route event to appropriate handler
   */
  private async handleEvent(event: ProviderWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.created':
        await this.handleSubscriptionCreated(event);
        break;

      case 'subscription.activated':
        await this.handleSubscriptionActivated(event);
        break;

      case 'subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;

      case 'subscription.canceled':
        await this.handleSubscriptionCanceled(event);
        break;

      case 'payment.completed':
        await this.handlePaymentCompleted(event);
        break;

      case 'payment.failed':
        await this.handlePaymentFailed(event);
        break;

      default:
        logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle subscription.created
   * Creates initial subscription record
   */
  private async handleSubscriptionCreated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.community_id;
    const tier = customData?.tier as SubscriptionTier;

    if (!communityId) {
      logger.warn(
        { eventId: event.id },
        'Subscription created event missing community_id metadata'
      );
      return;
    }

    const subscriptionId = data.id as string;
    const customerId = data.customerId as string;

    // Check if subscription already exists
    const existing = getSubscriptionByCommunityId(communityId);

    if (existing) {
      // Update existing subscription
      updateSubscription(communityId, {
        paymentCustomerId: customerId,
        paymentSubscriptionId: subscriptionId,
        paymentProvider: 'paddle',
        tier: tier || existing.tier,
        status: 'trialing', // Created but not yet activated
      });
    } else {
      // Create new subscription
      createSubscription({
        communityId,
        paymentCustomerId: customerId,
        paymentSubscriptionId: subscriptionId,
        paymentProvider: 'paddle',
        tier: tier || 'basic',
        status: 'trialing',
      });
    }

    // Log audit event
    logBillingAuditEvent(
      'subscription_created',
      {
        communityId,
        tier,
        paymentCustomerId: customerId,
        paymentSubscriptionId: subscriptionId,
        paymentProvider: 'paddle',
      },
      communityId
    );

    logger.info(
      { communityId, tier, subscriptionId },
      'Subscription created'
    );
  }

  /**
   * Handle subscription.activated
   * Updates subscription to active status
   */
  private async handleSubscriptionActivated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.community_id;

    if (!communityId) {
      logger.warn(
        { eventId: event.id },
        'Subscription activated event missing community_id metadata'
      );
      return;
    }

    const subscriptionId = data.id as string;
    const currentBillingPeriod = data.currentBillingPeriod as { startsAt: string; endsAt: string } | undefined;

    updateSubscription(communityId, {
      status: 'active',
      graceUntil: null, // Clear any grace period
      currentPeriodStart: currentBillingPeriod ? new Date(currentBillingPeriod.startsAt) : undefined,
      currentPeriodEnd: currentBillingPeriod ? new Date(currentBillingPeriod.endsAt) : undefined,
    });

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'subscription_activated',
      {
        communityId,
        paymentSubscriptionId: subscriptionId,
        paymentProvider: 'paddle',
      },
      communityId
    );

    logger.info(
      { communityId, subscriptionId },
      'Subscription activated'
    );
  }

  /**
   * Handle subscription.updated
   * Updates tier, status, and period information
   */
  private async handleSubscriptionUpdated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.community_id;

    if (!communityId) {
      logger.warn(
        { eventId: event.id },
        'Subscription updated event missing community_id metadata'
      );
      return;
    }

    const subscriptionId = data.id as string;
    const status = data.status as string;
    const tier = customData?.tier as SubscriptionTier | undefined;
    const currentBillingPeriod = data.currentBillingPeriod as { startsAt: string; endsAt: string } | undefined;
    const scheduledChange = data.scheduledChange as { action: string } | null;

    const provider = this.getProvider();
    const mappedStatus = provider.mapSubscriptionStatus(status);

    updateSubscription(communityId, {
      tier: tier || undefined,
      status: mappedStatus,
      currentPeriodStart: currentBillingPeriod ? new Date(currentBillingPeriod.startsAt) : undefined,
      currentPeriodEnd: currentBillingPeriod ? new Date(currentBillingPeriod.endsAt) : undefined,
      // Clear grace period if subscription is now active
      graceUntil: mappedStatus === 'active' ? null : undefined,
    });

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'subscription_updated',
      {
        communityId,
        tier,
        status: mappedStatus,
        cancelAtPeriodEnd: scheduledChange?.action === 'cancel',
        paymentProvider: 'paddle',
      },
      communityId
    );

    logger.info(
      {
        communityId,
        tier,
        status: mappedStatus,
        cancelAtPeriodEnd: scheduledChange?.action === 'cancel',
      },
      'Subscription updated'
    );
  }

  /**
   * Handle subscription.canceled
   * Downgrades to starter (free) tier and sets status to canceled
   */
  private async handleSubscriptionCanceled(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.community_id;

    if (!communityId) {
      logger.warn(
        { eventId: event.id },
        'Subscription canceled event missing community_id metadata'
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
        paymentProvider: 'paddle',
      },
      communityId
    );

    logger.info({ communityId }, 'Subscription canceled, downgraded to starter tier');
  }

  /**
   * Handle payment.completed (transaction.completed in Paddle)
   * Routes to appropriate handler based on payment type
   */
  private async handlePaymentCompleted(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const paymentType = customData?.type;

    // Route to boost payment handler for boost purchases
    if (paymentType === 'boost_purchase') {
      await this.handleBoostPaymentCompleted(event);
      return;
    }

    // Route to badge payment handler for badge purchases
    if (paymentType === 'badge_purchase') {
      await this.handleBadgePaymentCompleted(event);
      return;
    }

    // Handle as subscription payment
    const communityId = customData?.community_id;
    const subscriptionId = data.subscriptionId as string | undefined;

    if (!communityId && !subscriptionId) {
      logger.debug({ eventId: event.id }, 'Payment completed without community context');
      return;
    }

    // For subscription payments, update period and clear grace
    if (subscriptionId) {
      // Find subscription by payment subscription ID
      const subscription = getSubscriptionByPaymentId(subscriptionId);

      if (subscription) {
        updateSubscription(subscription.communityId, {
          status: 'active',
          graceUntil: null,
        });

        // Invalidate entitlement cache
        await redisService.invalidateEntitlements(subscription.communityId);

        // Log audit event
        logBillingAuditEvent(
          'payment_succeeded',
          {
            communityId: subscription.communityId,
            transactionId: data.id as string,
            paymentProvider: 'paddle',
          },
          subscription.communityId
        );

        logger.info(
          { communityId: subscription.communityId, transactionId: data.id },
          'Payment completed, grace period cleared'
        );
      }
    }
  }

  /**
   * Handle payment.failed
   * Sets 24-hour grace period and updates status to past_due
   */
  private async handlePaymentFailed(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const subscriptionId = data.subscriptionId as string | undefined;

    if (!subscriptionId) {
      logger.debug(
        { eventId: event.id },
        'Payment failed not associated with subscription'
      );
      return;
    }

    // Find subscription by payment subscription ID
    const subscription = getSubscriptionByPaymentId(subscriptionId);

    if (!subscription) {
      logger.warn({ subscriptionId }, 'Subscription not found for failed payment');
      return;
    }

    // Set grace period (24 hours from now)
    const graceUntil = new Date(Date.now() + GRACE_PERIOD_MS);

    updateSubscription(subscription.communityId, {
      status: 'past_due',
      graceUntil,
    });

    // Invalidate entitlement cache (grace period affects entitlements)
    await redisService.invalidateEntitlements(subscription.communityId);

    // Log audit events
    logBillingAuditEvent(
      'payment_failed',
      {
        communityId: subscription.communityId,
        transactionId: data.id as string,
        graceUntil: graceUntil.toISOString(),
        paymentProvider: 'paddle',
      },
      subscription.communityId
    );

    logBillingAuditEvent(
      'grace_period_started',
      {
        communityId: subscription.communityId,
        graceUntil: graceUntil.toISOString(),
      },
      subscription.communityId
    );

    logger.warn(
      {
        communityId: subscription.communityId,
        transactionId: data.id,
        graceUntil,
      },
      'Payment failed, grace period started'
    );
  }

  /**
   * Handle boost purchase payment completion
   * Records boost purchase and updates community stats
   */
  private async handleBoostPaymentCompleted(
    event: ProviderWebhookEvent
  ): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.community_id;
    const memberId = customData?.member_id;
    const months = parseInt(customData?.months || '0', 10);

    if (!communityId || !memberId || !months) {
      logger.warn(
        { eventId: event.id, customData },
        'Boost payment missing required metadata'
      );
      return;
    }

    // Get payment details from transaction
    const transactionId = data.id as string;
    const details = data.details as { totals?: { total?: string } } | undefined;
    const amountPaid = details?.totals?.total
      ? parseInt(details.totals.total, 10)
      : 0;

    try {
      // Process the boost payment through BoostService
      const purchase = await boostService.processBoostPayment({
        sessionId: transactionId,
        paymentId: transactionId,
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
          transactionId,
        },
        'Boost payment processed successfully'
      );
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          transactionId,
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
    event: ProviderWebhookEvent
  ): Promise<void> {
    const data = event.data as Record<string, unknown>;
    const customData = data.customData as Record<string, string> | undefined;
    const communityId = customData?.communityId || customData?.community_id;
    const memberId = customData?.memberId || customData?.member_id;

    if (!communityId || !memberId) {
      logger.warn(
        { eventId: event.id, customData },
        'Badge payment missing required metadata'
      );
      return;
    }

    const transactionId = data.id as string;

    try {
      // Import badge service dynamically to avoid circular dependency
      const { badgeService } = await import('../badge/BadgeService.js');

      // Record the badge purchase
      badgeService.recordBadgePurchase({
        memberId,
        paymentId: transactionId,
      });

      logger.info(
        {
          communityId,
          memberId,
          transactionId,
        },
        'Badge payment processed successfully'
      );
    } catch (error) {
      logger.error(
        {
          error: (error as Error).message,
          transactionId,
          communityId,
          memberId,
        },
        'Failed to process badge payment'
      );
      throw error;
    }
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const webhookService = new WebhookService();
