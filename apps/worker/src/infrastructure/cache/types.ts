/**
 * Multi-Layer Cache Types
 * Sprint S-12: Multi-Layer Caching
 *
 * Type definitions for the L1 (in-memory) and L2 (Redis) cache layers.
 */

/**
 * Cache entry with TTL metadata
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
}

/**
 * Cache hit/miss statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  invalidations: number;
  size: number;
  hitRate: number;
}

/**
 * Cache layer identifiers
 */
export enum CacheLayer {
  L1_MEMORY = 'L1_MEMORY',
  L2_REDIS = 'L2_REDIS',
  MISS = 'MISS',
}

/**
 * Cache operation result with layer info
 */
export interface CacheResult<T> {
  value: T | null;
  layer: CacheLayer;
  latencyMs: number;
}

/**
 * Cache key components for consistent key generation
 */
export interface CacheKeyComponents {
  namespace: string;
  entityType: string;
  identifier: string;
  version?: string;
}

/**
 * Configuration for L1 cache
 */
export interface L1CacheConfig {
  /** Default TTL in milliseconds (default: 60000 - 1 minute) */
  defaultTtlMs: number;
  /** Maximum entries before eviction (default: 10000) */
  maxEntries: number;
  /** Cleanup interval in milliseconds (default: 30000) */
  cleanupIntervalMs: number;
  /** Enable statistics tracking (default: true) */
  enableStats: boolean;
}

/**
 * Configuration for L2 cache
 */
export interface L2CacheConfig {
  /** Default TTL in milliseconds (default: 300000 - 5 minutes) */
  defaultTtlMs: number;
  /** Enable statistics tracking (default: true) */
  enableStats: boolean;
}

/**
 * Multi-layer cache configuration
 */
export interface MultiLayerCacheConfig {
  l1: L1CacheConfig;
  l2: L2CacheConfig;
  /** Enable L1 warming from L2 on miss (default: true) */
  warmL1OnL2Hit: boolean;
  /** Namespace prefix for all keys (default: 'cache') */
  namespace: string;
}

/**
 * Cache invalidation event
 */
export interface CacheInvalidationEvent {
  pattern: string;
  timestamp: number;
  source: 'local' | 'pubsub';
  reason?: string;
}

/**
 * Default cache configurations
 */
export const DEFAULT_L1_CONFIG: L1CacheConfig = {
  defaultTtlMs: 60_000, // 1 minute
  maxEntries: 10_000,
  cleanupIntervalMs: 30_000, // 30 seconds
  enableStats: true,
};

export const DEFAULT_L2_CONFIG: L2CacheConfig = {
  defaultTtlMs: 300_000, // 5 minutes
  enableStats: true,
};

export const DEFAULT_MULTILAYER_CONFIG: MultiLayerCacheConfig = {
  l1: DEFAULT_L1_CONFIG,
  l2: DEFAULT_L2_CONFIG,
  warmL1OnL2Hit: true,
  namespace: 'cache',
};
