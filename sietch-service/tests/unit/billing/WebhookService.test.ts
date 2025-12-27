/**
 * WebhookService Tests (v4.0 - Sprint 24)
 *
 * Tests for Stripe webhook processing with idempotency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';

// Mock dependencies
vi.mock('../StripeService.js', () => ({
  stripeService: {
    constructWebhookEvent: vi.fn(),
    getStripeSubscription: vi.fn(),
    mapSubscriptionStatus: vi.fn(),
    extractTierFromSubscription: vi.fn(),
  },
}));

vi.mock('../../cache/RedisService.js', () => ({
  redisService: {
    isEventProcessed: vi.fn(),
    markEventProcessed: vi.fn(),
    acquireEventLock: vi.fn(),
    releaseEventLock: vi.fn(),
    invalidateEntitlements: vi.fn(),
  },
}));

vi.mock('../../../db/billing-queries.js', () => ({
  isWebhookEventProcessed: vi.fn(),
  recordWebhookEvent: vi.fn(),
  getSubscriptionByCommunityId: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  logBillingAuditEvent: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WebhookService', () => {
  let webhookService: any;
  let mockStripeService: any;
  let mockRedisService: any;
  let mockBillingQueries: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import modules
    const webhookModule = await import('../WebhookService.js');
    const stripeModule = await import('../StripeService.js');
    const redisModule = await import('../../cache/RedisService.js');
    const queriesModule = await import('../../../db/billing-queries.js');

    webhookService = webhookModule.webhookService;
    mockStripeService = stripeModule.stripeService;
    mockRedisService = redisModule.redisService;
    mockBillingQueries = queriesModule;

    // Setup default mocks
    mockRedisService.isEventProcessed.mockResolvedValue(false);
    mockRedisService.acquireEventLock.mockResolvedValue(true);
    mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
  });

  // ===========================================================================
  // Signature Verification
  // ===========================================================================

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const mockEvent = { id: 'evt_test', type: 'invoice.paid' };
      mockStripeService.constructWebhookEvent.mockReturnValue(mockEvent);

      const result = webhookService.verifySignature('raw-body', 'signature');
      expect(result).toEqual(mockEvent);
      expect(mockStripeService.constructWebhookEvent).toHaveBeenCalledWith(
        'raw-body',
        'signature'
      );
    });

    it('should throw error on invalid signature', () => {
      mockStripeService.constructWebhookEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      expect(() => {
        webhookService.verifySignature('raw-body', 'bad-signature');
      }).toThrow('Invalid webhook signature');
    });
  });

  // ===========================================================================
  // Event Processing - Idempotency
  // ===========================================================================

  describe('processEvent - idempotency', () => {
    it('should reject duplicate event from Redis', async () => {
      mockRedisService.isEventProcessed.mockResolvedValue(true);

      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: { object: {} },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('Redis');
    });

    it('should reject duplicate event from database', async () => {
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(true);

      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: { object: {} },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('database');
      expect(mockRedisService.markEventProcessed).toHaveBeenCalledWith('evt_test');
    });

    it('should reject event if lock not acquired', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(false);

      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: { object: {} },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('another instance');
    });

    it('should skip unsupported event types', async () => {
      const event = {
        id: 'evt_test',
        type: 'customer.created',
        data: { object: {} },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('skipped');
      expect(result.message).toContain('Unsupported');
    });

    it('should process new event successfully', async () => {
      const event = {
        id: 'evt_test',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {
              community_id: 'test-community',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');
      expect(mockBillingQueries.recordWebhookEvent).toHaveBeenCalled();
      expect(mockRedisService.markEventProcessed).toHaveBeenCalled();
      expect(mockRedisService.releaseEventLock).toHaveBeenCalled();
    });

    it('should release lock even on error', async () => {
      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: { object: {} },
      } as unknown as Stripe.Event;

      // Simulate error in handler
      mockStripeService.getStripeSubscription.mockRejectedValue(
        new Error('Stripe API error')
      );

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('failed');
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_test');
    });
  });

  // ===========================================================================
  // Event Handlers - checkout.session.completed
  // ===========================================================================

  describe('handleCheckoutCompleted', () => {
    it('should create new subscription', async () => {
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const event = {
        id: 'evt_test',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {
              community_id: 'test-community',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      expect(mockBillingQueries.createSubscription).toHaveBeenCalledWith({
        communityId: 'test-community',
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: 'sub_test',
        tier: 'premium',
        status: 'active',
      });
      expect(mockRedisService.invalidateEntitlements).toHaveBeenCalledWith(
        'test-community'
      );
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'subscription_created',
        expect.any(Object),
        'test-community'
      );
    });

    it('should update existing subscription', async () => {
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue({
        id: 'existing',
        tier: 'basic',
      });

      const event = {
        id: 'evt_test',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {
              community_id: 'test-community',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'test-community',
        {
          stripeCustomerId: 'cus_test',
          stripeSubscriptionId: 'sub_test',
          tier: 'premium',
          status: 'active',
          graceUntil: null,
        }
      );
    });

    it('should skip if no community_id in metadata', async () => {
      const event = {
        id: 'evt_test',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {},
          },
        },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');
      expect(mockBillingQueries.createSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Event Handlers - invoice.paid
  // ===========================================================================

  describe('handleInvoicePaid', () => {
    it('should clear grace period and update period', async () => {
      const subscription = {
        id: 'sub_test',
        metadata: { community_id: 'test-community' },
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      };

      mockStripeService.getStripeSubscription.mockResolvedValue(subscription);

      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test',
            subscription: 'sub_test',
            amount_paid: 3500,
            currency: 'usd',
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'test-community',
        {
          status: 'active',
          graceUntil: null,
          currentPeriodStart: expect.any(Date),
          currentPeriodEnd: expect.any(Date),
        }
      );
      expect(mockRedisService.invalidateEntitlements).toHaveBeenCalled();
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'payment_succeeded',
        expect.any(Object),
        'test-community'
      );
    });

    it('should skip if no subscription', async () => {
      const event = {
        id: 'evt_test',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test',
            subscription: null,
          },
        },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Event Handlers - invoice.payment_failed
  // ===========================================================================

  describe('handleInvoicePaymentFailed', () => {
    it('should set 24-hour grace period', async () => {
      const subscription = {
        id: 'sub_test',
        metadata: { community_id: 'test-community' },
      };

      mockStripeService.getStripeSubscription.mockResolvedValue(subscription);

      const event = {
        id: 'evt_test',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test',
            subscription: 'sub_test',
            attempt_count: 2,
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      const updateCall = mockBillingQueries.updateSubscription.mock.calls[0];
      expect(updateCall[0]).toBe('test-community');
      expect(updateCall[1]).toMatchObject({
        status: 'past_due',
      });
      expect(updateCall[1].graceUntil).toBeInstanceOf(Date);

      // Grace period should be ~24 hours from now
      const gracePeriod = updateCall[1].graceUntil.getTime() - Date.now();
      expect(gracePeriod).toBeGreaterThan(23.9 * 60 * 60 * 1000);
      expect(gracePeriod).toBeLessThan(24.1 * 60 * 60 * 1000);

      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'payment_failed',
        expect.any(Object),
        'test-community'
      );
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'grace_period_started',
        expect.any(Object),
        'test-community'
      );
    });
  });

  // ===========================================================================
  // Event Handlers - customer.subscription.updated
  // ===========================================================================

  describe('handleSubscriptionUpdated', () => {
    it('should update tier and status', async () => {
      mockStripeService.extractTierFromSubscription.mockReturnValue('premium');
      mockStripeService.mapSubscriptionStatus.mockReturnValue('active');

      const event = {
        id: 'evt_test',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test',
            metadata: { community_id: 'test-community' },
            status: 'active',
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            cancel_at_period_end: false,
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'test-community',
        {
          tier: 'premium',
          status: 'active',
          currentPeriodStart: expect.any(Date),
          currentPeriodEnd: expect.any(Date),
          graceUntil: null,
        }
      );
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'subscription_updated',
        expect.any(Object),
        'test-community'
      );
    });
  });

  // ===========================================================================
  // Event Handlers - customer.subscription.deleted
  // ===========================================================================

  describe('handleSubscriptionDeleted', () => {
    it('should downgrade to starter tier', async () => {
      const event = {
        id: 'evt_test',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test',
            metadata: { community_id: 'test-community' },
          },
        },
      } as unknown as Stripe.Event;

      await webhookService.processEvent(event);

      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'test-community',
        {
          status: 'canceled',
          tier: 'starter',
          graceUntil: null,
        }
      );
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'subscription_canceled',
        expect.any(Object),
        'test-community'
      );
    });
  });
});
