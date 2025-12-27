import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { validateApiKey } from '../config.js';

/**
 * Extended Request type with admin context
 */
export interface AuthenticatedRequest extends Request {
  adminName?: string;
  apiKeyId?: string;
}

/**
 * Extended Request type with raw body for webhook signature verification
 * Used by routes that need to verify signatures (e.g., Stripe webhooks)
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
 * API key authentication middleware for admin endpoints
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
