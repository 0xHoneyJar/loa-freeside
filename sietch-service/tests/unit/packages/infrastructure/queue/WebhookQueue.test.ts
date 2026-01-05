/**
 * WebhookQueue Unit Tests
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Note: These tests use mocked BullMQ since we can't run
 * a real Redis instance in unit tests. Integration tests
 * would test with actual Redis.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import {
  WebhookQueue,
  createWebhookQueue,
  WebhookJobData,
  WebhookProcessResult,
} from '../../../../../src/packages/infrastructure/queue';
import {
  createTraceContext,
  runWithTrace,
} from '../../../../../src/packages/infrastructure/tracing';

// Mock BullMQ
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockImplementation((name, data, opts) => ({
      id: opts?.jobId || 'job-1',
      name,
      data,
      opts,
    })),
    addBulk: vi.fn().mockImplementation((jobs) =>
      jobs.map((j: any, i: number) => ({
        id: j.opts?.jobId || `job-${i}`,
        name: j.name,
        data: j.data,
      }))
    ),
    getWaitingCount: vi.fn().mockResolvedValue(5),
    getActiveCount: vi.fn().mockResolvedValue(2),
    getDelayedCount: vi.fn().mockResolvedValue(1),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 5, active: 2 }),
    getJobs: vi.fn().mockResolvedValue([]),
    getJob: vi.fn().mockResolvedValue(null),
    clean: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  QueueEvents: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('WebhookQueue', () => {
  let webhookQueue: WebhookQueue;

  beforeEach(() => {
    vi.clearAllMocks();

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
      queueName: 'test-webhooks',
      concurrency: 5,
      maxRetries: 3,
    });
  });

  afterEach(async () => {
    await webhookQueue.close();
  });

  describe('createWebhookQueue', () => {
    it('creates a webhook queue instance', () => {
      expect(webhookQueue).toBeInstanceOf(WebhookQueue);
    });

    it('creates queues with correct names', () => {
      expect(Queue).toHaveBeenCalledTimes(2); // Main queue and DLQ
      expect(Queue).toHaveBeenCalledWith(
        'test-webhooks',
        expect.objectContaining({
          connection: { host: 'localhost', port: 6379 },
        })
      );
      expect(Queue).toHaveBeenCalledWith(
        'test-webhooks-dlq',
        expect.any(Object)
      );
    });
  });

  describe('enqueue', () => {
    it('adds job to the queue', async () => {
      const jobData: Omit<WebhookJobData, 'trace'> = {
        eventId: 'evt_123',
        eventType: 'subscription.created',
        payload: JSON.stringify({ id: 'sub_456' }),
        provider: 'paddle',
        receivedAt: Date.now(),
      };

      const job = await webhookQueue.enqueue(jobData);

      expect(job.id).toBe('evt_123');
      expect(job.data.eventId).toBe('evt_123');
    });

    it('captures trace context when in trace', async () => {
      const ctx = createTraceContext({ tenantId: 'guild-123' });
      let capturedData: WebhookJobData | undefined;

      // Mock to capture the data
      const mockQueue = Queue as Mock;
      const mockInstance = mockQueue.mock.results[0].value;
      mockInstance.add.mockImplementation((name: string, data: WebhookJobData) => {
        capturedData = data;
        return { id: data.eventId, name, data };
      });

      runWithTrace(ctx, () => {
        webhookQueue.enqueue({
          eventId: 'evt_traced',
          eventType: 'payment.completed',
          payload: '{}',
          provider: 'paddle',
          receivedAt: Date.now(),
        });
      });

      expect(capturedData?.trace?.traceId).toBe(ctx.traceId);
    });

    it('sets priority based on event type', async () => {
      const mockQueue = Queue as Mock;
      const mockInstance = mockQueue.mock.results[0].value;

      // Payment events should be priority 1
      await webhookQueue.enqueue({
        eventId: 'evt_payment',
        eventType: 'payment.completed',
        payload: '{}',
        provider: 'paddle',
        receivedAt: Date.now(),
      });

      expect(mockInstance.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ priority: 1 })
      );

      // Subscription events should be priority 2
      await webhookQueue.enqueue({
        eventId: 'evt_sub',
        eventType: 'subscription.created',
        payload: '{}',
        provider: 'paddle',
        receivedAt: Date.now(),
      });

      expect(mockInstance.add).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ priority: 2 })
      );
    });
  });

  describe('enqueueBatch', () => {
    it('adds multiple jobs at once', async () => {
      const webhooks = [
        {
          eventId: 'evt_1',
          eventType: 'subscription.created',
          payload: '{}',
          provider: 'paddle',
          receivedAt: Date.now(),
        },
        {
          eventId: 'evt_2',
          eventType: 'payment.completed',
          payload: '{}',
          provider: 'paddle',
          receivedAt: Date.now(),
        },
      ];

      const jobs = await webhookQueue.enqueueBatch(webhooks);

      expect(jobs).toHaveLength(2);

      const mockQueue = Queue as Mock;
      const mockInstance = mockQueue.mock.results[0].value;
      expect(mockInstance.addBulk).toHaveBeenCalledTimes(1);
    });
  });

  describe('startWorker', () => {
    it('creates a worker with the processor', async () => {
      const processor = vi.fn().mockResolvedValue({ status: 'processed' as const });

      await webhookQueue.startWorker(processor);

      expect(Worker).toHaveBeenCalledWith(
        'test-webhooks',
        expect.any(Function),
        expect.objectContaining({
          concurrency: 5,
        })
      );
    });

    it('throws if worker already started', async () => {
      const processor = vi.fn().mockResolvedValue({ status: 'processed' as const });

      await webhookQueue.startWorker(processor);

      await expect(webhookQueue.startWorker(processor)).rejects.toThrow(
        'Worker already started'
      );
    });

    it('sets up event handlers', async () => {
      const processor = vi.fn();

      await webhookQueue.startWorker(processor);

      const mockWorker = Worker as Mock;
      const mockInstance = mockWorker.mock.results[0].value;

      expect(mockInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));
      expect(mockInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
      expect(mockInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('stopWorker', () => {
    it('closes worker and queue events', async () => {
      const processor = vi.fn();
      await webhookQueue.startWorker(processor);

      await webhookQueue.stopWorker();

      const mockWorker = Worker as Mock;
      const mockInstance = mockWorker.mock.results[0].value;
      expect(mockInstance.close).toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('returns queue metrics', async () => {
      const metrics = await webhookQueue.getMetrics();

      expect(metrics).toMatchObject({
        waitingJobs: 5,
        activeJobs: 2,
        delayedJobs: 1,
      });
    });
  });

  describe('getDeadLetterCount', () => {
    it('returns DLQ count', async () => {
      const count = await webhookQueue.getDeadLetterCount();
      expect(typeof count).toBe('number');
    });
  });

  describe('cleanOldJobs', () => {
    it('cleans completed jobs', async () => {
      const cleaned = await webhookQueue.cleanOldJobs(86400000);
      expect(typeof cleaned).toBe('number');
    });
  });

  describe('isHealthy', () => {
    it('returns true when queue is accessible', async () => {
      const healthy = await webhookQueue.isHealthy();
      expect(healthy).toBe(true);
    });

    it('returns false when queue throws', async () => {
      const mockQueue = Queue as Mock;
      const mockInstance = mockQueue.mock.results[0].value;
      mockInstance.getJobCounts.mockRejectedValueOnce(new Error('Connection failed'));

      const healthy = await webhookQueue.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('close', () => {
    it('closes all queues', async () => {
      await webhookQueue.close();

      const mockQueue = Queue as Mock;
      // Both main queue and DLQ should be closed
      expect(mockQueue.mock.results[0].value.close).toHaveBeenCalled();
      expect(mockQueue.mock.results[1].value.close).toHaveBeenCalled();
    });
  });
});

describe('WebhookQueue Priority', () => {
  let webhookQueue: WebhookQueue;
  let addMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
    });

    const mockQueue = Queue as Mock;
    addMock = mockQueue.mock.results[0].value.add;
  });

  afterEach(async () => {
    await webhookQueue.close();
  });

  it('payment events get priority 1', async () => {
    await webhookQueue.enqueue({
      eventId: 'evt_1',
      eventType: 'payment.completed',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    });

    expect(addMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ priority: 1 })
    );
  });

  it('subscription events get priority 2', async () => {
    await webhookQueue.enqueue({
      eventId: 'evt_1',
      eventType: 'subscription.activated',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    });

    expect(addMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ priority: 2 })
    );
  });

  it('other events get priority 5', async () => {
    await webhookQueue.enqueue({
      eventId: 'evt_1',
      eventType: 'invoice.generated',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    });

    expect(addMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ priority: 5 })
    );
  });
});

describe('WebhookQueue Graceful Degradation', () => {
  let webhookQueue: WebhookQueue;

  afterEach(async () => {
    if (webhookQueue) {
      await webhookQueue.close();
    }
  });

  it('falls back to direct processing when queue unavailable and fallback enabled', async () => {
    vi.clearAllMocks();

    const processor = vi.fn().mockResolvedValue({ status: 'processed' as const });

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
      queueName: 'test-fallback',
      enableDirectFallback: true,
    });

    // Set the processor for direct fallback
    webhookQueue.setProcessor(processor);

    // Make the queue.add throw an error to simulate Redis being unavailable
    const mockQueue = Queue as Mock;
    const mockInstance = mockQueue.mock.results[0].value;
    mockInstance.add.mockRejectedValueOnce(new Error('Redis connection failed'));

    const jobData = {
      eventId: 'evt_fallback',
      eventType: 'subscription.created',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    };

    const result = await webhookQueue.enqueue(jobData);

    // Should have processed directly
    expect(processor).toHaveBeenCalled();
    expect((result as any).processedDirectly).toBe(true);
    expect(result.id).toBe('direct:evt_fallback');
  });

  it('throws error when queue unavailable and fallback disabled', async () => {
    vi.clearAllMocks();

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
      queueName: 'test-no-fallback',
      enableDirectFallback: false, // Disabled
    });

    // Make the queue.add throw an error
    const mockQueue = Queue as Mock;
    const mockInstance = mockQueue.mock.results[0].value;
    mockInstance.add.mockRejectedValueOnce(new Error('Redis connection failed'));

    const jobData = {
      eventId: 'evt_error',
      eventType: 'subscription.created',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    };

    await expect(webhookQueue.enqueue(jobData)).rejects.toThrow('Redis connection failed');
  });

  it('throws error when fallback enabled but no processor set', async () => {
    vi.clearAllMocks();

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
      queueName: 'test-no-processor',
      enableDirectFallback: true,
    });

    // Don't set processor - webhookQueue.setProcessor() not called

    // Make the queue.add throw an error
    const mockQueue = Queue as Mock;
    const mockInstance = mockQueue.mock.results[0].value;
    mockInstance.add.mockRejectedValueOnce(new Error('Redis connection failed'));

    const jobData = {
      eventId: 'evt_no_proc',
      eventType: 'subscription.created',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    };

    await expect(webhookQueue.enqueue(jobData)).rejects.toThrow('Redis connection failed');
  });

  it('setProcessor allows direct processing without starting worker', async () => {
    vi.clearAllMocks();

    const processor = vi.fn().mockResolvedValue({ status: 'processed' as const });

    webhookQueue = createWebhookQueue({
      connection: { host: 'localhost', port: 6379 },
      queueName: 'test-set-processor',
      enableDirectFallback: true,
    });

    // Just set processor, don't start worker
    webhookQueue.setProcessor(processor);

    // Make queue unavailable
    const mockQueue = Queue as Mock;
    const mockInstance = mockQueue.mock.results[0].value;
    mockInstance.add.mockRejectedValueOnce(new Error('Redis down'));

    const result = await webhookQueue.enqueue({
      eventId: 'evt_set_proc',
      eventType: 'payment.completed',
      payload: '{}',
      provider: 'paddle',
      receivedAt: Date.now(),
    });

    expect(processor).toHaveBeenCalled();
    expect((result as any).processedDirectly).toBe(true);
  });
});
