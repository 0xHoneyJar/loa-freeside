/**
 * Multi-Layer Cache
 * Sprint S-12: Multi-Layer Caching
 *
 * Combines L1 (in-memory) and L2 (Redis) caches with automatic
 * warming and invalidation propagation.
 *
 * Read path: L1 -> L2 -> Source
 * Write path: Source -> L2 -> L1
 * Invalidation: L2 (pub/sub) -> All L1 instances
 *
 * Features:
 * - Automatic L1 warming on L2 hit
 * - Cross-instance invalidation via Redis pub/sub
 * - Combined statistics across layers
 * - Configurable TTLs per layer
 */

import type { Logger } from 'pino';
import type { StateManager } from '../../services/StateManager.js';
import type {
  CacheResult,
  CacheStats,
  MultiLayerCacheConfig,
  CacheInvalidationEvent,
} from './types.js';
import { CacheLayer, DEFAULT_MULTILAYER_CONFIG } from './types.js';
import { L1Cache } from './L1Cache.js';
import { L2Cache } from './L2Cache.js';

/**
 * Combined statistics from both cache layers
 */
export interface MultiLayerCacheStats {
  l1: CacheStats;
  l2: CacheStats;
  combined: {
    totalHits: number;
    totalMisses: number;
    l1HitRate: number;
    l2HitRate: number;
    overallHitRate: number;
  };
}

/**
 * Multi-Layer Cache combining L1 (memory) and L2 (Redis)
 */
export class MultiLayerCache {
  private readonly log: Logger;
  private readonly config: MultiLayerCacheConfig;
  private readonly l1: L1Cache;
  private readonly l2: L2Cache;

  constructor(
    stateManager: StateManager,
    logger: Logger,
    config: Partial<MultiLayerCacheConfig> = {}
  ) {
    this.log = logger.child({ component: 'MultiLayerCache' });
    this.config = { ...DEFAULT_MULTILAYER_CONFIG, ...config };

    // Initialize L1 (in-memory) cache
    this.l1 = new L1Cache(logger, this.config.l1);

    // Initialize L2 (Redis) cache with namespace prefix
    this.l2 = new L2Cache(stateManager, logger, this.config.namespace, this.config.l2);

    // Set up L1 invalidation on L2 pub/sub events
    this.l2.onInvalidation((event) => {
      this.handleInvalidationEvent(event);
    });

    this.log.info(
      {
        namespace: this.config.namespace,
        l1TtlMs: this.config.l1.defaultTtlMs,
        l2TtlMs: this.config.l2.defaultTtlMs,
        warmL1OnL2Hit: this.config.warmL1OnL2Hit,
      },
      'Multi-layer cache initialized'
    );
  }

  /**
   * Start the invalidation listener for cross-instance invalidation
   */
  startInvalidationListener(): void {
    this.l2.startInvalidationListener();
  }

