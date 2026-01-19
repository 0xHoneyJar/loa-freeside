/**
 * ConfigCache - Multi-Layer Configuration Cache
 *
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Implements a two-layer cache strategy:
 * - L1: In-memory Map with TTL (fast, process-local)
 * - L2: Redis with TTL (shared across instances)
 *
 * TTL serves as a fallback if Pub/Sub invalidation is missed.
 * Default TTL: 5 minutes.
 *
 * @see grimoires/loa/sdd.md §5.2.2 Cache Layer
 * @see grimoires/loa/sprint.md Sprint 120
 */

import type { Redis } from 'ioredis';
import { logger as defaultLogger } from '../../utils/logger.js';
import { recordCacheHit, recordCacheMiss, recordCacheInvalidation } from './cacheMetrics.js';
import type { CurrentConfiguration } from '../../db/types/config.types.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigCacheConfig {
  redis?: Redis;
  logger?: typeof defaultLogger;
  /** TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
  /** Key prefix for Redis (default: 'config:cache') */
  keyPrefix?: string;
}

export interface IConfigCache {
  /**
   * Get configuration from cache (L1 -> L2 -> miss).
   */
  get(serverId: string): Promise<CurrentConfiguration | null>;

  /**
   * Set configuration in cache (L1 and L2).
   */
  set(serverId: string, config: CurrentConfiguration): Promise<void>;

  /**
   * Invalidate configuration in cache (L1 and L2).
   */
  invalidate(serverId: string): Promise<void>;

  /**
   * Clear all cached configurations (for testing/maintenance).
   */
  clear(): Promise<void>;
}

// =============================================================================
// L1 Cache Entry
// =============================================================================

interface L1CacheEntry {
  config: CurrentConfiguration;
  expiresAt: number;
}

// =============================================================================
// ConfigCache Implementation
// =============================================================================

export class ConfigCache implements IConfigCache {
  private readonly redis?: Redis;
  private readonly logger: typeof defaultLogger;
  private readonly ttlMs: number;
  private readonly keyPrefix: string;

  /** L1: In-memory cache */
  private readonly l1Cache: Map<string, L1CacheEntry> = new Map();

  /** Default TTL: 5 minutes */
  private static readonly DEFAULT_TTL_MS = 5 * 60 * 1000;

  constructor(config: ConfigCacheConfig = {}) {
    this.redis = config.redis;
    this.logger = config.logger ?? defaultLogger;
    this.ttlMs = config.ttlMs ?? ConfigCache.DEFAULT_TTL_MS;
    this.keyPrefix = config.keyPrefix ?? 'config:cache';
  }

  /**
   * Get the Redis key for a server.
   */
  private getRedisKey(serverId: string): string {
    return `${this.keyPrefix}:${serverId}`;
  }

  /**
   * Get configuration from cache.
   *
   * Lookup order:
   * 1. L1 (in-memory) - fastest, process-local
   * 2. L2 (Redis) - shared across instances
   * 3. Return null (cache miss)
   */
  async get(serverId: string): Promise<CurrentConfiguration | null> {
    // Try L1 cache first
    const l1Entry = this.l1Cache.get(serverId);
    if (l1Entry) {
      if (Date.now() < l1Entry.expiresAt) {
        recordCacheHit('l1');
        this.logger.debug({ serverId, layer: 'L1' }, 'Config cache hit');
        return l1Entry.config;
      }
      // Entry expired, remove it
      this.l1Cache.delete(serverId);
    }

    // Try L2 cache (Redis)
    if (this.redis) {
      try {
        const key = this.getRedisKey(serverId);
        const data = await this.redis.get(key);

        if (data) {
          const config = this.deserializeConfig(data);
          // Populate L1 cache for subsequent reads
          this.setL1(serverId, config);
          recordCacheHit('l2');
          this.logger.debug({ serverId, layer: 'L2' }, 'Config cache hit');
          return config;
        }
      } catch (error) {
        // Log but don't throw - treat as cache miss
        this.logger.error({ error, serverId }, 'Failed to read from L2 cache');
      }
    }

    // Cache miss
    recordCacheMiss();
    this.logger.debug({ serverId }, 'Config cache miss');
    return null;
  }

  /**
   * Set configuration in cache (L1 and L2).
   */
  async set(serverId: string, config: CurrentConfiguration): Promise<void> {
    // Set L1 cache
    this.setL1(serverId, config);

    // Set L2 cache (Redis)
    if (this.redis) {
      try {
        const key = this.getRedisKey(serverId);
        const data = this.serializeConfig(config);
        const ttlSeconds = Math.ceil(this.ttlMs / 1000);

        await this.redis.setex(key, ttlSeconds, data);

        this.logger.debug({ serverId }, 'Config set in L2 cache');
      } catch (error) {
        // Log but don't throw - L1 cache still works
        this.logger.error({ error, serverId }, 'Failed to write to L2 cache');
      }
    }
  }

  /**
   * Invalidate configuration in cache (L1 and L2).
   */
  async invalidate(serverId: string): Promise<void> {
    // Invalidate L1
    const hadL1 = this.l1Cache.delete(serverId);

    // Invalidate L2
    let hadL2 = false;
    if (this.redis) {
      try {
        const key = this.getRedisKey(serverId);
        const deleted = await this.redis.del(key);
        hadL2 = deleted > 0;
      } catch (error) {
        this.logger.error({ error, serverId }, 'Failed to invalidate L2 cache');
      }
    }

    // Record metric
    if (hadL1 || hadL2) {
      recordCacheInvalidation();
    }

    this.logger.debug({ serverId, hadL1, hadL2 }, 'Config cache invalidated');
  }

  /**
   * Clear all cached configurations.
   */
  async clear(): Promise<void> {
    // Clear L1
    this.l1Cache.clear();

    // Clear L2 (all keys with our prefix)
    if (this.redis) {
      try {
        const pattern = `${this.keyPrefix}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to clear L2 cache');
      }
    }

    this.logger.info('Config cache cleared');
  }

  /**
   * Get cache statistics (for monitoring/debugging).
   */
  getStats(): { l1Size: number; ttlMs: number } {
    return {
      l1Size: this.l1Cache.size,
      ttlMs: this.ttlMs,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private setL1(serverId: string, config: CurrentConfiguration): void {
    this.l1Cache.set(serverId, {
      config,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  private serializeConfig(config: CurrentConfiguration): string {
    return JSON.stringify({
      ...config,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    });
  }

  private deserializeConfig(data: string): CurrentConfiguration {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ConfigCache instance.
 */
export function createConfigCache(
  redis?: Redis,
  options?: Partial<ConfigCacheConfig>
): ConfigCache {
  return new ConfigCache({ redis, ...options });
}
