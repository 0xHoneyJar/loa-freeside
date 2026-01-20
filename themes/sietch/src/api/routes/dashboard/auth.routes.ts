/**
 * Dashboard Authentication Routes
 *
 * Sprint 114: Authentication Core
 * Sprint 144: Dashboard Login Integration
 *
 * Implements Discord OAuth2 authentication flow with PKCE support for the
 * web configuration dashboard, plus username/password authentication for
 * QA testers and administrators.
 *
 * Features:
 * - Discord OAuth2 with PKCE (code verifier/challenge)
 * - Local username/password authentication (Sprint 144)
 * - Secure session cookie management
 * - User profile + guild fetching
 * - Admin guild filtering
 *
 * @module api/routes/dashboard/auth
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import { getCorrelationId, getClientIp } from '../../middleware/securityHeaders.js';
import { getAuthService } from '../../../services/auth/AuthService.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Discord OAuth2 token response
 */
interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Discord user profile
 */
interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

/**
 * Discord guild (partial)
 */
interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
  features: string[];
}

/**
 * Session data stored in cookie/Redis
 */
export interface DashboardSession {
  userId: string;
  username: string;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  adminGuilds: Array<{
    id: string;
    name: string;
    icon: string | null;
  }>;
  createdAt: number;
  lastActivity: number;
  /** Sprint 134 (MED-002): CSRF token for state-changing operations */
  csrfToken?: string;
}

/**
 * Request with dashboard session
 */
export interface DashboardAuthRequest extends Request {
  dashboardSession?: DashboardSession;
}

/**
 * Dependencies for dashboard auth routes
 */
export interface DashboardAuthDeps {
  /** Redis client for session storage */
  redis?: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
  };
  /** Discord bot's guild ID (the guild we're managing) */
  guildId: string;
}

// =============================================================================
// Configuration
// =============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const DISCORD_OAUTH_TOKEN = 'https://discord.com/api/oauth2/token';

/** OAuth2 scopes needed for dashboard */
const OAUTH_SCOPES = ['identify', 'guilds'].join(' ');

/** Session cookie configuration */
const SESSION_COOKIE_NAME = 'stilgar_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_TTL_SECONDS = 24 * 60 * 60;

/** Discord permission bit for Administrator */
const DISCORD_ADMIN_PERMISSION = BigInt(0x8);
/** Discord permission bit for Manage Guild */
const DISCORD_MANAGE_GUILD_PERMISSION = BigInt(0x20);

// =============================================================================
// Validation Schemas
// =============================================================================

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Sprint 144: Local login credentials schema
 */
const localLoginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8),
});

// =============================================================================
// PKCE Helpers
// =============================================================================

/**
 * Generate PKCE code verifier (43-128 characters)
 */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge from verifier (S256 method)
 */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate random state for CSRF protection
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// =============================================================================
// Discord API Helpers
// =============================================================================

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<DiscordTokenResponse> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(DISCORD_OAUTH_TOKEN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Discord token exchange failed');
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

/**
 * Fetch Discord user profile
 */
async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }

  return response.json() as Promise<DiscordUser>;
}

/**
 * Fetch user's guilds
 */
