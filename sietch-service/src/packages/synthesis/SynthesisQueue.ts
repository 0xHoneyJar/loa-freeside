/**
 * Synthesis Queue (v5.0 - Sprint 44)
 *
 * BullMQ-based queue for async Discord operations with:
 * - Custom exponential backoff retry (3 attempts: 5s, 25s, 125s using 5^n formula)
 * - Dead letter queue for permanent failures
 * - Job progress tracking
 * - Rate limiting (2 jobs/sec per worker = 10 jobs/sec global with 5 workers)
 *
 * Part of Phase 4: BullMQ + Global Token Bucket
 */

import { Queue, QueueOptions } from 'bullmq';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import type {
  SynthesisJobData,
  SynthesisJobType,
  SynthesisJobPayload,
  SynthesisQueueConfig,
  QueueMetrics,
} from './types.js';
import { getSchemaForJobType } from './types.js';
import { SynthesisError } from './SynthesisWorker.js';

// =============================================================================
// Constants
// =============================================================================

/** Default queue name */
export const DEFAULT_QUEUE_NAME = 'discord-synthesis';

/** Default retry attempts */
const DEFAULT_ATTEMPTS = 3;

/** Default exponential backoff initial delay (5 seconds) */
const DEFAULT_BACKOFF_DELAY = 5000;

/** Default concurrency limit */
const DEFAULT_CONCURRENCY = 5;

/** Default rate limit: 2 jobs per second per worker (5 workers × 2 = 10 global) */
const DEFAULT_RATE_LIMIT_MAX = 2;
const DEFAULT_RATE_LIMIT_DURATION = 1000;

/** Keep completed jobs for 24 hours */
const KEEP_COMPLETED_JOBS = 24 * 60 * 60 * 1000;

/** Keep failed jobs for 7 days */
const KEEP_FAILED_JOBS = 7 * 24 * 60 * 60 * 1000;

/** Maximum payload size: 1MB (Security: HIGH-001) */
const MAX_PAYLOAD_SIZE = 1024 * 1024;

// =============================================================================
// Synthesis Queue Class
// =============================================================================

/**
 * SynthesisQueue
 *
 * Main queue for Discord synthesis operations.
 * Provides methods to enqueue jobs and retrieve queue metrics.
 */
export class SynthesisQueue {
  private queue: Queue;
  private deadLetterQueue: Queue;
  private config: SynthesisQueueConfig;

