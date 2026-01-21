/**
 * Crypto Webhook Service (Sprint 157: NOWPayments Integration)
 *
 * Processes NOWPayments webhooks with LVVER pattern:
 * - Signature verification via ICryptoPaymentProvider
 * - Idempotent event processing (Redis + database deduplication)
 * - Payment status updates and subscription activation
 * - Entitlement cache invalidation on payment completion
 *
 * LVVER Pattern (Lock-Verify-Validate-Execute-Record):
 * 1. LOCK: Acquire distributed lock FIRST (prevents TOCTOU)
 * 2. VERIFY: Check Redis and database for duplicates UNDER LOCK
 * 3. VALIDATE: Validate event payload
 * 4. EXECUTE: Process the payment status update
 * 5. RECORD: Persist to database and mark in Redis
 * 6. UNLOCK: Release lock in finally block (guaranteed)
 *
 * Supported payment statuses:
 * - waiting: Payment created, awaiting funds
 * - confirming: Payment received, awaiting confirmations
 * - confirmed: Payment confirmed
 * - sending: Sending to merchant
 * - finished: Payment complete - ACTIVATE SUBSCRIPTION
 * - partially_paid: Partial payment received
 * - failed: Payment failed
 * - refunded: Payment refunded
 * - expired: Payment expired
 */

import { redisService } from '../cache/RedisService.js';
import {
  getCryptoPaymentByPaymentId,
  getCryptoPaymentByOrderId,
  updateCryptoPaymentStatus,
  logBillingAuditEvent,
  getSubscriptionByCommunityId,
  createSubscription,
  updateSubscription,
} from '../../db/billing-queries.js';
import { logger } from '../../utils/logger.js';
import type {
  ICryptoPaymentProvider,
  CryptoWebhookEvent,
  CryptoPaymentStatus,
} from '../../packages/core/ports/ICryptoPaymentProvider.js';

// =============================================================================
// Constants
// =============================================================================

/** Default lock TTL in seconds (30 seconds for standard webhooks) */
const DEFAULT_LOCK_TTL = 30;

/**
 * Maximum event age in milliseconds (10 minutes for crypto payments)
 *
 * Crypto payments have longer processing times due to blockchain confirmations,
 * so we use a longer window than standard webhooks (5 minutes).
 */
const MAX_EVENT_AGE_MS = 10 * 60 * 1000;

/** Cache TTL for processed events in seconds (24 hours) */
const PROCESSED_EVENT_CACHE_TTL = 24 * 60 * 60;

// =============================================================================
// Types
// =============================================================================

/**
 * Crypto webhook processing result
 */
export interface CryptoWebhookResult {
  /** Processing status */
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  /** Payment ID */
  paymentId: string;
  /** Payment status */
  paymentStatus: CryptoPaymentStatus;
  /** Optional message */
  message?: string;
  /** Error if failed */
  error?: string;
}

// =============================================================================
// Crypto Webhook Service Class
// =============================================================================

class CryptoWebhookService {
  private cryptoProvider: ICryptoPaymentProvider | null = null;

  /**
   * Set the crypto payment provider (dependency injection)
   */
  setCryptoProvider(provider: ICryptoPaymentProvider): void {
    this.cryptoProvider = provider;
  }

  /**
   * Get the crypto provider
   */
  private getProvider(): ICryptoPaymentProvider {
    if (!this.cryptoProvider) {
      throw new Error(
        'Crypto payment provider not configured. Call setCryptoProvider first.'
      );
    }
    return this.cryptoProvider;
  }

  // ---------------------------------------------------------------------------
  // Signature Verification
  // ---------------------------------------------------------------------------

  /**
   * Verify webhook signature and parse event
   *
   * @param payload - Raw request body (string or Buffer)
   * @param signature - x-nowpayments-sig header value
   * @returns Verified crypto webhook event
   * @throws Error if signature invalid
   */
  verifySignature(payload: string | Buffer, signature: string): CryptoWebhookEvent {
    const provider = this.getProvider();
    const result = provider.verifyWebhook(payload, signature);

    if (!result.valid || !result.event) {
      logger.warn({ error: result.error }, 'Invalid crypto webhook signature');
      throw new Error(result.error || 'Invalid webhook signature');
    }

    return result.event;
  }

