/**
 * Webhook Queue - BullMQ-based Webhook Processing
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides a durable queue for webhook processing to handle flash sale traffic.
 * Uses BullMQ with Redis for reliable message delivery and processing.
 *
 * Features:
 * - Automatic retries with exponential backoff
 * - Dead letter queue for failed webhooks
 * - Rate limiting to protect downstream services
 * - Trace context propagation
 * - Metrics for queue monitoring
 *
 * @module packages/infrastructure/queue/WebhookQueue
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import type { ConnectionOptions, WorkerOptions, QueueOptions } from 'bullmq';
import {
  createTraceContext,
  runWithTraceAsync,
  getTraceId,
  getSpanId,
  CreateTraceOptions,
} from '../tracing';
import { createLogger, ILogger } from '../logging';

// =============================================================================
// Types
// =============================================================================

/**
 * Webhook job data structure
 */
export interface WebhookJobData {
  /** Unique event ID from the provider */
  eventId: string;
  /** Event type (normalized) */
  eventType: string;
  /** Raw event payload */
  payload: string;
  /** Provider (paddle, stripe, etc.) */
  provider: string;
  /** Timestamp when webhook was received */
  receivedAt: number;
  /** Trace context for correlation */
  trace?: {
    traceId: string;
    spanId: string;
    tenantId?: string;
  };
}

/**
 * Webhook processing result
 */
export interface WebhookProcessResult {
  /** Processing status */
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  /** Optional message */
  message?: string;
  /** Processing duration (ms) */
  duration?: number;
}

/**
 * Webhook processor function type
 */
export type WebhookProcessor = (
  data: WebhookJobData
) => Promise<WebhookProcessResult>;

/**
 * Queue configuration options
 */
export interface WebhookQueueOptions {
  /** Redis connection options */
  connection: ConnectionOptions;
  /** Queue name (default: 'webhooks') */
  queueName?: string;
  /** Maximum concurrent jobs per worker (default: 10) */
  concurrency?: number;
  /** Maximum retries before dead letter (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in ms (default: 1000) */
  retryDelay?: number;
  /** Rate limit: max jobs per interval */
  rateLimitMax?: number;
  /** Rate limit interval in ms */
  rateLimitInterval?: number;
  /** Custom logger */
  logger?: ILogger;
  /**
   * Enable graceful degradation: fall back to direct processing if queue unavailable.
   * When true and a processor is set, enqueue() will process directly if Redis fails.
   * (default: false)
   */
  enableDirectFallback?: boolean;
}

/**
 * Queue metrics
 */
export interface QueueMetrics {
  /** Total jobs added */
  jobsAdded: number;
  /** Total jobs completed */
  jobsCompleted: number;
  /** Total jobs failed (moved to DLQ) */
  jobsFailed: number;
  /** Total retries */
  jobsRetried: number;
  /** Current active jobs */
  activeJobs: number;
  /** Current waiting jobs */
  waitingJobs: number;
  /** Current delayed jobs */
  delayedJobs: number;
}

// =============================================================================
// WebhookQueue Class
// =============================================================================

/**
 * BullMQ-based webhook queue for reliable webhook processing
 */
export class WebhookQueue {
  private queue: Queue<WebhookJobData, WebhookProcessResult>;
  private deadLetterQueue: Queue<WebhookJobData, WebhookProcessResult>;
  private worker: Worker<WebhookJobData, WebhookProcessResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private processor: WebhookProcessor | null = null;
  private logger: ILogger;
  private options: Required<Omit<WebhookQueueOptions, 'connection' | 'logger'>> & {
    connection: ConnectionOptions;
  };
  private directFallbackEnabled: boolean;

  // Internal metrics
  private metrics: QueueMetrics = {
    jobsAdded: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsRetried: 0,
    activeJobs: 0,
    waitingJobs: 0,
    delayedJobs: 0,
  };

