/**
 * Dashboard Authentication Middleware
 *
 * Sprint 115: Session & Auth Middleware
 *
 * Provides authentication middleware for dashboard API endpoints.
 *
 * Middleware Stack (for write operations):
 * 1. requireDashboardAuth - Validates session cookie
 * 2. liveAdminCheck - Re-verifies Discord admin status
 *
 * @module api/middleware/dashboardAuth
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';
import {
  getSession,
  storeSession,
  SESSION_COOKIE_NAME,
  hasAdminPermissions,
  type DashboardSession,
} from '../routes/dashboard/auth.routes.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Request with authenticated dashboard session
 */
export interface AuthenticatedDashboardRequest extends Request {
  dashboardSession: DashboardSession;
  serverId?: string;
}

/**
 * Redis interface for session management
 * Sprint 133 (HIGH-003): Added setNX for distributed locking
 */
export interface DashboardAuthRedis {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number; NX?: boolean }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
}

/**
 * Dependencies for dashboard auth middleware
 */
export interface DashboardAuthMiddlewareDeps {
  redis?: DashboardAuthRedis;
  guildId: string;
}

// =============================================================================
// Constants
// =============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Sprint 135 (MED-005): Reduced TTL for admin check cache
 *
 * Previously 5 minutes, now 90 seconds to balance performance vs security.
 * This allows faster response to Discord permission changes while still
 * reducing API load.
 */
const LIVE_ADMIN_CHECK_TTL = 90 * 1000; // 90 seconds (was 5 minutes)

/**
 * Sprint 135 (MED-004): Maximum entries in admin check cache
 * Prevents unbounded memory growth
 */
const LIVE_ADMIN_CHECK_MAX_ENTRIES = 1000;

/**
 * Admin check cache entry
 */
interface AdminCheckCacheEntry {
  isAdmin: boolean;
  checkedAt: number;
  /** Sprint 135 (MED-004): Last access time for LRU eviction */
  lastAccessedAt: number;
}

/**
 * Cache live admin check results
 * Sprint 135 (MED-004): Now with LRU eviction support
 */
const LIVE_ADMIN_CHECK_CACHE = new Map<string, AdminCheckCacheEntry>();

// =============================================================================
// Sprint 133 (HIGH-003): Session Refresh Distributed Locking
// =============================================================================

/** Session refresh lock TTL in seconds */
const SESSION_REFRESH_LOCK_TTL = 30;

/** Session refresh lock key prefix */
const SESSION_REFRESH_LOCK_PREFIX = 'session:refresh:lock:';

/** Maximum retry attempts for acquiring lock */
const SESSION_REFRESH_LOCK_RETRIES = 3;

/** Retry delay in milliseconds (with exponential backoff) */
const SESSION_REFRESH_LOCK_RETRY_DELAY = 100;

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create dashboard authentication middleware
 */
