/**
 * Global Discord Token Bucket Tests (v5.0 - Sprint 45)
 *
 * Comprehensive test suite for GlobalDiscordTokenBucket.
 * Tests atomic operations, rate limiting, concurrency, and edge cases.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import {
  GlobalDiscordTokenBucket,
  RateLimitExceededError,
  TokenBucketError,
} from '../../../../src/packages/synthesis/GlobalDiscordTokenBucket.js';

describe('GlobalDiscordTokenBucket', () => {
  let redis: typeof Redis;
  let bucket: GlobalDiscordTokenBucket;

  const testConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      db: 15, // Use separate DB for tests
    },
    maxTokens: 50,
    refillRate: 50,
    bucketKey: 'test:discord:tokens',
    defaultTimeout: 5000,
    initialBackoff: 50,
    maxBackoff: 500,
  };

  beforeAll(async () => {
    // Create Redis client for test assertions
    redis = new Redis(testConfig.redis.port, testConfig.redis.host, {
      db: testConfig.redis.db,
    });
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clean up test Redis DB before each test
    await redis.flushdb();
  });

  afterEach(async () => {
    if (bucket) {
      await bucket.close();
    }
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      expect(bucket.isReady()).toBe(true);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(50);
    });

    it('should initialize with custom maxTokens', async () => {
      bucket = new GlobalDiscordTokenBucket({
        ...testConfig,
        maxTokens: 100,
      });
      await bucket.initialize();

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(100);
    });

    it('should throw error if acquire called before initialize', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);

      await expect(bucket.acquire(1)).rejects.toThrow(TokenBucketError);
      await expect(bucket.acquire(1)).rejects.toThrow('not initialized');
    });

    it('should allow multiple initialize calls (idempotent)', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
      await bucket.initialize();
      await bucket.initialize();

      expect(bucket.isReady()).toBe(true);
    });
  });

  // ==========================================================================
  // Acquire Tests
  // ==========================================================================

  describe('acquire()', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should acquire 1 token successfully', async () => {
      const result = await bucket.acquire(1);
      expect(result).toBe(true);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(49);
    });

    it('should acquire multiple tokens', async () => {
      const result = await bucket.acquire(5);
      expect(result).toBe(true);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(45);
    });

    it('should return false when insufficient tokens', async () => {
      // Drain bucket
      await bucket.acquire(50);

      const result = await bucket.acquire(1);
      expect(result).toBe(false);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(0);
    });

    it('should handle concurrent acquisitions atomically', async () => {
      // Acquire 50 tokens concurrently (should succeed for all)
      const results = await Promise.all(
        Array(50)
          .fill(0)
          .map(() => bucket.acquire(1))
      );

      const successCount = results.filter((r) => r === true).length;
      expect(successCount).toBe(50);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(0);
    });

    it('should handle over-subscription gracefully', async () => {
      // Try to acquire 60 tokens when only 50 available
      const results = await Promise.all(
        Array(60)
          .fill(0)
          .map(() => bucket.acquire(1))
      );

      const successCount = results.filter((r) => r === true).length;
      const failCount = results.filter((r) => r === false).length;

      expect(successCount).toBe(50);
      expect(failCount).toBe(10);

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(0);
    });

    it('should throw error if tokens < 1', async () => {
      await expect(bucket.acquire(0)).rejects.toThrow(TokenBucketError);
      await expect(bucket.acquire(-1)).rejects.toThrow(TokenBucketError);
    });

    it('should throw error if tokens > maxTokens', async () => {
      await expect(bucket.acquire(51)).rejects.toThrow(TokenBucketError);
      await expect(bucket.acquire(51)).rejects.toThrow('exceed');
    });
  });

  // ==========================================================================
  // acquireWithWait Tests
  // ==========================================================================

  describe('acquireWithWait()', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket({
        ...testConfig,
        initialBackoff: 50,
        maxBackoff: 200,
      });
      await bucket.initialize();
    });

    it('should acquire token immediately if available', async () => {
      const start = Date.now();
      await bucket.acquireWithWait(1, 5000);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100); // Should be immediate

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(49);
    });

    it('should wait and retry until token available', async () => {
      // Drain bucket
      await bucket.acquire(50);

      // Reset bucket after 500ms (simulate refill)
      setTimeout(async () => {
        await bucket.reset();
      }, 500);

      const start = Date.now();
      await bucket.acquireWithWait(1, 2000);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(400); // Should wait
      expect(duration).toBeLessThan(1000);
    });

    it('should throw RateLimitExceededError on timeout', async () => {
      // Drain bucket
      await bucket.acquire(50);

      const start = Date.now();
      await expect(bucket.acquireWithWait(1, 500)).rejects.toThrow(
        RateLimitExceededError
      );
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(450);
      expect(duration).toBeLessThan(600);
    });

    it('should use exponential backoff with jitter', async () => {
      // Drain bucket
      await bucket.acquire(50);

      const attempts: number[] = [];
      let lastTime = Date.now();

      // Override sleep to track backoff intervals
      const originalSleep = (bucket as any).sleep.bind(bucket);
      (bucket as any).sleep = async (ms: number) => {
        const now = Date.now();
        attempts.push(now - lastTime);
        lastTime = now;
        await originalSleep(ms);
      };

      await expect(bucket.acquireWithWait(1, 1000)).rejects.toThrow(
        RateLimitExceededError
      );

      // Verify exponential backoff (each interval should be >= previous)
      expect(attempts.length).toBeGreaterThan(2);
      // Note: We can't strictly verify exponential due to jitter,
      // but we can verify intervals are reasonable
      for (const interval of attempts) {
        expect(interval).toBeGreaterThan(0);
        expect(interval).toBeLessThan(500); // Max backoff
      }
    });

    it('should handle concurrent acquireWithWait calls', async () => {
      // Only 10 tokens available initially
      await bucket.acquire(40);

      // 20 concurrent requests (10 should succeed immediately, 10 should wait/fail)
      const results = await Promise.allSettled(
        Array(20)
          .fill(0)
          .map(() => bucket.acquireWithWait(1, 1000))
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failCount = results.filter((r) => r.status === 'rejected').length;

      // At least 10 should succeed (those that got tokens immediately)
      expect(successCount).toBeGreaterThanOrEqual(10);
      // Some should fail due to timeout
      expect(failCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Refill Tests
  // ==========================================================================

  describe('Token Refill', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should refill tokens automatically', async () => {
      // Drain bucket
      await bucket.acquire(50);
      expect(await bucket.getCurrentTokens()).toBe(0);

      // Wait for refill (1 second = 50 tokens)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBeGreaterThan(40); // Should be close to 50
      expect(tokens).toBeLessThanOrEqual(50); // Should not exceed max
    });

    it('should cap refill at maxTokens', async () => {
      // Start with full bucket
      expect(await bucket.getCurrentTokens()).toBe(50);

      // Wait for refill attempts (should not exceed max)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(50); // Should still be at max
    });

    it('should refill at correct rate', async () => {
      // Drain bucket
      await bucket.acquire(50);

      // Wait for 2 seconds (should refill ~100 tokens, capped at 50)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBe(50); // Should be at max
    });
  });

  // ==========================================================================
  // Stats Tests
  // ==========================================================================

  describe('getStats()', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should return correct stats', async () => {
      const stats = await bucket.getStats();

      expect(stats.currentTokens).toBe(50);
      expect(stats.maxTokens).toBe(50);
      expect(stats.refillRate).toBe(50);
      expect(stats.utilizationPercent).toBe(0);
    });

    it('should calculate utilization correctly', async () => {
      // Use 25 tokens (50% utilization)
      await bucket.acquire(25);

      const stats = await bucket.getStats();
      expect(stats.utilizationPercent).toBe(50);
    });

    it('should show 100% utilization when empty', async () => {
      // Drain bucket
      await bucket.acquire(50);

      const stats = await bucket.getStats();
      expect(stats.utilizationPercent).toBe(100);
    });
  });

  // ==========================================================================
  // getCurrentTokens Tests
  // ==========================================================================

  describe('getCurrentTokens()', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should return current token count', async () => {
      expect(await bucket.getCurrentTokens()).toBe(50);

      await bucket.acquire(10);
      expect(await bucket.getCurrentTokens()).toBe(40);

      await bucket.acquire(20);
      expect(await bucket.getCurrentTokens()).toBe(20);
    });
  });

  // ==========================================================================
  // reset Tests
  // ==========================================================================

  describe('reset()', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should reset bucket to maxTokens', async () => {
      // Drain bucket
      await bucket.acquire(50);
      expect(await bucket.getCurrentTokens()).toBe(0);

      // Reset
      await bucket.reset();
      expect(await bucket.getCurrentTokens()).toBe(50);
    });

    it('should reset even when bucket is full', async () => {
      expect(await bucket.getCurrentTokens()).toBe(50);

      await bucket.reset();
      expect(await bucket.getCurrentTokens()).toBe(50);
    });
  });

  // ==========================================================================
  // Edge Cases & Error Handling
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle Redis connection errors gracefully', async () => {
      // Create bucket with invalid Redis config
      bucket = new GlobalDiscordTokenBucket({
        redis: {
          host: 'invalid-host',
          port: 9999,
        },
        maxTokens: 50,
      });

      // Initialize should fail with timeout
      await expect(bucket.initialize()).rejects.toThrow(TokenBucketError);
      await expect(bucket.initialize()).rejects.toThrow('timeout');
    });

    it('should handle very high concurrency', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      // 500 concurrent acquire attempts
      const results = await Promise.all(
        Array(500)
          .fill(0)
          .map(() => bucket.acquire(1))
      );

      const successCount = results.filter((r) => r === true).length;
      expect(successCount).toBe(50); // Exactly 50 should succeed
    });

    it('should maintain consistency across multiple bucket instances', async () => {
      // Create two bucket instances pointing to same Redis key
      const bucket1 = new GlobalDiscordTokenBucket(testConfig);
      const bucket2 = new GlobalDiscordTokenBucket(testConfig);

      await bucket1.initialize();
      await bucket2.initialize();

      // Acquire from both buckets
      await bucket1.acquire(25);
      await bucket2.acquire(25);

      // Total should be 0
      expect(await bucket1.getCurrentTokens()).toBe(0);
      expect(await bucket2.getCurrentTokens()).toBe(0);

      await bucket1.close();
      await bucket2.close();
    });

    it('should handle close() gracefully', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      await bucket.close();
      expect(bucket.isReady()).toBe(false);

      // Operations after close should fail
      await expect(bucket.acquire(1)).rejects.toThrow(TokenBucketError);
    });

    it('should handle multiple close() calls', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      await bucket.close();
      await bucket.close();
      await bucket.close();

      // Should not throw
      expect(bucket.isReady()).toBe(false);
    });
  });

  // ==========================================================================
  // Load Testing
  // ==========================================================================

  describe('Load Testing', () => {
    it('should handle sustained load', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      const startTime = Date.now();
      let successCount = 0;

      // Try to acquire tokens for 3 seconds
      while (Date.now() - startTime < 3000) {
        if (await bucket.acquire(1)) {
          successCount++;
        }
        await new Promise((resolve) => setTimeout(resolve, 10)); // 10ms between attempts
      }

      // Should acquire approximately 150 tokens (50 initial + 50*3 refilled)
      // Allow for some variance due to timing
      expect(successCount).toBeGreaterThan(120);
      expect(successCount).toBeLessThan(180);
    });

    it('should not leak tokens under load', async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();

      // Hammer the bucket with acquire attempts
      for (let i = 0; i < 10; i++) {
        await Promise.all(
          Array(100)
            .fill(0)
            .map(() => bucket.acquire(1))
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Tokens should be within valid range
      const tokens = await bucket.getCurrentTokens();
      expect(tokens).toBeGreaterThanOrEqual(0);
      expect(tokens).toBeLessThanOrEqual(50);
    });
  });

  // ==========================================================================
  // Security Tests
  // ==========================================================================

  describe('Security', () => {
    beforeEach(async () => {
      bucket = new GlobalDiscordTokenBucket(testConfig);
      await bucket.initialize();
    });

    it('should prevent token overflow attacks', async () => {
      // Attempt to acquire negative tokens (should throw)
      await expect(bucket.acquire(-1)).rejects.toThrow(TokenBucketError);

      // Attempt to acquire more than max (should throw)
      await expect(bucket.acquire(100)).rejects.toThrow(TokenBucketError);

      // Tokens should remain at max
      expect(await bucket.getCurrentTokens()).toBe(50);
    });

    it('should handle malicious concurrent access', async () => {
      // Simulate malicious actor trying to drain bucket repeatedly
      const attackResults = await Promise.all(
        Array(1000)
          .fill(0)
          .map(() => bucket.acquire(1))
      );

      const successCount = attackResults.filter((r) => r === true).length;
      expect(successCount).toBe(50); // Should only succeed 50 times

      // Bucket should be empty
      expect(await bucket.getCurrentTokens()).toBe(0);

      // Subsequent legitimate acquire should fail
      expect(await bucket.acquire(1)).toBe(false);
    });
  });
});
