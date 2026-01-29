/**
 * Verification Routes Module
 * Sprint 79: API Routes & Discord Integration - Native Wallet Verification
 *
 * Provides REST endpoints for the wallet verification flow:
 * - GET /verify/:sessionId - Get session info or serve verification page
 * - POST /verify/:sessionId - Submit signature for verification
 * - GET /verify/:sessionId/status - Poll verification status
 *
 * All endpoints require a valid session ID (UUID format).
 *
 * @security Sprint 79 Security Hardening:
 * - CRIT-1: Origin validation on POST (CSRF protection)
 * - CRIT-2: Rate limiting per session and IP
 * - CRIT-3: Discord username sanitization
 * - HIGH-1: IP-based rate limiting
 * - HIGH-2: Constant-time responses (timing attack mitigation)
 */

import { Router } from 'express';
import type { Response, Request, NextFunction } from 'express';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

import { logger } from '../../utils/logger.js';
import { ValidationError, NotFoundError } from '../middleware.js';
import { config } from '../../config.js';

// =============================================================================
// Security Constants
// =============================================================================

/**
 * Minimum response time in ms for constant-time responses (timing attack mitigation)
 */
const MIN_RESPONSE_TIME_MS = 100;

/**
 * Safe Discord username regex - allows alphanumeric, spaces, dashes, underscores, dots
 * Max 32 characters per Discord's limit
 */
const SAFE_USERNAME_REGEX = /^[\w\s\-_.]{1,32}$/;

// =============================================================================
// Types
// =============================================================================

/**
 * Verification session response
 */
interface VerificationSessionResponse {
  sessionId: string;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  message?: string;
  expiresAt: string;
  attemptsRemaining: number;
  discordUsername: string;
  walletAddress?: string;
  completedAt?: string;
}

/**
 * Signature submission response
 */
interface VerifySignatureResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  walletAddress?: string;
  sessionStatus: string;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Session ID parameter validation
 */
const sessionIdSchema = z.string().uuid('Invalid session ID format');

/**
 * Signature submission body validation
 */
const submitSignatureSchema = z.object({
  signature: z
    .string()
    .regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format (must be 0x-prefixed 65-byte hex)')
    .transform((s) => s as Hex),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid wallet address format')
    .transform((s) => s.toLowerCase() as Address),
});

// =============================================================================
// Security Helpers
// =============================================================================

/**
 * Parse hostname from URL safely
 *
 * @param urlString - URL string to parse
 * @returns hostname or null if invalid
 */
function parseHostname(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validate origin for CSRF protection (CRIT-1)
 *
 * Checks that the Origin or Referer header matches the expected base URL.
 * Uses proper URL parsing to prevent subdomain attacks (e.g., evil.com pretending
 * to be api.arrakis.community.evil.com).
 *
 * @param req - Express request
 * @param hostname - Request hostname for fallback
 * @returns true if origin is valid, false otherwise
 */
function validateOrigin(req: Request, hostname: string): boolean {
  const origin = req.get('origin') || req.get('referer');

  // Require origin header for POST requests
  if (!origin) {
    return false;
  }

  // Parse the origin hostname
  const originHostname = parseHostname(origin);
  if (!originHostname) {
    return false;
  }

  // Build list of expected hostnames
  const expectedHostnames: string[] = [];

  // Sprint 81 (HIGH-2): Use validated config instead of direct env var access
  const verifyBaseUrl = config.verification.baseUrl;
  if (verifyBaseUrl) {
    const baseHostname = parseHostname(verifyBaseUrl);
    if (baseHostname) {
      expectedHostnames.push(baseHostname);
    }
  }

  // Add request hostname (for same-origin requests)
  expectedHostnames.push(hostname.toLowerCase());

  // Check if origin hostname exactly matches any expected hostname
  // This prevents subdomain attacks like api.arrakis.community.evil.com
  return expectedHostnames.some((expected) => originHostname === expected);
}

/**
 * Sanitize Discord username for safe display (CRIT-3)
 *
 * Validates that the username only contains safe characters.
 * Returns a sanitized version or a fallback.
 *
 * @param username - Raw Discord username
 * @returns Sanitized username
 */
function sanitizeUsername(username: string): string {
  if (!username || typeof username !== 'string') {
    return 'Unknown User';
  }

  // Check against safe pattern
  if (SAFE_USERNAME_REGEX.test(username)) {
    return username;
  }

  // Strip potentially dangerous characters
  const sanitized = username.replace(/[^\w\s\-_.]/g, '').slice(0, 32);
  return sanitized || 'Unknown User';
}

/**
 * Hash IP address for privacy-compliant logging (LOW-1)
 *
 * @param ip - Raw IP address
 * @returns Hashed IP (first 16 chars of SHA-256)
 */
function hashIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Ensure constant-time response to prevent timing attacks (HIGH-2)
 *
 * Pads the response time to a minimum threshold to prevent
 * attackers from inferring valid session IDs via timing.
 *
 * @param startTime - Timestamp when processing started
 */
async function ensureConstantTime(startTime: number): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_RESPONSE_TIME_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_TIME_MS - elapsed));
  }
}