export function createDashboardAuthMiddleware(deps: DashboardAuthMiddlewareDeps) {
  const { redis, guildId } = deps;

  /**
   * Require authenticated dashboard session
   *
   * Validates the session cookie and attaches session to request.
   * Returns 401 if not authenticated.
   *
   * @example
   * router.get('/config', requireDashboardAuth, handler);
   */
  async function requireDashboardAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sessionId = req.cookies[SESSION_COOKIE_NAME];

      if (!sessionId) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
        return;
      }

      const session = await getSession(sessionId, redis);

      if (!session) {
        // Clear invalid cookie
        res.clearCookie(SESSION_COOKIE_NAME);
        res.status(401).json({
          error: 'SESSION_EXPIRED',
          message: 'Session expired. Please log in again.',
        });
        return;
      }

      // Check if session is too old (24 hours)
      const sessionAge = Date.now() - session.createdAt;
      const maxAge = 24 * 60 * 60 * 1000;

      if (sessionAge > maxAge) {
        res.clearCookie(SESSION_COOKIE_NAME);
        res.status(401).json({
          error: 'SESSION_EXPIRED',
          message: 'Session expired. Please log in again.',
        });
        return;
      }

      // Update last activity
      session.lastActivity = Date.now();
      await storeSession(sessionId, session, redis);

      // Attach session to request
      (req as AuthenticatedDashboardRequest).dashboardSession = session;

      next();
    } catch (error) {
      logger.error({ error }, 'Dashboard auth middleware error');
      res.status(500).json({
        error: 'AUTH_ERROR',
        message: 'Authentication check failed',
      });
    }
  }

  /**
   * Sprint 135 (MED-004): Evict least recently used admin check cache entries
   */
  function evictAdminCheckCacheLRU(): void {
    const evictCount = Math.max(1, Math.floor(LIVE_ADMIN_CHECK_MAX_ENTRIES * 0.1));

    const entries = Array.from(LIVE_ADMIN_CHECK_CACHE.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    for (let i = 0; i < evictCount && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        LIVE_ADMIN_CHECK_CACHE.delete(entry[0]);
      }
    }

    logger.debug(
      { evicted: Math.min(evictCount, entries.length), remaining: LIVE_ADMIN_CHECK_CACHE.size },
      'Admin check cache LRU eviction'
    );
  }

  /**
   * Live admin check middleware
   *
   * Re-verifies that the user still has admin permissions in Discord.
   * Should be used for write operations to prevent stale permission usage.
   *
   * Sprint 135 (MED-005): Reduced TTL from 5 minutes to 90 seconds
   * Sprint 135 (MED-004): Added LRU eviction for memory protection
   *
   * @example
   * router.post('/config', requireDashboardAuth, liveAdminCheck, handler);
   */
  async function liveAdminCheck(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dashboardReq = req as AuthenticatedDashboardRequest;
      const { dashboardSession } = dashboardReq;

      if (!dashboardSession) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
        return;
      }

      const serverId = req.params.serverId || guildId;
      const cacheKey = `${dashboardSession.userId}:${serverId}`;
      const now = Date.now();

      // Check cache first
      const cached = LIVE_ADMIN_CHECK_CACHE.get(cacheKey);
      if (cached && now - cached.checkedAt < LIVE_ADMIN_CHECK_TTL) {
        // Sprint 135 (MED-004): Update last accessed time for LRU
        cached.lastAccessedAt = now;

        if (!cached.isAdmin) {
          res.status(403).json({
            error: 'PERMISSION_REVOKED',
            message: 'You no longer have admin access to this server',
          });
          return;
        }
        dashboardReq.serverId = serverId;
        return next();
      }

      // Fetch current guild membership
      const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: {
          Authorization: `Bearer ${dashboardSession.accessToken}`,
        },
      });

      if (!response.ok) {
        // Token might be expired
        if (response.status === 401) {
          res.status(401).json({
            error: 'TOKEN_EXPIRED',
            message: 'Discord token expired. Please log in again.',
          });
          return;
        }
        throw new Error(`Discord API error: ${response.status}`);
      }

      interface GuildResponse {
        id: string;
        permissions: string;
      }

      const guilds = (await response.json()) as GuildResponse[];
      const targetGuild = guilds.find((g) => g.id === serverId);

      const isAdmin = targetGuild ? hasAdminPermissions(targetGuild.permissions) : false;

      // Sprint 135 (MED-004): Check if we need to evict before adding new entry
      if (!cached && LIVE_ADMIN_CHECK_CACHE.size >= LIVE_ADMIN_CHECK_MAX_ENTRIES) {
        evictAdminCheckCacheLRU();
      }

      // Update cache with LRU tracking
      LIVE_ADMIN_CHECK_CACHE.set(cacheKey, {
        isAdmin,
        checkedAt: now,
        lastAccessedAt: now,
      });

      if (!isAdmin) {
        logger.warn(
          { userId: dashboardSession.userId, serverId },
          'Live admin check failed - permission revoked'
        );
        res.status(403).json({
          error: 'PERMISSION_REVOKED',
          message: 'You no longer have admin access to this server',
        });
        return;
      }

      dashboardReq.serverId = serverId;
      next();
    } catch (error) {
      logger.error({ error }, 'Live admin check error');
      res.status(500).json({
        error: 'ADMIN_CHECK_ERROR',
        message: 'Failed to verify admin permissions',
      });
    }
  }

  /**
   * Invalidate live admin check cache for a user
   */
  function invalidateAdminCheckCache(userId: string, serverId?: string): void {
    if (serverId) {
      LIVE_ADMIN_CHECK_CACHE.delete(`${userId}:${serverId}`);
    } else {
      // Clear all entries for user
      for (const key of LIVE_ADMIN_CHECK_CACHE.keys()) {
        if (key.startsWith(`${userId}:`)) {
          LIVE_ADMIN_CHECK_CACHE.delete(key);
        }
      }
    }
  }

  /**
   * Acquire a distributed lock for session refresh
   * Sprint 133 (HIGH-003): Prevents race conditions during token refresh
   *
   * @returns Lock ID if acquired, null if lock is held by another process
   */
  async function acquireSessionRefreshLock(sessionId: string): Promise<string | null> {
    if (!redis) {
      // No Redis, return dummy lock (no distributed locking)
      return 'no-redis-lock';
    }

    const lockKey = `${SESSION_REFRESH_LOCK_PREFIX}${sessionId}`;
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (let attempt = 0; attempt < SESSION_REFRESH_LOCK_RETRIES; attempt++) {
      // Try to acquire lock with SET NX EX
      const result = await redis.set(lockKey, lockId, {
        EX: SESSION_REFRESH_LOCK_TTL,
        NX: true,
      });

      if (result !== null) {
        return lockId;
      }

      // Wait with exponential backoff before retry
      const delay = SESSION_REFRESH_LOCK_RETRY_DELAY * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    logger.debug({ sessionId }, 'Failed to acquire session refresh lock');
    return null;
  }

  /**
   * Release a distributed lock for session refresh
   * Sprint 133 (HIGH-003): Only releases if we still hold the lock
   */
  async function releaseSessionRefreshLock(sessionId: string, lockId: string): Promise<void> {
    if (!redis || lockId === 'no-redis-lock') {
      return;
    }

    const lockKey = `${SESSION_REFRESH_LOCK_PREFIX}${sessionId}`;

    // Only delete if we hold the lock (compare lock ID)
    const currentLock = await redis.get(lockKey);
    if (currentLock === lockId) {
      await redis.del(lockKey);
    }
  }

  /**
   * Session refresh middleware
   *
   * Extends session on activity. Optionally refreshes Discord token
   * if it's close to expiry.
   *
   * Sprint 133 (HIGH-003): Uses distributed locking to prevent race conditions
   */
  async function sessionRefresh(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dashboardReq = req as AuthenticatedDashboardRequest;
      const { dashboardSession } = dashboardReq;

      if (!dashboardSession) {
        return next();
      }

      const sessionId = req.cookies[SESSION_COOKIE_NAME];
      if (!sessionId) {
        return next();
      }

      // Update last activity timestamp
      dashboardSession.lastActivity = Date.now();

      // Check if Discord token needs refresh (within 30 minutes of expiry)
      const refreshThreshold = 30 * 60 * 1000;
      const shouldRefreshToken =
        dashboardSession.tokenExpiresAt - Date.now() < refreshThreshold;

      if (shouldRefreshToken) {
        // Sprint 133 (HIGH-003): Acquire distributed lock before token refresh
        const lockId = await acquireSessionRefreshLock(sessionId);

        if (lockId) {
          try {
            // Re-fetch session to check if another process already refreshed
            const currentSession = await getSession(sessionId, redis);

            if (currentSession && currentSession.tokenExpiresAt > dashboardSession.tokenExpiresAt) {
              // Another process already refreshed the token
              logger.debug({ userId: dashboardSession.userId }, 'Token already refreshed by another process');
              dashboardReq.dashboardSession = currentSession;
            } else {
              // Perform the refresh
              await refreshDiscordToken(dashboardSession);
              // Save updated session
              await storeSession(sessionId, dashboardSession, redis);
            }
          } catch (error) {
            // Log but don't fail the request - token refresh will be retried
            logger.warn({ error, userId: dashboardSession.userId }, 'Token refresh failed');
          } finally {
            // Always release the lock
            await releaseSessionRefreshLock(sessionId, lockId);
          }
        } else {
          logger.debug({ userId: dashboardSession.userId }, 'Skipping token refresh - lock held by another process');
        }
      } else {
        // Just save the updated last activity
        await storeSession(sessionId, dashboardSession, redis);
      }

      next();
    } catch (error) {
      logger.error({ error }, 'Session refresh error');
      // Don't fail the request on refresh errors
      next();
    }
  }

  /**
   * Refresh Discord access token
   */
  async function refreshDiscordToken(session: DashboardSession): Promise<void> {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing Discord credentials');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    interface TokenResponse {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }

    const tokens = (await response.json()) as TokenResponse;

    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.tokenExpiresAt = Date.now() + tokens.expires_in * 1000;

    logger.debug({ userId: session.userId }, 'Discord token refreshed');
  }

  return {
    requireDashboardAuth,
    requireServerAccess: liveAdminCheck, // Alias for route compatibility
    liveAdminCheck,
    sessionRefresh,
    invalidateAdminCheckCache,
  };
}

// =============================================================================
// Exports
// =============================================================================

export type DashboardAuthMiddleware = ReturnType<typeof createDashboardAuthMiddleware>;
