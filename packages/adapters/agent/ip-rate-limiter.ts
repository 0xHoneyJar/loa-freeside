/**
 * Pre-Auth IP Rate Limiter
 * Sprint S2-T3: In-memory token bucket per IP, applied before auth processing
 *
 * 100 requests/min per IP with burst capacity of 20.
 * Returns 429 with Retry-After header before any JWT/auth processing.
 * In-memory only — no Redis dependency for this layer. This is intentional:
 * pre-auth rate limiting must not fail-open on Redis outages, and per-instance
 * limits are acceptable since ALB sticky sessions distribute load evenly.
 *
 * Hardening (Sprint S0-T1): Validated IP extraction with loopback isolation.
 * Behind ALB, Express must have `trust proxy` set so req.ip reflects the
 * rightmost client IP from X-Forwarded-For (1 trusted hop).
 *
 * @see SDD §4.5 Pre-Auth IP Rate Limiter
 */

import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import { isIP, isIPv4 } from 'node:net';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface IpRateLimitConfig {
  /** Maximum requests per window (default: 100) */
  maxPerWindow: number;
  /** Window size in milliseconds (default: 60_000) */
  windowMs: number;
  /** Burst capacity — max tokens in bucket (default: 20) */
  burstCapacity: number;
  /** Maximum tracked IPs before LRU eviction (default: 10_000) */
  maxEntries: number;
}

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

const DEFAULT_CONFIG: IpRateLimitConfig = {
  maxPerWindow: 100,
  windowMs: 60_000,
  burstCapacity: 20,
  maxEntries: 10_000,
};

// --------------------------------------------------------------------------
// IP Extraction — Hardening (Sprint S0-T1)
// --------------------------------------------------------------------------

/** IPv4 loopback: 127.0.0.0/8 */
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** IPv4-mapped IPv6 prefix (case-insensitive via lowercase normalization) */
const IPV4_MAPPED_PREFIX = '::ffff:';

/** Dedicated bucket keys for non-client traffic */
const BUCKET_LOOPBACK = '__loopback__';
const BUCKET_UNIDENTIFIED = '__unidentified__';

/**
 * Normalize an IPv6 address to a canonical lowercase form.
 * Handles: uppercase hex, leading zeros, IPv4-mapped addresses.
 *
 * For IPv4-mapped IPv6 (::ffff:x.x.x.x), extracts the IPv4 address.
 * For pure IPv6, lowercases and collapses leading zeros per segment
 * to produce a consistent bucket key.
 *
 * Note: This does not implement full RFC 5952 zero-compression (::),
 * but since we only need consistent bucket keys (not display), lowercasing
 * + leading-zero removal per segment is sufficient for deduplication.
 */
function normalizeIp(raw: string): string {
  // Lowercase first — handles ::FFFF:, 2001:0DB8::, etc.
  const lower = raw.toLowerCase();

  // Handle IPv4-mapped IPv6: ::ffff:1.2.3.4 → 1.2.3.4
  if (lower.startsWith(IPV4_MAPPED_PREFIX)) {
    const v4Part = lower.slice(IPV4_MAPPED_PREFIX.length);
    // Validate extracted part is actually IPv4
    if (isIPv4(v4Part)) return v4Part;
  }

  // Pure IPv4 — already lowercase (digits), return as-is
  if (isIPv4(lower)) return lower;

  // Pure IPv6 — normalize each segment to remove leading zeros
  // Split on ':', handle :: expansion
  const parts = lower.split(':');
  const normalized = parts.map((seg) => {
    if (seg === '') return seg; // empty segments from :: expansion
    // Remove leading zeros: '0db8' → 'db8', '0000' → '0'
    return seg.replace(/^0+(?=.)/, '');
  });
  return normalized.join(':');
}

