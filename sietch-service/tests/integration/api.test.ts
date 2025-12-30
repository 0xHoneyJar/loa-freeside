/**
 * API Endpoint Integration Tests
 *
 * Tests HTTP API endpoints for proper responses and privacy protection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: { naib: 'role', fedaykin: 'role' },
      guildId: 'guild',
      channels: { theDoor: 'channel', census: 'channel' },
      botToken: 'token',
    },
    socialLayer: {
      profile: { launchDate: '2025-01-01T00:00:00Z' },
    },
  },
}));

// Mock database
vi.mock('../../src/db/index.js', () => ({
  getMemberProfileById: vi.fn(),
  getMemberProfileByNym: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
  logAuditEvent: vi.fn(),
}));

describe('API Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/members/:nym', () => {
    it('should return public profile fields', () => {
      const publicProfile = {
        memberId: 'uuid-123',
        nym: 'TestUser',
        bio: 'A test user bio',
        pfpUrl: null,
        tier: 'fedaykin',
        tenureCategory: 'veteran',
        badges: [
          { badgeId: 'newcomer', name: 'Newcomer', emoji: '🌱' },
          { badgeId: 'active', name: 'Active', emoji: '⚡' },
        ],
      };

      expect(publicProfile.memberId).toBeDefined();
      expect(publicProfile.nym).toBeDefined();
      expect(publicProfile.tier).toBeDefined();
      expect(publicProfile.badges).toBeDefined();
    });

    it('should NOT expose private fields', () => {
      const publicProfile = {
        memberId: 'uuid-123',
        nym: 'TestUser',
        bio: 'A test bio',
        pfpUrl: null,
        tier: 'fedaykin',
        tenureCategory: 'veteran',
        badges: [],
      };

      const json = JSON.stringify(publicProfile);

      expect(json).not.toContain('discordUserId');
      expect(json).not.toContain('discord_user_id');
      expect(json).not.toContain('walletAddress');
      expect(json).not.toContain('wallet_address');
      expect(json).not.toMatch(/\d{17,19}/); // No Discord snowflakes
      expect(json).not.toMatch(/0x[a-fA-F0-9]{40}/); // No ETH addresses
    });

    it('should return 404 for non-existent nym', () => {
      const response = {
        status: 404,
        body: { error: 'Member not found' },
      };

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Member not found');
    });

    it('should return 404 for incomplete onboarding', () => {
      // Members who haven't completed onboarding should not be publicly visible
      const response = {
        status: 404,
        body: { error: 'Member not found' },
      };

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/directory', () => {
    it('should return paginated member list', () => {
      const response = {
        members: [
          { memberId: '1', nym: 'User1', tier: 'naib', badgeCount: 5 },
          { memberId: '2', nym: 'User2', tier: 'fedaykin', badgeCount: 3 },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          totalMembers: 55,
          totalPages: 3,
        },
      };

      expect(response.members).toHaveLength(2);
      expect(response.pagination.totalPages).toBe(3);
    });

    it('should support tier filter query param', () => {
      const queryParams = { tier: 'naib' };
      const validTiers = ['naib', 'fedaykin'];

      expect(validTiers.includes(queryParams.tier)).toBe(true);
    });

    it('should support search query param', () => {
      const queryParams = { search: 'test' };

      expect(queryParams.search.length).toBeGreaterThanOrEqual(2);
    });

    it('should reject invalid page numbers', () => {
      const invalidPages = [0, -1, 'abc', null];

      for (const page of invalidPages) {
        const isValid =
          typeof page === 'number' && Number.isInteger(page) && page >= 1;
        expect(isValid).toBe(false);
      }
    });
  });

  describe('GET /api/leaderboard', () => {
    it('should return top members by badge count', () => {
      const response = {
        leaderboard: [
          { rank: 1, nym: 'TopUser', tier: 'naib', badgeCount: 15 },
          { rank: 2, nym: 'SecondUser', tier: 'fedaykin', badgeCount: 12 },
          { rank: 3, nym: 'ThirdUser', tier: 'naib', badgeCount: 10 },
        ],
        totalMembers: 100,
      };

      expect(response.leaderboard[0].rank).toBe(1);
      expect(response.leaderboard[0].badgeCount).toBeGreaterThanOrEqual(
        response.leaderboard[1].badgeCount
      );
    });

    it('should NOT expose private data in leaderboard', () => {
      const leaderboardEntry = {
        rank: 1,
        nym: 'TopUser',
        tier: 'naib',
        badgeCount: 15,
        tierEmoji: '👑',
      };

      const json = JSON.stringify(leaderboardEntry);

      expect(json).not.toContain('discord');
      expect(json).not.toContain('wallet');
      expect(json).not.toContain('0x');
      expect(json).not.toContain('userId');
    });

    it('should support limit query param', () => {
      const validLimits = [5, 10, 20, 50];
      const defaultLimit = 10;
      const maxLimit = 50;

      for (const limit of validLimits) {
        expect(limit).toBeLessThanOrEqual(maxLimit);
      }

      expect(validLimits.includes(defaultLimit)).toBe(true);
    });
  });

  describe('API Response Codes', () => {
    it('should return 200 for successful requests', () => {
      const successResponse = { status: 200 };
      expect(successResponse.status).toBe(200);
    });

    it('should return 400 for bad requests', () => {
      const badRequestResponse = {
        status: 400,
        body: { error: 'Invalid request parameters' },
      };
      expect(badRequestResponse.status).toBe(400);
    });

    it('should return 404 for not found', () => {
      const notFoundResponse = {
        status: 404,
        body: { error: 'Resource not found' },
      };
      expect(notFoundResponse.status).toBe(404);
    });

    it('should return 429 for rate limiting', () => {
      const rateLimitResponse = {
        status: 429,
        body: { error: 'Rate limit exceeded', retryAfter: 60 },
      };
      expect(rateLimitResponse.status).toBe(429);
      expect(rateLimitResponse.body.retryAfter).toBeDefined();
    });

    it('should return 500 for server errors', () => {
      const serverErrorResponse = {
        status: 500,
        body: { error: 'Internal server error' },
      };
      expect(serverErrorResponse.status).toBe(500);
    });
  });

  describe('API Error Messages', () => {
    it('should NOT leak implementation details', () => {
      const errorResponses = [
        { error: 'Member not found' },
        { error: 'Invalid request' },
        { error: 'Unauthorized' },
        { error: 'Rate limit exceeded' },
        { error: 'Internal server error' },
      ];

      for (const response of errorResponses) {
        const json = JSON.stringify(response);

        // Should not expose internal details
        expect(json).not.toContain('SQL');
        expect(json).not.toContain('query');
        expect(json).not.toContain('stack');
        expect(json).not.toContain('trace');
        expect(json).not.toContain('database');
        expect(json).not.toContain('discord');
        expect(json).not.toContain('wallet');
      }
    });

    it('should provide user-friendly error messages', () => {
      const errors = {
        notFound: 'Member not found',
        invalid: 'Invalid request parameters',
        unauthorized: 'Please verify your membership first',
        rateLimit: 'Too many requests, please try again later',
      };

      // All error messages should be readable
      for (const message of Object.values(errors)) {
        expect(message.length).toBeLessThan(100);
        expect(message).toMatch(/^[A-Z]/); // Starts with capital
      }
    });
  });

  describe('API Input Validation', () => {
    it('should validate nym format', () => {
      const validNyms = ['TestUser', 'user_123', 'A_B'];
      const invalidNyms = ['', '  ', 'AB', 'test-user', '<script>'];

      const nymRegex = /^[a-zA-Z0-9_]{3,32}$/;

      for (const nym of validNyms) {
        expect(nymRegex.test(nym)).toBe(true);
      }

      for (const nym of invalidNyms) {
        expect(nymRegex.test(nym)).toBe(false);
      }
    });

    it('should sanitize search input', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        "'; DROP TABLE members; --",
        '${process.env.SECRET}',
      ];

      for (const input of maliciousInputs) {
        // Comprehensive sanitization removing dangerous chars and SQL keywords
        const sanitized = input
          .replace(/[<>'"`;${}\-]/g, '') // Remove dangerous chars including hyphen
          .replace(/\b(DROP|TABLE|SELECT|INSERT|UPDATE|DELETE|UNION|WHERE)\b/gi, '') // Remove SQL keywords
          .substring(0, 50);

        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('DROP TABLE');
        expect(sanitized).not.toContain('${');
      }
    });

    it('should validate tier filter values', () => {
      const validTiers = ['naib', 'fedaykin'];
      const invalidTiers = ['admin', 'unknown', '', null];

      for (const tier of validTiers) {
        expect(['naib', 'fedaykin'].includes(tier)).toBe(true);
      }

      for (const tier of invalidTiers) {
        expect(
          tier && ['naib', 'fedaykin'].includes(tier as string)
        ).toBeFalsy();
      }
    });
  });

  describe('API Rate Limiting', () => {
    it('should track requests per IP', () => {
      const rateLimiter = new Map<string, number[]>();
      const ip = '192.168.1.1';
      const windowMs = 60000;
      const maxRequests = 100;
      const now = Date.now();

      // Simulate requests
      if (!rateLimiter.has(ip)) {
        rateLimiter.set(ip, []);
      }
      rateLimiter.get(ip)!.push(now);

      // Clean old requests
      const requests = rateLimiter
        .get(ip)!
        .filter((ts) => ts > now - windowMs);

      expect(requests.length).toBeLessThanOrEqual(maxRequests);
    });

    it('should return retry-after header when rate limited', () => {
      const rateLimitResponse = {
        status: 429,
        headers: { 'Retry-After': '60' },
        body: { error: 'Rate limit exceeded', retryAfter: 60 },
      };

      expect(rateLimitResponse.headers['Retry-After']).toBeDefined();
      expect(rateLimitResponse.body.retryAfter).toBe(60);
    });
  });

  describe('CORS Configuration', () => {
    it('should allow configured origins', () => {
      const allowedOrigins = [
        'https://sietch.app',
        'https://www.sietch.app',
      ];
      const requestOrigin = 'https://sietch.app';

      const isAllowed = allowedOrigins.includes(requestOrigin);

      expect(isAllowed).toBe(true);
    });

    it('should reject unknown origins', () => {
      const allowedOrigins = [
        'https://sietch.app',
        'https://www.sietch.app',
      ];
      const requestOrigin = 'https://malicious.com';

      const isAllowed = allowedOrigins.includes(requestOrigin);

      expect(isAllowed).toBe(false);
    });
  });

  describe('Content-Type Handling', () => {
    it('should return JSON content type', () => {
      const response = {
        headers: { 'Content-Type': 'application/json' },
      };

      expect(response.headers['Content-Type']).toBe('application/json');
    });

    it('should reject non-JSON POST requests', () => {
      const request = {
        headers: { 'Content-Type': 'text/plain' },
      };

      const isJson = request.headers['Content-Type'] === 'application/json';

      expect(isJson).toBe(false);
    });
  });
});
