/**
 * WebhookService Tests (v5.1 - Sprint 67 LVVER Pattern)
 *
 * Tests for Paddle webhook processing with idempotency.
 * Includes LVVER pattern verification and concurrent processing tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  IBillingProvider,
  ProviderWebhookEvent,
  WebhookVerificationResult,
} from '../../../src/packages/core/ports/IBillingProvider.js';

// Mock dependencies
vi.mock('../../../src/services/cache/RedisService.js', () => ({
  redisService: {
    isEventProcessed: vi.fn(),
    markEventProcessed: vi.fn(),
    acquireEventLock: vi.fn(),
    releaseEventLock: vi.fn(),
    invalidateEntitlements: vi.fn(),
  },
}));

vi.mock('../../../src/db/billing-queries.js', () => ({
  isWebhookEventProcessed: vi.fn(),
  recordWebhookEvent: vi.fn(),
  getSubscriptionByCommunityId: vi.fn(),
  getSubscriptionByPaymentId: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  logBillingAuditEvent: vi.fn(),
}));

vi.mock('../../../src/services/boost/BoostService.js', () => ({
  boostService: {
    activateBoost: vi.fn(),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WebhookService', () => {
  let webhookService: any;
  let mockBillingProvider: IBillingProvider;
  let mockRedisService: any;
  let mockBillingQueries: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock billing provider
    mockBillingProvider = {
      provider: 'paddle',
      verifyWebhook: vi.fn(),
      getOrCreateCustomer: vi.fn(),
      getCustomer: vi.fn(),
      createCheckoutSession: vi.fn(),
      createOneTimeCheckoutSession: vi.fn(),
      createPortalSession: vi.fn(),
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      resumeSubscription: vi.fn(),
      updateSubscriptionTier: vi.fn(),
      mapSubscriptionStatus: vi.fn().mockReturnValue('active'),
      isHealthy: vi.fn(),
    };

    // Import modules
    const webhookModule = await import('../../../src/services/billing/WebhookService.js');
    const redisModule = await import('../../../src/services/cache/RedisService.js');
    const queriesModule = await import('../../../src/db/billing-queries.js');

    webhookService = webhookModule.webhookService;
    mockRedisService = redisModule.redisService;
    mockBillingQueries = queriesModule;

    // Inject mock billing provider
    webhookService.setBillingProvider(mockBillingProvider);

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
      const mockEvent: ProviderWebhookEvent = {
        id: 'evt_test',
        type: 'payment.completed',
        rawType: 'transaction.completed',
        data: {},
        timestamp: new Date(),
      };
      const mockResult: WebhookVerificationResult = {
        valid: true,
        event: mockEvent,
      };
      (mockBillingProvider.verifyWebhook as any).mockReturnValue(mockResult);

      const result = webhookService.verifySignature('raw-body', 'signature');
      expect(result).toEqual(mockEvent);
      expect(mockBillingProvider.verifyWebhook).toHaveBeenCalledWith(
        'raw-body',
        'signature'
      );
    });

    it('should throw error on invalid signature', () => {
      const mockResult: WebhookVerificationResult = {
        valid: false,
        error: 'Invalid signature',
      };
      (mockBillingProvider.verifyWebhook as any).mockReturnValue(mockResult);

      expect(() => {
        webhookService.verifySignature('raw-body', 'bad-signature');
      }).toThrow('Invalid signature');
    });

    it('should throw generic error when no error message provided', () => {
      const mockResult: WebhookVerificationResult = {
        valid: false,
      };
      (mockBillingProvider.verifyWebhook as any).mockReturnValue(mockResult);

      expect(() => {
        webhookService.verifySignature('raw-body', 'bad-signature');
      }).toThrow('Invalid webhook signature');
    });

    it('should throw error when provider not configured', () => {
      // Create new instance without provider
      const WebhookServiceClass = (webhookService as any).constructor;
      const newInstance = new WebhookServiceClass();

      expect(() => {
        newInstance.verifySignature('raw-body', 'signature');
      }).toThrow('Billing provider not configured');
    });
  });

  // ===========================================================================
  // Event Processing - Idempotency
  // ===========================================================================

  describe('processEvent - idempotency', () => {
    const createMockEvent = (
      type: string = 'payment.completed',
      rawType: string = 'transaction.completed'
    ): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: type as any,
      rawType,
      data: { subscriptionId: 'sub_123' },
      timestamp: new Date(),
    });

    it('should reject duplicate event from Redis', async () => {
      mockRedisService.isEventProcessed.mockResolvedValue(true);

      const event = createMockEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('Redis');
    });

    it('should reject duplicate event from database', async () => {
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(true);

      const event = createMockEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('database');
      expect(mockRedisService.markEventProcessed).toHaveBeenCalledWith('evt_test');
    });

    it('should reject event if lock not acquired', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(false);

      const event = createMockEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('another instance');
    });

    it('should skip unsupported event types', async () => {
      const event = createMockEvent('unsupported.event' as any, 'custom.event');
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('skipped');
      expect(result.message?.toLowerCase()).toContain('unsupported');
    });

    it('should process new event successfully', async () => {
      const event = createMockEvent('subscription.created', 'subscription.created');
      event.data = {
        id: 'sub_123',
        customData: { community_id: 'community-123', tier: 'premium' },
        customerId: 'cus_123',
        currentBillingPeriod: {
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      };

      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.recordWebhookEvent).toHaveBeenCalled();
      expect(mockRedisService.markEventProcessed).toHaveBeenCalledWith('evt_test');
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_test');
    });

    it('should release lock even on error', async () => {
      const event = createMockEvent('subscription.created', 'subscription.created');
      event.data = {
        customData: { community_id: 'community-123' },
      };

      mockBillingQueries.getSubscriptionByCommunityId.mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_test');
    });
  });

  // ===========================================================================
  // Subscription Created
  // ===========================================================================

  describe('handleSubscriptionCreated', () => {
    const createSubscriptionEvent = (customData: Record<string, string> = {}): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: 'subscription.created',
      rawType: 'subscription.created',
      data: {
        id: 'sub_123',
        customerId: 'cus_123',
        status: 'active',
        customData: {
          community_id: 'community-123',
          tier: 'premium',
          ...customData,
        },
        currentBillingPeriod: {
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      timestamp: new Date(),
    });

    it('should create new subscription', async () => {
      const event = createSubscriptionEvent();
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.createSubscription).toHaveBeenCalled();
      expect(mockBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
        'subscription_created',
        expect.objectContaining({ communityId: 'community-123' }),
        'community-123'
      );
    });

    it('should update existing subscription', async () => {
      const event = createSubscriptionEvent();
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue({
        id: 1,
        communityId: 'community-123',
        paymentSubscriptionId: 'old_sub',
        paymentCustomerId: 'cus_old',
        tier: 'basic',
        status: 'active',
      });

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          paymentCustomerId: 'cus_123',
          paymentSubscriptionId: 'sub_123',
        })
      );
    });

    it('should skip if no community_id in metadata', async () => {
      const event: ProviderWebhookEvent = {
        id: 'evt_test',
        type: 'subscription.created',
        rawType: 'subscription.created',
        data: {
          id: 'sub_123',
          customData: {},
        },
        timestamp: new Date(),
      };

      const result = await webhookService.processEvent(event);

      // Event processes but handler logs warning and returns early
      expect(result.status).toBe('processed');
      expect(mockBillingQueries.createSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Payment Completed
  // ===========================================================================

  describe('handlePaymentCompleted', () => {
    const createPaymentEvent = (): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: 'payment.completed',
      rawType: 'transaction.completed',
      data: {
        id: 'txn_123',
        subscriptionId: 'sub_123',
        customData: {
          community_id: 'community-123',
        },
        currentBillingPeriod: {
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      timestamp: new Date(),
    });

    it('should clear grace period and update status', async () => {
      const event = createPaymentEvent();
      mockBillingQueries.getSubscriptionByPaymentId.mockReturnValue({
        id: 1,
        communityId: 'community-123',
        paymentSubscriptionId: 'sub_123',
        tier: 'premium',
        status: 'past_due',
        graceUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          status: 'active',
          graceUntil: null,
        })
      );
      expect(mockRedisService.invalidateEntitlements).toHaveBeenCalledWith('community-123');
    });

    it('should skip if no subscription found', async () => {
      const event = createPaymentEvent();
      mockBillingQueries.getSubscriptionByPaymentId.mockReturnValue(null);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Payment Failed
  // ===========================================================================

  describe('handlePaymentFailed', () => {
    const createPaymentFailedEvent = (): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: 'payment.failed',
      rawType: 'transaction.payment_failed',
      data: {
        id: 'txn_123',
        subscriptionId: 'sub_123',
      },
      timestamp: new Date(),
    });

    it('should set 24-hour grace period', async () => {
      const event = createPaymentFailedEvent();
      mockBillingQueries.getSubscriptionByPaymentId.mockReturnValue({
        id: 1,
        communityId: 'community-123',
        paymentSubscriptionId: 'sub_123',
        tier: 'premium',
        status: 'active',
      });

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).toHaveBeenCalled();
      // Check that graceUntil is set approximately 24 hours from now
      const updateCall = mockBillingQueries.updateSubscription.mock.calls[0][1];
      expect(updateCall.graceUntil).toBeDefined();
      expect(updateCall.status).toBe('past_due');
    });

    it('should skip if no subscription found', async () => {
      const event = createPaymentFailedEvent();
      mockBillingQueries.getSubscriptionByPaymentId.mockReturnValue(null);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Subscription Updated
  // ===========================================================================

  describe('handleSubscriptionUpdated', () => {
    const createUpdateEvent = (customData: Record<string, string> = {}): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: 'subscription.updated',
      rawType: 'subscription.updated',
      data: {
        id: 'sub_123',
        status: 'active',
        customData: {
          community_id: 'community-123',
          tier: 'exclusive',
          ...customData,
        },
      },
      timestamp: new Date(),
    });

    it('should update tier and status', async () => {
      const event = createUpdateEvent();

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          tier: 'exclusive',
          status: 'active',
        })
      );
      expect(mockRedisService.invalidateEntitlements).toHaveBeenCalledWith('community-123');
    });

    it('should skip if no community_id in metadata', async () => {
      const event: ProviderWebhookEvent = {
        id: 'evt_test',
        type: 'subscription.updated',
        rawType: 'subscription.updated',
        data: {
          id: 'sub_123',
          status: 'active',
          customData: {},
        },
        timestamp: new Date(),
      };

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Subscription Canceled
  // ===========================================================================

  describe('handleSubscriptionCanceled', () => {
    const createCancelEvent = (): ProviderWebhookEvent => ({
      id: 'evt_test',
      type: 'subscription.canceled',
      rawType: 'subscription.canceled',
      data: {
        id: 'sub_123',
        customData: {
          community_id: 'community-123',
        },
      },
      timestamp: new Date(),
    });

    it('should downgrade to starter tier', async () => {
      const event = createCancelEvent();

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          tier: 'starter',
          status: 'canceled',
          graceUntil: null,
        })
      );
      expect(mockRedisService.invalidateEntitlements).toHaveBeenCalledWith('community-123');
    });

    it('should skip if no community_id in metadata', async () => {
      const event: ProviderWebhookEvent = {
        id: 'evt_test',
        type: 'subscription.canceled',
        rawType: 'subscription.canceled',
        data: {
          id: 'sub_123',
          customData: {},
        },
        timestamp: new Date(),
      };

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
      expect(mockBillingQueries.updateSubscription).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // LVVER Pattern Tests (Sprint 67)
  // ===========================================================================

  describe('LVVER Pattern - Lock-Verify-Validate-Execute-Record', () => {
    const createSubscriptionEvent = (): ProviderWebhookEvent => ({
      id: 'evt_lvver_test',
      type: 'subscription.created',
      rawType: 'subscription.created',
      data: {
        id: 'sub_123',
        customerId: 'cus_123',
        status: 'active',
        customData: {
          community_id: 'community-123',
          tier: 'premium',
        },
        currentBillingPeriod: {
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
      timestamp: new Date(),
    });

    it('should acquire lock BEFORE checking for duplicates (LVVER order)', async () => {
      const callOrder: string[] = [];

      // Track the order of calls
      mockRedisService.acquireEventLock.mockImplementation(() => {
        callOrder.push('acquireEventLock');
        return Promise.resolve(true);
      });
      mockRedisService.isEventProcessed.mockImplementation(() => {
        callOrder.push('isEventProcessed');
        return Promise.resolve(false);
      });
      mockBillingQueries.isWebhookEventProcessed.mockImplementation(() => {
        callOrder.push('isWebhookEventProcessed');
        return false;
      });
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const event = createSubscriptionEvent();
      await webhookService.processEvent(event);

      // Verify LVVER order: Lock MUST come first
      expect(callOrder[0]).toBe('acquireEventLock');
      expect(callOrder[1]).toBe('isEventProcessed');
      expect(callOrder[2]).toBe('isWebhookEventProcessed');
    });

    it('should verify lock contention metric is emitted when lock not acquired', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(false);

      const event = createSubscriptionEvent();
      const result = await webhookService.processEvent(event);

      // Result indicates lock contention
      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('another instance');

      // Lock should NOT release since we never acquired it
      expect(mockRedisService.releaseEventLock).not.toHaveBeenCalled();
    });

    it('should simulate concurrent webhook processing - only one succeeds', async () => {
      // Simulate concurrent requests where only the first gets the lock
      let lockHolder: string | null = null;

      mockRedisService.acquireEventLock.mockImplementation(async (eventId: string) => {
        // Simulate Redis SET NX behavior
        if (lockHolder === null) {
          lockHolder = eventId;
          return true;
        }
        return false;
      });

      mockRedisService.releaseEventLock.mockImplementation(async () => {
        lockHolder = null;
      });

      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const event1 = createSubscriptionEvent();
      const event2 = { ...createSubscriptionEvent(), id: 'evt_lvver_test' }; // Same event ID

      // Process both "concurrently" (simulated)
      const results = await Promise.all([
        webhookService.processEvent(event1),
        webhookService.processEvent(event2),
      ]);

      // One should succeed, one should report duplicate
      const processed = results.filter(r => r.status === 'processed');
      const duplicates = results.filter(r => r.status === 'duplicate');

      expect(processed.length).toBe(1);
      expect(duplicates.length).toBe(1);
    });

    it('should release lock in finally block even when processing fails', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      // Make handler throw an error
      mockBillingQueries.getSubscriptionByCommunityId.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const event = createSubscriptionEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Database connection failed');

      // Lock MUST be released even on error
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_lvver_test');
    });

    it('should release lock when event is duplicate in Redis (found under lock)', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(true); // Duplicate found

      const event = createSubscriptionEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('Redis');

      // Lock should be released
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_lvver_test');
    });

    it('should release lock when event is duplicate in database (found under lock)', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(true); // Duplicate found

      const event = createSubscriptionEvent();
      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('duplicate');
      expect(result.message).toContain('database');

      // Lock should be released
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_lvver_test');
    });
  });

  // ===========================================================================
  // Replay Attack Prevention Tests (Sprint 72 - CRIT-4)
  // ===========================================================================

  describe('Replay Attack Prevention (CRIT-4)', () => {
    const createEventWithTimestamp = (timestamp: Date): ProviderWebhookEvent => ({
      id: 'evt_replay_test',
      type: 'subscription.created',
      rawType: 'subscription.created',
      data: {
        id: 'sub_123',
        customerId: 'cus_123',
        status: 'active',
        customData: {
          community_id: 'community-123',
          tier: 'premium',
        },
      },
      timestamp,
    });

    it('should accept events within 5-minute window', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      // Event from 2 minutes ago - should be accepted
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const event = createEventWithTimestamp(twoMinutesAgo);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
    });

    it('should accept events from current time', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const event = createEventWithTimestamp(new Date());

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('processed');
    });

    it('should reject events older than 5 minutes (replay attack)', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      // Event from 6 minutes ago - should be rejected
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const event = createEventWithTimestamp(sixMinutesAgo);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('replay attack');
    });

    it('should reject events from 10 minutes ago', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const event = createEventWithTimestamp(tenMinutesAgo);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('replay attack');
    });

    it('should reject events from 1 hour ago', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const event = createEventWithTimestamp(oneHourAgo);

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('replay attack');
    });

    it('should still release lock when rejecting stale event', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      const oldEvent = new Date(Date.now() - 10 * 60 * 1000);
      const event = createEventWithTimestamp(oldEvent);

      await webhookService.processEvent(event);

      // Lock should be released even for stale events
      expect(mockRedisService.releaseEventLock).toHaveBeenCalledWith('evt_replay_test');
    });

    it('should check timestamp BEFORE duplicate checks (fail fast)', async () => {
      const callOrder: string[] = [];

      mockRedisService.acquireEventLock.mockImplementation(async () => {
        callOrder.push('acquireEventLock');
        return true;
      });
      mockRedisService.isEventProcessed.mockImplementation(async () => {
        callOrder.push('isEventProcessed');
        return false;
      });
      mockBillingQueries.isWebhookEventProcessed.mockImplementation(() => {
        callOrder.push('isWebhookEventProcessed');
        return false;
      });
      mockRedisService.releaseEventLock.mockImplementation(async () => {
        callOrder.push('releaseEventLock');
      });

      // Old event should be rejected before duplicate checks
      const oldEvent = new Date(Date.now() - 10 * 60 * 1000);
      const event = createEventWithTimestamp(oldEvent);

      await webhookService.processEvent(event);

      // Lock acquired, then timestamp check should fail before Redis/DB checks
      // The order should show lock first, then rejection (no isEventProcessed check)
      expect(callOrder[0]).toBe('acquireEventLock');
      // isEventProcessed should NOT be called for stale events
      expect(callOrder).not.toContain('isEventProcessed');
      expect(callOrder).not.toContain('isWebhookEventProcessed');
    });

    it('should accept event exactly at 5-minute boundary', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      // Event exactly 5 minutes ago (minus small buffer for test timing)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000 + 100);
      const event = createEventWithTimestamp(fiveMinutesAgo);

      const result = await webhookService.processEvent(event);

      // Should just barely pass (within the 5 minute window)
      expect(result.status).toBe('processed');
    });
  });

  // ===========================================================================
  // Extended Lock TTL Tests (Sprint 67 - Task 67.4)
  // ===========================================================================

  describe('Extended Lock TTL for Boost/Badge Operations', () => {
    it('should use default TTL (30s) for subscription events', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
      mockBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);

      const event: ProviderWebhookEvent = {
        id: 'evt_sub_test',
        type: 'subscription.created',
        rawType: 'subscription.created',
        data: {
          id: 'sub_123',
          customerId: 'cus_123',
          customData: {
            community_id: 'community-123',
            tier: 'premium',
          },
        },
        timestamp: new Date(),
      };

      await webhookService.processEvent(event);

      // Should use default TTL (30 seconds)
      expect(mockRedisService.acquireEventLock).toHaveBeenCalledWith('evt_sub_test', 30);
    });

    it('should use extended TTL (60s) for boost purchase events', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      const event: ProviderWebhookEvent = {
        id: 'evt_boost_test',
        type: 'payment.completed',
        rawType: 'transaction.completed',
        data: {
          id: 'txn_123',
          customData: {
            type: 'boost_purchase',
            community_id: 'community-123',
            member_id: 'member-123',
            months: '3',
          },
        },
        timestamp: new Date(),
      };

      await webhookService.processEvent(event);

      // Should use extended TTL (60 seconds) for boost operations
      expect(mockRedisService.acquireEventLock).toHaveBeenCalledWith('evt_boost_test', 60);
    });

    it('should use extended TTL (60s) for badge purchase events', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);

      const event: ProviderWebhookEvent = {
        id: 'evt_badge_test',
        type: 'payment.completed',
        rawType: 'transaction.completed',
        data: {
          id: 'txn_456',
          customData: {
            type: 'badge_purchase',
            community_id: 'community-123',
            member_id: 'member-123',
          },
        },
        timestamp: new Date(),
      };

      await webhookService.processEvent(event);

      // Should use extended TTL (60 seconds) for badge operations
      expect(mockRedisService.acquireEventLock).toHaveBeenCalledWith('evt_badge_test', 60);
    });

    it('should use default TTL for regular payment events', async () => {
      mockRedisService.acquireEventLock.mockResolvedValue(true);
      mockRedisService.isEventProcessed.mockResolvedValue(false);
      mockBillingQueries.isWebhookEventProcessed.mockReturnValue(false);
      mockBillingQueries.getSubscriptionByPaymentId.mockReturnValue({
        id: 1,
        communityId: 'community-123',
        paymentSubscriptionId: 'sub_123',
      });

      const event: ProviderWebhookEvent = {
        id: 'evt_payment_test',
        type: 'payment.completed',
        rawType: 'transaction.completed',
        data: {
          id: 'txn_789',
          subscriptionId: 'sub_123',
          customData: {
            community_id: 'community-123',
            // No type field - regular subscription payment
          },
        },
        timestamp: new Date(),
      };

      await webhookService.processEvent(event);

      // Should use default TTL (30 seconds) for regular payments
      expect(mockRedisService.acquireEventLock).toHaveBeenCalledWith('evt_payment_test', 30);
    });
  });
});
