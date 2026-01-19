/**
 * Dashboard Auth Middleware Tests
 *
 * Sprint 115: Session & Auth Middleware
 *
 * Tests for authentication middleware stack including:
 * - requireDashboardAuth (401 for missing/invalid session)
 * - liveAdminCheck (re-verify Discord admin status)
 * - sessionRefresh (extend session on activity)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';

// =============================================================================
// Mocks - Must be before imports
// =============================================================================

// Mock fetch for Discord API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

// Session storage mock data
let mockSessionStore: Map<string, string>;

// Mock auth.routes.js
vi.mock('../../../src/api/routes/dashboard/auth.routes.js', () => ({
  SESSION_COOKIE_NAME: 'dashboard_session',
  getSession: vi.fn(async (sessionId: string) => {
    const data = mockSessionStore.get(sessionId);
    return data ? JSON.parse(data) : null;
  }),
  storeSession: vi.fn(async (sessionId: string, session: any) => {
    mockSessionStore.set(sessionId, JSON.stringify(session));
  }),
  hasAdminPermissions: vi.fn((permissions: string) => {
    // Check for ADMINISTRATOR (0x8) or MANAGE_GUILD (0x20)
    const permsInt = parseInt(permissions, 10);
    return (permsInt & 0x8) === 0x8 || (permsInt & 0x20) === 0x20;
  }),
}));

// Import after mocks
import { createDashboardAuthMiddleware } from '../../../src/api/middleware/dashboardAuth.js';
import { SESSION_COOKIE_NAME, hasAdminPermissions } from '../../../src/api/routes/dashboard/auth.routes.js';

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionStore = new Map();
  mockFetch.mockReset();
  process.env = {
    ...originalEnv,
    DISCORD_CLIENT_ID: 'test-client-id',
    DISCORD_CLIENT_SECRET: 'test-client-secret',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

// =============================================================================
// Test Setup
// =============================================================================

function createValidSession(overrides = {}) {
  return {
    userId: 'user-123',
    username: 'TestUser',
    avatar: 'avatar-hash',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    adminGuilds: [{ id: 'guild-123', name: 'Test Guild', icon: null }],
    createdAt: Date.now() - 1000, // 1 second ago
    lastActivity: Date.now() - 1000,
    ...overrides,
  };
}

function storeTestSession(sessionId: string, session: any) {
  mockSessionStore.set(sessionId, JSON.stringify(session));
}

function createTestApp(middleware: ReturnType<typeof createDashboardAuthMiddleware>) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Test route with requireDashboardAuth only
  app.get('/test/auth', middleware.requireDashboardAuth, (req, res) => {
    res.json({ success: true, userId: (req as any).dashboardSession.userId });
  });

  // Test route with requireDashboardAuth + liveAdminCheck
  app.post('/test/write/:serverId', middleware.requireDashboardAuth, middleware.liveAdminCheck, (req, res) => {
    res.json({ success: true, serverId: (req as any).serverId });
  });

  // Test route with session refresh
  app.get('/test/refresh', middleware.requireDashboardAuth, middleware.sessionRefresh, (req, res) => {
    res.json({ success: true });
  });

  return app;
}

// =============================================================================
// Tests: requireDashboardAuth
// =============================================================================

describe('requireDashboardAuth middleware', () => {
  it('should return 401 when no session cookie is present', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .expect(401);

    expect(response.body.error).toBe('UNAUTHORIZED');
    expect(response.body.message).toBe('Authentication required');
  });

  it('should return 401 when session is not found', async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      del: vi.fn(),
    };

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=invalid-session`)
      .expect(401);

    expect(response.body.error).toBe('SESSION_EXPIRED');
    expect(response.body.message).toBe('Session expired. Please log in again.');
  });

  it('should return 401 when session is too old (24+ hours)', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const oldSession = createValidSession({
      createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    });

    storeTestSession('old-session', oldSession);

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=old-session`)
      .expect(401);

    expect(response.body.error).toBe('SESSION_EXPIRED');
  });

  it('should allow request with valid session', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession();
    storeTestSession('valid-session', validSession);

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe('user-123');
  });

  it('should update lastActivity on valid request', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const oldActivity = Date.now() - 60000; // 1 minute ago
    const validSession = createValidSession({
      lastActivity: oldActivity,
    });
    storeTestSession('valid-session', validSession);

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session`)
      .expect(200);

    // Check stored session was updated
    const storedData = mockSessionStore.get('valid-session');
    expect(storedData).toBeDefined();
    const storedSession = JSON.parse(storedData!);
    expect(storedSession.lastActivity).toBeGreaterThan(oldActivity);
  });

  it('should not expose internal errors in response', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    // Make getSession throw an error by storing invalid JSON
    mockSessionStore.set('error-session', 'invalid-json{');

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=error-session`)
      .expect(500);

    expect(response.body.error).toBe('AUTH_ERROR');
    expect(response.body.message).toBe('Authentication check failed');
    // Should NOT contain internal error details
    expect(response.body.message).not.toContain('JSON');
  });
});

// =============================================================================
// Tests: liveAdminCheck
// =============================================================================

describe('liveAdminCheck middleware', () => {
  it('should return 401 when session is missing', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    // No session = requireDashboardAuth returns 401 first
    const response = await request(app)
      .post('/test/write/guild-123')
      .expect(401);

    expect(response.body.error).toBe('UNAUTHORIZED');
  });

  it('should verify admin permissions via Discord API', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession();
    storeTestSession('valid-session', validSession);

    // Mock Discord API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'guild-123', permissions: '8' }, // ADMINISTRATOR permission
      ],
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.serverId).toBe('guild-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/users/@me/guilds',
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${validSession.accessToken}`,
        },
      })
    );
  });

  it('should return 403 when admin permission revoked', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({ userId: 'user-revoked' });
    storeTestSession('revoked-session', validSession);

    // Mock Discord API - user no longer has admin
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'guild-123', permissions: '0' }, // No permissions
      ],
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=revoked-session`)
      .expect(403);

    expect(response.body.error).toBe('PERMISSION_REVOKED');
    expect(response.body.message).toBe('You no longer have admin access to this server');
  });

  it('should return 401 when Discord token is expired', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({ userId: 'user-expired-token' });
    storeTestSession('expired-token-session', validSession);

    // Mock Discord API - 401 response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=expired-token-session`)
      .expect(401);

    expect(response.body.error).toBe('TOKEN_EXPIRED');
    expect(response.body.message).toBe('Discord token expired. Please log in again.');
  });

  it('should use cached admin check result within TTL', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({ userId: 'user-cached' });
    storeTestSession('cached-session', validSession);

    // First call - hits Discord API
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'guild-123', permissions: '8' }],
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    // First request
    await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=cached-session`)
      .expect(200);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second request (should use cache)
    await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=cached-session`)
      .expect(200);

    // fetch should still only have been called once (cached)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return 403 when user not in target guild', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({ userId: 'user-not-in-guild' });
    storeTestSession('not-in-guild-session', validSession);

    // Mock Discord API - user is not in target guild
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'other-guild-456', permissions: '8' }, // Admin in different guild
      ],
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=not-in-guild-session`)
      .expect(403);

    expect(response.body.error).toBe('PERMISSION_REVOKED');
  });
});

// =============================================================================
// Tests: sessionRefresh
// =============================================================================

describe('sessionRefresh middleware', () => {
  it('should update lastActivity timestamp', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const oldActivity = Date.now() - 60000; // 1 minute ago
    const validSession = createValidSession({
      lastActivity: oldActivity,
    });
    storeTestSession('refresh-session', validSession);

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    await request(app)
      .get('/test/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=refresh-session`)
      .expect(200);

    const storedData = mockSessionStore.get('refresh-session');
    const storedSession = JSON.parse(storedData!);
    expect(storedSession.lastActivity).toBeGreaterThan(oldActivity);
  });

  it('should attempt token refresh when token expires within 30 minutes', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({
      tokenExpiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
    });
    storeTestSession('expiring-token-session', validSession);

    // Mock Discord token refresh
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }),
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    await request(app)
      .get('/test/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=expiring-token-session`)
      .expect(200);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/oauth2/token',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should not fail request if token refresh fails', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({
      tokenExpiresAt: Date.now() + 15 * 60 * 1000, // Within refresh threshold
    });
    storeTestSession('refresh-fail-session', validSession);

    // Mock failed token refresh
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    // Request should still succeed even though token refresh failed
    const response = await request(app)
      .get('/test/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=refresh-fail-session`)
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  it('should skip token refresh when token has long validity', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({
      tokenExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    });
    storeTestSession('long-validity-session', validSession);

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    await request(app)
      .get('/test/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=long-validity-session`)
      .expect(200);

    // Should not call Discord API for token refresh
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Tests: Auth Error Responses (115.5)
// =============================================================================

describe('Auth error responses (sanitization)', () => {
  it('should not leak session IDs in error responses', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .set('Cookie', `${SESSION_COOKIE_NAME}=secret-session-id-123`)
      .expect(401);

    // Response should not contain the session ID
    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('secret-session-id-123');
  });

  it('should not leak tokens in error responses on internal error', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({
      accessToken: 'super-secret-token-xyz',
      userId: 'user-error-test',
    });
    storeTestSession('error-test-session', validSession);

    // Mock Discord API network error
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=error-test-session`)
      .expect(500);

    // Response should not contain the token
    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('super-secret-token-xyz');
    expect(response.body.error).toBe('ADMIN_CHECK_ERROR');
  });

  it('should use consistent error format', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    const response = await request(app)
      .get('/test/auth')
      .expect(401);

    // All auth errors should have consistent structure
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('message');
    expect(typeof response.body.error).toBe('string');
    expect(typeof response.body.message).toBe('string');
  });
});

// =============================================================================
// Tests: Cache Invalidation
// =============================================================================

describe('invalidateAdminCheckCache', () => {
  it('should invalidate cache for specific user and server', async () => {
    const mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const validSession = createValidSession({ userId: 'user-invalidate-test' });
    storeTestSession('invalidate-session', validSession);

    // First call - populate cache
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'guild-123', permissions: '8' }],
    });

    const middleware = createDashboardAuthMiddleware({
      redis: mockRedis,
      guildId: 'test-guild-123',
    });

    const app = createTestApp(middleware);

    await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=invalidate-session`)
      .expect(200);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Invalidate cache
    middleware.invalidateAdminCheckCache('user-invalidate-test', 'guild-123');

    // Next request should hit Discord API again
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'guild-123', permissions: '8' }],
    });

    await request(app)
      .post('/test/write/guild-123')
      .set('Cookie', `${SESSION_COOKIE_NAME}=invalidate-session`)
      .expect(200);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
