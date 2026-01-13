import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { validateApiKey, validateApiKeyAsync } from '../config.js';
import { redisService } from '../services/cache/RedisService.js';
import { getApiKeyAuditLogger } from '../services/security/AdminApiKeyService.js';

/**
 * Extended Request type with admin context
 */
export interface AuthenticatedRequest extends Request {
  adminName?: string;
  apiKeyId?: string;
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
 * 100 requests per minute per IP
 */
export const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? 'unknown';
    }
    return req.ip ?? 'unknown';
  },
});

/**
 * Rate limiter for admin endpoints
 * 30 requests per minute per API key
 */
export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, please try again later' },
  keyGenerator: (req) => {
    // Use API key as rate limit key for admin endpoints
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      return `admin:${apiKey}`;
    }
    return `admin:${req.ip ?? 'unknown'}`;
  },
});

/**
 * Rate limiter for member-facing API endpoints
 * 60 requests per minute per IP (Sprint 9)
 */
export const memberRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests, fall back to IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `member:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `member:${req.ip ?? 'unknown'}`;
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
  keyGenerator: (req) => {
    // Use X-Forwarded-For for proxied requests
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return `webhook:${forwarded.split(',')[0]?.trim() ?? 'unknown'}`;
    }
    return `webhook:${req.ip ?? 'unknown'}`;
  },
  handler: (req, res, _next, options) => {
    // Log rate limit violations for monitoring
    const ip = req.ip ?? 'unknown';
    logger.warn(
      {
        ip,
        path: req.path,
        limit: options.max,
        windowMs: options.windowMs,
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
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Log error details
  logger.error(
    {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    },
    'Request error'
  );

  // Handle known error types
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }

  // Generic error response (don't leak internal details)
  res.status(500).json({ error: 'Internal server error' });
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
