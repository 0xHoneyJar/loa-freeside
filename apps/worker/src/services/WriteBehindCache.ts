/**
 * Write-Behind Cache Service
 * Sprint S-10: Write-Behind Cache
 *
 * Implements write-behind caching for score updates:
 * - Writes go to ScyllaDB immediately (fast path)
 * - PostgreSQL sync happens asynchronously in batches
 * - PostgreSQL becomes the backup/analytics store
 *
 * This allows sub-millisecond writes while maintaining PostgreSQL
 * as a consistent backup for analytics and disaster recovery.
 *
 * Pattern:
 * 1. Score update arrives
 * 2. Write to ScyllaDB via ScoreRepository (immediate)
 * 3. Queue PostgreSQL sync item
 * 4. Background worker processes queue in batches
 * 5. PostgreSQL sync completes asynchronously
 */

import type { Logger } from 'pino';
import type { TenantRequestContext } from './TenantContext.js';
import type { ScoreRepository, ScoreUpdate } from '../repositories/ScoreRepository.js';
import type { Score } from '../infrastructure/scylla/types.js';
import { recordCommand } from './TenantMetrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Pending sync item for PostgreSQL
 */
export interface PendingSyncItem {
  communityId: string;
  profileId: string;
  convictionScore: string;
  activityScore: string;
  currentRank: number;
  updatedAt: Date;
  retryCount: number;
  createdAt: Date;
}

/**
 * Sync result for a batch
 */
export interface SyncBatchResult {
  success: number;
  failed: number;
  retried: number;
}

/**
 * Write-behind cache configuration
 */
export interface WriteBehindConfig {
  /** Max items to sync in a single batch */
  batchSize: number;
  /** Interval between sync runs (ms) */
  syncIntervalMs: number;
  /** Max retries before discarding item */
  maxRetries: number;
  /** Max pending items before applying backpressure */
  maxPendingItems: number;
  /** Delay between retries (ms) - exponential backoff base */
  retryDelayMs: number;
}

/**
 * PostgreSQL sync function type
 * This is injected to avoid direct database.ts dependency
 */
export type PostgresSyncFn = (items: PendingSyncItem[]) => Promise<SyncBatchResult>;

// --------------------------------------------------------------------------
// Default Configuration
// --------------------------------------------------------------------------

const DEFAULT_CONFIG: WriteBehindConfig = {
  batchSize: 100,
  syncIntervalMs: 5000, // 5 seconds
  maxRetries: 3,
  maxPendingItems: 10000,
  retryDelayMs: 1000,
};

// --------------------------------------------------------------------------
// Write-Behind Cache Service
// --------------------------------------------------------------------------

export class WriteBehindCache {
  private readonly log: Logger;
  private readonly scores: ScoreRepository;
  private readonly config: WriteBehindConfig;
  private readonly pendingSync: Map<string, PendingSyncItem>;
  private readonly postgresSync: PostgresSyncFn;

  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private isShuttingDown = false;

