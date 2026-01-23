/**
 * Local Authentication Routes (Gom Jabbar)
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Implements username/password authentication for CLI and dashboard.
 * Separate from Discord OAuth - provides local user authentication.
 *
 * Endpoints:
 * - POST /api/auth/login - Authenticate user
 * - POST /api/auth/logout - Invalidate session
 * - GET /api/auth/me - Get current user info
 * - POST /api/auth/refresh - Refresh session
 *
 * @see grimoires/loa/sdd.md §13. User Management System
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getAuthService, type LoginRequest, type SessionType } from '../../services/auth/index.js';
import { authRateLimiter, strictAuthRateLimiter } from '../middleware.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Request with auth context
 */
export interface AuthenticatedRequest extends Request {
  authContext?: {
    userId: string;
    username: string;
    roles: string[];
    sandboxAccess: string[];
    sessionId: string;
  };
}

// =============================================================================
// Validation Schemas
// =============================================================================

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
  sessionType: z.enum(['cli', 'dashboard']),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract client IP from request
 */
function getClientIp(req: Request): string | undefined {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    const parts = xForwardedFor.split(',');
    const firstPart = parts[0];
    return firstPart ? firstPart.trim() : undefined;
  }
  return req.socket.remoteAddress;
}

/**
 * Extract bearer token from request
 */
function getBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }
  return authHeader.substring(7);
}

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create local authentication routes
 */
export function createAuthRouter(): Router {
  const router = Router();
  const authService = getAuthService();

  /**
   * POST /api/auth/login
   *
   * Authenticate user with username/password
   *
   * Sprint 10 (HIGH-1): Rate limited to prevent brute force attacks
   * - 10 requests per minute per IP (authRateLimiter)
   * - 5 failed attempts per 15 minutes (strictAuthRateLimiter)
   */
  router.post('/login', authRateLimiter, strictAuthRateLimiter, async (req: Request, res: Response) => {
    try {
      // Validate request body
      const parseResult = loginSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        res.status(400).json({
          success: false,
          error: firstError?.message ?? 'Validation failed',
        });
        return;
      }

      const { username, password, sessionType } = parseResult.data;
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'];

      // Attempt login
      const loginRequest: LoginRequest = {
        username,
        password,
        sessionType: sessionType as SessionType,
        ipAddress,
        userAgent,
      };

      const result = await authService.login(loginRequest);

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: result.error,
          remainingAttempts: result.remainingAttempts,
          lockedUntil: result.lockedUntil?.toISOString(),
        });
        return;
      }

      // Success
      res.json({
        success: true,
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt?.toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Login endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/auth/logout
   *
   * Invalidate current session
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.json({ success: true, message: 'No session to invalidate' });
        return;
      }

      const ipAddress = getClientIp(req);
      const result = await authService.logout(token, ipAddress);

      res.json({
        success: result.success,
        error: result.error,
      });
    } catch (error) {
      logger.error({ error }, 'Logout endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/auth/me
   *
   * Get current user info from session token
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.status(401).json({
          success: false,
          error: 'Authorization required',
        });
        return;
      }

      const result = await authService.validateSession(token);

      if (!result.valid) {
        res.status(401).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        user: result.user,
        session: {
          id: result.session?.id,
          type: result.session?.sessionType,
          expiresAt: result.session?.expiresAt.toISOString(),
          lastActivityAt: result.session?.lastActivityAt.toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Me endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/auth/refresh
   *
   * Refresh session (extend expiry)
   */
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.status(401).json({
          success: false,
          error: 'Authorization required',
        });
        return;
      }

      const result = await authService.refreshSession(token);

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired session',
        });
        return;
      }

      res.json({
        success: true,
        newExpiresAt: result.newExpiresAt?.toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Refresh endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/auth/sessions
   *
   * List active sessions for current user
   */
  router.get('/sessions', async (req: Request, res: Response) => {
    try {
      const token = getBearerToken(req);

      if (!token) {
        res.status(401).json({
          success: false,
          error: 'Authorization required',
        });
        return;
      }

      // Validate session and get user
      const authResult = await authService.validateSession(token);

      if (!authResult.valid || !authResult.user) {
        res.status(401).json({
          success: false,
          error: authResult.error || 'Invalid session',
        });
        return;
      }

      // Get all sessions for user
      const sessions = authService.listUserSessions(authResult.user.id);

      res.json({
        success: true,
        sessions: sessions.map(s => ({
          id: s.id,
          sessionType: s.sessionType,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          lastActivityAt: s.lastActivityAt.toISOString(),
          isCurrent: s.id === authResult.session?.id,
        })),
      });
    } catch (error) {
      logger.error({ error }, 'Sessions endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * DELETE /api/auth/sessions/:sessionId
   *
   * Revoke a specific session
   */
  router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
      const token = getBearerToken(req);
      const sessionId = req.params.sessionId;

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: 'Session ID required',
        });
        return;
      }

      if (!token) {
        res.status(401).json({
          success: false,
          error: 'Authorization required',
        });
        return;
      }

      // Validate session and get user
      const authResult = await authService.validateSession(token);
      const user = authResult.user;

      if (!authResult.valid || !user) {
        res.status(401).json({
          success: false,
          error: authResult.error || 'Invalid session',
        });
        return;
      }

      const ipAddress = getClientIp(req);
      const result = await authService.revokeSessionById(sessionId, user.id, ipAddress);

      res.json({
        success: result.success,
      });
    } catch (error) {
      logger.error({ error }, 'Revoke session endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  return router;
}

// =============================================================================
// Middleware: Require Local Auth
// =============================================================================

/**
 * Middleware to require local authentication
 *
 * Validates bearer token and attaches auth context to request.
 */
export async function requireLocalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void
): Promise<void> {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Authorization required',
    });
    return;
  }

  const authService = getAuthService();
  const context = await authService.getAuthContext(token);

  if (!context) {
    res.status(401).json({
      success: false,
      error: 'Invalid or expired session',
    });
    return;
  }

  req.authContext = {
    userId: context.userId,
    username: context.username,
    roles: context.roles,
    sandboxAccess: context.sandboxAccess,
    sessionId: context.sessionId || '',
  };

  next();
}