/**
 * Extract and validate client IP from an Express request.
 *
 * Requires `app.set('trust proxy', 1)` so req.ip reflects the rightmost
 * untrusted hop from X-Forwarded-For (the real client IP behind ALB).
 *
 * Returns:
 *  - A validated, normalized IP string for normal traffic
 *  - `__loopback__` for health-check/localhost traffic (prevents shared bucket)
 *  - `__unidentified__` if no valid IP can be determined (rate-limited separately)
 */
export function extractIp(req: Request): string {
  // req.ip is set by Express when trust proxy is configured
  const raw = req.ip || req.socket.remoteAddress;

  if (!raw) {
    return BUCKET_UNIDENTIFIED;
  }

  // Validate IP format first (works case-insensitively)
  if (isIP(raw) === 0) {
    return BUCKET_UNIDENTIFIED;
  }

  // Normalize to canonical lowercase form, extract IPv4 from mapped addresses
  const normalized = normalizeIp(raw);

  // Isolate loopback traffic (health checks, internal probes)
  if (normalized === '::1' || LOOPBACK_V4.test(normalized)) {
    return BUCKET_LOOPBACK;
  }

  return normalized;
}

// --------------------------------------------------------------------------
// IP Rate Limiter
// --------------------------------------------------------------------------

export class IpRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly config: IpRateLimitConfig;
  private readonly refillRatePerMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly logger: Logger,
    config?: Partial<IpRateLimitConfig>,
  ) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    if (merged.windowMs <= 0 || merged.maxPerWindow <= 0 || merged.burstCapacity <= 0 || merged.maxEntries <= 0) {
      throw new Error('Invalid IpRateLimitConfig: all values must be > 0');
    }
    this.config = merged;
    this.refillRatePerMs = this.config.maxPerWindow / this.config.windowMs;
    this.startCleanup();
  }

  /**
   * Check if a request from the given IP is allowed.
   * Consumes one token on success.
   */
  check(ip: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (!bucket) {
      // Evict LRU if at capacity
      if (this.buckets.size >= this.config.maxEntries) {
        this.evictOldest();
      }
      bucket = { tokens: this.config.burstCapacity, lastRefillMs: now };
      this.buckets.set(ip, bucket);
    } else {
      // Touch entry to maintain LRU order (most recently used at end)
      this.buckets.delete(ip);
      this.buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time (clamp to 0 for clock drift)
    const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
    bucket.tokens = Math.min(
      this.config.burstCapacity,
      bucket.tokens + elapsedMs * this.refillRatePerMs,
    );
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      // Denied — compute retry-after
      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(deficit / this.refillRatePerMs);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
    };
  }

  /**
   * Create Express middleware that rejects with 429 when rate-limited.
   * Only applies to agent endpoints (path prefix check done by caller via mount point).
   */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = extractIp(req);
      const result = this.check(ip);

      if (!result.allowed) {
        const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        res.setHeader('X-RateLimit-Limit', String(this.config.maxPerWindow));
        res.setHeader('X-RateLimit-Remaining', '0');
        this.logger.warn({ ip, path: req.path, retryAfterSec }, 'Pre-auth IP rate limit exceeded');
        res.status(429).json({
          error: 'Too many requests',
          retryAfter: retryAfterSec,
        });
        return;
      }

      res.setHeader('X-RateLimit-Limit', String(this.config.maxPerWindow));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      next();
    };
  }

  /**
   * Stop cleanup timer (for testing/shutdown).
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private evictOldest(): void {
    // Remove ~10% of oldest entries (by insertion order — Map preserves order)
    const evictCount = Math.max(1, Math.floor(this.config.maxEntries * 0.1));
    const iter = this.buckets.keys();
    for (let i = 0; i < evictCount; i++) {
      const key = iter.next().value;
      if (key !== undefined) this.buckets.delete(key);
    }
  }

  private startCleanup(): void {
    // Clean stale buckets every 2 minutes
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const staleThresholdMs = this.config.windowMs * 2;
      for (const [ip, bucket] of this.buckets) {
        if (now - bucket.lastRefillMs > staleThresholdMs) {
          this.buckets.delete(ip);
        }
      }
    }, 120_000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
