/**
 * SynthesisEngine
 *
 * Sprint S-21: Synthesis Engine & Rate Limiting
 *
 * BullMQ-based async job processor for Discord operations.
 * Features:
 * - 3 retries with exponential backoff
 * - 5 concurrent workers, 10 jobs/sec limiter
 * - Global token bucket (50 tokens/sec)
 * - Idempotency keys (24h TTL)
 * - Dead letter queue for failed jobs
 *
 * @see SDD §6.3.4 Synthesis Engine
 */

import type { Logger } from 'pino';
import type {
  ISynthesisEngine,
  IGlobalTokenBucket,
  SynthesisJob,
  SynthesisJobInfo,
  JobStatus,
  BatchSynthesisResult,
  SynthesisEngineStats,
  TokenBucketStatus,
  CreateRolePayload,
  CreateChannelPayload,
  SynthesisPayload,
} from '@freeside/core/ports';
import {
  SYNTHESIS_QUEUE_CONFIG,
  IDEMPOTENCY_CONFIG,
} from '@freeside/core/ports';
import type { CommunityManifest } from '@freeside/core/domain';
import type { SynthesisMetrics } from './metrics.js';
import { JobMetrics, trackDiscord429Error } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * BullMQ Queue interface (compatible with bullmq).
 */
export interface BullMQQueue {
  add(name: string, data: unknown, opts?: JobOptions): Promise<{ id: string }>;
  addBulk(jobs: Array<{ name: string; data: unknown; opts?: JobOptions }>): Promise<Array<{ id: string }>>;
  getJob(jobId: string): Promise<BullMQJob | null>;
  getJobs(statuses: JobStatus[]): Promise<BullMQJob[]>;
  getJobCounts(): Promise<Record<string, number>>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * BullMQ Worker interface.
 */
export interface BullMQWorker {
  on(event: string, handler: (...args: unknown[]) => void): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/**
 * BullMQ Job interface.
 */
export interface BullMQJob {
  id: string;
  name: string;
  data: SynthesisJob;
  progress: number;
  attemptsMade: number;
  failedReason?: string;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  getState(): Promise<JobStatus>;
  remove(): Promise<void>;
  retry(): Promise<void>;
}

/**
 * Job options for BullMQ.
 */
export interface JobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: { type: string; delay: number };
  removeOnComplete?: { age: number } | boolean;
  removeOnFail?: { age: number } | boolean;
}

/**
 * Discord REST client interface.
 */
export interface DiscordRestClient {
  createRole(guildId: string, data: CreateRolePayload): Promise<{ id: string }>;
  deleteRole(guildId: string, roleId: string): Promise<void>;
  assignRole(guildId: string, userId: string, roleId: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<void>;
  createChannel(guildId: string, data: CreateChannelPayload): Promise<{ id: string }>;
  deleteChannel(channelId: string): Promise<void>;
  updateChannelPermissions(channelId: string, overwrites: unknown[]): Promise<void>;
}

/**
 * Redis client interface.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  exists(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

/**
 * Queue and worker factory interface.
 */
export interface QueueFactory {
  createQueue(name: string, options: unknown): BullMQQueue;
  createWorker(name: string, processor: (job: BullMQJob) => Promise<void>, options: unknown): BullMQWorker;
}

/**
 * Options for SynthesisEngine.
 */
export interface SynthesisEngineOptions {
  /** Redis client for idempotency */
  redis: RedisClient;
  /** Queue factory (BullMQ) */
  queueFactory: QueueFactory;
  /** Global token bucket */
  tokenBucket: IGlobalTokenBucket;
  /** Discord REST client */
  discordRest: DiscordRestClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: SynthesisMetrics;
  /** Redis connection for BullMQ */
  redisConnection: unknown;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * BullMQ-based synthesis engine.
 */
export class SynthesisEngine implements ISynthesisEngine {
  private readonly queue: BullMQQueue;
  private readonly worker: BullMQWorker;
  private readonly redis: RedisClient;
  private readonly tokenBucket: IGlobalTokenBucket;
  private readonly discordRest: DiscordRestClient;
  private readonly log: Logger;
  private readonly metrics: SynthesisMetrics;

