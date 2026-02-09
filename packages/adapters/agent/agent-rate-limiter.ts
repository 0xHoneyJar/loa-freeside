/**
 * Agent Rate Limiter
 * Sprint S2-T2: TypeScript wrapper for multi-dimensional rate limit Lua script
 *
 * Evaluates the rate limit Lua script against Redis, returning structured results.
 * Fail-closed on Redis error: returns allowed=false with SERVICE_UNAVAILABLE.
 *
 * @see SDD §4.4 Agent Rate Limiter
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { AccessLevel } from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Which rate limit dimension was exceeded */
export type RateLimitDimension = 'community' | 'user' | 'channel' | 'burst';

/** Result of a rate limit check */
export interface RateLimitResult {
  allowed: boolean;
  /** Which dimension was exceeded (null if allowed) */
  dimension: RateLimitDimension | null;
  /** Remaining requests in the relevant window */
  remaining: number;
  /** Limit for the relevant dimension */
  limit: number;
  /** When the client should retry (milliseconds from now, 0 if allowed) */
  retryAfterMs: number;
  /** When the window resets (Unix timestamp in ms) */
  resetAtMs: number;
}

/** Rate limits per access level */
export interface TierLimits {
  /** Community-wide requests per window */
  community: number;
  /** Per-user requests per window */
  user: number;
  /** Per-channel requests per window */
  channel: number;
  /** Token bucket capacity */
  burstCapacity: number;
  /** Token bucket refill rate (tokens per millisecond) */
  burstRefillRatePerMs: number;
}

// --------------------------------------------------------------------------
// Tier Limits (from sprint plan: free: 60/10/20, pro: 300/30/60, enterprise: 1000/100/200)
// --------------------------------------------------------------------------

/** Default rate limits by access level */
export const TIER_LIMITS: Record<AccessLevel, TierLimits> = {
  free: {
    community: 60,
    user: 10,
    channel: 20,
    burstCapacity: 3,
    burstRefillRatePerMs: 3 / 60_000, // 3 tokens per minute
  },
  pro: {
    community: 300,
    user: 30,
    channel: 60,
    burstCapacity: 5,
    burstRefillRatePerMs: 5 / 60_000, // 5 tokens per minute
  },
  enterprise: {
    community: 1000,
    user: 100,
    channel: 200,
    burstCapacity: 10,
    burstRefillRatePerMs: 10 / 60_000, // 10 tokens per minute
  },
};

// --------------------------------------------------------------------------
// Lua Script Loading
// --------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const RATE_LIMIT_LUA = readFileSync(join(__dirname, 'lua', 'rate-limit.lua'), 'utf-8');

// --------------------------------------------------------------------------
// Rate Limiter
// --------------------------------------------------------------------------

export class AgentRateLimiter {
  private scriptSha: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  /**
   * Check rate limits across all 4 dimensions atomically.
   * Fail-closed: returns allowed=false on Redis error.
   *
   * @param params - Community, user, channel IDs and access level
   * @returns Rate limit result with dimension info
   */
  async check(params: {
    communityId: string;
    userId: string;
    channelId: string;
    accessLevel: AccessLevel;
  }): Promise<RateLimitResult> {
    const limits = TIER_LIMITS[params.accessLevel];
    const windowMs = 60_000; // 1 minute window
    const nowMs = Date.now();
    const requestId = randomUUID();

    try {
      let sha = await this.ensureScript();

      const keys = [
        `agent:rl:community:${params.communityId}:${windowMs}`,
        `agent:rl:user:${params.userId}:${windowMs}`,
        `agent:rl:channel:${params.channelId}:${windowMs}`,
        `agent:rl:burst:${params.userId}`,
      ];
      const argv = [
        String(limits.community),
        String(limits.user),
        String(limits.channel),
        String(limits.burstCapacity),
        String(limits.burstRefillRatePerMs),
        String(nowMs),
        requestId,
        String(windowMs),
      ];

      let result: string[];
      try {
        result = (await this.redis.evalsha(sha, 4, ...keys, ...argv)) as string[];
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('NOSCRIPT')) {
          // Script evicted from Redis cache — reload and retry once
          this.scriptSha = null;
          sha = await this.ensureScript();
          result = (await this.redis.evalsha(sha, 4, ...keys, ...argv)) as string[];
        } else {
          throw err;
        }
      }

      return parseRateLimitResult(result);
    } catch (error) {
      // Fail-closed: deny request on Redis error (FR-3.7)
      this.logger.error({ err: error }, 'Rate limiter Redis error — fail-closed');
      return {
        allowed: false,
        dimension: null,
        remaining: 0,
        limit: 0,
        retryAfterMs: 5000, // suggest retry in 5s
        resetAtMs: nowMs + 5000,
      };
    }
  }

  /**
   * Load and cache the Lua script SHA in Redis.
   */
  private async ensureScript(): Promise<string> {
    if (this.scriptSha) return this.scriptSha;
    this.scriptSha = await this.redis.script('LOAD', RATE_LIMIT_LUA) as string;
    return this.scriptSha;
  }
}

// --------------------------------------------------------------------------
// Result Parser
// --------------------------------------------------------------------------

/**
 * Parse the raw Lua script response into a typed RateLimitResult.
 *
 * Lua returns: [dimension, remaining, limit, retryAfterMs, resetAtMs]
 * Where dimension is 'ok' when all pass, or the name of the failed dimension.
 */
export function parseRateLimitResult(raw: string[]): RateLimitResult {
  const safeInt = (v: unknown, def = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
  };

  const dimension = raw?.[0];
  const remaining = safeInt(raw?.[1]);
  const limit = safeInt(raw?.[2]);
  const retryAfterMs = safeInt(raw?.[3]);
  const resetAtMs = safeInt(raw?.[4]);

  if (dimension === 'ok') {
    return {
      allowed: true,
      dimension: null,
      remaining,
      limit,
      retryAfterMs: 0,
      resetAtMs,
    };
  }

  // Validate known dimension — fail-closed on unexpected value
  if (
    dimension !== 'community' &&
    dimension !== 'user' &&
    dimension !== 'channel' &&
    dimension !== 'burst'
  ) {
    return {
      allowed: false,
      dimension: null,
      remaining: 0,
      limit: 0,
      retryAfterMs: 5000,
      resetAtMs: Date.now() + 5000,
    };
  }

  return {
    allowed: false,
    dimension,
    remaining,
    limit,
    retryAfterMs,
    resetAtMs,
  };
}