  /**
   * Get a value from the cache (L1 -> L2 -> miss)
   */
  async get<T>(key: string): Promise<CacheResult<T>> {
    const start = Date.now();

    // Try L1 first (sub-millisecond)
    const l1Value = this.l1.get<T>(key);
    if (l1Value !== undefined) {
      return {
        value: l1Value,
        layer: CacheLayer.L1_MEMORY,
        latencyMs: Date.now() - start,
      };
    }

    // Try L2 (Redis, ~1-5ms)
    const l2Value = await this.l2.get<T>(key);
    if (l2Value !== null) {
      // Warm L1 on L2 hit if enabled
      if (this.config.warmL1OnL2Hit) {
        this.l1.set(key, l2Value, this.config.l1.defaultTtlMs);
        this.log.debug({ key }, 'L1 warmed from L2 hit');
      }

      return {
        value: l2Value,
        layer: CacheLayer.L2_REDIS,
        latencyMs: Date.now() - start,
      };
    }

    // Cache miss
    return {
      value: null,
      layer: CacheLayer.MISS,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Get a value or compute it if not cached
   */
  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    options?: {
      l1TtlMs?: number;
      l2TtlMs?: number;
    }
  ): Promise<CacheResult<T>> {
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached.value !== null) {
      return cached;
    }

    // Cache miss - compute value
    const start = Date.now();
    const value = await compute();

    // Store in both layers
    await this.set(key, value, options);

    return {
      value,
      layer: CacheLayer.MISS,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Set a value in both cache layers
   */
  async set<T>(
    key: string,
    value: T,
    options?: {
      l1TtlMs?: number;
      l2TtlMs?: number;
    }
  ): Promise<void> {
    const l1Ttl = options?.l1TtlMs ?? this.config.l1.defaultTtlMs;
    const l2Ttl = options?.l2TtlMs ?? this.config.l2.defaultTtlMs;

    // Set in L1 (synchronous)
    this.l1.set(key, value, l1Ttl);

    // Set in L2 (async, don't wait)
    this.l2.set(key, value, l2Ttl).catch((error) => {
      this.log.warn({ error, key }, 'Failed to set L2 cache');
    });

    this.log.debug({ key, l1Ttl, l2Ttl }, 'Multi-layer cache set');
  }

  /**
   * Delete a value from both cache layers
   */
  async delete(key: string): Promise<void> {
    // Delete from L1
    this.l1.delete(key);

    // Delete from L2
    await this.l2.delete(key);

    this.log.debug({ key }, 'Multi-layer cache delete');
  }

  /**
   * Check if a key exists in either cache layer
   */
  async has(key: string): Promise<{ exists: boolean; layer: CacheLayer }> {
    // Check L1 first
    if (this.l1.has(key)) {
      return { exists: true, layer: CacheLayer.L1_MEMORY };
    }

    // Check L2
    if (await this.l2.has(key)) {
      return { exists: true, layer: CacheLayer.L2_REDIS };
    }

    return { exists: false, layer: CacheLayer.MISS };
  }

  /**
   * Invalidate entries by pattern across all layers
   */
  async invalidateByPattern(pattern: string, reason?: string): Promise<void> {
    // Invalidate L1 locally
    const l1Count = this.l1.invalidateByPattern(pattern);

    // Broadcast invalidation to all instances via L2
    await this.l2.invalidateByPattern(pattern, reason);

    this.log.info({ pattern, l1Count, reason }, 'Multi-layer cache invalidation');
  }

  /**
   * Handle invalidation event from L2 pub/sub
   */
  private handleInvalidationEvent(event: CacheInvalidationEvent): void {
    // Invalidate matching L1 entries
    const count = this.l1.invalidateByPattern(event.pattern);
    this.log.debug(
      { pattern: event.pattern, source: event.source, count },
      'L1 invalidated from pub/sub event'
    );
  }

  /**
   * Clear all entries from both cache layers
   */
  async clear(): Promise<void> {
    // Clear L1
    this.l1.clear();

    // Note: L2 clear would require SCAN, which is expensive
    // Instead, rely on TTL expiration or targeted invalidation
    this.log.info('Multi-layer cache cleared (L1 only, L2 via TTL)');
  }

  /**
   * Get combined statistics from both layers
   */
  getStats(): MultiLayerCacheStats {
    const l1Stats = this.l1.getStats();
    const l2Stats = this.l2.getStats();

    const totalHits = l1Stats.hits + l2Stats.hits;
    const totalMisses = l2Stats.misses; // L2 misses are true misses
    const totalRequests = l1Stats.hits + l1Stats.misses;

    return {
      l1: l1Stats,
      l2: l2Stats,
      combined: {
        totalHits,
        totalMisses,
        l1HitRate: l1Stats.hitRate,
        l2HitRate: l2Stats.hitRate,
        overallHitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      },
    };
  }

  /**
   * Reset statistics on both layers
   */
  resetStats(): void {
    this.l1.resetStats();
    this.l2.resetStats();
  }

  /**
   * Get L1 cache size
   */
  get l1Size(): number {
    return this.l1.size;
  }

  /**
   * Stop listeners and release resources
   */
  destroy(): void {
    this.l1.destroy();
    this.l2.destroy();
    this.log.info('Multi-layer cache destroyed');
  }
}
