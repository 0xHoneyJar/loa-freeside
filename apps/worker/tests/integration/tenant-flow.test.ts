/**
 * Tenant Flow Integration Tests
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Tests tenant context, rate limiting, and config hot-reload.
 * Requires Redis server running.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import pino from 'pino';
import { StateManager } from '../../src/services/StateManager.js';
import { TenantContextManager, TIER_DEFAULTS } from '../../src/services/TenantContext.js';
import { RateLimiter } from '../../src/services/RateLimiter.js';
import { ConfigReloader } from '../../src/services/ConfigReloader.js';

// Skip if no Redis available
const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';
const SKIP_INTEGRATION = process.env['SKIP_INTEGRATION'] === 'true';

const logger = pino({ level: 'silent' });

describe.skipIf(SKIP_INTEGRATION)('Tenant Integration', () => {
  let redis: Redis;
  let stateManager: StateManager;
  let tenantManager: TenantContextManager;
  let rateLimiter: RateLimiter;

  beforeAll(async () => {
    try {
      redis = new Redis(REDIS_URL);
      await redis.ping();

      stateManager = new StateManager(REDIS_URL, logger);
      await stateManager.connect();

      tenantManager = new TenantContextManager(stateManager, logger);
      rateLimiter = new RateLimiter(stateManager, logger);
    } catch (error) {
      console.warn('Redis not available, skipping integration tests');
      throw error;
    }
  });

  afterAll(async () => {
    if (stateManager) {
      await stateManager.close();
    }
    if (redis) {
      await redis.quit();
    }
  });

  beforeEach(async () => {
    // Clean up test keys
    const keys = await redis.keys('tenant:*');
    const rlKeys = await redis.keys('ratelimit:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    if (rlKeys.length > 0) {
      await redis.del(...rlKeys);
    }
    tenantManager.invalidateAllCaches();
  });

  describe('TenantContextManager', () => {
    it('should create context for new tenant with free tier defaults', async () => {
      const ctx = await tenantManager.createContext('guild_123', 'user_456');

      expect(ctx.guildId).toBe('guild_123');
      expect(ctx.userId).toBe('user_456');
      expect(ctx.tier).toBe('free');
      expect(ctx.config.rateLimits.commandsPerMinute).toBe(10);
    });

    it('should cache tenant config', async () => {
      // First call loads from Redis/creates default
      const ctx1 = await tenantManager.createContext('guild_cache_test');

      // Second call should use cache
      const ctx2 = await tenantManager.createContext('guild_cache_test');

      expect(ctx1.config.communityId).toBe(ctx2.config.communityId);
      expect(ctx1.config.createdAt).toBe(ctx2.config.createdAt);
    });

    it('should upgrade tenant tier', async () => {
      // Create with free tier
      await tenantManager.createContext('guild_upgrade_test');

      // Upgrade to pro
      const updatedConfig = await tenantManager.upgradeTier('guild_upgrade_test', 'pro');

      expect(updatedConfig.tier).toBe('pro');
      expect(updatedConfig.rateLimits.commandsPerMinute).toBe(100);
      expect(updatedConfig.features.advancedAnalytics).toBe(true);
    });

    it('should invalidate cache on request', async () => {
      // Load config
      const ctx1 = await tenantManager.createContext('guild_invalidate_test');
      const createdAt1 = ctx1.config.createdAt;

      // Invalidate
      tenantManager.invalidateCache('guild_invalidate_test');

      // Delete from Redis to simulate external update
      await redis.del('tenant:config:guild_invalidate_test');

      // Re-load should create new config
      const ctx2 = await tenantManager.createContext('guild_invalidate_test');

      // Should have different createdAt since it was re-created
      expect(ctx2.config.createdAt).toBeGreaterThanOrEqual(createdAt1);
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within limit', async () => {
      const config = await tenantManager.getConfig('guild_rate_test');

      // Free tier: 10 commands per minute
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkLimit('guild_rate_test', 'command', config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(10 - i - 1);
      }
    });

    it('should block requests over limit', async () => {
      const config = await tenantManager.getConfig('guild_rate_block_test');

      // Exhaust the limit (10 commands)
      for (let i = 0; i < 10; i++) {
        await rateLimiter.checkLimit('guild_rate_block_test', 'command', config);
      }

      // Next request should be blocked
      const result = await rateLimiter.checkLimit('guild_rate_block_test', 'command', config);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should allow unlimited for enterprise tier', async () => {
      await tenantManager.upgradeTier('guild_enterprise_test', 'enterprise');
      const config = await tenantManager.getConfig('guild_enterprise_test');

      // Should always be allowed
      for (let i = 0; i < 100; i++) {
        const result = await rateLimiter.checkLimit('guild_enterprise_test', 'command', config);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(-1); // Unlimited
      }
    });

    it('should reset rate limit', async () => {
      const config = await tenantManager.getConfig('guild_reset_test');

      // Use some quota
      for (let i = 0; i < 5; i++) {
        await rateLimiter.checkLimit('guild_reset_test', 'command', config);
      }

      // Reset
      await rateLimiter.reset('guild_reset_test', 'command');

      // Should have full quota again
      const result = await rateLimiter.checkLimit('guild_reset_test', 'command', config);
      expect(result.remaining).toBe(9); // 10 - 1
    });

    it('should track usage per action type', async () => {
      const config = await tenantManager.getConfig('guild_action_test');

      // Use command quota
      await rateLimiter.checkLimit('guild_action_test', 'command', config);

      // Eligibility check should have separate quota
      const result = await rateLimiter.checkLimit('guild_action_test', 'eligibility_check', config);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100); // Free tier eligibility limit
    });
  });

  describe('ConfigReloader', () => {
    it('should broadcast config reload events', async () => {
      const reloader = new ConfigReloader(stateManager, tenantManager, logger);

      // Start listening
      reloader.start();

      // Create a config first
      await tenantManager.createContext('guild_reload_test');

      // Trigger reload
      await reloader.triggerReload('guild_reload_test');

      // Give time for pub/sub
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cache should be invalidated
      const stats = tenantManager.getCacheStats();
      expect(stats.entries).not.toContain('guild_reload_test');

      reloader.stop();
    });

    it('should broadcast global reload events', async () => {
      const reloader = new ConfigReloader(stateManager, tenantManager, logger);

      // Load some configs
      await tenantManager.createContext('guild_global_1');
      await tenantManager.createContext('guild_global_2');

      expect(tenantManager.getCacheStats().size).toBe(2);

      // Start and trigger global reload
      reloader.start();
      await reloader.triggerGlobalReload();

      // Give time for pub/sub
      await new Promise((resolve) => setTimeout(resolve, 100));

      // All caches should be invalidated
      expect(tenantManager.getCacheStats().size).toBe(0);

      reloader.stop();
    });
  });
});

describe('Tier Configuration', () => {
  it('should have correct free tier defaults', () => {
    const free = TIER_DEFAULTS.free;

    expect(free.rateLimits.commandsPerMinute).toBe(10);
    expect(free.rateLimits.eligibilityChecksPerHour).toBe(100);
    expect(free.features.customBranding).toBe(false);
  });

  it('should have correct pro tier defaults', () => {
    const pro = TIER_DEFAULTS.pro;

    expect(pro.rateLimits.commandsPerMinute).toBe(100);
    expect(pro.rateLimits.eligibilityChecksPerHour).toBe(1000);
    expect(pro.features.advancedAnalytics).toBe(true);
  });

  it('should have correct enterprise tier defaults', () => {
    const enterprise = TIER_DEFAULTS.enterprise;

    expect(enterprise.rateLimits.commandsPerMinute).toBe(-1); // Unlimited
    expect(enterprise.features.unlimitedCommands).toBe(true);
  });
});