  // Track 429 errors in last hour for stats
  private discord429History: number[] = [];
  private rateLimitHistory: number[] = [];

  constructor(options: SynthesisEngineOptions) {
    this.redis = options.redis;
    this.tokenBucket = options.tokenBucket;
    this.discordRest = options.discordRest;
    this.log = options.logger.child({ component: 'SynthesisEngine' });
    this.metrics = options.metrics;

    // Create BullMQ queue with default job options
    this.queue = options.queueFactory.createQueue(SYNTHESIS_QUEUE_CONFIG.QUEUE_NAME, {
      connection: options.redisConnection,
      defaultJobOptions: {
        attempts: SYNTHESIS_QUEUE_CONFIG.MAX_ATTEMPTS,
        backoff: {
          type: SYNTHESIS_QUEUE_CONFIG.BACKOFF_TYPE,
          delay: SYNTHESIS_QUEUE_CONFIG.BACKOFF_BASE_MS,
        },
        removeOnComplete: { age: SYNTHESIS_QUEUE_CONFIG.REMOVE_ON_COMPLETE_AGE },
        removeOnFail: { age: SYNTHESIS_QUEUE_CONFIG.REMOVE_ON_FAIL_AGE },
      },
    });

    // Create worker with concurrency and rate limits
    this.worker = options.queueFactory.createWorker(
      SYNTHESIS_QUEUE_CONFIG.QUEUE_NAME,
      async (job: BullMQJob) => this.processJob(job),
      {
        connection: options.redisConnection,
        concurrency: SYNTHESIS_QUEUE_CONFIG.CONCURRENCY,
        limiter: {
          max: SYNTHESIS_QUEUE_CONFIG.RATE_LIMIT_MAX,
          duration: SYNTHESIS_QUEUE_CONFIG.RATE_LIMIT_DURATION,
        },
      }
    );

    // Set up worker event handlers
    this.setupWorkerEvents();

    this.log.info(
      {
        concurrency: SYNTHESIS_QUEUE_CONFIG.CONCURRENCY,
        rateLimit: `${SYNTHESIS_QUEUE_CONFIG.RATE_LIMIT_MAX}/sec`,
      },
      'Synthesis engine initialized'
    );
  }

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  async enqueue(
    job: SynthesisJob,
    options?: { priority?: number; delay?: number }
  ): Promise<string> {
    const result = await this.queue.add(
      `synthesis-${job.type}-${Date.now()}`,
      job,
      {
        priority: options?.priority,
        delay: options?.delay,
      }
    );

    JobMetrics.enqueued(this.metrics, job.type);
    this.log.debug({ jobId: result.id, type: job.type }, 'Job enqueued');

    return result.id;
  }

  async enqueueSynthesis(
    communityId: string,
    guildId: string,
    manifest: CommunityManifest
  ): Promise<BatchSynthesisResult> {
    const jobs: Array<{ name: string; data: SynthesisJob; opts: JobOptions }> = [];

    // Generate role creation jobs
    for (const tierRole of manifest.tierRoles) {
      const payload: CreateRolePayload = {
        name: tierRole.roleName,
        color: tierRole.roleColor,
        mentionable: tierRole.mentionable,
        hoist: tierRole.hoist,
      };

      jobs.push({
        name: `synthesis-create_role-${communityId}-${tierRole.tierId}`,
        data: {
          type: 'create_role',
          guildId,
          communityId,
          payload,
          idempotencyKey: `role:${communityId}:${tierRole.tierId}`,
        },
        opts: {
          priority: jobs.length,
          delay: jobs.length * 100, // Stagger by 100ms
        },
      });
    }

    // Generate channel creation jobs
    if (manifest.channels && manifest.channelTemplate !== 'none') {
      for (const channel of manifest.channels) {
        const payload: CreateChannelPayload = {
          name: channel.name,
          type: channel.type as 'text' | 'voice' | 'category',
          topic: channel.topic,
          parentId: channel.parentId,
          permissionOverwrites: channel.permissionOverrides?.map((o) => ({
            id: o.id,
            type: o.type === 'role' ? 'role' : 'member',
            allow: o.allow,
            deny: o.deny,
          })),
        };

        jobs.push({
          name: `synthesis-create_channel-${communityId}-${channel.name}`,
          data: {
            type: 'create_channel',
            guildId,
            communityId,
            payload,
            idempotencyKey: `channel:${communityId}:${channel.name}`,
          },
          opts: {
            priority: jobs.length,
            delay: jobs.length * 100,
          },
        });
      }
    }

    // Bulk add all jobs
    const results = await this.queue.addBulk(jobs);

    // Track metrics
    for (const job of jobs) {
      JobMetrics.enqueued(this.metrics, job.data.type);
    }

    this.log.info(
      { communityId, guildId, jobCount: results.length },
      'Batch synthesis enqueued'
    );

    return {
      communityId,
      guildId,
      jobCount: results.length,
      jobIds: results.map((r) => r.id),
      enqueuedAt: new Date(),
    };
  }

