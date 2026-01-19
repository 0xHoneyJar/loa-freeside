/**
 * Security Headers Middleware
 *
 * Sprint 136: Security Hardening
 *
 * Provides security-related HTTP headers and request tracking.
 *
 * Features:
 * - LOW-001: Correlation ID generation for audit logging
 * - LOW-002: Content Security Policy headers
 *
 * @module api/middleware/securityHeaders
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Request with correlation ID for audit logging
 */
export interface TrackedRequest extends Request {
  /** Unique request correlation ID for log tracing */
  correlationId: string;
}

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  /** Enable Content-Security-Policy header */
  enableCSP?: boolean;
  /** CSP directives (only used if enableCSP is true) */
  cspDirectives?: Record<string, string[]>;
  /** Enable X-Request-ID/correlation ID tracking */
  enableCorrelationId?: boolean;
  /** Enable X-Content-Type-Options: nosniff */
  enableNoSniff?: boolean;
  /** Enable X-Frame-Options */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Enable Referrer-Policy */
  referrerPolicy?: string | false;
}

// =============================================================================
// Constants
// =============================================================================

/** Header name for correlation ID */
export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Default CSP directives
 *
 * Conservative policy suitable for dashboard APIs.
 * Frontend may need different settings.
 */
const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'https://discord.com'],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
};

/**
 * Default security headers configuration
 */
const DEFAULT_CONFIG: Required<SecurityHeadersConfig> = {
  enableCSP: true,
  cspDirectives: DEFAULT_CSP_DIRECTIVES,
  enableCorrelationId: true,
  enableNoSniff: true,
  frameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique correlation ID
 */
function generateCorrelationId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Build CSP header value from directives
 */
function buildCSPHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create security headers middleware
 *
 * @param config - Security headers configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Use default configuration
 * app.use(createSecurityHeadersMiddleware());
 *
 * // Custom configuration
 * app.use(createSecurityHeadersMiddleware({
 *   enableCSP: false, // Disable CSP for API routes
 *   enableCorrelationId: true,
 * }));
 * ```
 */
export function createSecurityHeadersMiddleware(
  config: SecurityHeadersConfig = {}
): (req: Request, res: Response, next: NextFunction) => void {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Pre-build CSP header for performance
  const cspHeader = mergedConfig.enableCSP
    ? buildCSPHeader(mergedConfig.cspDirectives)
    : null;

  return (req: Request, res: Response, next: NextFunction) => {
    // LOW-001: Correlation ID for audit logging
    if (mergedConfig.enableCorrelationId) {
      // Use existing header if provided (e.g., from load balancer)
      const existingId = req.headers[CORRELATION_ID_HEADER] as string | undefined;
      const correlationId = existingId || generateCorrelationId();

      (req as TrackedRequest).correlationId = correlationId;
      res.setHeader(CORRELATION_ID_HEADER, correlationId);

      // Attach to logger context for this request
      // This enables correlation across all log entries for this request
      logger.debug({
        correlationId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }, 'Request started');
    }

    // LOW-002: Content Security Policy
    if (cspHeader) {
      res.setHeader('Content-Security-Policy', cspHeader);
    }

    // Additional security headers
    if (mergedConfig.enableNoSniff) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    if (mergedConfig.frameOptions) {
      res.setHeader('X-Frame-Options', mergedConfig.frameOptions);
    }

    if (mergedConfig.referrerPolicy) {
      res.setHeader('Referrer-Policy', mergedConfig.referrerPolicy);
    }

    // Prevent caching of API responses by default
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    next();
  };
}

/**
 * Get correlation ID from request
 *
 * @param req - Express request object
 * @returns Correlation ID or undefined if not tracked
 */
export function getCorrelationId(req: Request): string | undefined {
  return (req as TrackedRequest).correlationId;
}

/**
 * Get client IP address from request
 *
 * Handles proxied requests via X-Forwarded-For header.
 *
 * @param req - Express request object
 * @returns Client IP address
 */
export function getClientIp(req: Request): string {
  // Check X-Forwarded-For header (from proxies/load balancers)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP (original client)
    const ips = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0];
    return ips?.trim() ?? 'unknown';
  }

  return req.ip || 'unknown';
}

// =============================================================================
// Pre-configured Middleware Instances
// =============================================================================

/**
 * Default security headers middleware with all features enabled
 */
export const securityHeaders = createSecurityHeadersMiddleware();

/**
 * API-only security headers (no CSP, for JSON APIs)
 */
export const apiSecurityHeaders = createSecurityHeadersMiddleware({
  enableCSP: false, // APIs return JSON, not HTML
  enableCorrelationId: true,
  enableNoSniff: true,
  frameOptions: 'DENY',
});
