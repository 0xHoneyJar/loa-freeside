/**
 * Rate Limiting Middleware
 *
 * Sprint 112: Security Remediation (HIGH-002)
 *
 * Simple in-memory rate limiting for REST API endpoints.
 * Uses sliding window algorithm with per-user tracking.
 *
 * @module api/middleware/rate-limit
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';
import type { AuthenticatedRequest } from './auth.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key prefix for this limiter */
  keyPrefix: string;
  /** Whether to include standard rate limit headers */
  standardHeaders?: boolean;
  /**
   * Sprint 135 (MED-004): Maximum entries in the rate limit store
   * Prevents unbounded memory growth from malicious actors
   * @default 10000
   */
  maxEntries?: number;
}

/**
 * Rate limit window tracking
 *
 * Sprint 135 (MED-004): Added lastAccessedAt for LRU eviction
 */
interface RateLimitWindow {
  count: number;
  resetAt: number;
  /** Sprint 135 (MED-004): Last access time for LRU eviction */
  lastAccessedAt: number;
}

// =============================================================================
// Default Configurations
// =============================================================================

/**
 * Pre-defined rate limit configurations for different operation types
 */
export const RATE_LIMIT_CONFIGS = {
  /** General endpoints: 60 requests per minute */
  general: {
    max: 60,
    windowMs: 60 * 1000,
    keyPrefix: 'general',
    standardHeaders: true,
  },
  /** Write operations: 20 requests per minute */
  write: {
    max: 20,
    windowMs: 60 * 1000,
    keyPrefix: 'write',
    standardHeaders: true,
  },
  /** Expensive operations (tier calculations, checks): 10 requests per minute */
  expensive: {
    max: 10,
    windowMs: 60 * 1000,
    keyPrefix: 'expensive',
    standardHeaders: true,
  },
} as const;

// =============================================================================
// RateLimiter Class
// =============================================================================

/**
 * Sprint 135 (MED-004): Default maximum entries in rate limit store
 */
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * Sprint 138 (MED-003): Global rate limiter budget
 *
 * Tracks total memory usage across all rate limiter instances to prevent
 * unbounded memory growth from creating many rate limiter instances.
 */
const GLOBAL_MAX_ENTRIES = 50000; // Maximum total entries across all limiters
const GLOBAL_WARNING_THRESHOLD = 0.8; // 80% warning threshold
let globalEntryCount = 0;
const allLimiters: Set<RateLimiter> = new Set();

/**
 * Sprint 138 (MED-003): Get global rate limiter statistics
 */
export function getGlobalRateLimiterStats(): {
  totalEntries: number;
  maxEntries: number;
  utilization: number;
  instanceCount: number;
  warning: boolean;
} {
  // Recalculate from all limiter instances
  globalEntryCount = 0;
  for (const limiter of allLimiters) {
    globalEntryCount += limiter.getSize();
  }

  const utilization = globalEntryCount / GLOBAL_MAX_ENTRIES;

  return {
    totalEntries: globalEntryCount,
    maxEntries: GLOBAL_MAX_ENTRIES,
    utilization,
    instanceCount: allLimiters.size,
    warning: utilization >= GLOBAL_WARNING_THRESHOLD,
  };
}

/**
 * Sprint 138 (MED-003): Register limiter for global tracking
 */
function registerLimiter(limiter: RateLimiter): void {
  allLimiters.add(limiter);
}

/**
 * Sprint 138 (MED-003): Unregister limiter from global tracking
 */
function unregisterLimiter(limiter: RateLimiter): void {
  allLimiters.delete(limiter);
}

/** Sprint 138 (MED-003): Track if we've already warned about budget */
let globalBudgetWarningLogged = false;

/**
 * Sprint 138 (MED-003): Check if adding entries would exceed global budget
 * Logs warning once when approaching threshold
 */
function checkGlobalBudget(): boolean {
  const stats = getGlobalRateLimiterStats();

  // Log warning once when exceeding threshold
  if (stats.warning && !globalBudgetWarningLogged) {
    globalBudgetWarningLogged = true;
    logger.warn(
      {
        totalEntries: stats.totalEntries,
        maxEntries: stats.maxEntries,
        utilization: Math.round(stats.utilization * 100),
        instanceCount: stats.instanceCount,
      },
      'Rate limiter approaching global memory budget'
    );
  } else if (!stats.warning && globalBudgetWarningLogged) {
    // Reset warning flag if utilization drops below threshold
    globalBudgetWarningLogged = false;
  }

  return stats.totalEntries < GLOBAL_MAX_ENTRIES;
}

/**
 * In-memory sliding window rate limiter
 *
 * Thread-safe for single-process Node.js applications.
 * For distributed systems, consider using Redis-based limiting.
 *
 * Sprint 135 (MED-004): Implements LRU eviction to prevent memory exhaustion
 */
export class RateLimiter {
  private windows = new Map<string, RateLimitWindow>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  /** Sprint 135 (MED-004): Maximum entries before LRU eviction */
  private readonly maxEntries: number;