  // ---------------------------------------------------------------------------
  // Event Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a crypto webhook event with LVVER pattern
   *
   * LVVER Flow:
   * 1. LOCK: Acquire Redis lock for payment (FIRST - prevents TOCTOU)
   * 2. VERIFY: Check Redis for payment+status key (fast)
   * 3. VERIFY: Check database for current payment status
   * 4. VALIDATE: Verify status transition is valid
   * 5. EXECUTE: Update payment status and activate subscription if finished
   * 6. RECORD: Mark in Redis cache
   * 7. UNLOCK: Release lock (in finally block - guaranteed)
   *
   * @param event - Verified crypto webhook event
   * @returns Processing result
   */
  async processEvent(event: CryptoWebhookEvent): Promise<CryptoWebhookResult> {
    const paymentId = event.paymentId;
    const paymentStatus = event.status;

    logger.info(
      {
        paymentId,
        paymentStatus,
        actuallyPaid: event.actuallyPaid,
        orderId: event.orderId,
      },
      'Processing crypto webhook event'
    );

    // ==========================================================================
    // STEP 1 - LOCK: Acquire distributed lock FIRST (LVVER pattern)
    // Use payment ID as lock key to prevent concurrent processing
    // ==========================================================================
    const lockKey = `crypto:${paymentId}`;
    const lockAcquired = await redisService.acquireEventLock(lockKey, DEFAULT_LOCK_TTL);

    if (!lockAcquired) {
      logger.debug({ paymentId }, 'Crypto payment lock held by another process');
      return {
        status: 'duplicate',
        paymentId,
        paymentStatus,
        message: 'Payment being processed by another instance',
      };
    }

    try {
      // ========================================================================
      // STEP 1.5 - TIMESTAMP CHECK: Reject stale events (replay prevention)
      // ========================================================================
      const eventAge = Date.now() - event.timestamp.getTime();
      if (eventAge > MAX_EVENT_AGE_MS) {
        logger.warn(
          {
            paymentId,
            paymentStatus,
            eventTimestamp: event.timestamp.toISOString(),
            ageMs: eventAge,
            maxAgeMs: MAX_EVENT_AGE_MS,
          },
          'Rejecting stale crypto webhook event (potential replay attack)'
        );
        return {
          status: 'failed',
          paymentId,
          paymentStatus,
          error: 'Event timestamp too old - possible replay attack',
        };
      }

      // ========================================================================
      // STEP 2 - VERIFY: Check Redis for this payment+status combo (fast path)
      // ========================================================================
      const cacheKey = `crypto:processed:${paymentId}:${paymentStatus}`;
      if (await redisService.isEventProcessed(cacheKey)) {
        logger.debug(
          { paymentId, paymentStatus },
          'Crypto status already processed (Redis cache hit)'
        );
        return {
          status: 'duplicate',
          paymentId,
          paymentStatus,
          message: 'Status already processed (Redis)',
        };
      }

      // ========================================================================
      // STEP 3 - VERIFY: Get current payment from database
      // ========================================================================
      const payment = getCryptoPaymentByPaymentId(paymentId);

      if (!payment) {
        // Try to find by order ID as fallback
        const paymentByOrder = getCryptoPaymentByOrderId(event.orderId);
        if (!paymentByOrder) {
          logger.warn({ paymentId, orderId: event.orderId }, 'Crypto payment not found');
          return {
            status: 'failed',
            paymentId,
            paymentStatus,
            error: 'Payment not found in database',
          };
        }
      }

      const existingPayment = payment || getCryptoPaymentByOrderId(event.orderId)!;

      // ========================================================================
      // STEP 4 - VALIDATE: Check status transition is valid
      // ========================================================================
      if (!this.isValidStatusTransition(existingPayment.status, paymentStatus)) {
        logger.debug(
          {
            paymentId,
            currentStatus: existingPayment.status,
            newStatus: paymentStatus,
          },
          'Invalid or duplicate status transition'
        );
        return {
          status: 'skipped',
          paymentId,
          paymentStatus,
          message: `Invalid transition from ${existingPayment.status} to ${paymentStatus}`,
        };
      }

      // ========================================================================
      // STEP 5 - EXECUTE: Update payment status and handle completion
      // ========================================================================
      const isCompleted = paymentStatus === 'finished';

      // Update payment status in database
      updateCryptoPaymentStatus(paymentId, {
        status: paymentStatus,
        actuallyPaid: event.actuallyPaid,
        finishedAt: isCompleted ? new Date() : undefined,
      });

      // If payment finished, activate subscription
      if (isCompleted) {
        await this.activateSubscription(existingPayment.communityId, existingPayment.tier);
      }

      // Log audit event - use appropriate event type based on status
      const auditEventType = isCompleted
        ? 'crypto_payment_completed'
        : paymentStatus === 'failed'
          ? 'crypto_payment_failed'
          : paymentStatus === 'expired'
            ? 'crypto_payment_expired'
            : 'crypto_payment_status_updated';

      logBillingAuditEvent(
        auditEventType,
        {
          paymentId,
          communityId: existingPayment.communityId,
          tier: existingPayment.tier,
          actuallyPaid: event.actuallyPaid,
          payCurrency: event.payCurrency,
          priceAmount: event.priceAmount,
          newStatus: paymentStatus,
          paymentProvider: 'nowpayments',
        },
        existingPayment.communityId
      );

      // ========================================================================
      // STEP 6 - RECORD: Mark in Redis cache
      // ========================================================================
      await redisService.set(cacheKey, '1', PROCESSED_EVENT_CACHE_TTL);

      logger.info(
        {
          paymentId,
          paymentStatus,
          communityId: existingPayment.communityId,
          isCompleted,
        },
        'Crypto webhook event processed successfully'
      );

      return {
        status: 'processed',
        paymentId,
        paymentStatus,
        message: isCompleted ? 'Payment complete, subscription activated' : undefined,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(
        { paymentId, paymentStatus, error: errorMessage },
        'Failed to process crypto webhook event'
      );

      // Log failed processing
      logBillingAuditEvent('crypto_webhook_failed', {
        paymentId,
        paymentStatus,
        error: errorMessage,
        paymentProvider: 'nowpayments',
      });

      return {
        status: 'failed',
        paymentId,
        paymentStatus,
        error: errorMessage,
      };
    } finally {
      // ========================================================================
      // STEP 7 - UNLOCK: Release lock (guaranteed cleanup)
      // ========================================================================
      await redisService.releaseEventLock(lockKey);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscription Activation
  // ---------------------------------------------------------------------------

  /**
   * Activate or create subscription for community after successful payment
   */
  private async activateSubscription(
    communityId: string,
    tier: string
  ): Promise<void> {
    logger.info(
      { communityId, tier },
      'Activating subscription from crypto payment'
    );

    // Calculate period dates (30 days from now)
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Check if subscription exists
    const existing = getSubscriptionByCommunityId(communityId);

    if (existing) {
      // Update existing subscription
      updateSubscription(communityId, {
        paymentProvider: 'nowpayments',
        tier: tier as 'starter' | 'basic' | 'premium' | 'exclusive' | 'elite' | 'enterprise',
        status: 'active',
        graceUntil: null,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      });

      logger.info(
        { communityId, tier, action: 'updated' },
        'Subscription updated from crypto payment'
      );
    } else {
      // Create new subscription
      createSubscription({
        communityId,
        paymentProvider: 'nowpayments',
        tier: tier as 'starter' | 'basic' | 'premium' | 'exclusive' | 'elite' | 'enterprise',
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      });

      logger.info(
        { communityId, tier, action: 'created' },
        'Subscription created from crypto payment'
      );
    }

    // Invalidate entitlement cache
    await redisService.invalidateEntitlements(communityId);

    // Log audit event
    logBillingAuditEvent(
      'subscription_activated_crypto',
      {
        communityId,
        tier,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        paymentProvider: 'nowpayments',
      },
      communityId
    );
  }

  // ---------------------------------------------------------------------------
  // Validation Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a status transition is valid
   *
   * Valid transitions (NOWPayments flow):
   * waiting → confirming → confirmed → sending → finished
   * waiting → partially_paid
   * waiting → expired
   * any → failed
   * any → refunded
   */
  private isValidStatusTransition(
    current: CryptoPaymentStatus,
    next: CryptoPaymentStatus
  ): boolean {
    // Same status = duplicate webhook
    if (current === next) {
      return false;
    }

    // Terminal states cannot transition further
    const terminalStates: CryptoPaymentStatus[] = ['finished', 'failed', 'refunded', 'expired'];
    if (terminalStates.includes(current)) {
      return false;
    }

    // Failed and refunded can happen from any non-terminal state
    if (next === 'failed' || next === 'refunded') {
      return true;
    }

    // Define valid transitions
    const validTransitions: Record<CryptoPaymentStatus, CryptoPaymentStatus[]> = {
      waiting: ['confirming', 'partially_paid', 'expired', 'finished'],
      confirming: ['confirmed', 'finished'],
      confirmed: ['sending', 'finished'],
      sending: ['finished'],
      partially_paid: ['confirming', 'confirmed', 'sending', 'finished'],
      finished: [],
      failed: [],
      refunded: [],
      expired: [],
    };

    return validTransitions[current]?.includes(next) ?? false;
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const cryptoWebhookService = new CryptoWebhookService();
