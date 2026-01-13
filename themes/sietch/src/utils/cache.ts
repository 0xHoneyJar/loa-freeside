/**
 * Simple in-memory cache with TTL support
 *
 * Used for caching frequently accessed data like:
 * - Badge definitions (rarely change)
 * - Member counts (refreshed periodically)
 * - Public profiles (short TTL for responsiveness)
 */

import { logger } from './logger.js';

/**
 * Cache entry with value and expiration
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Default TTL in milliseconds */
  defaultTtl: number;
  /** Maximum number of entries */
  maxSize: number;
  /** Name for logging purposes */
  name: string;
}

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG: CacheConfig = {
  defaultTtl: 60_000, // 1 minute
  maxSize: 1000,
  name: 'default',
};

/**
 * Simple LRU-style cache with TTL
 */
export class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private hits = 0;
  private misses = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache with optional TTL
   */
  set(key: string, value: T, ttl?: number): void {
    // Evict if at max size
    if (this.cache.size >= this.config.maxSize) {
      this.evictExpired();
      // If still at max, delete oldest entry
      if (this.cache.size >= this.config.maxSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.config.defaultTtl),
    });
  }

  /**
   * Get or set a value using a factory function
   */
  async getOrSet(key: string, factory: () => T | Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   */
  deletePattern(pattern: RegExp): number {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.debug({ cache: this.config.name, evicted }, 'Evicted expired cache entries');
    }
  }
}

// =============================================================================
// Pre-configured cache instances
// =============================================================================

/**
 * Cache for badge definitions (long TTL - rarely change)
 */
export const badgeCache = new SimpleCache<unknown>({
  name: 'badges',
  defaultTtl: 300_000, // 5 minutes
  maxSize: 100,
});

/**
 * Cache for member counts and stats (medium TTL)
 */
export const statsCache = new SimpleCache<unknown>({
  name: 'stats',
  defaultTtl: 60_000, // 1 minute
  maxSize: 50,
});

/**
 * Cache for public profiles (short TTL)
 */
export const profileCache = new SimpleCache<unknown>({
  name: 'profiles',
  defaultTtl: 30_000, // 30 seconds
  maxSize: 500,
});

/**
 * Cache for directory queries (very short TTL)
 */
export const directoryCache = new SimpleCache<unknown>({
  name: 'directory',
  defaultTtl: 15_000, // 15 seconds
  maxSize: 100,
});

/**
 * Invalidate all profile-related caches for a member
 */
export function invalidateMemberCaches(memberId: string): void {
  profileCache.delete(`profile:${memberId}`);
  directoryCache.clear(); // Clear directory since it may contain this member
  statsCache.deletePattern(/^member-/);
}

/**
 * Invalidate all caches (for use after major updates)
 */
export function invalidateAllCaches(): void {
  badgeCache.clear();
  statsCache.clear();
  profileCache.clear();
  directoryCache.clear();
  logger.info('All caches invalidated');
}
