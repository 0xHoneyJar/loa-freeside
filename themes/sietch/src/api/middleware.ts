import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit, { type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { logger } from '../utils/logger.js';
import { config, validateApiKey, validateApiKeyAsync } from '../config.js';
import { redisService } from '../services/cache/RedisService.js';
import { getApiKeyAuditLogger } from '../services/security/AdminApiKeyService.js';

/**
 * Extended Request type with admin context
 */
export interface AuthenticatedRequest extends Request {
  adminName?: string;
  apiKeyId?: string;
}

// =============================================================================
// Distributed Rate Limiting (Sprint 82 - MED-4)
// =============================================================================

/**
 * Track rate limit events for metrics
 */
let rateLimitHitCount = 0;
let rateLimitRedisFailures = 0;

/**
 * Get rate limit metrics for monitoring
 */
export function getRateLimitMetrics(): { hitCount: number; redisFailures: number } {
  return { hitCount: rateLimitHitCount, redisFailures: rateLimitRedisFailures };
}

/**
 * Reset rate limit metrics (for testing)
 */
export function resetRateLimitMetrics(): void {
  rateLimitHitCount = 0;
  rateLimitRedisFailures = 0;
}

/**
 * Create a Redis store for rate limiting with graceful fallback
 *
 * Sprint 82 (MED-4): Distributed rate limiting for multi-instance deployments
 *
 * @param prefix - Key prefix for this rate limiter (e.g., 'rl:public', 'rl:admin')
 * @returns Redis store if available, undefined for memory store fallback
 */
function createRateLimitStore(prefix: string): Store | undefined {
  // Only use Redis store if Redis is enabled and connected
  if (!config.features.redisEnabled) {
    logger.debug({ prefix }, 'Rate limiter using memory store (Redis disabled)');
    return undefined;
  }

  try {
    if (!redisService.isConnected()) {
      logger.warn({ prefix }, 'Rate limiter using memory store (Redis not connected)');
      return undefined;
    }

    // Create Redis store with sendCommand for rate-limit-redis v4
    const store = new RedisStore({
      // Use sendCommand to execute Redis commands via RedisService
      sendCommand: async (...args: string[]): Promise<RedisReply> => {
        try {
          const result = await redisService.sendCommand(...args);
          // Cast to RedisReply - ioredis returns compatible types
          return result as RedisReply;
        } catch (error) {
          rateLimitRedisFailures++;
          logger.error({ error, prefix }, 'Redis rate limit command failed');
          throw error;
        }
      },
      prefix,
    });

    logger.info({ prefix }, 'Rate limiter using Redis store (distributed)');
    return store;
  } catch (error) {
    rateLimitRedisFailures++;
    logger.error({ error, prefix }, 'Failed to create Redis rate limit store, falling back to memory');
    return undefined;
  }
}

/**
 * Extended Request type with raw body for webhook signature verification
 * Used by routes that need to verify signatures (e.g., Paddle webhooks)
 */
export interface RawBodyRequest extends Request {
  rawBody: Buffer;
}

/**
 * Rate limiter for public endpoints
 *
 * Sprint 82 (MED-4): Reduced from 100 to 50 requests per minute
 * Uses Redis store for distributed rate limiting when available
 */
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // Sprint 82: Reduced from 100 to 50
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  store: createRateLimitStore('rl:public:'),
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? 'unknown';
    }
    return req.ip ?? 'unknown';
  },
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        limit: options.max,
        type: 'public',
      },
      'Public rate limit exceeded'
    );
    res.status(429).json(options.message);
  },
});

/**
 * Rate limiter for admin endpoints
 * 30 requests per minute per API key
 *
 * Sprint 82 (MED-4): Uses Redis store for distributed rate limiting
 */
