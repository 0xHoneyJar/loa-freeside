/**
 * SynthesisEngine Tests
 *
 * Sprint S-21: Synthesis Engine & Rate Limiting
 *
 * Tests for BullMQ-based synthesis engine with:
 * - Job enqueueing and processing
 * - Idempotency key handling
 * - Discord 429 error handling
 * - Batch synthesis operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SynthesisEngine, createSynthesisEngine } from '../engine.js';
import type {
  BullMQQueue,
  BullMQWorker,
  BullMQJob,
  QueueFactory,
  DiscordRestClient,
  RedisClient,
} from '../engine.js';
import type { IGlobalTokenBucket, SynthesisJob } from '@freeside/core/ports';
import type { SynthesisMetrics } from '../metrics.js';
import type { CommunityManifest } from '@freeside/core/domain';

// =============================================================================
// Mock Implementations
// =============================================================================

class MockBullMQQueue implements BullMQQueue {
  jobs: Map<string, BullMQJob> = new Map();
  private idCounter = 0;

  async add(name: string, data: unknown, _opts?: unknown): Promise<{ id: string }> {
    const id = `job-${++this.idCounter}`;
    const job: BullMQJob = {
      id,
      name,
      data: data as SynthesisJob,
      progress: 0,
      attemptsMade: 0,
      timestamp: Date.now(),
      getState: async () => 'waiting',
      remove: async () => {
        this.jobs.delete(id);
      },
      retry: async () => {},
    };
    this.jobs.set(id, job);
    return { id };
  }

  async addBulk(
    jobs: Array<{ name: string; data: unknown; opts?: unknown }>
  ): Promise<Array<{ id: string }>> {
    const results: Array<{ id: string }> = [];
    for (const job of jobs) {
      const result = await this.add(job.name, job.data, job.opts);
      results.push(result);
    }
    return results;
  }

  async getJob(jobId: string): Promise<BullMQJob | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getJobs(_statuses: string[]): Promise<BullMQJob[]> {
    return Array.from(this.jobs.values());
  }

  async getJobCounts(): Promise<Record<string, number>> {
    return {
      waiting: this.jobs.size,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };
  }

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

class MockBullMQWorker implements BullMQWorker {
  private eventHandlers: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  on(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async close(): Promise<void> {}
}

const createMockQueueFactory = (): QueueFactory & {
  queue: MockBullMQQueue;
  worker: MockBullMQWorker;
  processor: ((job: BullMQJob) => Promise<void>) | null;
} => {
  const queue = new MockBullMQQueue();
  const worker = new MockBullMQWorker();
  let processor: ((job: BullMQJob) => Promise<void>) | null = null;

  return {
    queue,
    worker,
    get processor() {
      return processor;
    },
    createQueue: () => queue,
    createWorker: (_name: string, proc: (job: BullMQJob) => Promise<void>) => {
      processor = proc;
      return worker;
    },
  };
};

const createMockRedisClient = (): RedisClient & { idempotencyKeys: Set<string> } => {
  const idempotencyKeys = new Set<string>();

  return {
    idempotencyKeys,
    get: async (key: string) => (idempotencyKeys.has(key) ? '1' : null),
    setex: async (key: string, _seconds: number, _value: string) => {
      idempotencyKeys.add(key);
      return 'OK';
    },
    exists: async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (idempotencyKeys.has(key)) count++;
      }
      return count;
    },
    incr: async () => 1,
    expire: async () => 1,
  };
};

const createMockTokenBucket = (): IGlobalTokenBucket => ({
  acquireWithWait: vi.fn().mockResolvedValue(undefined),
  tryAcquire: vi.fn().mockResolvedValue(true),
  getStatus: vi.fn().mockResolvedValue({
    tokens: 50,
    maxTokens: 50,
    refillRate: 50,
    lastRefillAt: new Date(),
  }),
  reset: vi.fn().mockResolvedValue(undefined),
});

const createMockDiscordRest = (): DiscordRestClient => ({
  createRole: vi.fn().mockResolvedValue({ id: 'role-123' }),
  deleteRole: vi.fn().mockResolvedValue(undefined),
  assignRole: vi.fn().mockResolvedValue(undefined),
  removeRole: vi.fn().mockResolvedValue(undefined),
  createChannel: vi.fn().mockResolvedValue({ id: 'channel-123' }),
  deleteChannel: vi.fn().mockResolvedValue(undefined),
  updateChannelPermissions: vi.fn().mockResolvedValue(undefined),
});

const createMockMetrics = (): SynthesisMetrics => ({
  tokenBucketExhausted: { inc: vi.fn() },
  tokenBucketWaits: { inc: vi.fn() },
  tokensAcquired: { inc: vi.fn() },
  currentTokens: { set: vi.fn(), inc: vi.fn(), dec: vi.fn() },
  discord429Errors: { inc: vi.fn() },
  discord429GlobalErrors: { inc: vi.fn() },
  discord429RetryAfter: { observe: vi.fn() },
  jobsEnqueued: { inc: vi.fn() },
  jobsCompleted: { inc: vi.fn() },
  jobsFailed: { inc: vi.fn() },
  jobsRetried: { inc: vi.fn() },
  jobsWaiting: { set: vi.fn(), inc: vi.fn(), dec: vi.fn() },
  jobsActive: { set: vi.fn(), inc: vi.fn(), dec: vi.fn() },
  jobDuration: { observe: vi.fn() },
  idempotencyHits: { inc: vi.fn() },
  idempotencyMisses: { inc: vi.fn() },
});

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

// =============================================================================
// Tests
// =============================================================================

describe('SynthesisEngine', () => {
  let queueFactory: ReturnType<typeof createMockQueueFactory>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let tokenBucket: IGlobalTokenBucket;
  let discordRest: DiscordRestClient;
  let metrics: SynthesisMetrics;
  let logger: ReturnType<typeof createMockLogger>;
  let engine: SynthesisEngine;

  beforeEach(() => {
    queueFactory = createMockQueueFactory();
    redis = createMockRedisClient();
    tokenBucket = createMockTokenBucket();
    discordRest = createMockDiscordRest();
    metrics = createMockMetrics();
    logger = createMockLogger();

    engine = new SynthesisEngine({
      redis,
      queueFactory,
      tokenBucket,
      discordRest,
      logger: logger as unknown as import('pino').Logger,
      metrics,
      redisConnection: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 5,
          rateLimit: '10/sec',
        }),
        'Synthesis engine initialized'
      );
    });

    it('should create queue and worker via factory', () => {
      expect(queueFactory.queue).toBeDefined();
      expect(queueFactory.worker).toBeDefined();
    });
  });

  // ===========================================================================
  // Enqueue Tests
  // ===========================================================================

  describe('enqueue', () => {
    it('should enqueue a job and return job ID', async () => {
      const job: SynthesisJob = {
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role', color: 0xff0000 },
        idempotencyKey: 'test-key',
      };

      const jobId = await engine.enqueue(job);

      expect(jobId).toBe('job-1');
      expect(queueFactory.queue.jobs.size).toBe(1);
    });

    it('should track enqueued job in metrics', async () => {
      const job: SynthesisJob = {
        type: 'delete_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { roleId: 'role-123' },
        idempotencyKey: 'delete-key',
      };

      await engine.enqueue(job);

      expect(metrics.jobsEnqueued.inc).toHaveBeenCalledWith({ type: 'delete_role' });
    });

    it('should accept priority and delay options', async () => {
      const job: SynthesisJob = {
        type: 'assign_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { userId: 'user-123', roleId: 'role-123' },
        idempotencyKey: 'assign-key',
      };

      const jobId = await engine.enqueue(job, { priority: 10, delay: 5000 });

      expect(jobId).toBeDefined();
    });
  });

  // ===========================================================================
  // Batch Synthesis Tests
  // ===========================================================================

  describe('enqueueSynthesis', () => {
    it('should enqueue batch jobs from manifest', async () => {
      const manifest: CommunityManifest = {
        communityId: 'community-123',
        communityName: 'Test Community',
        guildId: 'guild-123',
        eligibilityContract: '0x1234567890123456789012345678901234567890',
        tierRoles: [
          {
            tierId: 'tier-1',
            tierName: 'Bronze',
            roleName: 'Bronze Member',
            roleColor: 0xcd7f32,
            mentionable: true,
            hoist: true,
          },
          {
            tierId: 'tier-2',
            tierName: 'Silver',
            roleName: 'Silver Member',
            roleColor: 0xc0c0c0,
            mentionable: true,
            hoist: true,
          },
        ],
        channelTemplate: 'standard',
        channels: [
          {
            name: 'welcome',
            type: 'text',
            topic: 'Welcome channel',
          },
        ],
        createdAt: new Date(),
        version: 1,
      };

      const result = await engine.enqueueSynthesis('community-123', 'guild-123', manifest);

      expect(result.jobCount).toBe(3); // 2 roles + 1 channel
      expect(result.jobIds).toHaveLength(3);
      expect(result.communityId).toBe('community-123');
      expect(result.guildId).toBe('guild-123');
    });

    it('should skip channels when channelTemplate is none', async () => {
      const manifest: CommunityManifest = {
        communityId: 'community-123',
        communityName: 'Test Community',
        guildId: 'guild-123',
        eligibilityContract: '0x1234567890123456789012345678901234567890',
        tierRoles: [
          {
            tierId: 'tier-1',
            tierName: 'Bronze',
            roleName: 'Bronze Member',
            roleColor: 0xcd7f32,
            mentionable: true,
            hoist: true,
          },
        ],
        channelTemplate: 'none',
        channels: [],
        createdAt: new Date(),
        version: 1,
      };

      const result = await engine.enqueueSynthesis('community-123', 'guild-123', manifest);

      expect(result.jobCount).toBe(1); // Only 1 role, no channels
    });

    it('should track batch jobs in metrics', async () => {
      const manifest: CommunityManifest = {
        communityId: 'community-123',
        communityName: 'Test Community',
        guildId: 'guild-123',
        eligibilityContract: '0x1234567890123456789012345678901234567890',
        tierRoles: [
          {
            tierId: 'tier-1',
            tierName: 'Bronze',
            roleName: 'Bronze Member',
            roleColor: 0xcd7f32,
            mentionable: true,
            hoist: true,
          },
        ],
        channelTemplate: 'none',
        channels: [],
        createdAt: new Date(),
        version: 1,
      };

      await engine.enqueueSynthesis('community-123', 'guild-123', manifest);

      expect(metrics.jobsEnqueued.inc).toHaveBeenCalledWith({ type: 'create_role' });
    });
  });

  // ===========================================================================
  // Job Retrieval Tests
  // ===========================================================================

  describe('getJob', () => {
    it('should return job info for existing job', async () => {
      const job: SynthesisJob = {
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role' },
        idempotencyKey: 'test-key',
      };

      const jobId = await engine.enqueue(job);
      const jobInfo = await engine.getJob(jobId);

      expect(jobInfo).not.toBeNull();
      expect(jobInfo?.jobId).toBe(jobId);
      expect(jobInfo?.data.type).toBe('create_role');
    });

    it('should return null for non-existent job', async () => {
      const jobInfo = await engine.getJob('non-existent-job');

      expect(jobInfo).toBeNull();
    });
  });

  describe('getJobsByCommunity', () => {
    it('should return jobs for specific community', async () => {
      await engine.enqueue({
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-A',
        payload: { name: 'Role A' },
        idempotencyKey: 'key-a',
      });

      await engine.enqueue({
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-B',
        payload: { name: 'Role B' },
        idempotencyKey: 'key-b',
      });

      const jobs = await engine.getJobsByCommunity('community-A');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].data.communityId).toBe('community-A');
    });
  });

  // ===========================================================================
  // Job Cancellation Tests
  // ===========================================================================

  describe('cancelJob', () => {
    it('should cancel waiting job', async () => {
      const job: SynthesisJob = {
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role' },
        idempotencyKey: 'test-key',
      };

      const jobId = await engine.enqueue(job);
      const cancelled = await engine.cancelJob(jobId);

      expect(cancelled).toBe(true);
      expect(queueFactory.queue.jobs.size).toBe(0);
    });

    it('should return false for non-existent job', async () => {
      const cancelled = await engine.cancelJob('non-existent');

      expect(cancelled).toBe(false);
    });
  });

  // ===========================================================================
  // Job Retry Tests
  // ===========================================================================

  describe('retryJob', () => {
    it('should return null for non-existent job', async () => {
      const result = await engine.retryJob('non-existent');

      expect(result).toBeNull();
    });

    it('should retry failed job', async () => {
      // Enqueue a job
      const job: SynthesisJob = {
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role' },
        idempotencyKey: 'test-key',
      };

      const jobId = await engine.enqueue(job);

      // Mock the job as failed
      const queueJob = queueFactory.queue.jobs.get(jobId)!;
      queueJob.getState = async () => 'failed';

      const result = await engine.retryJob(jobId);

      expect(result).toBe(jobId);
      expect(metrics.jobsRetried.inc).toHaveBeenCalledWith({ type: 'create_role' });
    });
  });

  // ===========================================================================
  // Token Bucket Tests
  // ===========================================================================

  describe('getTokenBucketStatus', () => {
    it('should return token bucket status', async () => {
      const status = await engine.getTokenBucketStatus();

      expect(status.tokens).toBe(50);
      expect(status.maxTokens).toBe(50);
      expect(status.refillRate).toBe(50);
      expect(tokenBucket.getStatus).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Stats Tests
  // ===========================================================================

  describe('getStats', () => {
    it('should return engine stats', async () => {
      await engine.enqueue({
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role' },
        idempotencyKey: 'test-key',
      });

      const stats = await engine.getStats();

      expect(stats.waiting).toBeGreaterThanOrEqual(0);
      expect(stats.tokenBucket).toBeDefined();
      expect(stats.tokenBucket.maxTokens).toBe(50);
    });
  });

  // ===========================================================================
  // Idempotency Tests
  // ===========================================================================

  describe('isProcessed', () => {
    it('should return false for unprocessed key', async () => {
      const result = await engine.isProcessed('new-key');

      expect(result).toBe(false);
    });

    it('should return true for processed key', async () => {
      redis.idempotencyKeys.add('synthesis:idempotency:processed-key');

      const result = await engine.isProcessed('processed-key');

      expect(result).toBe(true);
    });
  });

  // ===========================================================================
  // Lifecycle Tests
  // ===========================================================================

  describe('lifecycle', () => {
    it('should pause and resume', async () => {
      await engine.pause();
      expect(logger.info).toHaveBeenCalledWith('Synthesis engine paused');

      await engine.resume();
      expect(logger.info).toHaveBeenCalledWith('Synthesis engine resumed');
    });

    it('should close gracefully', async () => {
      await engine.close();

      expect(logger.info).toHaveBeenCalledWith('Synthesis engine closed');
    });
  });

  // ===========================================================================
  // Factory Tests
  // ===========================================================================

  describe('createSynthesisEngine', () => {
    it('should create engine instance via factory', () => {
      const factoryEngine = createSynthesisEngine({
        redis,
        queueFactory,
        tokenBucket,
        discordRest,
        logger: logger as unknown as import('pino').Logger,
        metrics,
        redisConnection: {},
      });

      expect(factoryEngine).toBeDefined();
    });
  });
});

// =============================================================================
// Job Processing Tests (via mock processor)
// =============================================================================

describe('SynthesisEngine Job Processing', () => {
  let queueFactory: ReturnType<typeof createMockQueueFactory>;
  let redis: ReturnType<typeof createMockRedisClient>;
  let tokenBucket: IGlobalTokenBucket;
  let discordRest: DiscordRestClient;
  let metrics: SynthesisMetrics;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    queueFactory = createMockQueueFactory();
    redis = createMockRedisClient();
    tokenBucket = createMockTokenBucket();
    discordRest = createMockDiscordRest();
    metrics = createMockMetrics();
    logger = createMockLogger();

    new SynthesisEngine({
      redis,
      queueFactory,
      tokenBucket,
      discordRest,
      logger: logger as unknown as import('pino').Logger,
      metrics,
      redisConnection: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('processJob', () => {
    it('should acquire token before processing', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'test-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(tokenBucket.acquireWithWait).toHaveBeenCalled();
    });

    it('should call Discord REST for create_role', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role', color: 0xff0000 },
          idempotencyKey: 'test-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.createRole).toHaveBeenCalledWith('guild-123', {
        name: 'Test Role',
        color: 0xff0000,
      });
    });

    it('should call Discord REST for delete_role', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'delete_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { roleId: 'role-456' },
          idempotencyKey: 'delete-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.deleteRole).toHaveBeenCalledWith('guild-123', 'role-456');
    });

    it('should call Discord REST for assign_role', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'assign_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { userId: 'user-123', roleId: 'role-456' },
          idempotencyKey: 'assign-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.assignRole).toHaveBeenCalledWith('guild-123', 'user-123', 'role-456');
    });

    it('should call Discord REST for remove_role', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'remove_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { userId: 'user-123', roleId: 'role-456' },
          idempotencyKey: 'remove-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.removeRole).toHaveBeenCalledWith('guild-123', 'user-123', 'role-456');
    });

    it('should call Discord REST for create_channel', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_channel',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'test-channel', type: 'text' },
          idempotencyKey: 'channel-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.createChannel).toHaveBeenCalledWith('guild-123', {
        name: 'test-channel',
        type: 'text',
      });
    });

    it('should call Discord REST for delete_channel', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'delete_channel',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { channelId: 'channel-456' },
          idempotencyKey: 'delete-channel-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.deleteChannel).toHaveBeenCalledWith('channel-456');
    });

    it('should call Discord REST for update_permissions', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'update_permissions',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { channelId: 'channel-456', overwrites: [{ id: 'role-1', allow: '1024' }] },
          idempotencyKey: 'perm-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.updateChannelPermissions).toHaveBeenCalledWith('channel-456', [
        { id: 'role-1', allow: '1024' },
      ]);
    });

    it('should skip processing for already processed idempotency key', async () => {
      // Pre-add idempotency key
      redis.idempotencyKeys.add('synthesis:idempotency:already-processed');

      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'already-processed',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(discordRest.createRole).not.toHaveBeenCalled();
      expect(metrics.idempotencyHits.inc).toHaveBeenCalled();
    });

    it('should record idempotency miss for new job', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'new-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(metrics.idempotencyMisses.inc).toHaveBeenCalled();
    });

    it('should mark job as processed after completion', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'complete-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(redis.idempotencyKeys.has('synthesis:idempotency:complete-key')).toBe(true);
    });

    it('should record job completion metrics', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'metrics-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await queueFactory.processor!(job);

      expect(metrics.jobsCompleted.inc).toHaveBeenCalledWith({ type: 'create_role' });
      expect(metrics.jobDuration.observe).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should track Discord 429 error in metrics', async () => {
      (discordRest.createRole as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('429 Rate Limited')
      );

      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'error-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await expect(queueFactory.processor!(job)).rejects.toThrow('429');

      expect(metrics.discord429Errors.inc).toHaveBeenCalled();
    });

    it('should track global 429 errors separately', async () => {
      const error = new Error('429 Rate Limited');
      (error as unknown as { global: boolean }).global = true;
      (discordRest.createRole as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'global-error-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await expect(queueFactory.processor!(job)).rejects.toThrow('429');

      expect(metrics.discord429GlobalErrors.inc).toHaveBeenCalled();
    });

    it('should record failed job metrics for non-rate-limit errors', async () => {
      (discordRest.createRole as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('403 Forbidden')
      );

      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: { name: 'Test Role' },
          idempotencyKey: 'forbidden-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await expect(queueFactory.processor!(job)).rejects.toThrow('403');

      expect(metrics.jobsFailed.inc).toHaveBeenCalledWith({
        type: 'create_role',
        reason: 'forbidden',
      });
    });

    it('should throw error for unknown operation type', async () => {
      const job: BullMQJob = {
        id: 'job-1',
        name: 'test-job',
        data: {
          type: 'unknown_operation' as 'create_role',
          guildId: 'guild-123',
          communityId: 'community-123',
          payload: {},
          idempotencyKey: 'unknown-key',
        },
        progress: 0,
        attemptsMade: 0,
        timestamp: Date.now(),
        getState: async () => 'active',
        remove: async () => {},
        retry: async () => {},
      };

      await expect(queueFactory.processor!(job)).rejects.toThrow('Unknown operation type');
    });
  });
});

// =============================================================================
// Discord 429 Monitoring Tests (S-21.8)
// =============================================================================

describe('Discord 429 Monitoring', () => {
  let metrics: SynthesisMetrics;

  beforeEach(() => {
    metrics = createMockMetrics();
  });

  it('should record retry-after value when present', async () => {
    const queueFactory = createMockQueueFactory();
    const redis = createMockRedisClient();
    const tokenBucket = createMockTokenBucket();
    const discordRest = createMockDiscordRest();
    const logger = createMockLogger();

    const error = new Error('429 Rate Limited');
    (error as unknown as { retryAfter: number }).retryAfter = 30;
    (discordRest.createRole as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

    new SynthesisEngine({
      redis,
      queueFactory,
      tokenBucket,
      discordRest,
      logger: logger as unknown as import('pino').Logger,
      metrics,
      redisConnection: {},
    });

    const job: BullMQJob = {
      id: 'job-1',
      name: 'test-job',
      data: {
        type: 'create_role',
        guildId: 'guild-123',
        communityId: 'community-123',
        payload: { name: 'Test Role' },
        idempotencyKey: 'retry-after-key',
      },
      progress: 0,
      attemptsMade: 0,
      timestamp: Date.now(),
      getState: async () => 'active',
      remove: async () => {},
      retry: async () => {},
    };

    await expect(queueFactory.processor!(job)).rejects.toThrow('429');

    expect(metrics.discord429RetryAfter.observe).toHaveBeenCalledWith(30);
  });
});