  constructor(options: WebhookQueueOptions) {
    this.options = {
      connection: options.connection,
      queueName: options.queueName ?? 'webhooks',
      concurrency: options.concurrency ?? 10,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      rateLimitMax: options.rateLimitMax ?? 100,
      rateLimitInterval: options.rateLimitInterval ?? 1000,
      enableDirectFallback: options.enableDirectFallback ?? false,
    };

    this.directFallbackEnabled = this.options.enableDirectFallback;

    this.logger = options.logger ?? createLogger({ service: 'webhook-queue' });

    // Create main queue
    const queueOptions: QueueOptions = {
      connection: this.options.connection,
      defaultJobOptions: {
        attempts: this.options.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.options.retryDelay,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Keep max 1000 completed jobs
        },
        removeOnFail: false, // Keep failed jobs for investigation
      },
    };

    this.queue = new Queue(this.options.queueName, queueOptions);

    // Create dead letter queue for exhausted retries
    this.deadLetterQueue = new Queue(
      `${this.options.queueName}-dlq`,
      { connection: this.options.connection }
    );

    this.logger.info(
      { queueName: this.options.queueName },
      'Webhook queue created'
    );
  }

  // ---------------------------------------------------------------------------
  // Queue Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a webhook to the queue for processing
   *
   * If `enableDirectFallback` is true and the queue is unavailable,
   * falls back to direct processing using the registered processor.
   *
   * @param data - Webhook job data
   * @returns Job instance (or a synthetic job-like object for direct processing)
   */
  async enqueue(data: Omit<WebhookJobData, 'trace'>): Promise<Job<WebhookJobData, WebhookProcessResult> | { id: string; data: WebhookJobData; processedDirectly: true }> {
    // Capture current trace context
    const traceId = getTraceId();
    const spanId = getSpanId();

    const jobData: WebhookJobData = {
      ...data,
      trace: traceId !== 'no-trace' ? { traceId, spanId } : undefined,
    };

    try {
      const job = await this.queue.add(
        `webhook:${data.eventType}`,
        jobData,
        {
          jobId: data.eventId, // Use event ID for deduplication
          priority: this.getPriority(data.eventType),
        }
      );

      this.metrics.jobsAdded++;

      this.logger.debug(
        {
          eventId: data.eventId,
          eventType: data.eventType,
          jobId: job.id,
          traceId,
        },
        'Webhook enqueued'
      );

      return job;
    } catch (error) {
      // Graceful degradation: fall back to direct processing if enabled
      if (this.directFallbackEnabled && this.processor) {
        this.logger.warn(
          {
            eventId: data.eventId,
            eventType: data.eventType,
            error: (error as Error).message,
          },
          'Queue unavailable, falling back to direct processing'
        );

        const result = await this.processDirectly(jobData);
        this.metrics.jobsCompleted++;

        return {
          id: `direct:${data.eventId}`,
          data: jobData,
          processedDirectly: true as const,
        };
      }

      // Re-throw if fallback not enabled or no processor
      throw error;
    }
  }

  /**
   * Process a webhook directly (bypassing the queue)
   * Used for graceful degradation when Redis is unavailable.
   */
  private async processDirectly(data: WebhookJobData): Promise<WebhookProcessResult> {
    const startTime = performance.now();

    // Restore trace context if available
    const traceOptions: CreateTraceOptions | undefined = data.trace
      ? {
          traceId: data.trace.traceId,
          parentSpanId: data.trace.spanId,
          tenantId: data.trace.tenantId,
        }
      : undefined;

    const context = createTraceContext(traceOptions);

    return runWithTraceAsync(context, async () => {
      const result = await this.processor!(data);
      const duration = performance.now() - startTime;

      this.logger.info(
        {
          eventId: data.eventId,
          eventType: data.eventType,
          duration,
          direct: true,
        },
        'Webhook processed directly'
      );

      return {
        ...result,
        duration,
      };
    });
  }

  /**
   * Enqueue multiple webhooks (for batch processing)
   *
   * @param webhooks - Array of webhook data
   * @returns Array of job instances
   */
  async enqueueBatch(
    webhooks: Array<Omit<WebhookJobData, 'trace'>>
  ): Promise<Array<Job<WebhookJobData, WebhookProcessResult>>> {
    const traceId = getTraceId();
    const spanId = getSpanId();

    const jobs = webhooks.map((data) => ({
      name: `webhook:${data.eventType}`,
      data: {
        ...data,
        trace: traceId !== 'no-trace' ? { traceId, spanId } : undefined,
      } as WebhookJobData,
      opts: {
        jobId: data.eventId,
        priority: this.getPriority(data.eventType),
      },
    }));

    const addedJobs = await this.queue.addBulk(jobs);
    this.metrics.jobsAdded += addedJobs.length;

    this.logger.info(
      { count: addedJobs.length, traceId },
      'Batch webhooks enqueued'
    );

    return addedJobs;
  }

  /**
   * Get priority based on event type
   * Lower number = higher priority
   */
  private getPriority(eventType: string): number {
    // Payment events are highest priority
    if (eventType.startsWith('payment.')) {
      return 1;
    }
    // Subscription events are high priority
    if (eventType.startsWith('subscription.')) {
      return 2;
    }
    // Default priority
    return 5;
  }

  // ---------------------------------------------------------------------------
  // Worker Management
  // ---------------------------------------------------------------------------

  /**
   * Set the processor for direct fallback processing
   * This allows enqueue() to fall back to direct processing when Redis is unavailable.
   *
   * @param processor - Function to process webhook jobs
   */
  setProcessor(processor: WebhookProcessor): void {
    this.processor = processor;
    this.logger.debug('Processor registered for direct fallback');
  }

  /**
   * Start the queue worker
   *
   * @param processor - Function to process webhook jobs
   */
  async startWorker(processor: WebhookProcessor): Promise<void> {
    if (this.worker) {
      throw new Error('Worker already started');
    }

    this.processor = processor;

    const workerOptions: WorkerOptions = {
      connection: this.options.connection,
      concurrency: this.options.concurrency,
      limiter: {
        max: this.options.rateLimitMax,
        duration: this.options.rateLimitInterval,
      },
    };

    this.worker = new Worker<WebhookJobData, WebhookProcessResult>(
      this.options.queueName,
      async (job) => this.processJob(job),
      workerOptions
    );

    // Set up event handlers
    this.worker.on('completed', (job, result) => {
      this.metrics.jobsCompleted++;
      this.logger.debug(
        {
          eventId: job.data.eventId,
          status: result.status,
          duration: result.duration,
        },
        'Job completed'
      );
    });

    this.worker.on('failed', async (job, err) => {
      if (job && job.attemptsMade >= this.options.maxRetries) {
        // Move to dead letter queue
        await this.moveToDeadLetter(job, err);
        this.metrics.jobsFailed++;
      } else {
        this.metrics.jobsRetried++;
      }

      this.logger.warn(
        {
          eventId: job?.data.eventId,
          attempts: job?.attemptsMade,
          error: err.message,
        },
        'Job failed'
      );
    });

    this.worker.on('error', (err) => {
      this.logger.error({ error: err.message }, 'Worker error');
    });

    // Set up queue events for monitoring
    this.queueEvents = new QueueEvents(this.options.queueName, {
      connection: this.options.connection,
    });

    this.queueEvents.on('waiting', () => {
      this.metrics.waitingJobs++;
    });

    this.queueEvents.on('active', () => {
      this.metrics.activeJobs++;
      this.metrics.waitingJobs = Math.max(0, this.metrics.waitingJobs - 1);
    });

    this.queueEvents.on('completed', () => {
      this.metrics.activeJobs = Math.max(0, this.metrics.activeJobs - 1);
    });

    this.logger.info(
      {
        queueName: this.options.queueName,
        concurrency: this.options.concurrency,
      },
      'Webhook worker started'
    );
  }

  /**
   * Process a single job
   */
  private async processJob(
    job: Job<WebhookJobData, WebhookProcessResult>
  ): Promise<WebhookProcessResult> {
    const { data } = job;
    const startTime = performance.now();

    // Restore trace context if available
    const traceOptions: CreateTraceOptions | undefined = data.trace
      ? {
          traceId: data.trace.traceId,
          parentSpanId: data.trace.spanId,
          tenantId: data.trace.tenantId,
        }
      : undefined;

    const context = createTraceContext(traceOptions);

    return runWithTraceAsync(context, async () => {
      try {
        const result = await this.processor!(data);
        const duration = performance.now() - startTime;

        return {
          ...result,
          duration,
        };
      } catch (error) {
        const duration = performance.now() - startTime;
        throw Object.assign(error as Error, { duration });
      }
    });
  }

  /**
   * Move a failed job to the dead letter queue
   */
  private async moveToDeadLetter(
    job: Job<WebhookJobData, WebhookProcessResult>,
    error: Error
  ): Promise<void> {
    await this.deadLetterQueue.add(
      `dlq:${job.name}`,
      {
        ...job.data,
        // Add failure metadata
      },
      {
        jobId: `dlq:${job.id}`,
        removeOnComplete: false,
      }
    );

    this.logger.error(
      {
        eventId: job.data.eventId,
        eventType: job.data.eventType,
        error: error.message,
        attempts: job.attemptsMade,
      },
      'Job moved to dead letter queue'
    );
  }

  /**
   * Stop the worker gracefully
   */
  async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    this.logger.info('Webhook worker stopped');
  }

  // ---------------------------------------------------------------------------
  // Queue Information
  // ---------------------------------------------------------------------------

  /**
   * Get current queue metrics
   */
  async getMetrics(): Promise<QueueMetrics> {
    const [waiting, active, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      ...this.metrics,
      waitingJobs: waiting,
      activeJobs: active,
      delayedJobs: delayed,
    };
  }

  /**
   * Get dead letter queue count
   */
  async getDeadLetterCount(): Promise<number> {
    return this.deadLetterQueue.getWaitingCount();
  }

  /**
   * Get jobs from the dead letter queue
   */
  async getDeadLetterJobs(
    limit: number = 10
  ): Promise<Array<Job<WebhookJobData, WebhookProcessResult>>> {
    return this.deadLetterQueue.getJobs(['waiting'], 0, limit);
  }

  /**
   * Retry a dead letter job
   */
  async retryDeadLetterJob(jobId: string): Promise<void> {
    const dlqJob = await this.deadLetterQueue.getJob(jobId);

    if (!dlqJob) {
      throw new Error(`Dead letter job not found: ${jobId}`);
    }

    // Re-enqueue to main queue
    await this.queue.add(
      dlqJob.name.replace('dlq:', ''),
      dlqJob.data,
      {
        jobId: `retry:${dlqJob.data.eventId}:${Date.now()}`,
      }
    );

    // Remove from DLQ
    await dlqJob.remove();

    this.logger.info(
      { jobId, eventId: dlqJob.data.eventId },
      'Dead letter job retried'
    );
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clean up completed jobs older than a certain age
   *
   * @param maxAge - Maximum age in ms (default: 24 hours)
   */
  async cleanOldJobs(maxAge: number = 86400000): Promise<number> {
    const cleaned = await this.queue.clean(maxAge, 1000, 'completed');
    this.logger.info({ cleaned: cleaned.length }, 'Old jobs cleaned');
    return cleaned.length;
  }

  /**
   * Close the queue and all connections
   */
  async close(): Promise<void> {
    await this.stopWorker();
    await this.queue.close();
    await this.deadLetterQueue.close();
    this.logger.info('Webhook queue closed');
  }

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  /**
   * Check if the queue is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.queue.getJobCounts();
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a webhook queue instance
 *
 * @param options - Queue configuration
 * @returns WebhookQueue instance
 *
 * @example
 * ```typescript
 * import { createWebhookQueue } from '../packages/infrastructure/queue';
 *
 * const webhookQueue = createWebhookQueue({
 *   connection: { host: 'localhost', port: 6379 },
 *   concurrency: 20,
 *   maxRetries: 5,
 * });
 *
 * // Start worker
 * await webhookQueue.startWorker(async (data) => {
 *   // Process webhook
 *   return { status: 'processed' };
 * });
 *
 * // Enqueue webhook
 * await webhookQueue.enqueue({
 *   eventId: 'evt_123',
 *   eventType: 'subscription.created',
 *   payload: JSON.stringify(event),
 *   provider: 'paddle',
 *   receivedAt: Date.now(),
 * });
 * ```
 */
export function createWebhookQueue(
  options: WebhookQueueOptions
): WebhookQueue {
  return new WebhookQueue(options);
}
