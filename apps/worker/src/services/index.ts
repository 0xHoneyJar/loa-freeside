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
