/**
 * Cache Invalidation Service
 * Sprint S-12: Multi-Layer Caching
 *
 * Handles automatic cache invalidation when data is updated.
 * Integrates with write operations to ensure cache consistency.
 *
 * Strategies:
 * - Write-through: Update cache immediately on write
 * - Write-invalidate: Invalidate cache on write, lazy reload
 * - Pattern-based: Invalidate related entries by pattern
 */

import type { Logger } from 'pino';
import type { MultiLayerCache } from './MultiLayerCache.js';
import { CacheKeys, InvalidationPatterns, CacheNamespace } from './CacheKeyBuilder.js';

/**
 * Invalidation strategies
 */
export enum InvalidationStrategy {
  /** Delete the cached entry immediately */
  INVALIDATE = 'invalidate',
  /** Update the cached entry with new value */
  WRITE_THROUGH = 'write_through',
  /** Invalidate all related entries by pattern */
  PATTERN_INVALIDATE = 'pattern_invalidate',
}

/**
 * Invalidation event for tracking
 */
export interface InvalidationRecord {
  timestamp: number;
  pattern: string;
  strategy: InvalidationStrategy;
  reason: string;
  affectedKeys?: number;
}

/**
 * Cache Invalidation Service
 */
export class CacheInvalidator {
  private readonly log: Logger;
  private readonly cache: MultiLayerCache;
  private readonly history: InvalidationRecord[] = [];
  private readonly maxHistory = 100;

  constructor(cache: MultiLayerCache, logger: Logger) {
    this.log = logger.child({ component: 'CacheInvalidator' });
    this.cache = cache;
  }

  /**
   * Record an invalidation event
   */
  private recordInvalidation(
    pattern: string,
    strategy: InvalidationStrategy,
    reason: string,
    affectedKeys?: number
  ): void {
    const record: InvalidationRecord = {
      timestamp: Date.now(),
      pattern,
      strategy,
      reason,
      affectedKeys,
    };

    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this.log.debug(record, 'Invalidation recorded');
  }

  /**
   * Invalidate user vault cache on update
   */
  async onUserVaultUpdate(userId: string, reason: string = 'vault_update'): Promise<void> {
    const key = CacheKeys.userVault(userId);
    await this.cache.delete(key);
    this.recordInvalidation(key, InvalidationStrategy.INVALIDATE, reason);
  }

  /**
   * Invalidate user position cache on score change
   */
  async onUserScoreUpdate(userId: string, guildId: string, reason: string = 'score_update'): Promise<void> {
    // Invalidate user's position
    const positionKey = CacheKeys.userPosition(userId, guildId);
    await this.cache.delete(positionKey);

    // Invalidate guild leaderboard (positions may have shifted)
    const leaderboardKey = CacheKeys.guildLeaderboard(guildId);
    await this.cache.delete(leaderboardKey);

    this.recordInvalidation(
      `${positionKey},${leaderboardKey}`,
      InvalidationStrategy.INVALIDATE,
      reason
    );
  }

  /**
   * Invalidate guild leaderboard on any member score change
   */
  async onGuildLeaderboardChange(guildId: string, reason: string = 'leaderboard_change'): Promise<void> {
    const pattern = InvalidationPatterns.guildLeaderboard(guildId);
    await this.cache.invalidateByPattern(pattern, reason);
    this.recordInvalidation(pattern, InvalidationStrategy.PATTERN_INVALIDATE, reason);
  }

  /**
   * Invalidate tenant configuration on config change
   */
  async onTenantConfigUpdate(guildId: string, reason: string = 'config_update'): Promise<void> {
    const key = CacheKeys.tenantConfig(guildId);
    await this.cache.delete(key);
    this.recordInvalidation(key, InvalidationStrategy.INVALIDATE, reason);
  }

  /**
   * Invalidate RPC cache (for chain reorg or stale data)
   */
  async onChainReorg(reason: string = 'chain_reorg'): Promise<void> {
    const pattern = InvalidationPatterns.allRpc();
    await this.cache.invalidateByPattern(pattern, reason);
    this.recordInvalidation(pattern, InvalidationStrategy.PATTERN_INVALIDATE, reason);
  }

  /**
   * Invalidate specific RPC balance cache
   */
  async onBalanceChange(walletAddress: string, reason: string = 'balance_change'): Promise<void> {
    const key = CacheKeys.rpcBalance(walletAddress);
    await this.cache.delete(key);
    this.recordInvalidation(key, InvalidationStrategy.INVALIDATE, reason);
  }

  /**
   * Write-through: Update cache with new value
   */
  async writeThroughUserVault<T>(userId: string, data: T): Promise<void> {
    const key = CacheKeys.userVault(userId);
    await this.cache.set(key, data);
    this.recordInvalidation(key, InvalidationStrategy.WRITE_THROUGH, 'write_through_update');
  }

  /**
   * Write-through: Update tenant config with new value
   */
  async writeThroughTenantConfig<T>(guildId: string, config: T): Promise<void> {
    const key = CacheKeys.tenantConfig(guildId);
    await this.cache.set(key, config);
    this.recordInvalidation(key, InvalidationStrategy.WRITE_THROUGH, 'write_through_config');
  }

  /**
   * Invalidate entire namespace (use with caution)
   */
  async invalidateNamespace(namespace: CacheNamespace, reason: string): Promise<void> {
    const pattern = InvalidationPatterns.namespace(namespace);
    await this.cache.invalidateByPattern(pattern, reason);
    this.recordInvalidation(pattern, InvalidationStrategy.PATTERN_INVALIDATE, reason);
    this.log.warn({ namespace, reason }, 'Full namespace invalidation');
  }

  /**
   * Bulk invalidation for multiple users (e.g., after batch update)
   */
  async onBulkUserUpdate(userIds: string[], reason: string = 'bulk_update'): Promise<void> {
    const invalidations = userIds.map((userId) => {
      const key = CacheKeys.userVault(userId);
      return this.cache.delete(key);
    });

    await Promise.all(invalidations);
    this.recordInvalidation(
      `bulk:${userIds.length}_users`,
      InvalidationStrategy.INVALIDATE,
      reason,
      userIds.length
    );
  }

  /**
   * Get invalidation history
   */
  getHistory(): InvalidationRecord[] {
    return [...this.history];
  }

  /**
   * Get recent invalidation count by reason
   */
  getInvalidationStats(windowMs: number = 60000): Map<string, number> {
    const cutoff = Date.now() - windowMs;
    const stats = new Map<string, number>();

    for (const record of this.history) {
      if (record.timestamp >= cutoff) {
        const count = stats.get(record.reason) ?? 0;
        stats.set(record.reason, count + 1);
      }
    }

    return stats;
  }

  /**
   * Clear invalidation history
   */
  clearHistory(): void {
    this.history.length = 0;
  }
}
