/**
 * Config Service Module
 *
 * Sprint 118: ConfigService Core
 * Sprint 119: Pub/Sub Publisher
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Exports configuration management services for the Dashboard.
 */

export {
  ConfigService,
  ConfigNotFoundError,
  OptimisticLockError,
  type ConfigServiceConfig,
  type IConfigService,
} from './ConfigService.js';

// Sprint 119: Pub/Sub Publisher
export {
  ConfigPublisher,
  createConfigPublisher,
  type ConfigPublisherConfig,
  type IConfigPublisher,
  type InvalidationMessage,
} from './ConfigPublisher.js';

export {
  recordConfigInvalidation,
  recordConfigPublishError,
  getConfigMetricsPrometheus,
  getConfigMetricsRaw,
  resetConfigMetrics,
} from './configMetrics.js';

// Sprint 120: Pub/Sub Subscriber + Cache
export {
  ConfigCache,
  createConfigCache,
  type ConfigCacheConfig,
  type IConfigCache,
} from './ConfigCache.js';

export {
  ConfigSubscriber,
  createConfigSubscriber,
  type ConfigSubscriberConfig,
  type IConfigSubscriber,
} from './ConfigSubscriber.js';

export {
  recordCacheHit,
  recordCacheMiss,
  recordCacheInvalidation,
  recordPropagationLatency,
  getCacheMetricsPrometheus,
  getCacheMetricsRaw,
  resetCacheMetrics,
} from './cacheMetrics.js';
