/**
 * Governance Authorization & Rate Limiting Middleware
 *
 * Role-based access control with per-role daily limits and per-community
 * burst protection via Redis counters.
 *
 * Rate limits (AC-5.5.1):
 *   member: 5/day, operator: 20/day, admin: unlimited, agent: cannot propose
 * Burst limit (AC-5.5.2): 10/min per community
 *
 * Key Cardinality (F-4 / Bridgebuilder):
 *   Each active actor generates 2 Redis keys (daily + burst) with
 *   24h/60s TTL respectively. For N actors per community: 2N keys.
 *   At ~100 bytes/key, 10k actors = ~2MB — negligible at current scale.
 *   Monitor `governance_rate_limit_key_count` for scaling trajectory.
 *
 *   Future scaling (Stripe parallel): Stripe uses hierarchical rate limit
 *   keys (customer → merchant → global) to bound cardinality. At scale,
 *   a Count-Min Sketch probabilistic approach could replace per-actor
 *   keys while maintaining bounded memory and acceptable false-positive
 *   rates for rate limiting.
 *
 * @see SDD §5.4 Authorization Middleware
 * @see Sprint 5, Task 5.5 (AC-5.5.1 through AC-5.5.5)
 * @module packages/services/governance-auth
 */

import type { Redis } from 'ioredis';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Actor role */
export type Role = 'member' | 'operator' | 'admin' | 'agent';

/** Actor context attached to request */
export interface Actor {
  id: string;
  role: Role;
  community_id: string;
}

/** Express-compatible request/response/next */
export interface GovRequest {
  actor?: Actor;
  params: Record<string, string>;
}

export interface GovResponse {
  status(code: number): GovResponse;
  setHeader(name: string, value: string): GovResponse;
  json(body: unknown): void;
}

export type NextFunction = () => void;

/** Rate limit result */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

// --------------------------------------------------------------------------
// Constants — AC-5.5.1
// --------------------------------------------------------------------------

/** Per-role daily limits (null = unlimited) */
const ROLE_DAILY_LIMITS: Record<Role, number | null> = {
  member: 5,
  operator: 20,
  admin: null,
  agent: 0, // agent cannot propose
};

/** Per-community burst limit — AC-5.5.2 */
const BURST_LIMIT = 10;

/** Burst window in seconds (1 minute) */
const BURST_WINDOW_SECONDS = 60;

/** Daily window in seconds (24 hours) */
const DAILY_WINDOW_SECONDS = 86400;

// --------------------------------------------------------------------------
// Rate Limiter
// --------------------------------------------------------------------------

/** Metrics port for observability */
export interface GovernanceMetricsPort {
  putMetric(name: string, value: number, unit?: string): void;
}

export function createGovernanceRateLimiter(redis: Redis, metricsPort?: GovernanceMetricsPort) {
  /**
   * Atomic INCR + EXPIRE via Lua script — AC-5.5.4.
   * Returns [count, ttl] to ensure keys always have correct TTL
   * and Retry-After reflects actual remaining time.
   */
  const INCR_WITH_TTL_SCRIPT = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('TTL', KEYS[1])
    return {current, ttl}
  `;

  async function incrWithTtl(key: string, windowSeconds: number): Promise<[number, number]> {
    const result = (await redis.eval(INCR_WITH_TTL_SCRIPT, 1, key, windowSeconds)) as [number, number];
    return result;
  }

  /**
   * Check rate limits for a governance action.
   * Returns whether the action is allowed.
   */
  async function checkRateLimit(actor: Actor): Promise<RateLimitResult> {
    const dailyLimit = ROLE_DAILY_LIMITS[actor.role];

    // F-4: Emit rate limit key count metric for cardinality monitoring
    // Each invocation checks 1-2 keys (burst + optionally daily role key)
    let keysChecked = 0;

    // Agent role cannot perform governance actions
    if (dailyLimit === 0) {
      return {
        allowed: false,
        reason: `Role '${actor.role}' cannot perform governance actions`,
      };
    }

    // AC-5.5.2: Burst limit check (per-community, per-minute)
    const burstKey = `gov:burst:${actor.community_id}`;
    const [burstCount, burstTtl] = await incrWithTtl(burstKey, BURST_WINDOW_SECONDS);
    keysChecked++;

    if (burstCount > BURST_LIMIT) {
      return {
        allowed: false,
        retryAfterSeconds: burstTtl > 0 ? burstTtl : BURST_WINDOW_SECONDS,
        reason: 'Burst governance rate limit exceeded',
      };
    }

    // AC-5.5.1: Daily role limit check (per-actor, not per-role)
    if (dailyLimit !== null) {
      const roleKey = `gov:rate:${actor.community_id}:${actor.role}:${actor.id}`;
      const [roleCount, roleTtl] = await incrWithTtl(roleKey, DAILY_WINDOW_SECONDS);
      keysChecked++;

      if (roleCount > dailyLimit) {
        metricsPort?.putMetric('governance_rate_limit_key_count', keysChecked);
        return {
          allowed: false,
          retryAfterSeconds: roleTtl > 0 ? roleTtl : DAILY_WINDOW_SECONDS,
          reason: 'Daily governance rate limit exceeded',
        };
      }
    }

    // F-4: Emit cardinality metric for operational awareness
    metricsPort?.putMetric('governance_rate_limit_key_count', keysChecked);

    return { allowed: true };
  }

  return { checkRateLimit };
}

// --------------------------------------------------------------------------
// Middleware Factory — AC-5.5.3
// --------------------------------------------------------------------------

/**
 * Create requireGovernanceRole middleware.
 * Checks role authorization and rate limits.
 */
export function createRequireGovernanceRole(redis: Redis) {
  const rateLimiter = createGovernanceRateLimiter(redis);

  return function requireGovernanceRole(allowedRoles: Role[]) {
    return async (req: GovRequest, res: GovResponse, next: NextFunction): Promise<void> => {
      const actor = req.actor;
      if (!actor) {
        res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
        return;
      }

      // Role check — AC-5.5.5
      if (!allowedRoles.includes(actor.role)) {
        res.status(403).json({
          error: { code: 'FORBIDDEN', message: `Role '${actor.role}' cannot perform this action` },
        });
        return;
      }

      // Rate limit check — AC-5.5.1, AC-5.5.2
      const rateLimitResult = await rateLimiter.checkRateLimit(actor);
      if (!rateLimitResult.allowed) {
        // AC-5.5.3: 429 with Retry-After
        if (rateLimitResult.retryAfterSeconds) {
          res.setHeader('Retry-After', String(rateLimitResult.retryAfterSeconds));
        }
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: rateLimitResult.reason },
        });
        return;
      }

      next();
    };
  };
}