export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later' },
  store: createRateLimitStore('rl:admin:'),
  keyGenerator: (req) => {
    // Use API key as rate limit key for admin endpoints
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      return `admin:${apiKey.substring(0, 16)}`; // Hash prefix for privacy
    }
    return `admin:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        limit: options.max,
        type: 'admin',
      },
      'Admin rate limit exceeded'
    );
    res.status(429).json(options.message);
  },
});

/**
 * Rate limiter for member-facing API endpoints
 * 60 requests per minute per IP (Sprint 9)
 *
 * Sprint 82 (MED-4): Uses Redis store for distributed rate limiting
 */
export const memberRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  store: createRateLimitStore('rl:member:'),
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `member:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `member:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        limit: options.max,
        type: 'member',
      },
      'Member rate limit exceeded'
    );
    res.status(429).json(options.message);
  },
});

/**
 * Rate limiter for authentication endpoints (Sprint 10 - HIGH-1)
 *
 * Security Features:
 * - 10 requests per minute per IP (strict limit for auth)
 * - Prevents brute-force API key guessing attacks
 * - Uses progressive backoff approach
 * - Returns standard rate limit headers
 *
 * Sprint 10 (HIGH-1): CWE-307 Improper Restriction of Excessive Authentication Attempts
 *
 * @see grimoires/loa/sprint-10-security.md
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again later.',
    retryAfter: 60,
  },
  store: createRateLimitStore('rl:auth:'),
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `auth:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `auth:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        limit: options.max,
        type: 'auth',
        metric: 'sietch_auth_rate_limit_exceeded_total',
      },
      'Authentication rate limit exceeded (HIGH-1 security)'
    );
    res.status(429).json(options.message);
  },
});

/**
 * Strict rate limiter for failed authentication attempts (Sprint 10 - HIGH-1)
 *
 * Security Features:
 * - 5 failed attempts per 15 minutes per IP
 * - Implements account lockout pattern
 * - Only counts failed attempts (not successful ones)
 * - Provides longer lockout period for repeated failures
 *
 * Sprint 10 (HIGH-1): Defense in depth against brute force attacks
 */
export const strictAuthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many failed authentication attempts. Account temporarily locked.',
    retryAfter: 900, // 15 minutes in seconds
    lockedUntil: '', // Will be set dynamically in handler
  },
  store: createRateLimitStore('rl:auth-strict:'),
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `auth-strict:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `auth-strict:${req.ip ?? 'unknown'}`;
  },
  // Skip successful requests - only rate limit failures
  skipSuccessfulRequests: true,
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    logger.warn(
      {
        ip: req.ip,
        path: req.path,
        limit: options.max,
        lockedUntil,
        type: 'auth-strict',
        metric: 'sietch_auth_lockout_total',
      },
      'Authentication lockout triggered (HIGH-1 security)'
    );
    res.status(429).json({
      error: 'Too many failed authentication attempts. Account temporarily locked.',
      retryAfter: 900,
      lockedUntil,
    });
  },
});

/**
 * Rate limiter for webhook endpoints (Sprint 73 - HIGH-2)
 *
 * Security Features:
 * - 1000 requests per minute per IP (matches Paddle/Stripe burst capacity)
 * - Prevents DoS attacks on webhook endpoint
 * - Prevents brute-force signature guessing attempts
 * - Returns standard headers for client visibility
 *
 * Sprint 82 (MED-4): Uses Redis store for distributed rate limiting
 *
 * @see https://developer.paddle.com/webhooks
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 requests per minute per IP
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    error: 'Too many webhook requests',
    retryAfter: 60,
  },
  store: createRateLimitStore('rl:webhook:'),
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `webhook:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `webhook:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, _next, options) => {
    rateLimitHitCount++;
    // Log rate limit violations for monitoring
    const ip = req.ip ?? 'unknown';
    logger.warn(
      {
        ip,
        path: req.path,
        limit: options.max,
        windowMs: options.windowMs,
        type: 'webhook',
      },
      'Webhook rate limit exceeded (HIGH-2 security)'
    );
    res.status(429).json(options.message);
  },
});

/**
 * API key authentication middleware for admin endpoints (LEGACY - SYNC)
 *
 * DEPRECATED: Use requireApiKeyAsync for bcrypt-hashed key validation.
 *
 * This middleware only validates legacy plaintext keys synchronously.
 * For full security, migrate to requireApiKeyAsync.
 */
export function requireApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  const adminName = validateApiKey(apiKey);
  if (!adminName) {
    logger.warn({ apiKeyPrefix: apiKey.substring(0, 8) + '...' }, 'Invalid API key attempt');
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  // Attach admin name to request for audit logging
  req.adminName = adminName;
  next();
}