/**
 * Create rate limiters for verification endpoints (HIGH-1, CRIT-2)
 */
function createRateLimiters() {
  // Per-IP rate limiter: 100 requests per 15 minutes
  const ipRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
    skip: () => process.env.NODE_ENV === 'test', // Skip in tests
  });

  // Per-session rate limiter: 10 requests per 5 minutes per session
  const sessionRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    message: { error: 'Too many requests for this session' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.params.sessionId || 'unknown',
    skip: () => process.env.NODE_ENV === 'test', // Skip in tests
  });

  // Strict rate limiter for POST (signature submission): 3 per minute per IP
  const postRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 3,
    message: { error: 'Too many verification attempts, please wait' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
    skip: () => process.env.NODE_ENV === 'test', // Skip in tests
  });

  return { ipRateLimiter, sessionRateLimiter, postRateLimiter };
}

// =============================================================================
// Router Factory
// =============================================================================

/**
 * Create verification router with injected dependencies
 *
 * @param deps - Dependencies for the router
 * @returns Express router
 */
export function createVerifyRouter(deps: {
  getVerificationService: (communityId: string) => {
    getSession: (sessionId: string) => Promise<{
      id: string;
      status: string;
      discordUserId: string;
      discordUsername: string;
      walletAddress?: string;
      createdAt: Date;
      expiresAt: Date;
      completedAt?: Date;
      attempts: number;
      errorMessage?: string;
    } | null>;
    verifySignature: (params: {
      sessionId: string;
      signature: Hex;
      walletAddress: Address;
      ipAddress?: string;
      userAgent?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      errorCode?: string;
      walletAddress?: string;
      sessionStatus: string;
    }>;
  };
  getCommunityIdForSession: (sessionId: string) => Promise<string | null>;
  getSigningMessage: (sessionId: string) => Promise<string | null>;
  maxAttempts?: number;
}): Router {
  const router = Router();
  const MAX_ATTEMPTS = deps.maxAttempts ?? 3;

  // Create rate limiters (HIGH-1, CRIT-2)
  const { ipRateLimiter, sessionRateLimiter, postRateLimiter } = createRateLimiters();

  // Apply IP-based rate limiting to all routes
  router.use(ipRateLimiter);

  // Get __dirname equivalent for ESM
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  /**
   * GET /verify/:sessionId
   * Returns session data as JSON or serves verification HTML page
   *
   * Query params:
   * - format=json - Force JSON response
   * - format=html - Force HTML response (default for browsers)
   *
   * @security
   * - Rate limited per session (CRIT-2)
   * - Constant-time responses (HIGH-2)
   * - Username sanitization (CRIT-3)
   */
  router.get('/:sessionId', sessionRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Validate session ID
      const parseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!parseResult.success) {
        await ensureConstantTime(startTime);
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = parseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        await ensureConstantTime(startTime);
        throw new NotFoundError('Session not found');
      }

      // Get verification service for this community
      const service = deps.getVerificationService(communityId);
      const session = await service.getSession(sessionId);

      if (!session) {
        await ensureConstantTime(startTime);
        throw new NotFoundError('Session not found');
      }

      // Determine response format
      const format = req.query.format as string | undefined;
      const acceptsHtml = req.accepts('html');
      const wantsJson = format === 'json' || (!format && !acceptsHtml);

      if (wantsJson) {
        // Return JSON response with sanitized username (CRIT-3)
        const response: VerificationSessionResponse = {
          sessionId: session.id,
          status: session.status as VerificationSessionResponse['status'],
          expiresAt: session.expiresAt.toISOString(),
          attemptsRemaining: Math.max(0, MAX_ATTEMPTS - session.attempts),
          discordUsername: sanitizeUsername(session.discordUsername),
          walletAddress: session.walletAddress,
          completedAt: session.completedAt?.toISOString(),
        };

        // Add signing message for pending sessions
        if (session.status === 'pending') {
          const message = await deps.getSigningMessage(sessionId);
          if (message) {
            response.message = message;
          }
        }

        await ensureConstantTime(startTime);
        res.json(response);
      } else {
        // Serve HTML verification page
        // The page will fetch session data via API
        const staticPath = path.resolve(__dirname, '../../static/verify.html');
        await ensureConstantTime(startTime);

        // Set permissive CSP for verification page (allows inline scripts for wallet connection)
        // This overrides the global restrictive CSP from securityHeaders middleware
        res.setHeader(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' wss: https:",
            "img-src 'self' data: https:",
            "frame-src 'self' https:",
          ].join('; ')
        );

        res.sendFile(staticPath);
      }
    } catch (error) {
      await ensureConstantTime(startTime);
      next(error);
    }
  });

  /**
   * POST /verify/:sessionId
   * Submit a signature for verification
   *
   * @security
   * - Origin validation for CSRF protection (CRIT-1)
   * - Rate limited per IP (postRateLimiter)
   * - Constant-time responses (HIGH-2)
   * - IP hashing for privacy (LOW-1)
   * - Generic error messages (LOW-2)
   */
  router.post('/:sessionId', postRateLimiter, sessionRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // CRIT-1: Validate origin for CSRF protection
      if (!validateOrigin(req, req.hostname)) {
        logger.warn(
          { origin: req.get('origin'), referer: req.get('referer'), ipHash: hashIp(req.ip) },
          'CSRF protection: Invalid request origin'
        );
        await ensureConstantTime(startTime);
        throw new ValidationError('Invalid request origin');
      }

      // Validate session ID
      const sessionParseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!sessionParseResult.success) {
        await ensureConstantTime(startTime);
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = sessionParseResult.data;

      // Validate request body
      const bodyParseResult = submitSignatureSchema.safeParse(req.body);
      if (!bodyParseResult.success) {
        const errors = bodyParseResult.error.errors.map((e) => e.message).join(', ');
        await ensureConstantTime(startTime);
        throw new ValidationError(`Invalid request body: ${errors}`);
      }
      const { signature, walletAddress } = bodyParseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        await ensureConstantTime(startTime);
        throw new NotFoundError('Session not found');
      }

      // Get verification service and verify signature
      // LOW-1: Hash IP for privacy-compliant logging
      const service = deps.getVerificationService(communityId);
      const result = await service.verifySignature({
        sessionId,
        signature,
        walletAddress,
        ipAddress: hashIp(req.ip), // Hashed for privacy
        userAgent: req.get('User-Agent'),
      });

      // Log with hashed IP
      logger.info(
        {
          sessionId,
          success: result.success,
          errorCode: result.errorCode,
          walletAddress: result.walletAddress,
          ipHash: hashIp(req.ip),
        },
        'Verification attempt'
      );

      // LOW-2: Use generic error messages externally, detailed logging internally
      let response: VerifySignatureResponse;
      let statusCode: number;

      if (result.success) {
        response = {
          success: true,
          walletAddress: result.walletAddress,
          sessionStatus: result.sessionStatus,
        };
        statusCode = 200;
      } else {
        // Log detailed error internally
        logger.warn(
          { sessionId, errorCode: result.errorCode, error: result.error },
          'Verification failed'
        );

        // Return generic error externally
        response = {
          success: false,
          error: 'Verification failed. Please check your wallet and try again.',
          sessionStatus: result.sessionStatus,
        };

        // Determine status code based on error type
        if (result.errorCode === 'SESSION_NOT_FOUND') {
          statusCode = 404;
        } else if (result.errorCode === 'MAX_ATTEMPTS_EXCEEDED') {
          statusCode = 429;
        } else {
          statusCode = 400;
        }
      }

      await ensureConstantTime(startTime);
      res.status(statusCode).json(response);
    } catch (error) {
      await ensureConstantTime(startTime);
      next(error);
    }
  });

  /**
   * GET /verify/:sessionId/status
   * Poll verification status (lightweight endpoint for polling)
   *
   * @security
   * - Rate limited per session (CRIT-2)
   * - Constant-time responses (HIGH-2)
   */
  router.get('/:sessionId/status', sessionRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Validate session ID
      const parseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!parseResult.success) {
        await ensureConstantTime(startTime);
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = parseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        await ensureConstantTime(startTime);
        throw new NotFoundError('Session not found');
      }

      // Get verification service
      const service = deps.getVerificationService(communityId);
      const session = await service.getSession(sessionId);

      if (!session) {
        await ensureConstantTime(startTime);
        throw new NotFoundError('Session not found');
      }

      // Return minimal status response
      await ensureConstantTime(startTime);
      res.json({
        status: session.status,
        walletAddress: session.walletAddress,
        completedAt: session.completedAt?.toISOString(),
      });
    } catch (error) {
      await ensureConstantTime(startTime);
      next(error);
    }
  });

  return router;
}

/**
 * Export router type for testing
 */
export type VerifyRouter = ReturnType<typeof createVerifyRouter>;