  async getJob(jobId: string): Promise<SynthesisJobInfo | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    return this.mapJobToInfo(job);
  }

  async getJobsByCommunity(
    communityId: string,
    status?: JobStatus
  ): Promise<SynthesisJobInfo[]> {
    const statuses = status ? [status] : ['waiting', 'active', 'completed', 'failed', 'delayed'] as JobStatus[];
    const jobs = await this.queue.getJobs(statuses);

    return jobs
      .filter((job) => job.data.communityId === communityId)
      .map((job) => this.mapJobToInfo(job));
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobId);
    if (!job) return false;

    const state = await job.getState();
    if (state === 'active' || state === 'completed') {
      return false; // Can't cancel active or completed jobs
    }

    await job.remove();
    this.log.info({ jobId }, 'Job cancelled');
    return true;
  }

  async retryJob(jobId: string): Promise<string | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    if (state !== 'failed') {
      return null; // Can only retry failed jobs
    }

    await job.retry();
    JobMetrics.retried(this.metrics, job.data.type);
    this.log.info({ jobId }, 'Job retry requested');
    return jobId;
  }

  // ===========================================================================
  // Token Bucket
  // ===========================================================================

  async getTokenBucketStatus(): Promise<TokenBucketStatus> {
    return this.tokenBucket.getStatus();
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  async getStats(): Promise<SynthesisEngineStats> {
    const counts = await this.queue.getJobCounts();
    const tokenStatus = await this.tokenBucket.getStatus();

    // Clean up old history entries (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.discord429History = this.discord429History.filter((t) => t > oneHourAgo);
    this.rateLimitHistory = this.rateLimitHistory.filter((t) => t > oneHourAgo);

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      tokenBucket: tokenStatus,
      rateLimitHitsLastHour: this.rateLimitHistory.length,
      discord429ErrorsLastHour: this.discord429History.length,
    };
  }

  async isProcessed(key: string): Promise<boolean> {
    const exists = await this.redis.exists(`${IDEMPOTENCY_CONFIG.KEY_PREFIX}${key}`);
    return exists === 1;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.log.info('Synthesis engine closed');
  }

  async pause(): Promise<void> {
    await this.worker.pause();
    this.log.info('Synthesis engine paused');
  }

  async resume(): Promise<void> {
    await this.worker.resume();
    this.log.info('Synthesis engine resumed');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Process a synthesis job.
   */
  private async processJob(job: BullMQJob): Promise<void> {
    const { type, guildId, payload, idempotencyKey } = job.data;
    const startTime = Date.now();

    // Acquire token from global bucket
    await this.tokenBucket.acquireWithWait();

    // Check idempotency
    const alreadyProcessed = await this.checkIdempotency(idempotencyKey);
    if (alreadyProcessed) {
      this.metrics.idempotencyHits.inc();
      this.log.info({ idempotencyKey }, 'Job already processed, skipping');
      return;
    }

    this.metrics.idempotencyMisses.inc();

    try {
      await this.executeOperation(type, guildId, payload);

      // Mark as processed
      await this.markProcessed(idempotencyKey);

      const duration = Date.now() - startTime;
      JobMetrics.completed(this.metrics, type, duration);

      this.log.info({ jobId: job.id, type, duration }, 'Job completed');
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this.handleRateLimitError(error, type, guildId);
        throw error; // BullMQ will retry
      }

      JobMetrics.failed(this.metrics, type, this.getErrorReason(error));
      throw error;
    }
  }

