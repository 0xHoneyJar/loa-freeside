/**
 * L1 In-Memory Cache
 * Sprint S-12: Multi-Layer Caching
 *
 * Per-process in-memory cache with LRU eviction and TTL support.
 * Provides sub-millisecond access for hot data with 60s default TTL.
 *
 * Features:
 * - LRU eviction when max entries exceeded
 * - TTL-based expiration
 * - Automatic cleanup of expired entries
 * - Hit/miss statistics
 * - Thread-safe within single process
 */

import type { Logger } from 'pino';
import type {
  CacheEntry,
  CacheStats,
  L1CacheConfig,
} from './types.js';
import { DEFAULT_L1_CONFIG } from './types.js';

/**
 * L1 In-Memory Cache with LRU eviction
 */
export class L1Cache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly log: Logger;
  private readonly config: L1CacheConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Statistics
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;
  private invalidations = 0;

  constructor(logger: Logger, config: Partial<L1CacheConfig> = {}) {
    this.log = logger.child({ component: 'L1Cache' });
    this.config = { ...DEFAULT_L1_CONFIG, ...config };

    // Start periodic cleanup
    this.startCleanup();

    this.log.info(
      {
        maxEntries: this.config.maxEntries,
        defaultTtlMs: this.config.defaultTtlMs,
        cleanupIntervalMs: this.config.cleanupIntervalMs,
      },
      'L1 cache initialized'
    );
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.config.enableStats) {
        this.misses++;
      }
      return undefined;
    }

    const age = Date.now() - entry.timestamp;

    if (age > entry.ttlMs) {
      // Entry has expired
      this.cache.delete(key);
      if (this.config.enableStats) {
        this.misses++;
      }
      this.log.debug({ key, ageMs: age }, 'L1 cache entry expired');
      return undefined;
    }

    // Move to end of Map for LRU tracking (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    if (this.config.enableStats) {
      this.hits++;
    }
    this.log.debug({ key, ageMs: age }, 'L1 cache hit');
    return entry.value as T;
  }

  /**
   * Set a value in the cache with TTL
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.config.defaultTtlMs,
    };

    // Check if we need to evict
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry as CacheEntry<unknown>);

    if (this.config.enableStats) {
      this.sets++;
    }
    this.log.debug({ key, ttlMs: entry.ttlMs }, 'L1 cache set');
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted && this.config.enableStats) {
      this.deletes++;
    }
    return deleted;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttlMs) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Invalidate entries by pattern (prefix match)
   */
  invalidateByPattern(pattern: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((_, key) => {
      if (key.startsWith(pattern)) {
        keysToDelete.push(key);
      }
    });

    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    if (this.config.enableStats) {
      this.invalidations += count;
    }

    this.log.debug({ pattern, count }, 'L1 cache invalidated by pattern');
    return count;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.log.info({ entriesCleared: size }, 'L1 cache cleared');
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
      invalidations: this.invalidations,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
    this.invalidations = 0;
  }

  /**
   * Evict the least recently used entry (first item in Map)
   */
  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this.log.debug({ key: firstKey }, 'L1 cache LRU eviction');
    }
  }

  /**
   * Remove expired entries from the cache
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    this.cache.forEach((entry, key) => {
      const age = now - entry.timestamp;
      if (age > entry.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    });

    if (removed > 0) {
      this.log.debug({ entriesRemoved: removed }, 'L1 cache cleanup completed');
    }
  }

  /**
   * Start the cleanup interval
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval and release resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.log.info('L1 cache destroyed');
  }
}
