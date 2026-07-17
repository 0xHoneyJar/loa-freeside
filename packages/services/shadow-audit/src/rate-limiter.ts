/**
 * SDD §6 (FR-8) — per-IP fixed-window rate limiter (AC-6).
 *
 * Bounds requests per key (the gateway keys on client IP) so one caller cannot
 * exhaust the audit. The clock is injected for deterministic tests.
 */

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateDecision;
}

export interface RateLimiterConfig {
  /** Max requests per window. */
  limit: number;
  windowMs: number;
  /** Injected clock (unix ms). */
  now: () => number;
}

export class FixedWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();
  constructor(private readonly cfg: RateLimiterConfig) {}

  check(key: string): RateDecision {
    const now = this.cfg.now();
    const entry = this.hits.get(key);
    if (!entry || now - entry.windowStart >= this.cfg.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.cfg.limit - 1, retryAfterMs: 0 };
    }
    if (entry.count >= this.cfg.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.cfg.windowMs - (now - entry.windowStart),
      };
    }
    entry.count += 1;
    return { allowed: true, remaining: this.cfg.limit - entry.count, retryAfterMs: 0 };
  }
}
