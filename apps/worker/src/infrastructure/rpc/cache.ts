/**
 * RPC Cache for Graceful Degradation
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Simple TTL-based cache for storing RPC results
 * Used as fallback when all providers fail
 */

import type { Logger } from 'pino';
import type { CacheEntry } from './types.js';

/**
 * In-memory cache with TTL support for RPC results
 */
export class RPCCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private readonly log: Logger;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(logger: Logger, cleanupIntervalMs = 60000) {
    this.log = logger.child({ component: 'RPCCache' });

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Set a value in the cache with TTL
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttlMs,
    };

    this.cache.set(key, entry as CacheEntry<unknown>);

    this.log.debug({ key, ttlMs }, 'Cached RPC result');
  }

  /**
   * Get a value from the cache (returns undefined if expired or not found)
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    const age = Date.now() - entry.timestamp;

    if (age > entry.ttlMs) {
      // Entry has expired
      this.cache.delete(key);
      this.log.debug({ key, ageMs: age }, 'Cache entry expired');
      return undefined;
    }

    this.log.debug({ key, ageMs: age }, 'Cache hit');
    return entry.value as T;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const value = this.get(key);
    return value !== undefined;
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.log.info({ entriesCleared: size }, 'Cache cleared');
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    return this.cache.size;
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
      this.log.debug({ entriesRemoved: removed }, 'Cache cleanup completed');
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    oldestEntryAgeMs: number | null;
    newestEntryAgeMs: number | null;
  } {
    if (this.cache.size === 0) {
      return { size: 0, oldestEntryAgeMs: null, newestEntryAgeMs: null };
    }

    const now = Date.now();
    let oldest = now;
    let newest = 0;

    this.cache.forEach((entry) => {
      if (entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
      if (entry.timestamp > newest) {
        newest = entry.timestamp;
      }
    });

    return {
      size: this.cache.size,
      oldestEntryAgeMs: now - oldest,
      newestEntryAgeMs: now - newest,
    };
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
