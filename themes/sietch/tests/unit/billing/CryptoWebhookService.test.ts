/**
 * CryptoWebhookService Unit Tests (Sprint 157: NOWPayments Integration)
 *
 * Tests for CryptoWebhookService including:
 * - Signature verification
 * - LVVER pattern processing
 * - Status transitions
 * - Subscription activation
 * - Idempotency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CryptoWebhookEvent, ICryptoPaymentProvider } from '../../../src/packages/core/ports/ICryptoPaymentProvider.js';

// Mock dependencies - must be defined before imports that use them
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Redis service with factory
vi.mock('../../../src/services/cache/RedisService.js', () => ({
  redisService: {
    acquireEventLock: vi.fn(),
    releaseEventLock: vi.fn(),
    isEventProcessed: vi.fn(),
    set: vi.fn(),
    invalidateEntitlements: vi.fn(),
  },
}));

// Mock billing queries with factory
vi.mock('../../../src/db/billing-queries.js', () => ({
  getCryptoPaymentByPaymentId: vi.fn(),
  getCryptoPaymentByOrderId: vi.fn(),
  updateCryptoPaymentStatus: vi.fn(),
  logBillingAuditEvent: vi.fn(),
  getSubscriptionByCommunityId: vi.fn(),
  createSubscription: vi.fn(),
  updateSubscription: vi.fn(),
}));

// Import after mocks are set up
import { cryptoWebhookService } from '../../../src/services/billing/CryptoWebhookService.js';
import { redisService } from '../../../src/services/cache/RedisService.js';
import * as billingQueries from '../../../src/db/billing-queries.js';

// Mock crypto provider
const mockCryptoProvider: ICryptoPaymentProvider = {
  provider: 'nowpayments',
  createPayment: vi.fn(),
  getPaymentStatus: vi.fn(),
  getSupportedCurrencies: vi.fn(),
  getMinimumPaymentAmount: vi.fn(),
  estimatePrice: vi.fn(),
  verifyWebhook: vi.fn(),
  isHealthy: vi.fn(),
};

// Type the mocked functions
const mockedRedisService = vi.mocked(redisService);
const mockedBillingQueries = vi.mocked(billingQueries);

describe('CryptoWebhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    mockedRedisService.acquireEventLock.mockResolvedValue(true);
    mockedRedisService.releaseEventLock.mockResolvedValue(undefined);
    mockedRedisService.isEventProcessed.mockResolvedValue(false);
    mockedRedisService.set.mockResolvedValue(undefined);
    mockedRedisService.invalidateEntitlements.mockResolvedValue(undefined);

    mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
      id: 'cp_test_123',
      paymentId: '12345',
      communityId: 'test-community',
      tier: 'premium',
      priceAmount: 99.0,
      priceCurrency: 'usd',
      status: 'waiting',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    mockedBillingQueries.updateCryptoPaymentStatus.mockReturnValue(true);
    mockedBillingQueries.getSubscriptionByCommunityId.mockReturnValue(null);
    mockedBillingQueries.createSubscription.mockReturnValue('sub_test_123');
    mockedBillingQueries.updateSubscription.mockReturnValue(true);

    // Set the crypto provider
    cryptoWebhookService.setCryptoProvider(mockCryptoProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // verifySignature Tests
  // ===========================================================================

  describe('verifySignature', () => {
    it('should verify valid signature and return event', () => {
      const mockEvent: CryptoWebhookEvent = {
        paymentId: '12345',
        status: 'finished',
        actuallyPaid: 0.0025,
        payCurrency: 'btc',
        priceAmount: 99,
        orderId: 'order_test',
        timestamp: new Date(),
        rawData: {},
      };

      (mockCryptoProvider.verifyWebhook as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: true,
        event: mockEvent,
      });

      const result = cryptoWebhookService.verifySignature('{}', 'valid-signature');

      expect(result).toEqual(mockEvent);
      expect(mockCryptoProvider.verifyWebhook).toHaveBeenCalledWith('{}', 'valid-signature');
    });

    it('should throw error for invalid signature', () => {
      (mockCryptoProvider.verifyWebhook as ReturnType<typeof vi.fn>).mockReturnValue({
        valid: false,
        error: 'Invalid signature',
      });

      expect(() =>
        cryptoWebhookService.verifySignature('{}', 'invalid-signature')
      ).toThrow('Invalid signature');
    });
  });

  // ===========================================================================
  // processEvent Tests - LVVER Pattern
  // ===========================================================================

  describe('processEvent', () => {
    const createTestEvent = (overrides = {}): CryptoWebhookEvent => ({
      paymentId: '12345',
      status: 'confirming',
      actuallyPaid: 0.0025,
      payCurrency: 'btc',
      priceAmount: 99,
      orderId: 'order_test',
      timestamp: new Date(),
      rawData: {},
      ...overrides,
    });

    // -------------------------------------------------------------------------
    // LOCK Step Tests
    // -------------------------------------------------------------------------

    describe('LOCK step', () => {
      it('should return duplicate if lock cannot be acquired', async () => {
        mockedRedisService.acquireEventLock.mockResolvedValue(false);

        const event = createTestEvent();
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('duplicate');
        expect(result.message).toContain('another instance');
        expect(mockedRedisService.acquireEventLock).toHaveBeenCalledWith(
          'crypto:12345',
          30
        );
      });

      it('should always release lock in finally block', async () => {
        const event = createTestEvent();

        await cryptoWebhookService.processEvent(event);

        expect(mockedRedisService.releaseEventLock).toHaveBeenCalledWith('crypto:12345');
      });

      it('should release lock even on error', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue(null);
        mockedBillingQueries.getCryptoPaymentByOrderId.mockReturnValue(null);

        const event = createTestEvent();
        await cryptoWebhookService.processEvent(event);

        expect(mockedRedisService.releaseEventLock).toHaveBeenCalledWith('crypto:12345');
      });
    });

    // -------------------------------------------------------------------------
    // Timestamp Check Tests
    // -------------------------------------------------------------------------

    describe('timestamp check', () => {
      it('should reject stale events', async () => {
        const staleEvent = createTestEvent({
          timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        });

        const result = await cryptoWebhookService.processEvent(staleEvent);

        expect(result.status).toBe('failed');
        expect(result.error).toContain('too old');
      });

      it('should accept events within age limit', async () => {
        const recentEvent = createTestEvent({
          timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        });

        await cryptoWebhookService.processEvent(recentEvent);

        // Should proceed to next step (verify Redis)
        expect(mockedRedisService.isEventProcessed).toHaveBeenCalled();
      });
    });

    // -------------------------------------------------------------------------
    // VERIFY Step Tests
    // -------------------------------------------------------------------------

    describe('VERIFY step', () => {
      it('should return duplicate if already in Redis cache', async () => {
        mockedRedisService.isEventProcessed.mockResolvedValue(true);

        const event = createTestEvent();
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('duplicate');
        expect(result.message).toContain('Redis');
      });

      it('should fail if payment not found', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue(null);
        mockedBillingQueries.getCryptoPaymentByOrderId.mockReturnValue(null);

        const event = createTestEvent();
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('failed');
        expect(result.error).toContain('not found');
      });

      it('should find payment by order ID if not found by payment ID', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue(null);
        mockedBillingQueries.getCryptoPaymentByOrderId.mockReturnValue({
          id: 'cp_test_123',
          paymentId: '12345',
          communityId: 'test-community',
          tier: 'premium',
          status: 'waiting',
        });

        const event = createTestEvent();
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.getCryptoPaymentByOrderId).toHaveBeenCalledWith('order_test');
      });
    });

    // -------------------------------------------------------------------------
    // VALIDATE Step Tests - Status Transitions
    // -------------------------------------------------------------------------

    describe('VALIDATE step - status transitions', () => {
      it('should skip duplicate status', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
          id: 'cp_test_123',
          paymentId: '12345',
          communityId: 'test-community',
          tier: 'premium',
          status: 'confirming', // Same as event
        } as any);

        const event = createTestEvent({ status: 'confirming' });
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('skipped');
        expect(result.message).toContain('Invalid transition');
      });

      it('should skip invalid transition from terminal state', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
          id: 'cp_test_123',
          paymentId: '12345',
          communityId: 'test-community',
          tier: 'premium',
          status: 'finished', // Terminal state
        } as any);

        const event = createTestEvent({ status: 'confirming' });
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('skipped');
      });

      it('should allow valid transition waiting → confirming', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
          id: 'cp_test_123',
          paymentId: '12345',
          communityId: 'test-community',
          tier: 'premium',
          status: 'waiting',
        } as any);

        const event = createTestEvent({ status: 'confirming' });
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('processed');
      });

      it('should allow failed status from any non-terminal state', async () => {
        mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
          id: 'cp_test_123',
          paymentId: '12345',
          communityId: 'test-community',
          tier: 'premium',
          status: 'confirming',
        } as any);

        const event = createTestEvent({ status: 'failed' });
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('processed');
      });
    });

    // -------------------------------------------------------------------------
    // EXECUTE Step Tests
    // -------------------------------------------------------------------------

    describe('EXECUTE step', () => {
      it('should update payment status', async () => {
        const event = createTestEvent({ status: 'confirming' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.updateCryptoPaymentStatus).toHaveBeenCalledWith(
          '12345',
          expect.objectContaining({
            status: 'confirming',
            actuallyPaid: 0.0025,
          })
        );
      });

      it('should activate subscription on finished status', async () => {
        const event = createTestEvent({ status: 'finished' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.createSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            communityId: 'test-community',
            tier: 'premium',
            status: 'active',
            paymentProvider: 'nowpayments',
          })
        );
      });

      it('should update existing subscription on finished', async () => {
        mockedBillingQueries.getSubscriptionByCommunityId.mockReturnValue({
          id: 'sub_existing',
          communityId: 'test-community',
          tier: 'basic',
          status: 'active',
        } as any);

        const event = createTestEvent({ status: 'finished' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.updateSubscription).toHaveBeenCalledWith(
          'test-community',
          expect.objectContaining({
            tier: 'premium',
            status: 'active',
            paymentProvider: 'nowpayments',
          })
        );
      });

      it('should set finishedAt on finished status', async () => {
        const event = createTestEvent({ status: 'finished' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.updateCryptoPaymentStatus).toHaveBeenCalledWith(
          '12345',
          expect.objectContaining({
            status: 'finished',
            finishedAt: expect.any(Date),
          })
        );
      });

      it('should invalidate entitlement cache on subscription activation', async () => {
        const event = createTestEvent({ status: 'finished' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedRedisService.invalidateEntitlements).toHaveBeenCalledWith('test-community');
      });
    });

    // -------------------------------------------------------------------------
    // RECORD Step Tests
    // -------------------------------------------------------------------------

    describe('RECORD step', () => {
      it('should mark event as processed in Redis', async () => {
        const event = createTestEvent({ status: 'confirming' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedRedisService.set).toHaveBeenCalledWith(
          'crypto:processed:12345:confirming',
          '1',
          86400 // 24 hours
        );
      });

      it('should log audit event', async () => {
        const event = createTestEvent({ status: 'confirming' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
          'crypto_payment_status_updated',
          expect.objectContaining({
            paymentId: '12345',
            communityId: 'test-community',
            newStatus: 'confirming',
          }),
          'test-community'
        );
      });

      it('should log completed event type for finished status', async () => {
        const event = createTestEvent({ status: 'finished' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
          'crypto_payment_completed',
          expect.any(Object),
          expect.any(String)
        );
      });

      it('should log failed event type for failed status', async () => {
        const event = createTestEvent({ status: 'failed' });
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
          'crypto_payment_failed',
          expect.any(Object),
          expect.any(String)
        );
      });
    });

    // -------------------------------------------------------------------------
    // Error Handling Tests
    // -------------------------------------------------------------------------

    describe('error handling', () => {
      it('should return failed status on error', async () => {
        mockedBillingQueries.updateCryptoPaymentStatus.mockImplementation(() => {
          throw new Error('Database error');
        });

        const event = createTestEvent();
        const result = await cryptoWebhookService.processEvent(event);

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Database error');
      });

      it('should log audit event on failure', async () => {
        mockedBillingQueries.updateCryptoPaymentStatus.mockImplementation(() => {
          throw new Error('Database error');
        });

        const event = createTestEvent();
        await cryptoWebhookService.processEvent(event);

        expect(mockedBillingQueries.logBillingAuditEvent).toHaveBeenCalledWith(
          'crypto_webhook_failed',
          expect.objectContaining({
            paymentId: '12345',
            error: 'Database error',
          })
        );
      });
    });
  });

  // ===========================================================================
  // Full Flow Integration Tests
  // ===========================================================================

  describe('full payment flow', () => {
    it('should process complete payment lifecycle', async () => {
      // Start with waiting status
      mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
        id: 'cp_test_123',
        paymentId: '12345',
        communityId: 'test-community',
        tier: 'premium',
        status: 'waiting',
      } as any);

      // Process confirming
      const confirmingEvent = {
        paymentId: '12345',
        status: 'confirming' as const,
        actuallyPaid: 0.0025,
        payCurrency: 'btc' as const,
        priceAmount: 99,
        orderId: 'order_test',
        timestamp: new Date(),
        rawData: {},
      };

      let result = await cryptoWebhookService.processEvent(confirmingEvent);
      expect(result.status).toBe('processed');

      // Update mock to reflect new status
      mockedBillingQueries.getCryptoPaymentByPaymentId.mockReturnValue({
        id: 'cp_test_123',
        paymentId: '12345',
        communityId: 'test-community',
        tier: 'premium',
        status: 'confirming',
      } as any);

      // Process finished
      const finishedEvent = {
        ...confirmingEvent,
        status: 'finished' as const,
      };

      // Clear Redis cache for new status
      mockedRedisService.isEventProcessed.mockResolvedValue(false);

      result = await cryptoWebhookService.processEvent(finishedEvent);
      expect(result.status).toBe('processed');
      expect(result.message).toContain('subscription activated');
    });
  });
});
