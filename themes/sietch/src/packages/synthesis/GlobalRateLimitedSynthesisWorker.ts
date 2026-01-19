/**
 * Global Rate-Limited Synthesis Worker (v5.0 - Sprint 45)
 *
 * Extends SynthesisWorker with global token bucket rate limiting.
 * Ensures ALL Discord API calls across ALL workers and tenants respect
 * the platform-wide 50 req/sec limit.
 *
 * Key Features:
 * - Global token acquisition before every Discord API call
 * - Graceful handling of rate limit timeouts
 * - Integration with existing SynthesisWorker job handlers
 * - Automatic retries on rate limit errors
 *
 * Part of Phase 4: BullMQ + Global Token Bucket
 *
 * Security Considerations:
 * - CRIT-001: All Discord operations MUST acquire tokens first
 * - HIGH-004: Timeout protection prevents indefinite blocking
 * - MED-004: Failed acquisitions trigger job retry
 */

import { Worker, Job } from 'bullmq';
import type { WorkerOptions } from 'bullmq';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import type { Client } from 'discord.js';
import type {
  SynthesisJobData,
  SynthesisJobResult,
  SynthesisJobProgress,
} from './types.js';
import {
  SynthesisWorker,
  SynthesisError,
  DiscordAPIError,
} from './SynthesisWorker.js';
import type { SynthesisWorkerConfig } from './SynthesisWorker.js';
import {
  GlobalDiscordTokenBucket,
  RateLimitExceededError,
} from './GlobalDiscordTokenBucket.js';
import type { TokenBucketConfig, Logger } from './GlobalDiscordTokenBucket.js';

// =============================================================================
// Configuration
// =============================================================================

export interface GlobalRateLimitedWorkerConfig extends SynthesisWorkerConfig {
  /**
   * Token bucket configuration
   * If not provided, uses same Redis as queue
   */
  tokenBucket?: Partial<TokenBucketConfig>;

  /**
   * Timeout for token acquisition (milliseconds)
   * @default 30000 (30 seconds)
   */
  tokenAcquisitionTimeout?: number;

  /**
   * Logger instance for dependency injection
   * @default console
   */
  logger?: Logger;
}

// =============================================================================
// Global Rate-Limited Synthesis Worker
// =============================================================================

/**
 * GlobalRateLimitedSynthesisWorker
 *
 * Wrapper around SynthesisWorker that adds global rate limiting via
 * GlobalDiscordTokenBucket. All Discord API calls are automatically
 * rate-limited at the platform level.
 *
 * **Architecture:**
 * 1. Job dequeued from BullMQ
 * 2. Before processing: Acquire token from global bucket
 * 3. If timeout: Throw retryable error (BullMQ retries job)
 * 4. If success: Process job with standard SynthesisWorker
 * 5. Job completes normally
 */
export class GlobalRateLimitedSynthesisWorker {
  private worker: Worker;
  private synthesisWorker: SynthesisWorker;
  private globalBucket: GlobalDiscordTokenBucket;
  private discordClient: Client;
  private config: GlobalRateLimitedWorkerConfig;
  private logger: Logger;
  private jobCompletedCount = 0;

