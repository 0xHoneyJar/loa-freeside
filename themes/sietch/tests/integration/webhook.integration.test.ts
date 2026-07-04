/**
 * Webhook Integration Tests (v5.0)
 *
 * End-to-end tests for the complete webhook processing flow:
 * - Redis lock acquisition + deduplication
 * - Timestamp freshness (replay prevention)
 * - Database persistence
 * - Cache invalidation
 * - Subscription lifecycle
 *
 * v5.0: modernized to the provider-agnostic contract —
 * WebhookService.processEvent() takes a normalized ProviderWebhookEvent
 * (id, type, rawType, data, timestamp), not a raw Stripe event. The v4.0
 * suite predated the Paddle migration AND its vi.mock specifiers pointed
 * one directory level too deep ('../../../…' instead of '../../src/…'),
 * so no mock ever attached and the suite failed on real module imports
 * ("Database not initialized") — the shared baseline CI failure tracked
 * in issue #375.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { ProviderWebhookEvent } from '../../src/packages/core/ports/IBillingProvider.js';

// Mock all dependencies for integration testing
vi.mock('ioredis', () => {
  const mockCache = new Map<string, { value: string; expiry?: number }>();

  const isLive = (key: string): boolean => {
    const item = mockCache.get(key);
    if (!item) return false;
    if (item.expiry && item.expiry < Date.now()) {
      mockCache.delete(key);
      return false;
    }
    return true;
  };

  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn((key: string) => Promise.resolve(isLive(key) ? mockCache.get(key)!.value : null)),
      set: vi.fn((key: string, value: string, ...args: any[]) => {
        // Real SET NX semantics: fail WITHOUT writing when the key exists
        const hasNX = args.some((a) => String(a).toUpperCase() === 'NX');
        if (hasNX && isLive(key)) {
          return Promise.resolve(null);
        }
        const exIdx = args.findIndex((a) => String(a).toUpperCase() === 'EX');
        const ttl = exIdx >= 0 ? Number(args[exIdx + 1]) * 1000 : undefined;
        mockCache.set(key, { value, expiry: ttl ? Date.now() + ttl : undefined });
        return Promise.resolve('OK');
      }),
      setex: vi.fn((key: string, ttl: number, value: string) => {
        mockCache.set(key, { value, expiry: Date.now() + ttl * 1000 });
        return Promise.resolve('OK');
      }),
      del: vi.fn((key: string) => {
        mockCache.delete(key);
        return Promise.resolve(1);
      }),
      exists: vi.fn((key: string) => Promise.resolve(isLive(key) ? 1 : 0)),
      info: vi.fn().mockResolvedValue('# Stats\r\ntotal_commands:100\r\n'),
      quit: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
      _mockCache: mockCache, // Expose for test inspection
    })),
  };
});

vi.mock('../../src/config.js', () => ({
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
    // BoostService is constructed at module load via WebhookService's import
    // chain and reads these keys in its constructor.
    boost: {
      thresholds: { level1: 2, level2: 7, level3: 14 },
      pricing: { pricePerMonthCents: 500 },
      bundles: undefined,
    },
    paddle: undefined,
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

vi.mock('../../src/db/billing-queries.js', () => ({
  getSubscriptionByCommunityId: vi.fn((id: string) => mockDatabase.subscriptions.get(id)),
  getSubscriptionByPaymentId: vi.fn((paymentSubscriptionId: string) => {
    for (const sub of mockDatabase.subscriptions.values()) {
      if (sub.paymentSubscriptionId === paymentSubscriptionId) return sub;
    }
    return undefined;
  }),
  createSubscription: vi.fn((data: any) => {
    const sub = { id: 'sub_' + Math.random(), ...data };
    mockDatabase.subscriptions.set(data.communityId, sub);
    return sub;
  }),
  updateSubscription: vi.fn((communityId: string, data: any) => {
    const existing = mockDatabase.subscriptions.get(communityId);
    if (existing) {
      Object.assign(existing, data);
    }
  }),
  isWebhookEventProcessed: vi.fn((eventId: string) => mockDatabase.webhookEvents.has(eventId)),
  recordWebhookEvent: vi.fn(
    (eventId: string, type: string, payload: string, status: string, error?: string) => {
      mockDatabase.webhookEvents.set(eventId, { eventId, type, payload, status, error });
    }
  ),
  logBillingAuditEvent: vi.fn((type: string, data: any, communityId?: string) => {
    mockDatabase.auditLog.push({ type, data, communityId, timestamp: Date.now() });
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

/** Build a normalized provider event the way adapters hand them to the service. */
function mkEvent(
  id: string,
  type: ProviderWebhookEvent['type'],
  data: Record<string, unknown>,
  timestamp: Date = new Date()
): ProviderWebhookEvent {
  return { id, type, rawType: `paddle.${type}`, data, timestamp };
}

