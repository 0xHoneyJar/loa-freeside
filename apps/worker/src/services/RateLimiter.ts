/**
 * Rate Limiter Service
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Implements tier-based rate limiting per tenant.
 * Uses sliding window algorithm with Redis storage.
 */

import type { Logger } from 'pino';
import type { StateManager } from './StateManager.js';
import type { TenantTier, TenantConfig } from './TenantContext.js';
import { Counter, Gauge } from 'prom-client';

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

const rateLimitHits = new Counter({
  name: 'arrakis_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['community_id', 'tier', 'action'],
});

const rateLimitAllowed = new Counter({
  name: 'arrakis_rate_limit_allowed_total',
  help: 'Total number of allowed requests',
  labelNames: ['community_id', 'tier', 'action'],
});

const currentWindowUsage = new Gauge({
  name: 'arrakis_rate_limit_window_usage',
  help: 'Current usage in rate limit window',
  labelNames: ['community_id', 'action'],
});

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type RateLimitAction = 'command' | 'eligibility_check' | 'sync_request';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterMs?: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * Default rate limit windows per action
 */
const ACTION_WINDOWS: Record<RateLimitAction, number> = {
  command: 60_000, // 1 minute
  eligibility_check: 3_600_000, // 1 hour
  sync_request: 86_400_000, // 24 hours
};

// --------------------------------------------------------------------------
// Rate Limiter
// --------------------------------------------------------------------------

export class RateLimiter {
  private readonly log: Logger;
  private readonly stateManager: StateManager;

  constructor(stateManager: StateManager, logger: Logger) {
    this.stateManager = stateManager;
    this.log = logger.child({ component: 'RateLimiter' });
  }

  /**
   * Check if action is allowed for tenant
   * Uses sliding window counter algorithm
   */
  async checkLimit(
    communityId: string,
    action: RateLimitAction,
    tenantConfig: TenantConfig
  ): Promise<RateLimitResult> {
    const limit = this.getLimitForAction(action, tenantConfig);

    // Unlimited for enterprise tier
    if (limit === -1) {
      rateLimitAllowed.inc({ community_id: communityId, tier: tenantConfig.tier, action });
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: 0,
      };
    }

    const windowMs = ACTION_WINDOWS[action];
    const windowKey = this.getWindowKey(communityId, action);
    const now = Date.now();

    // Get current count in window
    const currentCount = await this.getCurrentCount(windowKey, now, windowMs);

    if (currentCount >= limit) {
      // Rate limited
      const resetAt = await this.getWindowResetTime(windowKey, windowMs);
      const retryAfterMs = resetAt - now;

      rateLimitHits.inc({ community_id: communityId, tier: tenantConfig.tier, action });

      this.log.warn(
        {
          communityId,
          action,
          currentCount,
          limit,
          retryAfterMs,
        },
        'Rate limit exceeded'
      );

      return {
        allowed: false,
        remaining: 0,
        limit,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Increment counter
    await this.incrementCounter(windowKey, now, windowMs);

    const remaining = limit - currentCount - 1;
    const resetAt = now + windowMs;

    rateLimitAllowed.inc({ community_id: communityId, tier: tenantConfig.tier, action });
    currentWindowUsage.set({ community_id: communityId, action }, currentCount + 1);

    return {
      allowed: true,
      remaining,
      limit,
      resetAt,
    };
  }

  /**
   * Consume rate limit (after action succeeds)
   * Call this after checkLimit returns allowed=true
   */
  async consume(
    communityId: string,
    action: RateLimitAction,
    _tenantConfig: TenantConfig
  ): Promise<void> {
    // Already incremented in checkLimit, this is a no-op
    // Kept for API symmetry with acquire/release patterns
    this.log.debug({ communityId, action }, 'Rate limit consumed');
  }

  /**
   * Get current usage for tenant
   */
  async getUsage(
    communityId: string,
    action: RateLimitAction,
    tenantConfig: TenantConfig
  ): Promise<{ current: number; limit: number; windowMs: number }> {
    const limit = this.getLimitForAction(action, tenantConfig);
    const windowMs = ACTION_WINDOWS[action];
    const windowKey = this.getWindowKey(communityId, action);
    const now = Date.now();

    const current = await this.getCurrentCount(windowKey, now, windowMs);

    return { current, limit, windowMs };
  }

  /**
   * Reset rate limit for tenant (admin action)
   */
  async reset(communityId: string, action: RateLimitAction): Promise<void> {
    const windowKey = this.getWindowKey(communityId, action);
    await this.stateManager.delete(windowKey);

    this.log.info({ communityId, action }, 'Rate limit reset');
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private getLimitForAction(action: RateLimitAction, config: TenantConfig): number {
    switch (action) {
      case 'command':
        return config.rateLimits.commandsPerMinute;
      case 'eligibility_check':
        return config.rateLimits.eligibilityChecksPerHour;
      case 'sync_request':
        return config.rateLimits.syncRequestsPerDay;
      default:
        return 10; // Safe default
    }
  }

  private getWindowKey(communityId: string, action: RateLimitAction): string {
    return `ratelimit:${communityId}:${action}`;
  }

  private async getCurrentCount(
    windowKey: string,
    now: number,
    windowMs: number
  ): Promise<number> {
    // Use sorted set with timestamps for sliding window
    const minTimestamp = now - windowMs;

    // Clean expired entries and count remaining
    await this.stateManager.zremrangebyscore(windowKey, 0, minTimestamp);
    const count = await this.stateManager.zcard(windowKey);

    return count;
  }

  private async incrementCounter(
    windowKey: string,
    now: number,
    windowMs: number
  ): Promise<void> {
    // Add entry with current timestamp as score
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    await this.stateManager.zadd(windowKey, now, member);

    // Set expiry on the key (cleanup)
    await this.stateManager.expire(windowKey, Math.ceil(windowMs / 1000) + 60);
  }

  private async getWindowResetTime(windowKey: string, windowMs: number): Promise<number> {
    // Get oldest entry timestamp
    const oldest = await this.stateManager.zrangebyscore(windowKey, 0, Infinity, 0, 1);

    if (oldest.length > 0) {
      const oldestTime = parseInt(oldest[0].split(':')[0], 10);
      return oldestTime + windowMs;
    }

    return Date.now() + windowMs;
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createRateLimiter(stateManager: StateManager, logger: Logger): RateLimiter {
  return new RateLimiter(stateManager, logger);
}
