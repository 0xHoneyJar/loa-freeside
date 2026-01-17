/**
 * Rate Limiter Service for DoS Protection
 * Sprint SEC-3: Rate Limiting & Credential Management
 *
 * Implements per-guild and per-user rate limiting to prevent abuse.
 * Uses rate-limiter-flexible with Redis backend for distributed limiting.
 *
 * M-4: Consumer lacks rate limiting
 */

import type { Logger } from 'pino';
import type Redis from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { Counter, Histogram, Gauge } from 'prom-client';
import { registry } from '../infrastructure/metrics.js';

// --------------------------------------------------------------------------
// Metrics (SEC-3.4)
// --------------------------------------------------------------------------

const rateLimitViolationsTotal = new Counter({
  name: 'worker_rate_limit_violations_total',
  help: 'Total number of rate limit violations',
  labelNames: ['type', 'guild_id'] as const,
  registers: [registry],
});

const rateLimitAllowedTotal = new Counter({
  name: 'worker_rate_limit_requests_allowed_total',
  help: 'Total number of allowed requests (not rate limited)',
  labelNames: ['type'] as const,
  registers: [registry],
});

const rateLimitCheckDuration = new Histogram({
  name: 'worker_rate_limit_check_duration_seconds',
  help: 'Duration of rate limit checks',
  labelNames: ['type'] as const,
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01],
  registers: [registry],
});

const rateLimitRemainingPoints = new Gauge({
  name: 'worker_rate_limit_remaining_points',
  help: 'Remaining rate limit points',
  labelNames: ['type', 'key'] as const,
  registers: [registry],
});

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type RateLimitType = 'guild' | 'user';

export interface RateLimitCheckResult {
  allowed: boolean;
  type: RateLimitType;
  key: string;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

export interface RateLimitConfig {
  guildLimit: number;       // Commands per second per guild (default: 100)
  guildDuration: number;    // Window duration in seconds (default: 1)
  userLimit: number;        // Commands per second per user (default: 5)
  userDuration: number;     // Window duration in seconds (default: 1)
}

const DEFAULT_CONFIG: RateLimitConfig = {
  guildLimit: 100,
  guildDuration: 1,
  userLimit: 5,
  userDuration: 1,
};

// --------------------------------------------------------------------------
// Rate Limiter Service
// --------------------------------------------------------------------------

/**
 * Redis-backed rate limiter for DoS protection
 *
 * Implements two-level rate limiting:
 * 1. Per-guild: 100 commands/second (protects server resources)
 * 2. Per-user: 5 commands/second (protects individual users)
 *
 * Both must pass for a request to be allowed.
 */
export class RateLimiterService {
  private readonly guildLimiter: RateLimiterRedis;
  private readonly userLimiter: RateLimiterRedis;
  private readonly log: Logger;
  private readonly config: RateLimitConfig;

  constructor(redis: Redis, logger: Logger, config: Partial<RateLimitConfig> = {}) {
    this.log = logger.child({ component: 'RateLimiterService' });
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Guild-level rate limiter (SEC-3.2)
    this.guildLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'ratelimit:guild',
      points: this.config.guildLimit,
      duration: this.config.guildDuration,
      blockDuration: 0, // Don't block, just deny
    });