  constructor(
    private readonly config: RateLimitConfig
  ) {
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    // Sprint 138 (MED-003): Register with global tracking
    registerLimiter(this);
    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Check if a request is allowed and update the count
   *
   * @param key - Unique identifier for rate limiting (usually userId or IP)
   * @returns Object with allowed status and rate limit info
   */
  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const fullKey = `${this.config.keyPrefix}:${key}`;
    let window = this.windows.get(fullKey);

    // Create new window if none exists or expired
    if (!window || now > window.resetAt) {
      // Sprint 135 (MED-004): Check if we need to evict before adding
      if (!window && this.windows.size >= this.maxEntries) {
        this.evictLRU();
      }
      // Sprint 138 (MED-003): Check global budget and trigger eviction if needed
      if (!window && !checkGlobalBudget()) {
        this.evictLRU();
      }

      window = {
        count: 0,
        resetAt: now + this.config.windowMs,
        lastAccessedAt: now,
      };
      this.windows.set(fullKey, window);
    } else {
      // Sprint 135 (MED-004): Update last accessed time for LRU tracking
      window.lastAccessedAt = now;
    }

    // Check if limit exceeded
    if (window.count >= this.config.max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: window.resetAt,
      };
    }

    // Increment count
    window.count++;

    return {
      allowed: true,
      remaining: this.config.max - window.count,
      resetAt: window.resetAt,
    };
  }

  /**
   * Sprint 135 (MED-004): Evict least recently used entries
   *
   * Removes 10% of entries when at capacity to amortize eviction cost.
   */
  private evictLRU(): void {
    const evictCount = Math.max(1, Math.floor(this.maxEntries * 0.1));

    // Convert to array and sort by lastAccessedAt (oldest first)
    const entries = Array.from(this.windows.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    // Remove oldest entries
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        this.windows.delete(entry[0]);
      }
    }

    logger.debug(
      {
        keyPrefix: this.config.keyPrefix,
        evicted: Math.min(evictCount, entries.length),
        remaining: this.windows.size,
      },
      'Rate limiter LRU eviction'
    );
  }

  /**
   * Start periodic cleanup of expired windows
   */
  private startCleanup(): void {
    // Clean up every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);

    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up expired windows
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (now > window.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval (for testing/shutdown)
   * Sprint 138 (MED-003): Also unregisters from global tracking
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    // Sprint 138 (MED-003): Unregister from global tracking
    unregisterLimiter(this);
  }

  /**
   * Clear all rate limit data (for testing)
   */
  clear(): void {
    this.windows.clear();
  }

  /**
   * Get current window count for a key (for testing)
   */
  getCount(key: string): number {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const window = this.windows.get(fullKey);
    if (!window || Date.now() > window.resetAt) {
      return 0;
    }
    return window.count;
  }

  /**
   * Sprint 135 (MED-004): Get current number of entries (for monitoring/testing)
   */
  getSize(): number {
    return this.windows.size;
  }

  /**
   * Sprint 135 (MED-004): Get maximum entries configuration (for testing)
   */
  getMaxEntries(): number {
    return this.maxEntries;
  }
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create rate limiting middleware
 *
 * @param config - Rate limit configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const writeLimiter = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.write);
 * router.post('/endpoint', writeLimiter, handler);
 * ```
 */
export function createRateLimitMiddleware(
  config: RateLimitConfig
): (req: Request, res: Response, next: NextFunction) => void {
  const limiter = new RateLimiter(config);

  return (req: Request, res: Response, next: NextFunction) => {
    // Extract key: prefer userId from auth, fallback to IP
    const authReq = req as AuthenticatedRequest;
    const key = authReq.caller?.userId || req.ip || 'anonymous';

    const result = limiter.check(key);

    // Add rate limit headers if enabled
    if (config.standardHeaders !== false) {
      res.setHeader('X-RateLimit-Limit', config.max);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
    }

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);

      logger.warn(
        {
          userId: authReq.caller?.userId,
          ip: req.ip,
          path: req.path,
          keyPrefix: config.keyPrefix,
        },
        'Rate limit exceeded'
      );

      res.status(429).json({
        error: 'Too many requests',
        retryAfter,
      });
      return;
    }

    next();
  };
}

// =============================================================================
// Pre-built Middleware Instances
// =============================================================================

/**
 * General rate limiter: 60 requests per minute
 */
export const generalRateLimiter = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.general);

/**
 * Write operation rate limiter: 20 requests per minute
 */
export const writeRateLimiter = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.write);

/**
 * Expensive operation rate limiter: 10 requests per minute
 */
export const expensiveRateLimiter = createRateLimitMiddleware(RATE_LIMIT_CONFIGS.expensive);

// =============================================================================
// Factory for Custom Limiters
// =============================================================================

/**
 * Create a custom rate limiter with specific settings
 *
 * @param max - Maximum requests allowed
 * @param windowMs - Window size in milliseconds
 * @param keyPrefix - Unique prefix for this limiter
 * @returns Rate limiting middleware
 */
export function rateLimit(
  max: number,
  windowMs: number,
  keyPrefix: string
): (req: Request, res: Response, next: NextFunction) => void {
  return createRateLimitMiddleware({ max, windowMs, keyPrefix, standardHeaders: true });
}
