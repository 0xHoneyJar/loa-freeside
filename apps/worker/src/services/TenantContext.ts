/**
 * Tenant Context Service
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Manages per-tenant context and configuration.
 * Propagates community_id through request lifecycle.
 */

import type { Logger } from 'pino';
import type { StateManager } from './StateManager.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Tenant tier determines rate limits and feature access
 */
export type TenantTier = 'free' | 'pro' | 'enterprise';

/**
 * Tenant configuration loaded from database/cache
 */
export interface TenantConfig {
  communityId: string;
  guildId: string;
  tier: TenantTier;
  features: {
    customBranding: boolean;
    advancedAnalytics: boolean;
    prioritySupport: boolean;
    unlimitedCommands: boolean;
  };
  rateLimits: {
    commandsPerMinute: number;
    eligibilityChecksPerHour: number;
    syncRequestsPerDay: number;
  };
  createdAt: number;
  updatedAt: number;
}

/**
 * Tenant context for a single request
 */
export interface TenantRequestContext {
  communityId: string;
  guildId: string;
  userId?: string;
  tier: TenantTier;
  config: TenantConfig;
  requestId: string;
  startTime: number;
}

/**
 * Default tier configurations
 */
export const TIER_DEFAULTS: Record<TenantTier, Omit<TenantConfig, 'communityId' | 'guildId' | 'createdAt' | 'updatedAt'>> = {
  free: {
    tier: 'free',
    features: {
      customBranding: false,
      advancedAnalytics: false,
      prioritySupport: false,
      unlimitedCommands: false,
    },
    rateLimits: {
      commandsPerMinute: 10,
      eligibilityChecksPerHour: 100,
      syncRequestsPerDay: 1,
    },
  },
  pro: {
    tier: 'pro',
    features: {
      customBranding: true,
      advancedAnalytics: true,
      prioritySupport: false,
      unlimitedCommands: false,
    },
    rateLimits: {
      commandsPerMinute: 100,
      eligibilityChecksPerHour: 1000,
      syncRequestsPerDay: 10,
    },
  },
  enterprise: {
    tier: 'enterprise',
    features: {
      customBranding: true,
      advancedAnalytics: true,
      prioritySupport: true,
      unlimitedCommands: true,
    },
    rateLimits: {
      commandsPerMinute: -1, // Unlimited
      eligibilityChecksPerHour: -1,
      syncRequestsPerDay: -1,
    },
  },
};

// --------------------------------------------------------------------------
// Tenant Context Manager
// --------------------------------------------------------------------------

export class TenantContextManager {
  private readonly log: Logger;
  private readonly stateManager: StateManager;
  private readonly configCache: Map<string, { config: TenantConfig; expiresAt: number }> = new Map();
  private readonly cacheTtlMs: number;

  constructor(stateManager: StateManager, logger: Logger, cacheTtlMs = 30_000) {
    this.stateManager = stateManager;
    this.log = logger.child({ component: 'TenantContextManager' });
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Create tenant context for a request
   */
  async createContext(
    guildId: string,
    userId?: string,
    requestId?: string
  ): Promise<TenantRequestContext> {
    const config = await this.getConfig(guildId);

    return {
      communityId: config.communityId,
      guildId,
      userId,
      tier: config.tier,
      config,
      requestId: requestId ?? this.generateRequestId(),
      startTime: Date.now(),
    };
  }

  /**
   * Get tenant configuration (with caching)
   */
  async getConfig(guildId: string): Promise<TenantConfig> {
    // Check in-memory cache first
    const cached = this.configCache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config;
    }

    // Check Redis cache
    const redisKey = `tenant:config:${guildId}`;
    const redisConfig = await this.stateManager.get(redisKey);

    if (redisConfig) {
      const config = JSON.parse(redisConfig) as TenantConfig;
      this.cacheConfig(guildId, config);
      return config;
    }

    // Load from database (would query PostgreSQL in real implementation)
    // For now, return default free tier config
    const config = this.createDefaultConfig(guildId);

    // Cache it
    await this.stateManager.set(redisKey, JSON.stringify(config), this.cacheTtlMs);
    this.cacheConfig(guildId, config);

    return config;
  }

  /**
   * Update tenant configuration
   */
  async updateConfig(guildId: string, updates: Partial<TenantConfig>): Promise<TenantConfig> {
    const current = await this.getConfig(guildId);
    const updated: TenantConfig = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };

    // Persist to Redis
    const redisKey = `tenant:config:${guildId}`;
    await this.stateManager.set(redisKey, JSON.stringify(updated), this.cacheTtlMs * 2);

    // Update caches
    this.cacheConfig(guildId, updated);

    this.log.info({ guildId, tier: updated.tier }, 'Tenant config updated');

    return updated;
  }

  /**
   * Upgrade tenant tier
   */
  async upgradeTier(guildId: string, newTier: TenantTier): Promise<TenantConfig> {
    const tierDefaults = TIER_DEFAULTS[newTier];

    return this.updateConfig(guildId, {
      tier: newTier,
      features: tierDefaults.features,
      rateLimits: tierDefaults.rateLimits,
    });
  }

  /**
   * Invalidate cached config (for hot reload)
   */
  invalidateCache(guildId: string): void {
    this.configCache.delete(guildId);
    this.log.debug({ guildId }, 'Tenant config cache invalidated');
  }

  /**
   * Invalidate all cached configs
   */
  invalidateAllCaches(): void {
    this.configCache.clear();
    this.log.info('All tenant config caches invalidated');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.configCache.size,
      entries: Array.from(this.configCache.keys()),
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private createDefaultConfig(guildId: string): TenantConfig {
    const defaults = TIER_DEFAULTS.free;
    const now = Date.now();

    return {
      communityId: guildId, // Use guildId as communityId for new tenants
      guildId,
      tier: defaults.tier,
      features: { ...defaults.features },
      rateLimits: { ...defaults.rateLimits },
      createdAt: now,
      updatedAt: now,
    };
  }

  private cacheConfig(guildId: string, config: TenantConfig): void {
    this.configCache.set(guildId, {
      config,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  private generateRequestId(): string {
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createTenantContextManager(
  stateManager: StateManager,
  logger: Logger
): TenantContextManager {
  return new TenantContextManager(stateManager, logger);
}
