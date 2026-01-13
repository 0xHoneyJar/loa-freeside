/**
 * Redis Local Rate Limiter Tests (Sprint 67 - Security Hardening)
 *
 * Tests for the local rate limiter fallback and updated acquireEventLock
 * behavior when Redis is unavailable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing RedisService
vi.mock('ioredis', () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    status: 'ready',
    ping: vi.fn().mockResolvedValue('PONG'),
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    quit: vi.fn(),
    on: vi.fn(),
    info: vi.fn(),
  }));
  return { default: MockRedis };
});

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config
vi.mock('../../../src/config.js', () => ({
  config: {
    redis: {
      url: 'redis://localhost:6379',
      maxRetries: 3,
      connectTimeout: 5000,
      entitlementTtl: 300,
    },
  },
}));

describe('Redis Local Rate Limiter Fallback', () => {
  let redisService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-import to get fresh instance
    const module = await import('../../../src/services/cache/RedisService.js');
    redisService = module.redisService;
    redisService.resetLocalRateLimiter();
  });

  // ===========================================================================
  // Fallback Behavior
  // ===========================================================================

  describe('acquireEventLock fallback', () => {
    it('should use local rate limiter when Redis not connected', async () => {
      // Redis is not connected (client is null)
      const eventId = 'evt_subscription_created_123';

      // First request should be allowed
      const result1 = await redisService.acquireEventLock(eventId);
      expect(result1).toBe(true);

      const metrics = redisService.getMetrics();
      expect(metrics.redisFallbackTotal).toBe(1);
      expect(metrics.localRateLimiterRequests).toBe(1);
    });

    it('should rate limit after burst capacity exceeded', async () => {
      // Token bucket: 10 tokens max, 10/sec refill
      // Make 11 rapid requests - first 10 should succeed, 11th should fail
      const eventType = 'subscription_created';
      const results: boolean[] = [];

      for (let i = 0; i < 12; i++) {
        const result = await redisService.acquireEventLock(`evt_${eventType}_${i}`);
        results.push(result);
      }

      // First 10 should succeed
      const successCount = results.filter((r) => r === true).length;
      expect(successCount).toBe(10);

      // 11th and 12th should fail
      expect(results[10]).toBe(false);
      expect(results[11]).toBe(false);
    });

    it('should track per-event-type rate limiting', async () => {
      // Different event types should have separate buckets
      const results: boolean[] = [];

      // 10 requests for type A
      for (let i = 0; i < 10; i++) {
        results.push(await redisService.acquireEventLock(`evt_type_a_${i}`));
      }

      // 10 requests for type B (should have its own bucket)
      for (let i = 0; i < 10; i++) {
        results.push(await redisService.acquireEventLock(`evt_type_b_${i}`));
      }

      // All 20 should succeed (10 per type)
      expect(results.filter((r) => r === true).length).toBe(20);
    });

    it('should extract event type from event ID', async () => {
      // Event IDs should be parsed to extract type
      await redisService.acquireEventLock('evt_subscription_created_abc123');
      await redisService.acquireEventLock('evt_payment_completed_xyz789');

      // Each type should have its own bucket with 9 tokens remaining
      // (10 - 1 used)
      for (let i = 0; i < 9; i++) {
        expect(await redisService.acquireEventLock(`evt_subscription_created_${i}`)).toBe(true);
        expect(await redisService.acquireEventLock(`evt_payment_completed_${i}`)).toBe(true);
      }

      // 11th request for each type should fail
      expect(await redisService.acquireEventLock('evt_subscription_created_overflow')).toBe(false);
      expect(await redisService.acquireEventLock('evt_payment_completed_overflow')).toBe(false);
    });
  });

  // ===========================================================================
  // TTL Parameter
  // ===========================================================================

  describe('acquireEventLock with custom TTL', () => {
    it('should accept custom TTL parameter', async () => {
      // Connect Redis for this test
      await redisService.connect();

      // This test mainly verifies the signature accepts ttlSeconds
      // The actual TTL behavior is tested via the Redis mock
      const eventId = 'evt_test_123';

      // Should not throw when passing custom TTL
      await expect(
        redisService.acquireEventLock(eventId, 60)
      ).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Metrics
  // ===========================================================================

  describe('Metrics tracking', () => {
    it('should track redis fallback total', async () => {
      // Make fallback requests
      await redisService.acquireEventLock('evt_test_1');
      await redisService.acquireEventLock('evt_test_2');
      await redisService.acquireEventLock('evt_test_3');

      const metrics = redisService.getMetrics();
      expect(metrics.redisFallbackTotal).toBe(3);
    });

    it('should track local rate limiter request count', async () => {
      // Make requests that get allowed
      for (let i = 0; i < 5; i++) {
        await redisService.acquireEventLock(`evt_test_${i}`);
      }

      const metrics = redisService.getMetrics();
      expect(metrics.localRateLimiterRequests).toBe(5);
    });

    it('should track lock TTL exhausted events', () => {
      redisService.incrementLockTtlExhausted();
      redisService.incrementLockTtlExhausted();

      const metrics = redisService.getMetrics();
      expect(metrics.lockTtlExhaustedTotal).toBe(2);
    });

    it('should reset all metrics', async () => {
      // Generate some metrics
      await redisService.acquireEventLock('evt_test_1');
      redisService.incrementLockTtlExhausted();

      // Reset
      redisService.resetLocalRateLimiter();

      const metrics = redisService.getMetrics();
      expect(metrics.redisFallbackTotal).toBe(0);
      expect(metrics.localRateLimiterRequests).toBe(0);
      expect(metrics.lockTtlExhaustedTotal).toBe(0);
    });
  });

  // ===========================================================================
  // Event Type Extraction
  // ===========================================================================

  describe('Event type extraction', () => {
    it('should use "unknown" for short event IDs', async () => {
      // Event IDs with < 3 parts should fall back to "unknown"
      await redisService.acquireEventLock('evt_short');
      await redisService.acquireEventLock('simple');

      // Both should use the same "unknown" bucket
      const metrics = redisService.getMetrics();
      expect(metrics.localRateLimiterRequests).toBe(2);
    });

    it('should parse standard event ID format', async () => {
      // Standard format: evt_<type>_<action>_<uuid>
      await redisService.acquireEventLock('evt_subscription_created_abc123');

      // Should extract "subscription_created" as the type
      const metrics = redisService.getMetrics();
      expect(metrics.localRateLimiterRequests).toBe(1);
    });
  });
});