/**
 * Middleware to require specific roles
 */
export function requireRoles(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: () => void): void => {
    if (!req.authContext) {
      res.status(401).json({
        success: false,
        error: 'Authorization required',
      });
      return;
    }

    const hasRole = roles.some(role => req.authContext!.roles.includes(role));

    if (!hasRole) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        requiredRoles: roles,
        yourRoles: req.authContext.roles,
      });
      return;
    }

    next();
  };
}

// =============================================================================
// API Key Verification (CRIT-3 Frontend Auth)
// =============================================================================

/**
 * GET /api/auth/verify
 *
 * Verify API key for frontend authentication.
 * SECURITY: Part of CRIT-3 frontend auth remediation.
 *
 * Uses x-api-key header (same as other API routes).
 *
 * Sprint 10 (HIGH-1): Rate limited to prevent brute force attacks
 * - 10 requests per minute per IP (authRateLimiter)
 * - 5 failed attempts per 15 minutes (strictAuthRateLimiter)
 *
 * @see grimoires/loa/a2a/audits/2026-01-21/SECURITY-AUDIT-REPORT.md
 * @see grimoires/loa/sprint-10-security.md
 */
export function addApiKeyVerifyRoute(router: Router): void {
  router.get('/verify', authRateLimiter, strictAuthRateLimiter, (req: Request, res: Response) => {
    // API key is validated by requireApiKey middleware before this route
    // If we reach here, the key is valid
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({
        success: false,
        error: 'API key required',
      });
      return;
    }

    // Check against environment variable
    const validApiKey = process.env.SIETCH_API_KEY ?? process.env.API_KEY;

    if (!validApiKey) {
      logger.warn('No API key configured - set SIETCH_API_KEY or API_KEY environment variable');
      res.status(500).json({
        success: false,
        error: 'Server misconfiguration',
      });
      return;
    }

    // Constant-time comparison to prevent timing attacks
    const isValid = apiKey.length === validApiKey.length &&
      apiKey.split('').every((char, i) => char === validApiKey[i]);

    if (!isValid) {
      res.status(403).json({
        success: false,
        error: 'Invalid API key',
      });
      return;
    }

    res.json({
      success: true,
      message: 'API key verified',
    });
  });
}

// =============================================================================
// Exports
// =============================================================================

export { createAuthRouter as default };