async function fetchUserGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch guilds: ${response.status}`);
  }

  return response.json() as Promise<DiscordGuild[]>;
}

/**
 * Check if user has admin permissions in guild
 */
function hasAdminPermissions(permissions: string): boolean {
  const perms = BigInt(permissions);
  return (
    (perms & DISCORD_ADMIN_PERMISSION) === DISCORD_ADMIN_PERMISSION ||
    (perms & DISCORD_MANAGE_GUILD_PERMISSION) === DISCORD_MANAGE_GUILD_PERMISSION
  );
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Sprint 134 (MED-001): Production mode check for session store
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * In-memory session store (fallback when Redis unavailable)
 *
 * WARNING: In-memory store should ONLY be used in development.
 * Production requires Redis for proper session persistence and scaling.
 */
const memorySessionStore = new Map<string, DashboardSession>();

/**
 * Track if we've warned about in-memory session usage in production
 */
let memorySessionWarningLogged = false;

/**
 * Store session data
 *
 * Sprint 134 (MED-001): Fail fast in production if Redis is unavailable.
 * In-memory sessions are not suitable for production as they:
 * - Don't persist across restarts
 * - Don't work with multiple instances
 * - Can cause memory leaks under load
 */
async function storeSession(
  sessionId: string,
  session: DashboardSession,
  redis?: DashboardAuthDeps['redis']
): Promise<void> {
  const serialized = JSON.stringify(session);

  if (redis) {
    await redis.set(`dashboard:session:${sessionId}`, serialized, {
      EX: SESSION_TTL_SECONDS,
    });
  } else {
    // Sprint 134 (MED-001): Fail in production without Redis
    if (IS_PRODUCTION) {
      logger.fatal('SESSION_STORE_ERROR: Redis is required for production session management');
      throw new Error(
        'Redis is required for production session management. ' +
          'Configure REDIS_URL environment variable or set FEATURE_REDIS_ENABLED=true.'
      );
    }

    // Log warning once in development
    if (!memorySessionWarningLogged) {
      logger.warn(
        'Using in-memory session store - sessions will not persist across restarts. ' +
          'Configure Redis for production use.'
      );
      memorySessionWarningLogged = true;
    }

    memorySessionStore.set(sessionId, session);
    // Schedule cleanup
    setTimeout(() => {
      memorySessionStore.delete(sessionId);
    }, SESSION_TTL_MS);
  }
}

/**
 * Retrieve session data
 */
async function getSession(
  sessionId: string,
  redis?: DashboardAuthDeps['redis']
): Promise<DashboardSession | null> {
  if (redis) {
    const data = await redis.get(`dashboard:session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  return memorySessionStore.get(sessionId) ?? null;
}

/**
 * Delete session data
 */
async function deleteSession(
  sessionId: string,
  redis?: DashboardAuthDeps['redis']
): Promise<void> {
  if (redis) {
    await redis.del(`dashboard:session:${sessionId}`);
  } else {
    memorySessionStore.delete(sessionId);
  }
}

// =============================================================================
// Sprint 134 (MED-002): CSRF Validation
// =============================================================================

/** CSRF token header name */
const CSRF_HEADER = 'x-csrf-token';

/**
 * Validate CSRF token from request header against session token
 *
 * Sprint 134 (MED-002): Protects state-changing operations from CSRF attacks.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @returns true if valid, false otherwise
 */
function validateCsrfToken(
  req: Request,
  session: DashboardSession
): boolean {
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!headerToken || !session.csrfToken) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  try {
    const tokenBuffer = Buffer.from(headerToken, 'utf-8');
    const sessionBuffer = Buffer.from(session.csrfToken, 'utf-8');

    // Lengths must match for timingSafeEqual
    if (tokenBuffer.length !== sessionBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(tokenBuffer, sessionBuffer);
  } catch {
    return false;
  }
}

// =============================================================================
// PKCE State Storage (temporary, for OAuth flow)
// =============================================================================

/**
 * Temporary storage for OAuth state (code verifier, etc.)
 * Uses memory with 10-minute expiry
 */
const oauthStateStore = new Map<
  string,
  {
    codeVerifier: string;
    redirectUrl?: string;
    expiresAt: number;
  }
>();

// Clean up expired states periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [state, data] of oauthStateStore) {
      if (data.expiresAt < now) {
        oauthStateStore.delete(state);
      }
    }
  },
  60 * 1000
); // Every minute

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create dashboard authentication routes
 */
