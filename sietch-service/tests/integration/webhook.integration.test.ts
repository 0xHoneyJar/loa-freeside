/**
 * Webhook Integration Tests (v4.0 - Sprint 24)
 *
 * End-to-end tests for the complete webhook processing flow:
 * - Stripe signature verification
 * - Redis deduplication
 * - Database persistence
 * - Cache invalidation
 * - Subscription lifecycle
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type Stripe from 'stripe';

// Mock all dependencies for integration testing
vi.mock('ioredis', () => {
  const mockCache = new Map<string, { value: string; expiry?: number }>();

  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn((key: string) => {
        const item = mockCache.get(key);
        if (!item) return Promise.resolve(null);
        if (item.expiry && item.expiry < Date.now()) {
          mockCache.delete(key);
          return Promise.resolve(null);
        }
        return Promise.resolve(item.value);
      }),
      set: vi.fn((key: string, value: string, ...args: any[]) => {
        const ttl = args.length >= 2 && args[0] === 'EX' ? args[1] * 1000 : undefined;
        mockCache.set(key, {
          value,
          expiry: ttl ? Date.now() + ttl : undefined,
        });
        return Promise.resolve(args.length >= 3 && args[2] === 'NX' && mockCache.has(key) ? null : 'OK');
      }),
      setex: vi.fn((key: string, ttl: number, value: string) => {
        mockCache.set(key, {
          value,
          expiry: Date.now() + ttl * 1000,
        });
        return Promise.resolve('OK');
      }),
      del: vi.fn((key: string) => {
        mockCache.delete(key);
        return Promise.resolve(1);
      }),
      exists: vi.fn((key: string) => {
        return Promise.resolve(mockCache.has(key) ? 1 : 0);
      }),
      info: vi.fn().mockResolvedValue('# Stats\r\ntotal_commands:100\r\n'),
      quit: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
      _mockCache: mockCache, // Expose for test inspection
    })),
  };
});

vi.mock('../../../config.js', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_123',
      webhookSecret: 'whsec_test_123',
      priceIds: new Map([
        ['basic', 'price_basic'],
        ['premium', 'price_premium'],
      ]),
    },
    redis: {
      url: 'redis://localhost:6379',
      maxRetries: 3,
      connectTimeout: 5000,
      entitlementTtl: 300,
    },
  },
}));

// In-memory database for testing
const mockDatabase = {
  subscriptions: new Map<string, any>(),
  webhookEvents: new Map<string, any>(),
  auditLog: [] as any[],

  reset() {
    this.subscriptions.clear();
    this.webhookEvents.clear();
    this.auditLog = [];
  },
};

vi.mock('../../../db/billing-queries.js', () => ({
  getSubscriptionByCommunityId: vi.fn((id: string) => mockDatabase.subscriptions.get(id)),
  createSubscription: vi.fn((data: any) => {
    const sub = { id: 'sub_' + Math.random(), ...data };
    mockDatabase.subscriptions.set(data.communityId, sub);
    return sub;
  }),
  updateSubscription: vi.fn((id: string, data: any) => {
    const existing = mockDatabase.subscriptions.get(id);
    if (existing) {
      Object.assign(existing, data);
    }
  }),
  isWebhookEventProcessed: vi.fn((eventId: string) => mockDatabase.webhookEvents.has(eventId)),
  recordWebhookEvent: vi.fn((eventId: string, type: string, payload: string, status: string) => {
    mockDatabase.webhookEvents.set(eventId, { eventId, type, payload, status });
  }),
  logBillingAuditEvent: vi.fn((type: string, data: any, communityId?: string) => {
    mockDatabase.auditLog.push({ type, data, communityId, timestamp: Date.now() });
  }),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Stripe SDK
vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      webhooks: {
        constructEvent: vi.fn((payload: any, signature: string, secret: string) => {
          if (signature === 'invalid') {
            throw new Error('Invalid signature');
          }
          return JSON.parse(payload.toString());
        }),
      },
      subscriptions: {
        retrieve: vi.fn((id: string) => {
          return Promise.resolve({
            id,
            metadata: { community_id: 'test-community' },
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 2592000,
            status: 'active',
          });
        }),
      },
    })),
  };
});

describe('Webhook Integration Tests', () => {
  let webhookService: any;
  let redisService: any;

  beforeAll(async () => {
    // Import services after all mocks are in place
    const webhookModule = await import('../../src/services/billing/WebhookService.js');
    const redisModule = await import('../../src/services/cache/RedisService.js');

    webhookService = webhookModule.webhookService;
    redisService = redisModule.redisService;

    // Connect Redis
    await redisService.connect();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });

  beforeEach(() => {
    mockDatabase.reset();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Full Flow: checkout.session.completed
  // ===========================================================================

  describe('Complete checkout flow', () => {
    it('should process checkout → subscription creation → cache invalidation', async () => {
      const event: Stripe.Event = {
        id: 'evt_checkout_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test123',
            customer: 'cus_test123',
            subscription: 'sub_test123',
            metadata: {
              community_id: 'test-community',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      // Process the event
      const result = await webhookService.processEvent(event);

      // Verify successful processing
      expect(result.status).toBe('processed');
      expect(result.eventId).toBe('evt_checkout_123');

      // Verify subscription created in database
      const subscription = mockDatabase.subscriptions.get('test-community');
      expect(subscription).toBeDefined();
      expect(subscription.tier).toBe('premium');
      expect(subscription.status).toBe('active');

      // Verify webhook event recorded
      expect(mockDatabase.webhookEvents.has('evt_checkout_123')).toBe(true);

      // Verify audit log
      const auditEntries = mockDatabase.auditLog.filter(
        (e) => e.type === 'subscription_created'
      );
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].communityId).toBe('test-community');

      // Verify event marked in Redis
      const isProcessed = await redisService.isEventProcessed('evt_checkout_123');
      expect(isProcessed).toBe(true);
    });

    it('should reject duplicate event on second attempt', async () => {
      const event: Stripe.Event = {
        id: 'evt_checkout_456',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test456',
            customer: 'cus_test456',
            subscription: 'sub_test456',
            metadata: {
              community_id: 'test-community-2',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      // First processing
      const result1 = await webhookService.processEvent(event);
      expect(result1.status).toBe('processed');

      // Second processing (duplicate)
      const result2 = await webhookService.processEvent(event);
      expect(result2.status).toBe('duplicate');
      expect(result2.message).toContain('Redis');

      // Verify subscription created only once
      expect(mockDatabase.subscriptions.size).toBe(1);
    });
  });

  // ===========================================================================
  // Full Flow: invoice.paid → Grace period cleared
  // ===========================================================================

  describe('Invoice paid flow', () => {
    it('should clear grace period on successful payment', async () => {
      // Setup: subscription in grace period
      mockDatabase.subscriptions.set('test-community', {
        id: 'sub_existing',
        tier: 'premium',
        status: 'past_due',
        graceUntil: new Date(Date.now() + 3600000), // 1 hour from now
      });

      const event: Stripe.Event = {
        id: 'evt_invoice_paid_123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test123',
            subscription: 'sub_test123',
            amount_paid: 3500,
            currency: 'usd',
          },
        },
      } as unknown as Stripe.Event;

      // Process the event
      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      // Verify grace period cleared
      const subscription = mockDatabase.subscriptions.get('test-community');
      expect(subscription.status).toBe('active');
      expect(subscription.graceUntil).toBeNull();

      // Verify audit log
      const paymentSuccessLogs = mockDatabase.auditLog.filter(
        (e) => e.type === 'payment_succeeded'
      );
      expect(paymentSuccessLogs).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Full Flow: invoice.payment_failed → Grace period started
  // ===========================================================================

  describe('Payment failure flow', () => {
    it('should set 24-hour grace period on payment failure', async () => {
      // Setup: active subscription
      mockDatabase.subscriptions.set('test-community', {
        id: 'sub_existing',
        tier: 'premium',
        status: 'active',
      });

      const event: Stripe.Event = {
        id: 'evt_invoice_failed_123',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test123',
            subscription: 'sub_test123',
            attempt_count: 2,
          },
        },
      } as unknown as Stripe.Event;

      // Process the event
      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      // Verify grace period set
      const subscription = mockDatabase.subscriptions.get('test-community');
      expect(subscription.status).toBe('past_due');
      expect(subscription.graceUntil).toBeInstanceOf(Date);

      // Grace period should be ~24 hours
      const gracePeriod = subscription.graceUntil.getTime() - Date.now();
      expect(gracePeriod).toBeGreaterThan(23.9 * 60 * 60 * 1000);

      // Verify audit logs
      const auditLogs = mockDatabase.auditLog.filter(
        (e) => e.type === 'payment_failed' || e.type === 'grace_period_started'
      );
      expect(auditLogs).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Full Flow: subscription.deleted → Downgrade to starter
  // ===========================================================================

  describe('Subscription cancellation flow', () => {
    it('should downgrade to starter tier on cancellation', async () => {
      // Setup: premium subscription
      mockDatabase.subscriptions.set('test-community', {
        id: 'sub_existing',
        tier: 'premium',
        status: 'active',
      });

      const event: Stripe.Event = {
        id: 'evt_sub_deleted_123',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test123',
            metadata: { community_id: 'test-community' },
          },
        },
      } as unknown as Stripe.Event;

      // Process the event
      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      // Verify downgrade
      const subscription = mockDatabase.subscriptions.get('test-community');
      expect(subscription.tier).toBe('starter');
      expect(subscription.status).toBe('canceled');

      // Verify audit log
      const cancelLogs = mockDatabase.auditLog.filter(
        (e) => e.type === 'subscription_canceled'
      );
      expect(cancelLogs).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Concurrency: Multiple processors
  // ===========================================================================

  describe('Concurrent processing protection', () => {
    it('should handle concurrent processing attempts with locks', async () => {
      const event: Stripe.Event = {
        id: 'evt_concurrent_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_concurrent',
            customer: 'cus_concurrent',
            subscription: 'sub_concurrent',
            metadata: {
              community_id: 'test-concurrent',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      // Simulate concurrent processing
      const results = await Promise.all([
        webhookService.processEvent(event),
        webhookService.processEvent(event),
        webhookService.processEvent(event),
      ]);

      // Only one should succeed
      const processed = results.filter((r) => r.status === 'processed');
      const duplicates = results.filter((r) => r.status === 'duplicate');

      expect(processed.length).toBe(1);
      expect(duplicates.length).toBe(2);

      // Verify subscription created only once
      expect(mockDatabase.subscriptions.size).toBe(1);
    });
  });

  // ===========================================================================
  // Error Handling & Recovery
  // ===========================================================================

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      const queries = await import('../../../db/billing-queries.js');
      (queries.createSubscription as any).mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      const event: Stripe.Event = {
        id: 'evt_db_error',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_error',
            customer: 'cus_error',
            subscription: 'sub_error',
            metadata: {
              community_id: 'test-error',
              tier: 'premium',
            },
          },
        },
      } as unknown as Stripe.Event;

      const result = await webhookService.processEvent(event);

      // Should record failure
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Database');

      // Should record failed event
      const webhookEvent = mockDatabase.webhookEvents.get('evt_db_error');
      expect(webhookEvent.status).toBe('failed');
    });
  });
});
