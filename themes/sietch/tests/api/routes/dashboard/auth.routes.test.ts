/**
 * Dashboard Auth Routes Tests
 *
 * Sprint 114: Authentication Core
 *
 * Tests for Discord OAuth2 authentication flow with PKCE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { createDashboardAuthRouter, SESSION_COOKIE_NAME, CSRF_HEADER } from '../../../../src/api/routes/dashboard/auth.routes.js';

// =============================================================================
// Mocks
// =============================================================================

// Mock fetch for Discord API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...originalEnv,
    DISCORD_CLIENT_ID: 'test-client-id',
    DISCORD_CLIENT_SECRET: 'test-client-secret',
    DASHBOARD_URL: 'http://localhost:5173',
    NODE_ENV: 'test',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

// =============================================================================
// Test Setup
// =============================================================================

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  };

  const authRouter = createDashboardAuthRouter({
    redis: mockRedis,
    guildId: 'test-guild-123',
  });

  app.use('/api/dashboard/auth', authRouter);

  return { app, mockRedis };
}

// =============================================================================
// Tests: OAuth2 Initiation
// =============================================================================

describe('GET /api/dashboard/auth/discord', () => {
  it('should redirect to Discord OAuth2 authorize endpoint', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/discord')
      .expect(302);

    expect(response.headers.location).toContain('discord.com/api/oauth2/authorize');
    expect(response.headers.location).toContain('client_id=test-client-id');
    expect(response.headers.location).toContain('response_type=code');
    expect(response.headers.location).toContain('scope=identify+guilds');
    expect(response.headers.location).toContain('code_challenge_method=S256');
  });

  it('should include state parameter for CSRF protection', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/discord')
      .expect(302);

    const location = new URL(response.headers.location);
    const state = location.searchParams.get('state');

    expect(state).toBeTruthy();
    expect(state!.length).toBe(32); // 16 bytes hex encoded
  });

  it('should include PKCE code challenge', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/discord')
      .expect(302);

    const location = new URL(response.headers.location);
    const codeChallenge = location.searchParams.get('code_challenge');

    expect(codeChallenge).toBeTruthy();
    // Base64url encoded SHA256 hash
    expect(codeChallenge!.length).toBe(43);
  });

  it('should return 500 if DISCORD_CLIENT_ID is missing', async () => {
    delete process.env.DISCORD_CLIENT_ID;
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/discord')
      .expect(500);

    expect(response.body.error).toBe('OAuth not configured');
  });
});

// =============================================================================
// Tests: OAuth2 Callback
// =============================================================================

describe('GET /api/dashboard/auth/callback', () => {
  it('should return 400 for missing code parameter', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/callback?state=invalid')
      .expect(400);

    expect(response.body.error).toBe('Invalid callback parameters');
  });

  it('should return 400 for missing state parameter', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/callback?code=test-code')
      .expect(400);

    expect(response.body.error).toBe('Invalid callback parameters');
  });

  it('should return 400 for invalid state', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/callback?code=test-code&state=invalid-state')
      .expect(400);

    expect(response.body.error).toContain('Invalid or expired state');
  });
});

// =============================================================================
// Tests: Session Management
// =============================================================================

describe('POST /api/dashboard/auth/logout', () => {
  it('should clear session cookie on logout', async () => {
    const { app, mockRedis } = createTestApp();

    const response = await request(app)
      .post('/api/dashboard/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test-session-id`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(mockRedis.del).toHaveBeenCalledWith('dashboard:session:test-session-id');

    // Check that Set-Cookie header clears the cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain(SESSION_COOKIE_NAME);
    // Express uses Expires=Thu, 01 Jan 1970 to clear cookies
    expect(cookies[0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('should succeed even without session cookie', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/dashboard/auth/logout')
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});

describe('GET /api/dashboard/auth/me', () => {
  it('should return 401 when not authenticated', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .get('/api/dashboard/auth/me')
      .expect(401);

    expect(response.body.error).toBe('Not authenticated');
  });

  it('should return user info when authenticated', async () => {
    const { app, mockRedis } = createTestApp();

    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: 'avatar-hash',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 3600000,
      adminGuilds: [{ id: 'guild-1', name: 'Test Guild', icon: null }],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .get('/api/dashboard/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      .expect(200);

    expect(response.body.id).toBe('user-123');
    expect(response.body.username).toBe('TestUser');
    expect(response.body.adminGuilds).toHaveLength(1);
    // Should not expose sensitive data
    expect(response.body.accessToken).toBeUndefined();
    expect(response.body.refreshToken).toBeUndefined();
  });

  it('should return 401 for expired session', async () => {
    const { app, mockRedis } = createTestApp();

    // Return null for expired/invalid session
    mockRedis.get.mockResolvedValueOnce(null);

    const response = await request(app)
      .get('/api/dashboard/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=expired-session-id`)
      .expect(401);

    expect(response.body.error).toBe('Session expired');
  });
});

// =============================================================================
// Tests: Token Refresh
// =============================================================================

describe('POST /api/dashboard/auth/refresh', () => {
  it('should return 401 when not authenticated', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/dashboard/auth/refresh')
      .expect(401);

    expect(response.body.error).toBe('Not authenticated');
  });

  it('should skip refresh if token not expiring soon', async () => {
    const { app, mockRedis } = createTestApp();

    const csrfToken = 'test-csrf-token-12345';
    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: null,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      // Token expires in 1 hour (not within 5 minute threshold)
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      adminGuilds: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      csrfToken, // Sprint 134 (MED-002): Include CSRF token
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .post('/api/dashboard/auth/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      .set(CSRF_HEADER, csrfToken) // Sprint 134 (MED-002): Include CSRF header
      .expect(200);

    expect(response.body.refreshed).toBe(false);
    // fetch should not have been called
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Tests: Session Cookie Security
// =============================================================================

describe('Session Cookie Security', () => {
  it('should set HttpOnly flag on session cookie', async () => {
    // This would be tested via the callback flow
    // Verifying cookie configuration in auth.routes.ts
    const { app, mockRedis } = createTestApp();

    // Simulate a successful login by checking logout clears properly
    const response = await request(app)
      .post('/api/dashboard/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test-session`)
      .expect(200);

    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('should set SameSite=Lax on session cookie', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/dashboard/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=test-session`)
      .expect(200);

    const cookies = response.headers['set-cookie'];
    expect(cookies[0]).toContain('SameSite=Lax');
  });
});

// =============================================================================
// Tests: CSRF Protection (Sprint 134 MED-002)
// =============================================================================

describe('CSRF Protection', () => {
  it('should reject refresh without CSRF token', async () => {
    const { app, mockRedis } = createTestApp();

    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: null,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      adminGuilds: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      csrfToken: 'valid-csrf-token',
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .post('/api/dashboard/auth/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      // No CSRF header
      .expect(403);

    expect(response.body.error).toBe('CSRF_INVALID');
  });

  it('should reject refresh with invalid CSRF token', async () => {
    const { app, mockRedis } = createTestApp();

    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: null,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      adminGuilds: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      csrfToken: 'valid-csrf-token',
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .post('/api/dashboard/auth/refresh')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      .set(CSRF_HEADER, 'wrong-csrf-token')
      .expect(403);

    expect(response.body.error).toBe('CSRF_INVALID');
  });

  it('should reject logout with invalid CSRF token when session exists', async () => {
    const { app, mockRedis } = createTestApp();

    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: null,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      adminGuilds: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      csrfToken: 'valid-csrf-token',
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .post('/api/dashboard/auth/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      .set(CSRF_HEADER, 'wrong-csrf-token')
      .expect(403);

    expect(response.body.error).toBe('CSRF_INVALID');
  });

  it('should include csrfToken in /me response', async () => {
    const { app, mockRedis } = createTestApp();

    const csrfToken = 'test-csrf-token-for-me-endpoint';
    const mockSession = {
      userId: 'user-123',
      username: 'TestUser',
      avatar: 'test-avatar',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      adminGuilds: [{ id: 'guild-1', name: 'Test Guild', icon: null }],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      csrfToken,
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockSession));

    const response = await request(app)
      .get('/api/dashboard/auth/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-id`)
      .expect(200);

    expect(response.body.csrfToken).toBe(csrfToken);
    expect(response.body.id).toBe('user-123');
    expect(response.body.username).toBe('TestUser');
  });
});

// =============================================================================
// Tests: PKCE Flow Integration
// =============================================================================

describe('PKCE Flow', () => {
  it('should generate unique state and code verifier for each request', async () => {
    const { app } = createTestApp();

    const response1 = await request(app).get('/api/dashboard/auth/discord');
    const response2 = await request(app).get('/api/dashboard/auth/discord');

    const url1 = new URL(response1.headers.location);
    const url2 = new URL(response2.headers.location);

    const state1 = url1.searchParams.get('state');
    const state2 = url2.searchParams.get('state');
    const challenge1 = url1.searchParams.get('code_challenge');
    const challenge2 = url2.searchParams.get('code_challenge');

    expect(state1).not.toBe(state2);
    expect(challenge1).not.toBe(challenge2);
  });
});
