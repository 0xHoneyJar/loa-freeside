/**
 * Service exports
 *
 * Sprint S-5: Added NatsClient
 * Sprint S-7: Added TenantContext, RateLimiter, TenantMetrics, ConfigReloader
 */
export { DiscordRestService } from './DiscordRest.js';
export { StateManager } from './StateManager.js';
export { NatsClient, createNatsClient, STREAM_CONFIGS, CONSUMER_CONFIGS } from './NatsClient.js';

// Sprint S-7: Multi-Tenancy
export {
  TenantContextManager,
  createTenantContextManager,
  TIER_DEFAULTS,
  type TenantTier,
  type TenantConfig,
  type TenantRequestContext,
} from './TenantContext.js';
export {
  RateLimiter,
  createRateLimiter,
  type RateLimitAction,
  type RateLimitResult,
} from './RateLimiter.js';
export {
  ConfigReloader,
  createConfigReloader,
  type ConfigReloadEvent,
} from './ConfigReloader.js';
export * from './TenantMetrics.js';

// Sprint S-9: Hot-Path Migration
export {
  HotPathService,
  type PositionData,
  type ThresholdData,
  type WaitlistPositionData,
  type MemberRankData,
  type HandlerLeaderboardEntry,
  type HotPathConfig,
} from './HotPathService.js';

// Sprint S-10: Write-Behind Cache
export {
  WriteBehindCache,
  createWriteBehindCache,
  type PendingSyncItem,
  type SyncBatchResult,
  type WriteBehindConfig,
  type PostgresSyncFn,
} from './WriteBehindCache.js';
export {
  PostgresScoreSync,
  createPostgresScoreSync,
  type PostgresScoreSyncConfig,
} from './PostgresScoreSync.js';

// Sprint SEC-3: Rate Limiting & DoS Protection
export {
  RateLimiterService,
  createRateLimiterService,
  getRateLimitMessage,
  type RateLimitCheckResult,
  type RateLimitConfig,
  type RateLimitType,
} from './RateLimiterService.js';