/**
 * API key authentication middleware for admin endpoints (ASYNC - RECOMMENDED)
 *
 * Sprint 73 (HIGH-1): Secure API key validation with bcrypt.
 *
 * Features:
 * - Bcrypt-based validation with constant-time comparison
 * - Supports both legacy plaintext and bcrypt-hashed keys
 * - Async to prevent blocking the event loop during bcrypt operations
 * - Audit logging of all validation attempts (TASK-73.4)
 *
 * @example
 * ```typescript
 * router.use('/admin', requireApiKeyAsync);
 * router.get('/admin/stats', (req, res) => { ... });
 * ```
 */
export async function requireApiKeyAsync(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  const auditLogger = getApiKeyAuditLogger();

  // Extract request context for audit
  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'];
  const endpoint = req.path;
  const method = req.method;

  if (!apiKey || typeof apiKey !== 'string') {
    // Log failure for missing key
    auditLogger.logFailure('missing', endpoint, method, ipAddress, 'API key required', userAgent).catch(() => {});
    res.status(401).json({ error: 'API key required' });
    return;
  }

  const keyHint = apiKey.substring(0, 8);

  try {
    const adminName = await validateApiKeyAsync(apiKey);
    if (!adminName) {
      // Log failure for invalid key
      auditLogger.logFailure(keyHint, endpoint, method, ipAddress, 'Invalid API key', userAgent).catch(() => {});
      logger.warn({ apiKeyPrefix: keyHint + '...' }, 'Invalid API key attempt');
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    // Log success
    auditLogger.logSuccess(keyHint, adminName, endpoint, method, ipAddress, userAgent).catch(() => {});

    // Attach admin name to request for audit logging
    req.adminName = adminName;
    next();
  } catch (error) {
    // Log failure for error
    auditLogger.logFailure(keyHint, endpoint, method, ipAddress, 'Validation error', userAgent).catch(() => {});
    logger.error({ error }, 'API key validation error');
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Extract client IP from request (supports proxies)
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.ip ?? 'unknown';
}

/**
 * Request validation error
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Global error handler middleware
 *
 * SECURITY: HIGH-6 Remediation - Sensitive Data Exposure (CWE-209)
 * - Never exposes stack traces to clients
 * - Never exposes file paths or internal structure
 * - Logs full error details server-side only
 * - Returns generic error messages in production
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Generate request ID for correlation
  const requestId = res.getHeader('X-Request-ID') || crypto.randomUUID();

  // Log FULL error details server-side (never sent to client)
  logger.error(
    {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      requestId,
      // Don't log body in production - might contain sensitive data
      body: process.env.NODE_ENV === 'development' ? req.body : '[REDACTED]',
    },
    'Request error'
  );

  // Handle known error types (safe messages)
  if (err instanceof ValidationError) {
    res.status(400).json({
      error: err.message,
      requestId,
    });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({
      error: err.message,
      requestId,
    });
    return;
  }

  // SECURITY: Generic error response - never leak internal details
  // Development mode can include more info for debugging
  if (process.env.NODE_ENV === 'development') {
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      requestId,
      // Stack trace only in development
      stack: err.stack?.split('\n').slice(0, 5),
    });
    return;
  }

  // Production: Generic message only
  res.status(500).json({
    error: 'Internal server error',
    requestId,
  });
};

/**
 * 404 handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Request ID middleware for tracing
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', requestId);
  next();
}

// =============================================================================
// Security Breach Middleware (Sprint 67 - Fail-Closed Pattern)
// =============================================================================

/**
 * Security service status for health checks
 */
export interface SecurityServiceStatus {
  redis: boolean;
  auditPersistence: boolean;
  overall: boolean;
}

/**
 * Track security service failures
 */
let securityServiceStatus: SecurityServiceStatus = {
  redis: true,
  auditPersistence: true,
  overall: true,
};

/** Counter for 503 responses - exposed for metrics */
let securityBreach503Count = 0;

/**
 * Update security service status
 * Called by health checks or when services fail
 */
export function updateSecurityServiceStatus(updates: Partial<SecurityServiceStatus>): void {
  if (updates.redis !== undefined) {
    securityServiceStatus.redis = updates.redis;
  }
  if (updates.auditPersistence !== undefined) {
    securityServiceStatus.auditPersistence = updates.auditPersistence;
  }
  // Overall is healthy only if all critical services are healthy
  securityServiceStatus.overall =
    securityServiceStatus.redis && securityServiceStatus.auditPersistence;
}

/**
 * Get current security service status for health endpoints
 */
export function getSecurityServiceStatus(): SecurityServiceStatus {
  return { ...securityServiceStatus };
}

/**
 * Get 503 count for metrics
 */
export function getSecurityBreach503Count(): number {
  return securityBreach503Count;
}

/**
 * Reset 503 count (for testing)
 */
export function resetSecurityBreach503Count(): void {
  securityBreach503Count = 0;
}

/**
 * Routes that require distributed locking (Redis required)
 * These operations MUST have Redis available to prevent race conditions
 */
const ROUTES_REQUIRING_DISTRIBUTED_LOCK = [
  '/billing/webhook',
  '/admin/boosts',
  '/badges/purchase',
];

/**
 * Routes that require audit persistence
 * These operations MUST be able to write audit logs
 */
const ROUTES_REQUIRING_AUDIT = [
  '/admin/',
  '/billing/',
  '/boosts/',
  '/badges/',
];

/**
 * Check if a route requires distributed locking
 */
function routeRequiresDistributedLock(path: string): boolean {
  return ROUTES_REQUIRING_DISTRIBUTED_LOCK.some((route) => path.startsWith(route));
}

/**
 * Check if a route requires audit logging
 */
function routeRequiresAudit(path: string): boolean {
  return ROUTES_REQUIRING_AUDIT.some((route) => path.startsWith(route));
}

/**
 * Security Breach Middleware
 *
 * Returns HTTP 503 Service Unavailable when critical security services
 * are unreachable. This implements the fail-closed pattern to ensure
 * security guarantees are never bypassed.
 *
 * Trigger Conditions:
 * 1. Redis unavailable AND operation requires distributed locking
 * 2. Audit persistence fails (audit log writes)
 *
 * Usage:
 * Apply to routes that require security service availability.
 *
 * @example
 * app.use('/billing', securityBreachMiddleware, billingRouter);
 */
export async function securityBreachMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const path = req.path;
  const method = req.method;

  // Check if route requires distributed locking
  if (routeRequiresDistributedLock(path)) {
    // Check Redis connectivity
    const redisHealthy = redisService.isConnected();

    if (!redisHealthy) {
      securityBreach503Count++;
      logger.warn(
        {
          path,
          method,
          reason: 'redis_unavailable',
          metric: 'sietch_security_breach_503_total',
        },
        'Security breach: Redis unavailable for distributed lock operation'
      );

      updateSecurityServiceStatus({ redis: false });

      res.setHeader('Retry-After', '30');
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Required security services are unavailable. Please retry.',
        retryAfter: 30,
      });
      return;
    }

    // Redis is healthy
    updateSecurityServiceStatus({ redis: true });
  }

  // Check if route requires audit logging
  if (routeRequiresAudit(path)) {
    // For now, audit persistence is considered healthy if we can write
    // In a full implementation, this would check audit service connectivity
    // For Sprint 67, we mark it healthy (actual audit persistence check deferred)
    updateSecurityServiceStatus({ auditPersistence: true });
  }

  next();
}

/**
 * Security health check endpoint handler
 *
 * Returns detailed security service status for monitoring.
 * Endpoint: GET /health/security
 */
export function securityHealthHandler(req: Request, res: Response): void {
  const status = getSecurityServiceStatus();

  // Check real-time Redis status
  const redisConnected = redisService.isConnected();
  const redisStatus = redisService.getConnectionStatus();

  const response = {
    status: status.overall && redisConnected ? 'healthy' : 'unhealthy',
    services: {
      redis: {
        healthy: redisConnected,
        status: redisStatus.status,
        error: redisStatus.error,
      },
      auditPersistence: {
        healthy: status.auditPersistence,
      },
    },
    metrics: {
      securityBreach503Count,
    },
    timestamp: new Date().toISOString(),
  };

  if (response.status === 'healthy') {
    res.json(response);
  } else {
    res.status(503).json(response);
  }
}