describe('Webhook Integration Tests', () => {
  let webhookService: any;
  let redisService: any;
  let billingQueries: any;

  beforeAll(async () => {
    // Import services after all mocks are in place
    const webhookModule = await import('../../src/services/billing/WebhookService.js');
    const redisModule = await import('../../src/services/cache/RedisService.js');
    billingQueries = await import('../../src/db/billing-queries.js');

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
  // Full Flow: subscription.created
  // ===========================================================================

  describe('Complete subscription creation flow', () => {
    it('should process creation → subscription record → dedup marking', async () => {
      const event = mkEvent('evt_checkout_123', 'subscription.created', {
        id: 'psub_test123',
        customerId: 'cus_test123',
        customData: { community_id: 'test-community', tier: 'premium' },
      });

      const result = await webhookService.processEvent(event);

      // Verify successful processing
      expect(result.status).toBe('processed');
      expect(result.eventId).toBe('evt_checkout_123');

      // Verify subscription created in database (created = trialing until activation)
      const subscription = mockDatabase.subscriptions.get('test-community');
      expect(subscription).toBeDefined();
      expect(subscription.tier).toBe('premium');
      expect(subscription.status).toBe('trialing');
      expect(subscription.paymentSubscriptionId).toBe('psub_test123');

      // Verify webhook event recorded
      expect(mockDatabase.webhookEvents.get('evt_checkout_123')?.status).toBe('processed');

      // Verify audit log
      const auditEntries = mockDatabase.auditLog.filter((e) => e.type === 'subscription_created');
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].communityId).toBe('test-community');

      // Verify event marked in Redis for dedup
      expect(await redisService.isEventProcessed('evt_checkout_123')).toBe(true);
    });

    it('should reject duplicate event on second attempt', async () => {
      const event = mkEvent('evt_checkout_456', 'subscription.created', {
        id: 'psub_test456',
        customerId: 'cus_test456',
        customData: { community_id: 'dup-community', tier: 'basic' },
      });

      const first = await webhookService.processEvent(event);
      expect(first.status).toBe('processed');

      const second = await webhookService.processEvent(event);
      expect(second.status).toBe('duplicate');

      // Only one subscription_created audit entry across both attempts
      const auditEntries = mockDatabase.auditLog.filter((e) => e.type === 'subscription_created');
      expect(auditEntries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Replay prevention
  // ===========================================================================

  describe('Timestamp freshness', () => {
    it('should reject stale events as potential replays', async () => {
      const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1h old
      const event = mkEvent(
        'evt_stale_123',
        'subscription.created',
        {
          id: 'psub_stale',
          customerId: 'cus_stale',
          customData: { community_id: 'stale-community', tier: 'basic' },
        },
        staleTimestamp
      );

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('too old');
      expect(mockDatabase.subscriptions.has('stale-community')).toBe(false);
    });
  });

  // ===========================================================================
  // payment.completed clears grace period
  // ===========================================================================

  describe('Payment completed flow', () => {
    it('should clear grace period on successful payment', async () => {
      mockDatabase.subscriptions.set('grace-community', {
        id: 'sub_local_1',
        communityId: 'grace-community',
        paymentSubscriptionId: 'psub_grace_1',
        tier: 'premium',
        status: 'past_due',
        graceUntil: new Date(Date.now() + 12 * 60 * 60 * 1000),
      });

      const event = mkEvent('evt_payment_ok_123', 'payment.completed', {
        id: 'txn_123',
        subscriptionId: 'psub_grace_1',
        customData: { community_id: 'grace-community' },
      });

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      const subscription = mockDatabase.subscriptions.get('grace-community');
      expect(subscription.status).toBe('active');
      expect(subscription.graceUntil).toBeNull();

      const auditEntries = mockDatabase.auditLog.filter((e) => e.type === 'payment_succeeded');
      expect(auditEntries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // payment.failed sets grace period
  // ===========================================================================

  describe('Payment failure flow', () => {
    it('should set 24-hour grace period on payment failure', async () => {
      mockDatabase.subscriptions.set('fail-community', {
        id: 'sub_local_2',
        communityId: 'fail-community',
        paymentSubscriptionId: 'psub_fail_1',
        tier: 'premium',
        status: 'active',
        graceUntil: null,
      });

      const before = Date.now();
      const event = mkEvent('evt_payment_fail_123', 'payment.failed', {
        id: 'txn_456',
        subscriptionId: 'psub_fail_1',
      });

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      const subscription = mockDatabase.subscriptions.get('fail-community');
      expect(subscription.status).toBe('past_due');
      expect(subscription.graceUntil).toBeInstanceOf(Date);
      const graceMs = subscription.graceUntil.getTime() - before;
      expect(graceMs).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(graceMs).toBeLessThanOrEqual(25 * 60 * 60 * 1000);

      const types = mockDatabase.auditLog.map((e) => e.type);
      expect(types).toContain('payment_failed');
      expect(types).toContain('grace_period_started');
    });
  });

  // ===========================================================================
  // subscription.canceled downgrades tier
  // ===========================================================================

  describe('Subscription cancellation flow', () => {
    it('should downgrade to starter tier on cancellation', async () => {
      mockDatabase.subscriptions.set('cancel-community', {
        id: 'sub_local_3',
        communityId: 'cancel-community',
        paymentSubscriptionId: 'psub_cancel_1',
        tier: 'premium',
        status: 'active',
        graceUntil: null,
      });

      const event = mkEvent('evt_cancel_123', 'subscription.canceled', {
        id: 'psub_cancel_1',
        customData: { community_id: 'cancel-community' },
      });

      const result = await webhookService.processEvent(event);
      expect(result.status).toBe('processed');

      const subscription = mockDatabase.subscriptions.get('cancel-community');
      expect(subscription.status).toBe('canceled');
      expect(subscription.tier).toBe('starter');

      const auditEntries = mockDatabase.auditLog.filter((e) => e.type === 'subscription_canceled');
      expect(auditEntries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Concurrency protection (distributed lock)
  // ===========================================================================

  describe('Concurrent processing protection', () => {
    it('should handle concurrent processing attempts with locks', async () => {
      const event = mkEvent('evt_concurrent_123', 'subscription.created', {
        id: 'psub_concurrent',
        customerId: 'cus_concurrent',
        customData: { community_id: 'concurrent-community', tier: 'basic' },
      });

      const [a, b] = await Promise.all([
        webhookService.processEvent(event),
        webhookService.processEvent(event),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toContain('processed');
      expect(statuses).toContain('duplicate');

      // Exactly one subscription creation despite two attempts
      const auditEntries = mockDatabase.auditLog.filter((e) => e.type === 'subscription_created');
      expect(auditEntries).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      billingQueries.createSubscription.mockImplementationOnce(() => {
        throw new Error('DB write failed');
      });

      const event = mkEvent('evt_db_error_123', 'subscription.created', {
        id: 'psub_err',
        customerId: 'cus_err',
        customData: { community_id: 'error-community', tier: 'basic' },
      });

      const result = await webhookService.processEvent(event);

      expect(result.status).toBe('failed');
      expect(result.error).toBe('DB write failed');

      // Failure is recorded durably for reconciliation
      const recorded = mockDatabase.webhookEvents.get('evt_db_error_123');
      expect(recorded?.status).toBe('failed');
      expect(recorded?.error).toBe('DB write failed');
    });
  });
});
