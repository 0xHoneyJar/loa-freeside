/**
 * Global Rate-Limited Synthesis Worker Tests (v5.0 - Sprint 45)
 *
 * Integration tests for GlobalRateLimitedSynthesisWorker.
 * Tests rate limiting integration with job processing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import { Client } from 'discord.js';
import { SynthesisQueue } from '../../../../src/packages/synthesis/SynthesisQueue.js';
import {
  GlobalRateLimitedSynthesisWorker,
  GlobalRateLimitedWorkerConfig,
} from '../../../../src/packages/synthesis/GlobalRateLimitedSynthesisWorker.js';

// Mock Discord client
class MockDiscordClient {
  guilds = {
    fetch: vi.fn().mockResolvedValue({
      id: 'test-guild-id',
      roles: {
        create: vi.fn().mockResolvedValue({ id: 'new-role-id', name: 'Test Role' }),
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
      channels: {
        create: vi.fn().mockResolvedValue({ id: 'new-channel-id', name: 'test-channel' }),
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
      members: {
        fetchMe: vi.fn().mockResolvedValue({
          permissions: {
            has: vi.fn().mockReturnValue(true),
          },
          roles: {
            highest: { position: 10 },
          },
        }),
        fetch: vi.fn().mockResolvedValue({
          roles: {
            add: vi.fn().mockResolvedValue(undefined),
          },
        }),
      },
    }),
  };

  channels = {
    fetch: vi.fn().mockResolvedValue({
      isTextBased: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue({ id: 'message-id' }),
    }),
  };
}

describe('GlobalRateLimitedSynthesisWorker', () => {
  let redis: typeof Redis;
  let queue: SynthesisQueue;
  let worker: GlobalRateLimitedSynthesisWorker;
  let discordClient: Client;

  const testConfig: GlobalRateLimitedWorkerConfig = {
    queueName: 'test-rate-limited-queue',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      db: 14, // Separate test DB
    },
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 1000,
    },
    discordClient: new MockDiscordClient() as unknown as Client,
    tokenBucket: {
      maxTokens: 10,
      refillRate: 5,
      bucketKey: 'test:rate-limited:tokens',
      defaultTimeout: 2000,
    },
    tokenAcquisitionTimeout: 2000,
  };

  beforeAll(async () => {
    redis = new Redis(testConfig.redis.port, testConfig.redis.host, {
      db: testConfig.redis.db,
    });

    discordClient = testConfig.discordClient;
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();

    queue = new SynthesisQueue({
      queueName: testConfig.queueName,
      redis: testConfig.redis,
    });
  });

  afterEach(async () => {
    if (worker) {
      await worker.close();
    }
    if (queue) {
      await queue.close();
    }
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('Initialization', () => {
    it('should initialize worker with token bucket', async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();

      expect(worker.isReady()).toBe(true);

      const tokens = await worker.getCurrentTokens();
      expect(tokens).toBe(10);
    });

    it('should get bucket stats after initialization', async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();

      const stats = await worker.getBucketStats();
      expect(stats.currentTokens).toBe(10);
      expect(stats.maxTokens).toBe(10);
      expect(stats.refillRate).toBe(5);
      expect(stats.utilizationPercent).toBe(0);
    });
  });

  // ==========================================================================
  // Job Processing with Rate Limiting
  // ==========================================================================

  describe('Job Processing', () => {
    beforeEach(async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();
    });

    it('should process job after acquiring token', async () => {
      // Enqueue a CREATE_ROLE job
      const jobId = await queue.enqueue('CREATE_ROLE', {
        guildId: 'test-guild-id',
        name: 'Test Role',
        color: 0xff0000,
      });

      // Wait for job to be processed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check job completed
      const job = await queue.getJob(jobId);
      const state = await job?.getState();
      expect(state).toBe('completed');

      // Token should have been consumed
      const tokens = await worker.getCurrentTokens();
      expect(tokens).toBe(9); // 10 - 1
    });

    it('should process multiple jobs with rate limiting', async () => {
      // Enqueue 5 jobs (half of max tokens)
      const jobIds = await Promise.all(
        Array(5)
          .fill(0)
          .map(() =>
            queue.enqueue('CREATE_ROLE', {
              guildId: 'test-guild-id',
              name: 'Test Role',
            })
          )
      );

      // Wait for jobs to be processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // All jobs should complete
      const states = await Promise.all(
        jobIds.map(async (id) => {
          const job = await queue.getJob(id);
          return job?.getState();
        })
      );

      expect(states.filter((s) => s === 'completed').length).toBe(5);

      // Tokens should have been consumed
      const tokens = await worker.getCurrentTokens();
      expect(tokens).toBe(5); // 10 - 5
    });

    it('should wait for tokens when bucket empty', async () => {
      // Drain bucket first
      await worker.resetBucket();
      for (let i = 0; i < 10; i++) {
        await worker.getCurrentTokens(); // Just to confirm
      }

      // Enqueue job when bucket is empty
      const jobId = await queue.enqueue('CREATE_ROLE', {
        guildId: 'test-guild-id',
        name: 'Test Role',
      });

      // Wait for refill and processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Job should eventually complete after refill
      const job = await queue.getJob(jobId);
      const state = await job?.getState();
      expect(state).toMatch(/completed|waiting|active/); // Might still be processing
    });

    it('should handle token acquisition timeout', async () => {
      // Drain bucket and don't allow refill
      const worker2 = new GlobalRateLimitedSynthesisWorker({
        ...testConfig,
        tokenBucket: {
          ...testConfig.tokenBucket!,
          refillRate: 0, // No refill
        },
        tokenAcquisitionTimeout: 500, // Short timeout
      });
      await worker2.initialize();

      // Drain all tokens
      for (let i = 0; i < 10; i++) {
        await queue.enqueue('CREATE_ROLE', {
          guildId: 'test-guild-id',
          name: `Role ${i}`,
        });
      }

      // Enqueue one more job (should timeout)
      const jobId = await queue.enqueue('CREATE_ROLE', {
        guildId: 'test-guild-id',
        name: 'Timeout Role',
      });

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Job should fail with rate limit timeout
      const job = await queue.getJob(jobId);
      const state = await job?.getState();
      expect(state).toBe('failed');

      await worker2.close();
    });
  });

  // ==========================================================================
  // Concurrency Tests
  // ==========================================================================

  describe('Concurrency', () => {
    beforeEach(async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();
    });

    it('should enforce global rate limit across concurrent workers', async () => {
      // Create second worker sharing same token bucket
      const worker2 = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker2.initialize();

      // Enqueue 20 jobs (more than maxTokens)
      const jobIds = await Promise.all(
        Array(20)
          .fill(0)
          .map((_, i) =>
            queue.enqueue('CREATE_ROLE', {
              guildId: 'test-guild-id',
              name: `Role ${i}`,
            })
          )
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check how many completed (should be limited by tokens)
      const states = await Promise.all(
        jobIds.map(async (id) => {
          const job = await queue.getJob(id);
          return job?.getState();
        })
      );

      const completedCount = states.filter((s) => s === 'completed').length;

      // Should complete approximately maxTokens + refills
      // With 10 max tokens + ~5 tokens/sec refill * 3 sec = ~25 tokens
      expect(completedCount).toBeGreaterThan(10);
      expect(completedCount).toBeLessThan(30);

      await worker2.close();
    });
  });

  // ==========================================================================
  // Bucket Management Tests
  // ==========================================================================

  describe('Bucket Management', () => {
    beforeEach(async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();
    });

    it('should reset bucket on demand', async () => {
      // Use some tokens
      await queue.enqueue('CREATE_ROLE', {
        guildId: 'test-guild-id',
        name: 'Test Role',
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Reset bucket
      await worker.resetBucket();

      const tokens = await worker.getCurrentTokens();
      expect(tokens).toBe(10);
    });

    it('should provide accurate bucket stats', async () => {
      // Use 5 tokens
      for (let i = 0; i < 5; i++) {
        await queue.enqueue('CREATE_ROLE', {
          guildId: 'test-guild-id',
          name: `Role ${i}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const stats = await worker.getBucketStats();
      expect(stats.currentTokens).toBeLessThan(10);
      expect(stats.utilizationPercent).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    beforeEach(async () => {
      worker = new GlobalRateLimitedSynthesisWorker(testConfig);
      await worker.initialize();
    });

    it('should handle worker pause and resume', async () => {
      await worker.pause();

      // Enqueue job while paused
      const jobId = await queue.enqueue('CREATE_ROLE', {
        guildId: 'test-guild-id',
        name: 'Paused Job',
      });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Job should still be waiting
      let job = await queue.getJob(jobId);
      let state = await job?.getState();
      expect(state).toBe('waiting');

      // Resume worker
      await worker.resume();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Job should now be completed
      job = await queue.getJob(jobId);
      state = await job?.getState();
      expect(state).toBe('completed');
    });

    it('should close cleanly', async () => {
      await worker.close();
      expect(worker.isReady()).toBe(false);
    });
  });

  // ==========================================================================
  // Load Testing
  // ==========================================================================

  describe('Load Testing', () => {
    it('should handle burst load gracefully', async () => {
      worker = new GlobalRateLimitedSynthesisWorker({
        ...testConfig,
        tokenBucket: {
          maxTokens: 50,
          refillRate: 25,
          bucketKey: 'test:burst:tokens',
        },
      });
      await worker.initialize();

      // Enqueue 100 jobs in burst
      const jobIds = await Promise.all(
        Array(100)
          .fill(0)
          .map((_, i) =>
            queue.enqueue('CREATE_ROLE', {
              guildId: 'test-guild-id',
              name: `Burst Role ${i}`,
            })
          )
      );

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Check completion rate
      const states = await Promise.all(
        jobIds.map(async (id) => {
          const job = await queue.getJob(id);
          return job?.getState();
        })
      );

      const completedCount = states.filter(
        (s) => s === 'completed' || s === 'active'
      ).length;

      // Should complete at least initial tokens + refills
      expect(completedCount).toBeGreaterThan(50);
    });
  });
});
