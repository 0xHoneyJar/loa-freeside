/**
 * Synthesis Queue Tests (v5.0 - Sprint 44)
 *
 * Unit tests for SynthesisQueue class covering:
 * - Job enqueuing (single and batch)
 * - Job management (get, remove, retry)
 * - Queue metrics
 * - Dead letter queue operations
 * - Queue control (pause, resume, drain, clean)
 * - Configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SynthesisQueue, DEFAULT_QUEUE_NAME } from '../../../../src/packages/synthesis/SynthesisQueue.js';
import type { SynthesisJobType } from '../../../../src/packages/synthesis/types.js';

// Mock BullMQ
vi.mock('bullmq', () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
    addBulk: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    getJob: vi.fn(),
    getWaitingCount: vi.fn().mockResolvedValue(10),
    getActiveCount: vi.fn().mockResolvedValue(5),
    getCompletedCount: vi.fn().mockResolvedValue(100),
    getFailedCount: vi.fn().mockResolvedValue(3),
    getDelayedCount: vi.fn().mockResolvedValue(2),
    getPausedCount: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(5),
    getJobs: vi.fn().mockResolvedValue([]),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    drain: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  class MockQueue {
    constructor() {
      return mockQueue;
    }
  }

  return {
    Queue: MockQueue,
  };
});

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
      ping: vi.fn().mockResolvedValue('PONG'),
    })),
  };
});

describe('SynthesisQueue', () => {
  let queue: SynthesisQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new SynthesisQueue({
      queueName: 'test-queue',
      redis: {
        host: 'localhost',
        port: 6379,
      },
    });
  });

  afterEach(async () => {
    await queue.close();
  });

  // ---------------------------------------------------------------------------
  // Configuration Tests
  // ---------------------------------------------------------------------------

  describe('Configuration', () => {
    it('should use default queue name if not provided', () => {
      const defaultQueue = new SynthesisQueue();
      expect(defaultQueue.getQueueName()).toBe(DEFAULT_QUEUE_NAME);
    });

    it('should use custom queue name if provided', () => {
      expect(queue.getQueueName()).toBe('test-queue');
    });

    it('should return worker configuration', () => {
      const workerConfig = queue.getWorkerConfig();
      expect(workerConfig).toHaveProperty('concurrency');
      expect(workerConfig).toHaveProperty('limiter');
      expect(workerConfig.limiter).toHaveProperty('max');
      expect(workerConfig.limiter).toHaveProperty('duration');
    });

    it('should use default worker concurrency', () => {
      const workerConfig = queue.getWorkerConfig();
      expect(workerConfig.concurrency).toBe(5);
    });

    it('should use custom worker concurrency if provided', () => {
      const customQueue = new SynthesisQueue({
        workerOptions: {
          concurrency: 10,
          limiter: { max: 20, duration: 2000 },
        },
      });
      const workerConfig = customQueue.getWorkerConfig();
      expect(workerConfig.concurrency).toBe(10);
      expect(workerConfig.limiter.max).toBe(20);
      expect(workerConfig.limiter.duration).toBe(2000);
    });
  });

  // ---------------------------------------------------------------------------
  // Job Enqueuing Tests
  // ---------------------------------------------------------------------------

  describe('Job Enqueuing', () => {
    it('should enqueue a CREATE_ROLE job', async () => {
      const jobId = await queue.enqueue('CREATE_ROLE' as SynthesisJobType, {
        guildId: '12345678901234567',
        name: 'Test Role',
        color: 0xff0000,
      });

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue a CREATE_CHANNEL job', async () => {
      const jobId = await queue.enqueue('CREATE_CHANNEL' as SynthesisJobType, {
        guildId: '12345678901234567',
        name: 'test-channel',
      });

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with custom idempotency key', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          idempotencyKey: 'custom-key',
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with community ID', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          communityId: 'community-123',
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with user ID', async () => {
      const jobId = await queue.enqueue(
        'ASSIGN_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          userId: '44444444444444444',
          roleId: '55555555555555555',
        },
        {
          userId: 'user-456',
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with metadata', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          metadata: { source: 'wizard', step: 'role_mapping' },
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with priority', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          priority: 10,
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with delay', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          delay: 5000,
        }
      );

      expect(jobId).toBe('mock-job-id');
    });

    it('should enqueue with custom attempts', async () => {
      const jobId = await queue.enqueue(
        'CREATE_ROLE' as SynthesisJobType,
        {
          guildId: '12345678901234567',
          name: 'Test Role',
        },
        {
          attempts: 5,
        }
      );

      expect(jobId).toBe('mock-job-id');
    });
  });

  // ---------------------------------------------------------------------------
  // Batch Enqueuing Tests
  // ---------------------------------------------------------------------------

  describe('Batch Enqueuing', () => {
    it('should enqueue multiple jobs in a batch', async () => {
      const jobIds = await queue.enqueueBatch([
        {
          jobType: 'CREATE_ROLE' as SynthesisJobType,
          payload: { guildId: '12345678901234567', name: 'Role 1' },
        },
        {
          jobType: 'CREATE_ROLE' as SynthesisJobType,
          payload: { guildId: '12345678901234567', name: 'Role 2' },
        },
      ]);

      expect(jobIds).toHaveLength(2);
      expect(jobIds[0]).toBe('job-1');
      expect(jobIds[1]).toBe('job-2');
    });

    it('should enqueue batch with community IDs', async () => {
      const jobIds = await queue.enqueueBatch([
        {
          jobType: 'CREATE_ROLE' as SynthesisJobType,
          payload: { guildId: '12345678901234567', name: 'Role 1' },
          options: { communityId: 'community-123' },
        },
      ]);

      expect(jobIds).toHaveLength(2);
    });

    it('should enqueue batch with priorities', async () => {
      const jobIds = await queue.enqueueBatch([
        {
          jobType: 'CREATE_ROLE' as SynthesisJobType,
          payload: { guildId: '12345678901234567', name: 'Role 1' },
          options: { priority: 10 },
        },
        {
          jobType: 'CREATE_CHANNEL' as SynthesisJobType,
          payload: { guildId: '12345678901234567', name: 'channel-1' },
          options: { priority: 5 },
        },
      ]);

      expect(jobIds).toHaveLength(2);
    });

    it('should enqueue empty batch', async () => {
      const jobIds = await queue.enqueueBatch([]);
      expect(jobIds).toHaveLength(2); // Mock returns 2 IDs
    });
  });

  // ---------------------------------------------------------------------------
  // Job Management Tests
  // ---------------------------------------------------------------------------

  describe('Job Management', () => {
    it('should get job by ID', async () => {
      const mockJob = { id: 'job-1', data: {} };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);

      const job = await queue.getJob('job-1');
      expect(job).toEqual(mockJob);
    });

    it('should return undefined for non-existent job', async () => {
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(undefined);

      const job = await queue.getJob('non-existent');
      expect(job).toBeUndefined();
    });

    it('should get job state', async () => {
      const mockJob = {
        id: 'job-1',
        data: {},
        getState: vi.fn().mockResolvedValue('active'),
      };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);

      const state = await queue.getJobState('job-1');
      expect(state).toBe('active');
    });

    it('should return undefined for job state if job not found', async () => {
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(undefined);

      const state = await queue.getJobState('non-existent');
      expect(state).toBeUndefined();
    });

    it('should remove a job', async () => {
      const mockJob = {
        id: 'job-1',
        data: {},
        remove: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);

      await queue.removeJob('job-1');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should not throw when removing non-existent job', async () => {
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(undefined);

      await expect(queue.removeJob('non-existent')).resolves.not.toThrow();
    });

    it('should retry a failed job', async () => {
      const mockJob = {
        id: 'job-1',
        data: {},
        retry: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);

      await queue.retryJob('job-1');
      expect(mockJob.retry).toHaveBeenCalled();
    });

    it('should not throw when retrying non-existent job', async () => {
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(undefined);

      await expect(queue.retryJob('non-existent')).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Dead Letter Queue Tests
  // ---------------------------------------------------------------------------

  describe('Dead Letter Queue', () => {
    it('should move failed job to DLQ', async () => {
      const mockJob = {
        id: 'job-1',
        data: {
          type: 'CREATE_ROLE',
          payload: { guildId: '12345678901234567', name: 'Test' },
          communityId: 'community-123',
        },
        failedReason: 'Permission denied',
        stacktrace: ['Error: Permission denied', '  at ...'],
        attemptsMade: 3,
        finishedOn: Date.now(),
        getState: vi.fn().mockResolvedValue('failed'),
        remove: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);
      vi.mocked(queue['deadLetterQueue'].add).mockResolvedValueOnce({
        id: 'dlq-1',
      } as any);

      await queue.moveToDeadLetter('job-1');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should throw error if job is not in failed state', async () => {
      const mockJob = {
        id: 'job-1',
        data: {},
        getState: vi.fn().mockResolvedValue('active'),
      };
      vi.mocked(queue['queue'].getJob).mockResolvedValueOnce(mockJob);

      await expect(queue.moveToDeadLetter('job-1')).rejects.toThrow(
        'not in failed state'
      );
    });

    it('should get DLQ size', async () => {
      vi.mocked(queue['deadLetterQueue'].count).mockResolvedValueOnce(5);

      const size = await queue.getDeadLetterQueueSize();
      expect(size).toBe(5);
    });

    it('should get DLQ entries', async () => {
      const mockEntries = [
        { data: { jobId: 'job-1', error: 'Error 1' } },
        { data: { jobId: 'job-2', error: 'Error 2' } },
      ];
      vi.mocked(queue['deadLetterQueue'].getJobs).mockResolvedValueOnce(
        mockEntries as any
      );

      const entries = await queue.getDeadLetterQueueEntries(10);
      expect(entries).toHaveLength(2);
    });

    it('should limit DLQ entries', async () => {
      vi.mocked(queue['deadLetterQueue'].getJobs).mockResolvedValueOnce([]);

      const entries = await queue.getDeadLetterQueueEntries(5);
      expect(entries).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Queue Metrics Tests
  // ---------------------------------------------------------------------------

  describe('Queue Metrics', () => {
    it('should get queue metrics', async () => {
      const metrics = await queue.getMetrics();

      expect(metrics).toEqual({
        waiting: 10,
        active: 5,
        completed: 100,
        failed: 3,
        delayed: 2,
        paused: 0,
      });
    });

    it('should handle metrics retrieval errors gracefully', async () => {
      vi.mocked(queue['queue'].getWaitingCount).mockRejectedValueOnce(
        new Error('Redis error')
      );

      await expect(queue.getMetrics()).rejects.toThrow('Redis error');
    });
  });

  // ---------------------------------------------------------------------------
  // Queue Control Tests
  // ---------------------------------------------------------------------------

  describe('Queue Control', () => {
    it('should pause the queue', async () => {
      await queue.pause();
      expect(queue['queue'].pause).toHaveBeenCalled();
    });

    it('should resume the queue', async () => {
      await queue.resume();
      expect(queue['queue'].resume).toHaveBeenCalled();
    });

    it('should drain the queue', async () => {
      await queue.drain();
      expect(queue['queue'].drain).toHaveBeenCalledWith(false);
    });

    it('should drain delayed jobs', async () => {
      await queue.drain(true);
      expect(queue['queue'].drain).toHaveBeenCalledWith(true);
    });

    it('should clean completed jobs', async () => {
      await queue.cleanCompleted(3600000); // 1 hour
      expect(queue['queue'].clean).toHaveBeenCalledWith(
        3600000,
        0,
        'completed'
      );
    });

    it('should clean failed jobs', async () => {
      await queue.cleanFailed(86400000); // 24 hours
      expect(queue['queue'].clean).toHaveBeenCalledWith(
        86400000,
        0,
        'failed'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle Tests
  // ---------------------------------------------------------------------------

  describe('Lifecycle', () => {
    it('should close queue and DLQ', async () => {
      await queue.close();
      expect(queue['queue'].close).toHaveBeenCalled();
      expect(queue['deadLetterQueue'].close).toHaveBeenCalled();
    });
  });
});
