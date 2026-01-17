/**
 * Multi-Layer Cache Module
 * Sprint S-12: Multi-Layer Caching
 *
 * Exports the complete caching infrastructure including:
 * - L1 in-memory cache with LRU eviction
 * - L2 Redis cache with pub/sub invalidation
 * - Multi-layer cache combining both layers
 * - Cache key builders and patterns
 * - Type definitions
 */

// Types
export type {
  CacheEntry,
  CacheStats,
  CacheResult,
  CacheKeyComponents,
  L1CacheConfig,
  L2CacheConfig,
  MultiLayerCacheConfig,
  CacheInvalidationEvent,
} from './types.js';

export {
  CacheLayer,
  DEFAULT_L1_CONFIG,
  DEFAULT_L2_CONFIG,
  DEFAULT_MULTILAYER_CONFIG,
} from './types.js';

// Cache implementations
export { L1Cache } from './L1Cache.js';
export { L2Cache } from './L2Cache.js';
export { MultiLayerCache, type MultiLayerCacheStats } from './MultiLayerCache.js';

// Key builders
export {
  CacheNamespace,
  CacheEntityType,
  buildCacheKey,
  parseCacheKey,
  CacheKeys,
  InvalidationPatterns,
} from './CacheKeyBuilder.js';

// Metrics
export {
  CacheMetrics,
  type MetricLabels,
  type HistogramBucket,
  type LatencyHistogram,
  type CacheMetricsSnapshot,
} from './CacheMetrics.js';

// Invalidation
export {
  CacheInvalidator,
  InvalidationStrategy,
  type InvalidationRecord,
} from './CacheInvalidator.js';
