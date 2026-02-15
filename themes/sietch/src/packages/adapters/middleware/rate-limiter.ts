/**
 * Billing Rate Limiter — Per-Principal Fixed-Window
 *
 * In-memory fixed-window rate limiter keyed by authenticated principal.
 * Billing API routes require authentication — unauthenticated requests
 * are rejected with 401, not rate-limited by IP.
 *
 * Single-instance deployment constraint: move to Redis INCRBY with TTL
 * if horizontally scaling (per FR-6).
 *
 * LIMITATION (Bridge Review, finding medium-2):
 * In-memory state is lost on process restart, allowing a burst of requests
 * through the reset window. For single-instance deployments this is an
 * accepted risk. The RedisCounterBackend from protocol/atomic-counter.ts
 * can serve as the persistent backend when scaling horizontally — both
 * the restart-burst and horizontal-scaling cases share the same fix.
 *
 * Sprint refs: Task 6.1
 *
 * @module packages/adapters/middleware/rate-limiter
 */

import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// Types
// =============================================================================

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Key extractor: returns principal ID from request, or null if unauthenticated */
  keyExtractor: (req: Request) => string | null;
  /** Route name for logging */
  routeName?: string;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

// =============================================================================
// Rate Limiter Factory
// =============================================================================

/**
 * Create a per-principal fixed-window rate limiter middleware.
 *
 * Key extraction per route type:
 *   - S2S billing routes: `s2s:${jwt.service_id}`
 *   - Admin routes: `admin:${jwt.sub}`
 *   - Purchase routes: `purchase:${jwt.sub}`
 *   - Unauthenticated routes: rejected with 401
 */
export function createBillingRateLimiter(config: RateLimitConfig) {
  const windowMs = config.windowMs ?? 60_000;
  const windows = new Map<string, WindowEntry>();

  // Periodic cleanup to prevent memory leaks (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now - entry.windowStart > windowMs * 2) {
        windows.delete(key);
      }
    }
  }, 300_000);

  // Allow GC if the middleware is removed
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function billingRateLimit(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const key = config.keyExtractor(req);

    if (key === null) {
      // All billing API routes require authentication per PRD.
      // No IP-based rate limiting (IP is not a stable principal).
      res.status(401).json({
        error: 'Authentication Required',
        message: 'Billing API routes require authentication.',
      });
      return;
    }

    const now = Date.now();
    let entry = windows.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      // New window
      entry = { count: 1, windowStart: now };
      windows.set(key, entry);
      next();
      return;
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
      const retryAfterSeconds = Math.ceil(
        (entry.windowStart + windowMs - now) / 1000,
      );

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${config.routeName ?? 'this route'}. Try again in ${retryAfterSeconds} seconds.`,
        retry_after_seconds: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

// =============================================================================
// Key Extractors
// =============================================================================

/** S2S route key extractor: s2s:{service_id} */
export function s2sKeyExtractor(req: Request): string | null {
  const serviceId = (req as any).internalServiceId;
  return serviceId ? `s2s:${serviceId}` : null;
}

/** Admin route key extractor: admin:{sub} */
export function adminKeyExtractor(req: Request): string | null {
  const sub = (req as any).adminSub ?? (req as any).accountId;
  return sub ? `admin:${sub}` : null;
}

/** Purchase route key extractor: purchase:{sub} */
export function purchaseKeyExtractor(req: Request): string | null {
  const sub = (req as any).accountId;
  return sub ? `purchase:${sub}` : null;
}