  constructor(
    scoreRepository: ScoreRepository,
    postgresSync: PostgresSyncFn,
    logger: Logger,
    config: Partial<WriteBehindConfig> = {}
  ) {
    this.scores = scoreRepository;
    this.postgresSync = postgresSync;
    this.log = logger.child({ component: 'WriteBehindCache' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pendingSync = new Map();
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the background sync worker
   */
  start(): void {
    if (this.syncTimer) {
      this.log.warn('Write-behind cache already started');
      return;
    }

    this.log.info(
      {
        batchSize: this.config.batchSize,
        syncIntervalMs: this.config.syncIntervalMs
      },
      'Starting write-behind cache'
    );

    this.syncTimer = setInterval(() => {
      this.processSyncQueue().catch((error) => {
        this.log.error({ error }, 'Error processing sync queue');
      });
    }, this.config.syncIntervalMs);
  }

  /**
   * Stop the background sync worker
   * Flushes remaining items before stopping
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Flush remaining items
    if (this.pendingSync.size > 0) {
      this.log.info(
        { pendingCount: this.pendingSync.size },
        'Flushing pending sync items before shutdown'
      );
      await this.processSyncQueue();
    }

    this.log.info('Write-behind cache stopped');
  }

  // --------------------------------------------------------------------------
  // Write Operations
  // --------------------------------------------------------------------------

  /**
   * Update a score through the write-behind cache
   * - Writes to ScyllaDB immediately
   * - Queues PostgreSQL sync
   */
  async updateScore(
    ctx: TenantRequestContext,
    update: ScoreUpdate
  ): Promise<Score> {
    const start = Date.now();

    try {
      // Check backpressure
      if (this.pendingSync.size >= this.config.maxPendingItems) {
        this.log.warn(
          { pendingCount: this.pendingSync.size, maxPending: this.config.maxPendingItems },
          'Write-behind cache backpressure - processing sync queue'
        );
        await this.processSyncQueue();
      }

      // Write to ScyllaDB (fast path)
      const updatedScore = await this.scores.updateScore(ctx, update);

      // Queue PostgreSQL sync
      this.queueSync(ctx.communityId, updatedScore);

      recordCommand(ctx.communityId, ctx.tier, 'writebehind_update', 'success', Date.now() - start);

      this.log.debug(
        {
          communityId: ctx.communityId,
          profileId: update.profileId,
          pendingCount: this.pendingSync.size
        },
        'Score updated via write-behind cache'
      );

      return updatedScore;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'writebehind_update', 'error', Date.now() - start);
      this.log.error({ error, update }, 'Failed to update score via write-behind cache');
      throw error;
    }
  }

  /**
   * Batch update scores through the write-behind cache
   */
  async batchUpdateScores(
    ctx: TenantRequestContext,
    updates: ScoreUpdate[]
  ): Promise<{ success: number; failed: number }> {
    const start = Date.now();
    let success = 0;
    let failed = 0;

    try {
      // Process updates sequentially to maintain order
      for (const update of updates) {
        try {
          await this.updateScore(ctx, update);
          success++;
        } catch {
          failed++;
          this.log.warn({ profileId: update.profileId }, 'Failed to update score in batch');
        }
      }

      recordCommand(
        ctx.communityId,
        ctx.tier,
        'writebehind_batch_update',
        failed === 0 ? 'success' : 'partial',
        Date.now() - start
      );

      return { success, failed };
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'writebehind_batch_update', 'error', Date.now() - start);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Sync Queue
  // --------------------------------------------------------------------------

  /**
   * Queue a score for PostgreSQL sync
   */
  private queueSync(communityId: string, score: Score): void {
    const key = `${communityId}:${score.profileId}`;

    // Upsert - newer updates replace older ones
    const existing = this.pendingSync.get(key);

    this.pendingSync.set(key, {
      communityId,
      profileId: score.profileId,
      convictionScore: score.convictionScore,
      activityScore: score.activityScore,
      currentRank: score.currentRank,
      updatedAt: score.updatedAt,
      retryCount: existing?.retryCount ?? 0,
      createdAt: existing?.createdAt ?? new Date(),
    });
  }

  /**
   * Process the sync queue
   * Called periodically by background worker
   */
  async processSyncQueue(): Promise<SyncBatchResult> {
    if (this.isSyncing) {
      this.log.debug('Sync already in progress, skipping');
      return { success: 0, failed: 0, retried: 0 };
    }

    if (this.pendingSync.size === 0) {
      return { success: 0, failed: 0, retried: 0 };
    }

    this.isSyncing = true;
    const start = Date.now();

    try {
      // Get batch of items to sync
      const batch: PendingSyncItem[] = [];
      const keys: string[] = [];

      for (const [key, item] of this.pendingSync) {
        if (batch.length >= this.config.batchSize) break;
        batch.push(item);
        keys.push(key);
      }

      if (batch.length === 0) {
        return { success: 0, failed: 0, retried: 0 };
      }

      this.log.debug({ batchSize: batch.length }, 'Processing sync batch');

      // Sync to PostgreSQL
      const result = await this.postgresSync(batch);

      // Remove successful items from queue
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key && i < result.success) {
          this.pendingSync.delete(key);
        }
      }

      // Handle failures - increment retry count or discard
      let retried = 0;
      for (let i = result.success; i < keys.length; i++) {
        const key = keys[i];
        if (!key) continue;

        const item = this.pendingSync.get(key);
        if (!item) continue;

        if (item.retryCount >= this.config.maxRetries) {
          this.log.error(
            { communityId: item.communityId, profileId: item.profileId, retries: item.retryCount },
            'Max retries exceeded, discarding sync item'
          );
          this.pendingSync.delete(key);
        } else {
          item.retryCount++;
          retried++;
        }
      }

      const duration = Date.now() - start;
      this.log.info(
        {
          success: result.success,
          failed: result.failed,
          retried,
          durationMs: duration,
          remainingPending: this.pendingSync.size
        },
        'Sync batch completed'
      );

      return { ...result, retried };
    } finally {
      this.isSyncing = false;
    }
  }

  // --------------------------------------------------------------------------
  // Status & Metrics
  // --------------------------------------------------------------------------

  /**
   * Get current queue status
   */
  getStatus(): {
    pendingCount: number;
    isSyncing: boolean;
    isRunning: boolean;
    isShuttingDown: boolean;
  } {
    return {
      pendingCount: this.pendingSync.size,
      isSyncing: this.isSyncing,
      isRunning: this.syncTimer !== null,
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Get pending items for a community (for debugging)
   */
  getPendingForCommunity(communityId: string): PendingSyncItem[] {
    const items: PendingSyncItem[] = [];
    for (const [key, item] of this.pendingSync) {
      if (key.startsWith(`${communityId}:`)) {
        items.push(item);
      }
    }
    return items;
  }

  /**
   * Force immediate sync (for testing/debugging)
   */
  async flushSync(): Promise<SyncBatchResult> {
    let totalResult: SyncBatchResult = { success: 0, failed: 0, retried: 0 };

    while (this.pendingSync.size > 0) {
      const result = await this.processSyncQueue();
      totalResult.success += result.success;
      totalResult.failed += result.failed;
      totalResult.retried += result.retried;

      // Break if no progress to avoid infinite loop
      if (result.success === 0 && result.failed === 0) break;
    }

    return totalResult;
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createWriteBehindCache(
  scoreRepository: ScoreRepository,
  postgresSync: PostgresSyncFn,
  logger: Logger,
  config?: Partial<WriteBehindConfig>
): WriteBehindCache {
  return new WriteBehindCache(scoreRepository, postgresSync, logger, config);
}