export function createDashboardAuthRouter(deps: DashboardAuthDeps): Router {
  const router = Router();
  const { redis, guildId } = deps;

  /**
   * GET /api/dashboard/auth/discord
   *
   * Initiates Discord OAuth2 flow with PKCE
   *
   * Query params:
   * - redirect: URL to redirect after successful auth (optional)
   */
  router.get('/discord', (req: Request, res: Response) => {
    try {
      const clientId = process.env.DISCORD_CLIENT_ID;
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';

      if (!clientId) {
        logger.error('Missing DISCORD_CLIENT_ID');
        res.status(500).json({ error: 'OAuth not configured' });
        return;
      }

      // Generate PKCE values
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Store state with code verifier (10 minute expiry)
      oauthStateStore.set(state, {
        codeVerifier,
        redirectUrl: req.query.redirect as string | undefined,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      // Build redirect URI (must match Discord app settings)
      const redirectUri = `${dashboardUrl}/api/dashboard/auth/callback`;

      // Build authorization URL
      const authUrl = new URL(DISCORD_OAUTH_AUTHORIZE);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', OAUTH_SCOPES);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('prompt', 'consent');

      logger.debug({ state }, 'Initiating Discord OAuth flow');

      res.redirect(authUrl.toString());
    } catch (error) {
      logger.error({ error }, 'Failed to initiate OAuth flow');
      res.status(500).json({ error: 'Failed to initiate login' });
    }
  });

  /**
   * GET /api/dashboard/auth/callback
   *
   * OAuth2 callback handler - exchanges code for token
   */
  router.get('/callback', async (req: Request, res: Response) => {
    try {
      // Validate query params
      const parseResult = callbackQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        logger.warn({ query: req.query }, 'Invalid callback parameters');
        res.status(400).json({ error: 'Invalid callback parameters' });
        return;
      }

      const { code, state } = parseResult.data;
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';

      // Verify state and get code verifier
      const storedState = oauthStateStore.get(state);
      if (!storedState) {
        logger.warn({ state }, 'Invalid or expired OAuth state');
        res.status(400).json({ error: 'Invalid or expired state. Please try logging in again.' });
        return;
      }

      // Remove used state
      oauthStateStore.delete(state);

      // Check expiry
      if (storedState.expiresAt < Date.now()) {
        res.status(400).json({ error: 'OAuth state expired. Please try logging in again.' });
        return;
      }

      // Exchange code for token
      const redirectUri = `${dashboardUrl}/api/dashboard/auth/callback`;
      const tokens = await exchangeCodeForToken(code, storedState.codeVerifier, redirectUri);

      // Fetch user profile
      const user = await fetchDiscordUser(tokens.access_token);

      // Fetch user's guilds
      const guilds = await fetchUserGuilds(tokens.access_token);

      // Filter to guilds where user has admin permissions
      const adminGuilds = guilds.filter((g) => hasAdminPermissions(g.permissions));

      // Check if user has admin access to the target guild
      const hasTargetGuildAccess = adminGuilds.some((g) => g.id === guildId);

      if (!hasTargetGuildAccess) {
        // Sprint 136 (LOW-001): Enhanced audit logging for security events
        logger.warn(
          {
            userId: user.id,
            guildId,
            adminGuildIds: adminGuilds.map((g) => g.id),
            correlationId: getCorrelationId(req),
            clientIp: getClientIp(req),
          },
          'User does not have admin access to target guild'
        );
        // Redirect to login page with error
        const errorUrl = new URL('/login', dashboardUrl);
        errorUrl.searchParams.set('error', 'no_admin_access');
        res.redirect(errorUrl.toString());
        return;
      }

      // Create session
      // Sprint 134 (MED-002): Generate CSRF token for state-changing operations
      const sessionId = generateSessionId();
      const csrfToken = crypto.randomBytes(32).toString('hex');
      const session: DashboardSession = {
        userId: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        adminGuilds: adminGuilds.map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
        })),
        createdAt: Date.now(),
        lastActivity: Date.now(),
        csrfToken,
      };

      // Store session
      await storeSession(sessionId, session, redis);

      // Set session cookie
      res.cookie(SESSION_COOKIE_NAME, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });

      // Sprint 136 (LOW-001): Enhanced audit logging with correlation ID and IP
      logger.info(
        {
          userId: user.id,
          username: session.username,
          adminGuildCount: adminGuilds.length,
          correlationId: getCorrelationId(req),
          clientIp: getClientIp(req),
        },
        'Dashboard login successful'
      );

      // Redirect to dashboard or specified URL
      const redirectUrl = storedState.redirectUrl || '/dashboard';
      res.redirect(redirectUrl);
    } catch (error) {
      logger.error({ error }, 'OAuth callback failed');
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
      const errorUrl = new URL('/login', dashboardUrl);
      errorUrl.searchParams.set('error', 'auth_failed');
      res.redirect(errorUrl.toString());
    }
  });

  /**
   * POST /api/dashboard/auth/login
   *
   * Sprint 144: Local username/password authentication
   *
   * Authenticates QA testers and administrators using local credentials.
   */
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const parseResult = localLoginSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          success: false,
          error: 'Invalid credentials format',
        });
        return;
      }

      const { username, password } = parseResult.data;
      const authService = getAuthService();

      // Authenticate user
      const result = await authService.login({
        username,
        password,
        sessionType: 'dashboard',
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });

      if (!result.success || !result.token || !result.user) {
        // Sprint 136 (LOW-001): Enhanced audit logging for failed logins
        logger.warn(
          {
            username,
            error: result.error,
            remainingAttempts: result.remainingAttempts,
            lockedUntil: result.lockedUntil,
            correlationId: getCorrelationId(req),
            clientIp: getClientIp(req),
          },
          'Local login failed'
        );

        res.status(401).json({
          success: false,
          error: result.error || 'Invalid credentials',
          remainingAttempts: result.remainingAttempts,
          lockedUntil: result.lockedUntil,
        });
        return;
      }

      // Set session cookie
      res.cookie(SESSION_COOKIE_NAME, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });

      // Sprint 136 (LOW-001): Enhanced audit logging
      logger.info(
        {
          userId: result.user.id,
          username: result.user.username,
          roles: result.user.roles,
          correlationId: getCorrelationId(req),
          clientIp: getClientIp(req),
        },
        'Local login successful'
      );

      // Return user info (format matching dashboard User type)
      res.json({
        success: true,
        user: {
          id: result.user.id,
          username: result.user.username,
          authType: 'local' as const,
          displayName: result.user.displayName,
          roles: result.user.roles,
          sandboxAccess: result.user.sandboxAccess,
          requirePasswordChange: result.user.requirePasswordChange,
        },
        requirePasswordChange: result.user.requirePasswordChange,
      });
    } catch (error) {
      logger.error({ error }, 'Local login error');
      res.status(500).json({
        success: false,
        error: 'Authentication service error',
      });
    }
  });

  /**
   * POST /api/dashboard/auth/logout
   *
   * Terminates user session
   *
   * Sprint 134 (MED-002): Requires CSRF token validation for Discord sessions
   * Sprint 144: Also handles local session logout
   */
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const sessionToken = req.cookies[SESSION_COOKIE_NAME];

      if (sessionToken) {
        // Try Discord session first
        const discordSession = await getSession(sessionToken, redis);

        if (discordSession) {
          // Sprint 134 (MED-002): Validate CSRF token before logout
          if (!validateCsrfToken(req, discordSession)) {
            res.status(403).json({
              error: 'CSRF_INVALID',
              message: 'Invalid or missing CSRF token',
            });
            return;
          }
          await deleteSession(sessionToken, redis);
        } else {
          // Try local session (Sprint 144)
          const authService = getAuthService();
          await authService.logout(sessionToken);
        }
      }

      // Clear cookie
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      // Sprint 136 (LOW-001): Enhanced audit logging
      logger.info(
        {
          sessionToken: sessionToken?.substring(0, 8),
          correlationId: getCorrelationId(req),
          clientIp: getClientIp(req),
        },
        'Dashboard logout'
      );

      res.json({ success: true });
    } catch (error) {
      logger.error({ error }, 'Logout failed');
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  /**
   * GET /api/dashboard/auth/me
   *
   * Returns current user info if authenticated
   *
   * Sprint 134 (MED-002): Also returns CSRF token for client-side usage
   * Sprint 144: Supports both Discord OAuth and local sessions
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const sessionToken = req.cookies[SESSION_COOKIE_NAME];

      if (!sessionToken) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      // Try Discord session first (legacy format)
      const discordSession = await getSession(sessionToken, redis);

      if (discordSession) {
        // Update last activity
        discordSession.lastActivity = Date.now();
        await storeSession(sessionToken, discordSession, redis);

        // Return Discord user info
        res.json({
          id: discordSession.userId,
          username: discordSession.username,
          authType: 'discord' as const,
          avatar: discordSession.avatar,
          adminGuilds: discordSession.adminGuilds,
          csrfToken: discordSession.csrfToken,
        });
        return;
      }

      // Try local session (Sprint 144)
      const authService = getAuthService();
      const authContext = await authService.getAuthContext(sessionToken);

      if (authContext) {
        // Get full user info for local users
        const userService = await import('../../../services/auth/UserService.js');
        const user = userService.getUserService().getUser(authContext.userId);

        if (user) {
          res.json({
            id: user.id,
            username: user.username,
            authType: 'local' as const,
            displayName: user.displayName,
            roles: user.roles,
            sandboxAccess: user.sandboxAccess,
            requirePasswordChange: user.requirePasswordChange,
          });
          return;
        }
      }

      // Clear invalid cookie
      res.clearCookie(SESSION_COOKIE_NAME);
      res.status(401).json({ error: 'Session expired' });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch user info');
      res.status(500).json({ error: 'Failed to fetch user info' });
    }
  });

  /**
   * POST /api/dashboard/auth/refresh
   *
   * Refresh the Discord access token
   *
   * Sprint 134 (MED-002): Requires CSRF token validation
   */
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const sessionId = req.cookies[SESSION_COOKIE_NAME];

      if (!sessionId) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const session = await getSession(sessionId, redis);

      if (!session) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }

      // Sprint 134 (MED-002): Validate CSRF token before refresh
      if (!validateCsrfToken(req, session)) {
        res.status(403).json({
          error: 'CSRF_INVALID',
          message: 'Invalid or missing CSRF token',
        });
        return;
      }

      // Check if token needs refresh (within 5 minutes of expiry)
      const refreshThreshold = 5 * 60 * 1000;
      if (session.tokenExpiresAt - Date.now() > refreshThreshold) {
        res.json({ refreshed: false, expiresAt: session.tokenExpiresAt });
        return;
      }

      // Refresh token
      const clientId = process.env.DISCORD_CLIENT_ID;
      const clientSecret = process.env.DISCORD_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Missing Discord credentials');
      }

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      });

      const response = await fetch(DISCORD_OAUTH_TOKEN, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: params.toString(),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Token refresh failed');
        res.status(401).json({ error: 'Token refresh failed. Please log in again.' });
        return;
      }

      const tokens = (await response.json()) as DiscordTokenResponse;

      // Update session
      session.accessToken = tokens.access_token;
      session.refreshToken = tokens.refresh_token;
      session.tokenExpiresAt = Date.now() + tokens.expires_in * 1000;
      session.lastActivity = Date.now();

      await storeSession(sessionId, session, redis);

      logger.debug({ userId: session.userId }, 'Token refreshed');

      res.json({ refreshed: true, expiresAt: session.tokenExpiresAt });
    } catch (error) {
      logger.error({ error }, 'Token refresh failed');
      res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  /**
   * POST /api/dashboard/auth/change-password
   *
   * Changes the current user's password (local auth only)
   *
   * Sprint 145: Change password endpoint for local users
   */
  const changePasswordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12),
  });

  router.post('/change-password', async (req: Request, res: Response) => {
    try {
      const sessionToken = req.cookies[SESSION_COOKIE_NAME];

      if (!sessionToken) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      // Only local sessions can change password
      const authService = getAuthService();
      const authContext = await authService.getAuthContext(sessionToken);

      if (!authContext || authContext.authType !== 'local') {
        res.status(403).json({
          error: 'DISCORD_USER',
          message: 'Password change not available for Discord users',
        });
        return;
      }

      // Validate request body
      const parseResult = changePasswordSchema.safeParse(req.body);

      if (!parseResult.success) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parseResult.error.flatten().fieldErrors,
        });
        return;
      }

      const { currentPassword, newPassword } = parseResult.data;

      // Attempt password change via UserService
      const userService = await import('../../../services/auth/UserService.js');
      const service = userService.getUserService();

      try {
        await service.changePassword(
          authContext.userId,
          {
            currentPassword,
            newPassword,
          },
          {
            userId: authContext.userId,
            username: authContext.username,
            ip: getClientIp(req),
          }
        );

        // Sprint 145 (LOW-001): Enhanced audit logging
        logger.info(
          {
            userId: authContext.userId,
            username: authContext.username,
            correlationId: getCorrelationId(req),
            clientIp: getClientIp(req),
          },
          'Password changed via dashboard'
        );

        res.json({
          success: true,
          message: 'Password changed successfully',
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Log password change failure
        logger.warn(
          {
            userId: authContext.userId,
            username: authContext.username,
            error: errorMessage,
            correlationId: getCorrelationId(req),
            clientIp: getClientIp(req),
          },
          'Password change failed'
        );

        // Return appropriate error
        if (errorMessage.includes('Current password is incorrect')) {
          res.status(401).json({
            error: 'INVALID_PASSWORD',
            message: 'Current password is incorrect',
          });
        } else if (errorMessage.includes('does not meet requirements')) {
          res.status(400).json({
            error: 'WEAK_PASSWORD',
            message: errorMessage,
          });
        } else {
          res.status(400).json({
            error: 'PASSWORD_CHANGE_FAILED',
            message: errorMessage,
          });
        }
      }
    } catch (error) {
      logger.error({ error }, 'Password change error');
      res.status(500).json({
        error: 'SERVER_ERROR',
        message: 'Password change service error',
      });
    }
  });

  return router;
}

// =============================================================================
// Exports
// =============================================================================

export {
  getSession,
  storeSession,
  deleteSession,
  SESSION_COOKIE_NAME,
  hasAdminPermissions,
  /** Sprint 134 (MED-002): CSRF header name for client-side usage */
  CSRF_HEADER,
};