  /**
   * Execute a Discord operation.
   */
  private async executeOperation(
    type: string,
    guildId: string,
    payload: SynthesisPayload
  ): Promise<void> {
    switch (type) {
      case 'create_role': {
        const p = payload as CreateRolePayload;
        await this.discordRest.createRole(guildId, p);
        break;
      }
      case 'delete_role': {
        const p = payload as { roleId: string };
        await this.discordRest.deleteRole(guildId, p.roleId);
        break;
      }
      case 'assign_role': {
        const p = payload as { userId: string; roleId: string };
        await this.discordRest.assignRole(guildId, p.userId, p.roleId);
        break;
      }
      case 'remove_role': {
        const p = payload as { userId: string; roleId: string };
        await this.discordRest.removeRole(guildId, p.userId, p.roleId);
        break;
      }
      case 'create_channel': {
        const p = payload as CreateChannelPayload;
        await this.discordRest.createChannel(guildId, p);
        break;
      }
      case 'delete_channel': {
        const p = payload as { channelId: string };
        await this.discordRest.deleteChannel(p.channelId);
        break;
      }
      case 'update_permissions': {
        const p = payload as { channelId: string; overwrites: unknown[] };
        await this.discordRest.updateChannelPermissions(p.channelId, p.overwrites);
        break;
      }
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  /**
   * Check if idempotency key exists.
   */
  private async checkIdempotency(key: string): Promise<boolean> {
    const exists = await this.redis.exists(`${IDEMPOTENCY_CONFIG.KEY_PREFIX}${key}`);
    return exists === 1;
  }

  /**
   * Mark idempotency key as processed.
   */
  private async markProcessed(key: string): Promise<void> {
    await this.redis.setex(
      `${IDEMPOTENCY_CONFIG.KEY_PREFIX}${key}`,
      IDEMPOTENCY_CONFIG.TTL_SECONDS,
      '1'
    );
  }

  /**
   * Check if error is a rate limit error.
   */
  private isRateLimitError(error: unknown): boolean {
    const message = (error as Error)?.message ?? '';
    return message.includes('429') || message.includes('rate limit');
  }

  /**
   * Handle Discord rate limit error.
   */
  private handleRateLimitError(error: unknown, type: string, guildId: string): void {
    const err = error as { global?: boolean; retryAfter?: number };

    this.rateLimitHistory.push(Date.now());
    this.discord429History.push(Date.now());

    trackDiscord429Error(this.metrics, err, type, guildId);

    if (err.global) {
      this.log.error(
        { type, guildId, retryAfter: err.retryAfter },
        'CRITICAL: Global 429 rate limit hit!'
      );
    } else {
      this.log.warn(
        { type, guildId, retryAfter: err.retryAfter },
        'Discord 429 rate limit hit'
      );
    }
  }

  /**
   * Extract error reason string.
   */
  private getErrorReason(error: unknown): string {
    if (error instanceof Error) {
      if (error.message.includes('429')) return 'rate_limit';
      if (error.message.includes('403')) return 'forbidden';
      if (error.message.includes('404')) return 'not_found';
      return 'unknown';
    }
    return 'unknown';
  }

  /**
   * Map BullMQ job to SynthesisJobInfo.
   */
  private mapJobToInfo(job: BullMQJob): SynthesisJobInfo {
    return {
      jobId: job.id,
      name: job.name,
      status: 'waiting', // Will be updated by getState()
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
    };
  }

  /**
   * Set up worker event handlers.
   */
  private setupWorkerEvents(): void {
    this.worker.on('completed', (job: BullMQJob) => {
      this.log.info({ jobId: job.id, type: job.data.type }, 'Synthesis job completed');
    });

    this.worker.on('failed', (job: BullMQJob | undefined, error: Error) => {
      this.log.error({ jobId: job?.id, error: error.message }, 'Synthesis job failed');
    });

    this.worker.on('error', (error: Error) => {
      this.log.error({ error: error.message }, 'Worker error');
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a synthesis engine.
 *
 * @param options - Engine options
 * @returns Synthesis engine instance
 */
export function createSynthesisEngine(options: SynthesisEngineOptions): ISynthesisEngine {
  return new SynthesisEngine(options);
}