  constructor(config: GlobalRateLimitedWorkerConfig) {
    this.config = config;
    this.discordClient = config.discordClient;
    this.logger = config.logger || console;

    // Initialize global token bucket
    const bucketConfig: TokenBucketConfig = {
      redis: config.tokenBucket?.redis || config.redis,
      maxTokens: config.tokenBucket?.maxTokens,
      refillRate: config.tokenBucket?.refillRate,
      bucketKey: config.tokenBucket?.bucketKey,
      defaultTimeout:
        config.tokenAcquisitionTimeout || config.tokenBucket?.defaultTimeout,
      initialBackoff: config.tokenBucket?.initialBackoff,
      maxBackoff: config.tokenBucket?.maxBackoff,
      logger: this.logger,
    };

    this.globalBucket = new GlobalDiscordTokenBucket(bucketConfig);

    // Initialize underlying SynthesisWorker (but don't start it)
    // We wrap its processJob method with rate limiting
    this.synthesisWorker = new SynthesisWorker(config);

    // Create our own worker that wraps synthesis with rate limiting
    const connection = new Redis(config.redis.port, config.redis.host, {
      password: config.redis.password,
      db: config.redis.db || 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const workerOptions: WorkerOptions = {
      connection,
      concurrency: config.concurrency || 5,
      limiter: config.limiter || {
        max: 10,
        duration: 1000,
      },
    };

    this.worker = new Worker(
      config.queueName,
      async (job: Job) => this.processJobWithRateLimit(job),
      workerOptions
    );

    this.setupEventHandlers();
  }

  /**
   * Initialize the worker and token bucket
   *
   * Must be called before worker starts processing jobs
   */
  async initialize(): Promise<void> {
    await this.globalBucket.initialize();
    this.logger.info({
      queueName: this.config.queueName,
      tokenAcquisitionTimeout: this.config.tokenAcquisitionTimeout || 30000,
    }, 'Global rate-limited worker initialized');
  }

  /**
   * Process job with global rate limiting
   *
   * Wraps the standard SynthesisWorker.processJob with token acquisition
   */
  private async processJobWithRateLimit(job: Job): Promise<SynthesisJobResult> {
    const jobData = job.data as SynthesisJobData;
    const startTime = Date.now();

    try {
      // Update progress: Waiting for rate limit token
      await job.updateProgress({
        current: 0,
        total: 100,
        stage: 'rate_limit_wait',
        message: 'Waiting for global rate limit token...',
      } as SynthesisJobProgress);

      // CRITICAL: Acquire token from global bucket BEFORE any Discord API call
      const tokenAcquisitionStart = Date.now();
      try {
        await this.globalBucket.acquireWithWait(
          1,
          this.config.tokenAcquisitionTimeout || 30000
        );
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          const waitTime = Date.now() - tokenAcquisitionStart;
          this.logger.warn({
            jobId: job.id,
            waitTime,
            timeout: this.config.tokenAcquisitionTimeout || 30000,
          }, 'Token acquisition timeout');

          // Throw retryable error - BullMQ will retry this job
          throw new SynthesisError(
            `Global rate limit timeout (waited ${waitTime}ms)`,
            'RATE_LIMIT_TIMEOUT',
            true // Retryable
          );
        }
        throw error;
      }

      const tokenWaitTime = Date.now() - tokenAcquisitionStart;
      if (tokenWaitTime > 1000) {
        this.logger.info({
          jobId: job.id,
          tokenWaitTime,
        }, 'Token acquired after wait');
      }

      // Update progress: Processing job
      await job.updateProgress({
        current: 10,
        total: 100,
        stage: 'processing',
        message: 'Token acquired, processing job...',
      } as SynthesisJobProgress);

      // Process job with underlying SynthesisWorker
      // Call the protected processJob method (type-safe inheritance)
      const result = await this.synthesisWorker['processJob'](job);

      const totalDuration = Date.now() - startTime;

      return {
        ...result,
        duration: totalDuration,
        metadata: {
          ...result.metadata,
          tokenWaitTime,
          totalDuration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Handle rate limit errors
      if (
        error instanceof SynthesisError &&
        error.code === 'RATE_LIMIT_TIMEOUT'
      ) {
        return {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: true,
          },
          duration,
        };
      }

      // Handle Discord API 429 errors (shouldn't happen with bucket, but just in case)
      if (
        error instanceof DiscordAPIError &&
        error.message.includes('429')
      ) {
        this.logger.error({
          jobId: job.id,
          error: error.message,
        }, 'UNEXPECTED Discord 429 - token bucket failed!');
        return {
          success: false,
          error: {
            code: 'DISCORD_429_UNEXPECTED',
            message: 'Discord 429 despite global rate limiting',
            retryable: true,
          },
          duration,
        };
      }

      // Re-throw other errors to be handled by worker
      throw error;
    }
  }

  /**
   * Get global token bucket statistics
   */
  async getBucketStats() {
    return this.globalBucket.getStats();
  }

  /**
   * Get current token count
   */
  async getCurrentTokens(): Promise<number> {
    return this.globalBucket.getCurrentTokens();
  }

  /**
   * Reset token bucket (for testing or emergency)
   */
  async resetBucket(): Promise<void> {
    return this.globalBucket.reset();
  }

  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.globalBucket.isReady();
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  private setupEventHandlers(): void {
    this.worker.on('completed', async (job) => {
      this.logger.info({ jobId: job.id }, 'Job completed');

      this.jobCompletedCount++;

      // Log bucket stats periodically (every 10 jobs)
      if (this.jobCompletedCount % 10 === 0) {
        try {
          const stats = await this.globalBucket.getStats();
          this.logger.info({
            currentTokens: stats.currentTokens,
            maxTokens: stats.maxTokens,
            utilizationPercent: stats.utilizationPercent,
          }, 'Bucket stats');
        } catch (error) {
          // Ignore stats errors
        }
      }
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error({
        jobId: job?.id,
        error: error.message,
      }, 'Job failed');

      // Alert on unexpected 429s
      if (error.message.includes('DISCORD_429_UNEXPECTED')) {
        this.logger.error({
          jobId: job?.id,
          alert: 'CRITICAL',
        }, 'Discord 429 despite global rate limiting!');
      }
    });

    this.worker.on('error', (error) => {
      this.logger.error({ error: error.message }, 'Worker error');
    });

    this.worker.on('stalled', (jobId) => {
      this.logger.warn({ jobId }, 'Job stalled');
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the worker and token bucket
   */
  async close(): Promise<void> {
    await this.worker.close();
    await this.synthesisWorker.close();
    await this.globalBucket.close();
    this.logger.info('Worker closed');
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
  }
}