    // User-level rate limiter (SEC-3.3)
    this.userLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'ratelimit:user',
      points: this.config.userLimit,
      duration: this.config.userDuration,
      blockDuration: 0, // Don't block, just deny
    });

    this.log.info(
      {
        guildLimit: this.config.guildLimit,
        guildDuration: this.config.guildDuration,
        userLimit: this.config.userLimit,
        userDuration: this.config.userDuration,
      },
      'Rate limiter initialized'
    );
  }

  /**
   * Check both guild and user rate limits
   * Returns the most restrictive result (first failure)
   */
  async checkLimits(
    guildId: string | null | undefined,
    userId: string | null | undefined
  ): Promise<RateLimitCheckResult> {
    // Check guild limit first if guild exists
    if (guildId) {
      const guildResult = await this.checkGuild(guildId);
      if (!guildResult.allowed) {
        return guildResult;
      }
    }

    // Check user limit if user exists
    if (userId) {
      const userResult = await this.checkUser(userId);
      if (!userResult.allowed) {
        // Refund the guild point we consumed
        if (guildId) {
          await this.refundGuild(guildId);
        }
        return userResult;
      }
    }

    // Both passed (or neither was provided)
    return {
      allowed: true,
      type: 'user',
      key: userId ?? guildId ?? 'unknown',
      remaining: -1,
      limit: this.config.userLimit,
      retryAfterMs: 0,
    };
  }

  /**
   * Check guild rate limit
   * Returns true if allowed, false if rate limited
   */
  async checkGuild(guildId: string): Promise<RateLimitCheckResult> {
    const end = rateLimitCheckDuration.startTimer({ type: 'guild' });

    try {
      const res = await this.guildLimiter.consume(guildId);

      end();
      rateLimitAllowedTotal.inc({ type: 'guild' });

      // Update remaining points gauge (sampled)
      if (Math.random() < 0.1) {
        rateLimitRemainingPoints.set({ type: 'guild', key: guildId }, res.remainingPoints);
      }

      return {
        allowed: true,
        type: 'guild',
        key: guildId,
        remaining: res.remainingPoints,
        limit: this.config.guildLimit,
        retryAfterMs: 0,
      };
    } catch (error) {
      end();

      if (error instanceof RateLimiterRes) {
        // Rate limited
        rateLimitViolationsTotal.inc({ type: 'guild', guild_id: guildId });

        this.log.warn(
          {
            guildId,
            msBeforeNext: error.msBeforeNext,
            consumedPoints: error.consumedPoints,
          },
          'Guild rate limit exceeded'
        );

        return {
          allowed: false,
          type: 'guild',
          key: guildId,
          remaining: 0,
          limit: this.config.guildLimit,
          retryAfterMs: error.msBeforeNext,
        };
      }

      // Unknown error, fail open (allow request but log error)
      this.log.error({ error, guildId }, 'Rate limiter error, failing open');
      return {
        allowed: true,
        type: 'guild',
        key: guildId,
        remaining: -1,
        limit: this.config.guildLimit,
        retryAfterMs: 0,
      };
    }
  }

  /**
   * Check user rate limit
   * Returns true if allowed, false if rate limited
   */
  async checkUser(userId: string): Promise<RateLimitCheckResult> {
    const end = rateLimitCheckDuration.startTimer({ type: 'user' });

    try {
      const res = await this.userLimiter.consume(userId);

      end();
      rateLimitAllowedTotal.inc({ type: 'user' });

      return {
        allowed: true,
        type: 'user',
        key: userId,
        remaining: res.remainingPoints,
        limit: this.config.userLimit,
        retryAfterMs: 0,
      };
    } catch (error) {
      end();

      if (error instanceof RateLimiterRes) {
        // Rate limited
        rateLimitViolationsTotal.inc({ type: 'user', guild_id: 'user' });

        this.log.warn(
          {
            userId,
            msBeforeNext: error.msBeforeNext,
            consumedPoints: error.consumedPoints,
          },
          'User rate limit exceeded'
        );

        return {
          allowed: false,
          type: 'user',
          key: userId,
          remaining: 0,
          limit: this.config.userLimit,
          retryAfterMs: error.msBeforeNext,
        };
      }

      // Unknown error, fail open
      this.log.error({ error, userId }, 'Rate limiter error, failing open');
      return {
        allowed: true,
        type: 'user',
        key: userId,
        remaining: -1,
        limit: this.config.userLimit,
        retryAfterMs: 0,
      };
    }
  }

  /**
   * Refund a guild point (used when user limit fails after guild passed)
   */
  private async refundGuild(guildId: string): Promise<void> {
    try {
      await this.guildLimiter.reward(guildId, 1);
    } catch (error) {
      // Best effort refund, don't fail the request
      this.log.debug({ error, guildId }, 'Failed to refund guild point');
    }
  }

  /**
   * Get current rate limit status without consuming
   * Useful for health checks and monitoring
   */
  async getStatus(guildId?: string, userId?: string): Promise<{
    guild?: { remaining: number; limit: number };
    user?: { remaining: number; limit: number };
  }> {
    const status: {
      guild?: { remaining: number; limit: number };
      user?: { remaining: number; limit: number };
    } = {};

    if (guildId) {
      try {
        const res = await this.guildLimiter.get(guildId);
        status.guild = {
          remaining: res ? res.remainingPoints : this.config.guildLimit,
          limit: this.config.guildLimit,
        };
      } catch {
        status.guild = { remaining: this.config.guildLimit, limit: this.config.guildLimit };
      }
    }

    if (userId) {
      try {
        const res = await this.userLimiter.get(userId);
        status.user = {
          remaining: res ? res.remainingPoints : this.config.userLimit,
          limit: this.config.userLimit,
        };
      } catch {
        status.user = { remaining: this.config.userLimit, limit: this.config.userLimit };
      }
    }

    return status;
  }

  /**
   * Delete rate limit entries (for admin/testing)
   */
  async reset(guildId?: string, userId?: string): Promise<void> {
    if (guildId) {
      await this.guildLimiter.delete(guildId);
      this.log.info({ guildId }, 'Guild rate limit reset');
    }
    if (userId) {
      await this.userLimiter.delete(userId);
      this.log.info({ userId }, 'User rate limit reset');
    }
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create rate limiter service with default config
 */
export function createRateLimiterService(
  redis: Redis,
  logger: Logger,
  config?: Partial<RateLimitConfig>
): RateLimiterService {
  return new RateLimiterService(redis, logger, config);
}

// --------------------------------------------------------------------------
// User-Friendly Error Messages (SEC-3.5)
// --------------------------------------------------------------------------

/**
 * Generate user-friendly rate limit message
 */
export function getRateLimitMessage(result: RateLimitCheckResult): string {
  const retrySeconds = Math.ceil(result.retryAfterMs / 1000);

  if (result.type === 'guild') {
    return `This server is processing too many commands right now. Please try again in ${retrySeconds} second${retrySeconds !== 1 ? 's' : ''}.`;
  }

  return `You're sending commands too quickly! Please slow down and try again in ${retrySeconds} second${retrySeconds !== 1 ? 's' : ''}.`;
}