  constructor(config?: Partial<SynthesisQueueConfig>) {
    this.config = this.buildConfig(config);

    const connection = new Redis(
      this.config.redis.port,
      this.config.redis.host,
      {
        password: this.config.redis.password,
        db: this.config.redis.db || 0,
        maxRetriesPerRequest: null, // BullMQ handles retries
        enableReadyCheck: false,
      }
    );

    // Main queue configuration
    const queueOptions: QueueOptions = {
      connection,
      defaultJobOptions: {
        attempts: this.config.defaultJobOptions.attempts,
        backoff: {
          type: 'custom',
        },
        removeOnComplete: this.config.defaultJobOptions.removeOnComplete,
        removeOnFail: this.config.defaultJobOptions.removeOnFail,
      },
      settings: {
        backoffStrategies: {
          custom: (attemptsMade: number) => {
            // Custom backoff: 5s, 25s, 125s (5 * 5^(attemptsMade-1))
            const baseDelay = 5000;
            return baseDelay * Math.pow(5, attemptsMade - 1);
          },
        },
      },
    };

    this.queue = new Queue(this.config.queueName, queueOptions);

    // Dead letter queue for permanently failed jobs
    this.deadLetterQueue = new Queue(`${this.config.queueName}-dlq`, {
      connection,
      defaultJobOptions: {
        removeOnComplete: false, // Keep all DLQ entries
        removeOnFail: false,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private buildConfig(
    partial?: Partial<SynthesisQueueConfig>
  ): SynthesisQueueConfig {
    return {
      queueName: partial?.queueName || DEFAULT_QUEUE_NAME,
      redis: {
        host: partial?.redis?.host || process.env.REDIS_HOST || 'localhost',
        port: partial?.redis?.port || parseInt(process.env.REDIS_PORT || '6379', 10),
        password: partial?.redis?.password || process.env.REDIS_PASSWORD,
        db: partial?.redis?.db || parseInt(process.env.REDIS_DB || '0', 10),
      },
      defaultJobOptions: {
        attempts: partial?.defaultJobOptions?.attempts || DEFAULT_ATTEMPTS,
        backoff: {
          type: 'custom', // Custom 5^n backoff strategy (5s, 25s, 125s)
          delay:
            partial?.defaultJobOptions?.backoff?.delay ||
            DEFAULT_BACKOFF_DELAY,
        },
        removeOnComplete:
          partial?.defaultJobOptions?.removeOnComplete !== undefined
            ? partial.defaultJobOptions.removeOnComplete
            : KEEP_COMPLETED_JOBS,
        removeOnFail:
          partial?.defaultJobOptions?.removeOnFail !== undefined
            ? partial.defaultJobOptions.removeOnFail
            : KEEP_FAILED_JOBS,
      },
      workerOptions: {
        concurrency:
          partial?.workerOptions?.concurrency || DEFAULT_CONCURRENCY,
        limiter: {
          max:
            partial?.workerOptions?.limiter?.max || DEFAULT_RATE_LIMIT_MAX,
          duration:
            partial?.workerOptions?.limiter?.duration ||
            DEFAULT_RATE_LIMIT_DURATION,
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Job Enqueuing
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a synthesis job
   *
   * @param jobType - Type of synthesis operation
   * @param payload - Job-specific payload
   * @param options - Optional job configuration overrides
   * @returns Job ID
   */
  async enqueue<T extends SynthesisJobPayload>(
    jobType: SynthesisJobType,
    payload: T,
    options?: {
      idempotencyKey?: string;
      communityId?: string;
      userId?: string;
      metadata?: Record<string, unknown>;
      priority?: number;
      delay?: number;
      attempts?: number;
    }
  ): Promise<string> {
    // Security: HIGH-001 - Validate payload with Zod schema
    const schema = getSchemaForJobType(jobType);
    const validationResult = schema.safeParse(payload);

    if (!validationResult.success) {
      throw new SynthesisError(
        `Invalid payload for ${jobType}: ${validationResult.error.message}`,
        'INVALID_PAYLOAD',
        false // Not retryable
      );
    }

    const validatedPayload = validationResult.data;

    // Security: HIGH-001 - Check payload size limit (1MB max)
    const payloadJson = JSON.stringify(validatedPayload);
    if (payloadJson.length > MAX_PAYLOAD_SIZE) {
      throw new SynthesisError(
        `Payload exceeds size limit (${payloadJson.length} bytes > ${MAX_PAYLOAD_SIZE} bytes)`,
        'PAYLOAD_TOO_LARGE',
        false // Not retryable
      );
    }

    const idempotencyKey =
      options?.idempotencyKey || this.generateIdempotencyKey();

    const jobData: SynthesisJobData<T> = {
      type: jobType,
      payload: validatedPayload as T,
      idempotencyKey,
      communityId: options?.communityId,
      userId: options?.userId,
      metadata: options?.metadata,
    };

    const job = await this.queue.add(jobType, jobData, {
      jobId: idempotencyKey, // Use idempotency key as job ID for deduplication
      priority: options?.priority,
      delay: options?.delay,
      attempts: options?.attempts,
    });

    return job.id!;
  }

  /**
   * Enqueue multiple jobs as a batch
   *
   * @param jobs - Array of jobs to enqueue
   * @returns Array of job IDs
   */
  async enqueueBatch<T extends SynthesisJobPayload>(
    jobs: Array<{
      jobType: SynthesisJobType;
      payload: T;
      options?: {
        idempotencyKey?: string;
        communityId?: string;
        userId?: string;
        metadata?: Record<string, unknown>;
        priority?: number;
        delay?: number;
      };
    }>
  ): Promise<string[]> {
    const bulkJobs = jobs.map((job) => {
      // Security: HIGH-001 - Validate payload with Zod schema
      const schema = getSchemaForJobType(job.jobType);
      const validationResult = schema.safeParse(job.payload);

      if (!validationResult.success) {
        throw new SynthesisError(
          `Invalid payload for ${job.jobType}: ${validationResult.error.message}`,
          'INVALID_PAYLOAD',
          false
        );
      }

      const validatedPayload = validationResult.data;

      // Security: HIGH-001 - Check payload size limit
      const payloadJson = JSON.stringify(validatedPayload);
      if (payloadJson.length > MAX_PAYLOAD_SIZE) {
        throw new SynthesisError(
          `Payload exceeds size limit (${payloadJson.length} bytes > ${MAX_PAYLOAD_SIZE} bytes)`,
          'PAYLOAD_TOO_LARGE',
          false
        );
      }

      const idempotencyKey =
        job.options?.idempotencyKey || this.generateIdempotencyKey();

      return {
        name: job.jobType,
        data: {
          type: job.jobType,
          payload: validatedPayload,
          idempotencyKey,
          communityId: job.options?.communityId,
          userId: job.options?.userId,
          metadata: job.options?.metadata,
        } as SynthesisJobData<T>,
        opts: {
          jobId: idempotencyKey,
          priority: job.options?.priority,
          delay: job.options?.delay,
        },
      };
    });

    const addedJobs = await this.queue.addBulk(bulkJobs);
    return addedJobs.map((job) => job.id!);
  }

  // ---------------------------------------------------------------------------
  // Job Management
  // ---------------------------------------------------------------------------

  /**
   * Get job by ID
   */
  async getJob(jobId: string) {
    return this.queue.getJob(jobId);
  }

  /**
   * Get job state (waiting, active, completed, failed, delayed)
   */
  async getJobState(jobId: string): Promise<string | undefined> {
    const job = await this.getJob(jobId);
    return job ? await job.getState() : undefined;
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.retry();
    }
  }

  /**
   * Sanitize payload for DLQ storage
   *
   * Security: MED-002 - Redact PII and sensitive data before DLQ storage
   */
  private sanitizePayloadForDLQ(payload: SynthesisJobPayload): Record<string, unknown> {
    const sanitized = { ...payload } as any;

    // Redact user IDs (PII under GDPR)
    if ('userId' in sanitized) {
      sanitized.userId = '[REDACTED]';
    }

    // Redact custom reason fields (could contain PII)
    if ('reason' in sanitized) {
      sanitized.reason = sanitized.reason ? '[REDACTED]' : undefined;
    }

    // Redact message content (PII)
    if ('content' in sanitized) {
      sanitized.content = '[REDACTED]';
    }

    // Redact permission overwrite IDs (could expose internal structure)
    if ('permissionOverwrites' in sanitized && Array.isArray(sanitized.permissionOverwrites)) {
      sanitized.permissionOverwrites = '[REDACTED]';
    }

    // Keep guild IDs, channel IDs, role IDs (not PII, needed for debugging)
    return sanitized;
  }

  /**
   * Move failed job to dead letter queue
   *
   * Security: MED-002 - Sanitize payloads and error data before DLQ storage
   */
  async moveToDeadLetter(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    const state = await job.getState();
    if (state !== 'failed') {
      throw new Error(`Job ${jobId} is not in failed state (current: ${state})`);
    }

    // Sanitize payload before storage
    const sanitizedPayload = this.sanitizePayloadForDLQ(job.data.payload);

    // Sanitize error message (remove file paths, internal details)
    const sanitizedError = job.failedReason
      ? job.failedReason.replace(/\/[\w\-_\/]+\.ts:\d+/g, '[FILE]:[LINE]')
      : undefined;

    // Add to dead letter queue
    await this.deadLetterQueue.add('dlq-entry', {
      jobId: job.id,
      jobType: job.data.type,
      payload: sanitizedPayload,
      error: sanitizedError
        ? {
            code: 'JOB_FAILED',
            message: sanitizedError,
            // Security: MED-002 - Do not store stack traces (security through obscurity)
            stack: undefined,
          }
        : undefined,
      attemptsMade: job.attemptsMade,
      failedAt: new Date(job.finishedOn || Date.now()),
      communityId: job.data.communityId,
    });

    // Remove from main queue
    await job.remove();
  }

  /**
   * Clean DLQ entries older than retention period (GDPR compliance)
   *
   * Security: MED-002 - Implement data retention policy
   * Default: 30 days
   */
  async cleanDeadLetterQueue(retentionMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffTime = Date.now() - retentionMs;
    const entries = await this.deadLetterQueue.getJobs(['completed', 'waiting'], 0, 1000);

    let cleaned = 0;
    for (const job of entries) {
      const entry = job.data as any;
      if (entry.failedAt && new Date(entry.failedAt).getTime() < cutoffTime) {
        await job.remove();
        cleaned++;
      }
    }

    return cleaned;
  }

  // ---------------------------------------------------------------------------
  // Queue Metrics
  // ---------------------------------------------------------------------------

  /**
   * Get queue metrics
   */
  async getMetrics(): Promise<QueueMetrics> {
    const [waiting, active, completed, failed, delayed, paused] =
      await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
        this.queue.getPausedCount(),
      ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
    };
  }

  /**
   * Get dead letter queue size
   */
  async getDeadLetterQueueSize(): Promise<number> {
    return this.deadLetterQueue.count();
  }

  /**
   * Get dead letter queue entries
   */
  async getDeadLetterQueueEntries(limit = 100) {
    const jobs = await this.deadLetterQueue.getJobs(
      ['completed', 'waiting', 'active'],
      0,
      limit - 1
    );
    return jobs.map((job) => job.data);
  }

  // ---------------------------------------------------------------------------
  // Queue Control
  // ---------------------------------------------------------------------------

  /**
   * Pause the queue (stop processing new jobs)
   */
  async pause(): Promise<void> {
    await this.queue.pause();
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(delayed = false): Promise<void> {
    await this.queue.drain(delayed);
  }

  /**
   * Clean completed jobs older than grace period
   */
  async cleanCompleted(graceMs: number): Promise<void> {
    await this.queue.clean(graceMs, 0, 'completed');
  }

  /**
   * Clean failed jobs older than grace period
   */
  async cleanFailed(graceMs: number): Promise<void> {
    await this.queue.clean(graceMs, 0, 'failed');
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Generate idempotency key
   *
   * Security: MED-001 - Use crypto.randomUUID() for cryptographically secure random
   */
  private generateIdempotencyKey(): string {
    return `synth-${randomUUID()}`;
  }

  /**
   * Get queue name
   */
  getQueueName(): string {
    return this.config.queueName;
  }

  /**
   * Get worker configuration
   */
  getWorkerConfig() {
    return this.config.workerOptions;
  }

  /**
   * Close queue connections
   */
  async close(): Promise<void> {
    await this.queue.close();
    await this.deadLetterQueue.close();
  }
}
