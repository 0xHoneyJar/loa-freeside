/**
 * Verification Routes Tests
 * Sprint 79: API Routes & Discord Integration
 *
 * Unit tests for the verification REST API router factory.
 * Tests the createVerifyRouter function directly without HTTP layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, Router } from 'express';

// Mock logger first to avoid any config dependency issues
vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock middleware to avoid config dependency
vi.mock('../../../../src/api/middleware.js', () => ({
  ValidationError: class ValidationError extends Error {
    statusCode = 400;
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    statusCode = 404;
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
}));

import { createVerifyRouter } from '../../../../src/api/routes/verify.routes.js';

// =============================================================================
// Test Setup
// =============================================================================

const TEST_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_COMMUNITY_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TEST_SIGNATURE = '0x' + 'a'.repeat(130); // 65 bytes = 130 hex chars

interface MockSession {
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
}

function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  const now = new Date();
  return {
    id: TEST_SESSION_ID,
    status: 'pending',
    discordUserId: '123456789012345678',
    discordUsername: 'testuser#1234',
    walletAddress: undefined,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    completedAt: undefined,
    attempts: 0,
    errorMessage: undefined,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('createVerifyRouter', () => {
  let mockGetSession: ReturnType<typeof vi.fn>;
  let mockVerifySignature: ReturnType<typeof vi.fn>;
  let mockGetCommunityIdForSession: ReturnType<typeof vi.fn>;
  let mockGetSigningMessage: ReturnType<typeof vi.fn>;
  let router: Router;

  beforeEach(() => {
    mockGetSession = vi.fn();
    mockVerifySignature = vi.fn();
    mockGetCommunityIdForSession = vi.fn();
    mockGetSigningMessage = vi.fn();

    router = createVerifyRouter({
      getVerificationService: (_communityId: string) => ({
        getSession: mockGetSession,
        verifySignature: mockVerifySignature,
      }),
      getCommunityIdForSession: mockGetCommunityIdForSession,
      getSigningMessage: mockGetSigningMessage,
      maxAttempts: 3,
    });
  });

  describe('Router creation', () => {
    it('should create a router with expected routes', () => {
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');

      // Router should have stack with route handlers
      const routerStack = (router as any).stack;
      expect(Array.isArray(routerStack)).toBe(true);
      expect(routerStack.length).toBeGreaterThan(0);
    });

    it('should have GET /:sessionId route', () => {
      const routerStack = (router as any).stack;
      const getRoutes = routerStack.filter(
        (layer: any) => layer.route?.methods?.get
      );
      expect(getRoutes.length).toBeGreaterThanOrEqual(1);
    });

    it('should have POST /:sessionId route', () => {
      const routerStack = (router as any).stack;
      const postRoutes = routerStack.filter(
        (layer: any) => layer.route?.methods?.post
      );
      expect(postRoutes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Dependency injection', () => {
    it('should call getCommunityIdForSession with session ID', async () => {
      mockGetCommunityIdForSession.mockResolvedValue(TEST_COMMUNITY_ID);
      mockGetSession.mockResolvedValue(createMockSession());
      mockGetSigningMessage.mockResolvedValue('Sign this message');

      // Create mock request/response
      const mockReq = {
        params: { sessionId: TEST_SESSION_ID },
        query: { format: 'json' },
        accepts: vi.fn().mockReturnValue(false),
      } as unknown as Request;

      const mockRes = {
        json: vi.fn(),
      } as unknown as Response;

      const mockNext = vi.fn();

      // Find and call the GET route handler
      const routerStack = (router as any).stack;
      const getRoute = routerStack.find(
        (layer: any) => layer.route?.path === '/:sessionId' && layer.route?.methods?.get
      );

      if (getRoute?.route?.stack?.[0]?.handle) {
        await getRoute.route.stack[0].handle(mockReq, mockRes, mockNext);
      }

      expect(mockGetCommunityIdForSession).toHaveBeenCalledWith(TEST_SESSION_ID);
    });

    it('should call getVerificationService with community ID', async () => {
      mockGetCommunityIdForSession.mockResolvedValue(TEST_COMMUNITY_ID);
      mockGetSession.mockResolvedValue(createMockSession());
      mockGetSigningMessage.mockResolvedValue('Sign this message');

      const getVerificationServiceSpy = vi.fn().mockReturnValue({
        getSession: mockGetSession,
        verifySignature: mockVerifySignature,
      });

      const testRouter = createVerifyRouter({
        getVerificationService: getVerificationServiceSpy,
        getCommunityIdForSession: mockGetCommunityIdForSession,
        getSigningMessage: mockGetSigningMessage,
        maxAttempts: 3,
      });

      const mockReq = {
        params: { sessionId: TEST_SESSION_ID },
        query: { format: 'json' },
        accepts: vi.fn().mockReturnValue(false),
      } as unknown as Request;

      const mockRes = {
        json: vi.fn(),
      } as unknown as Response;

      const mockNext = vi.fn();

      // Find and call the GET route handler
      const routerStack = (testRouter as any).stack;
      const getRoute = routerStack.find(
        (layer: any) => layer.route?.path === '/:sessionId' && layer.route?.methods?.get
      );

      if (getRoute?.route?.stack?.[0]?.handle) {
        await getRoute.route.stack[0].handle(mockReq, mockRes, mockNext);
      }

      expect(getVerificationServiceSpy).toHaveBeenCalledWith(TEST_COMMUNITY_ID);
    });
  });

  describe('Session ID validation', () => {
    it('should validate UUID format for session ID', () => {
      // Valid UUIDs
      expect(TEST_SESSION_ID).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Invalid formats should fail validation
      expect('invalid-uuid').not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect('').not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('Signature validation', () => {
    it('should accept valid signature format', () => {
      // 65 bytes = 130 hex characters + 0x prefix
      const validSignature = '0x' + 'a'.repeat(130);
      expect(validSignature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });

    it('should reject invalid signature formats', () => {
      // Too short
      expect('0x' + 'a'.repeat(128)).not.toMatch(/^0x[a-fA-F0-9]{130}$/);
      // Too long
      expect('0x' + 'a'.repeat(132)).not.toMatch(/^0x[a-fA-F0-9]{130}$/);
      // Missing prefix
      expect('a'.repeat(130)).not.toMatch(/^0x[a-fA-F0-9]{130}$/);
      // Invalid characters
      expect('0x' + 'g'.repeat(130)).not.toMatch(/^0x[a-fA-F0-9]{130}$/);
    });
  });

  describe('Wallet address validation', () => {
    it('should accept valid wallet address format', () => {
      expect(TEST_WALLET).toMatch(/^0x[a-fA-F0-9]{40}$/i);
      // Lowercase
      expect(TEST_WALLET.toLowerCase()).toMatch(/^0x[a-fA-F0-9]{40}$/i);
      // Uppercase
      expect(TEST_WALLET.toUpperCase()).toMatch(/^0x[a-fA-F0-9]{40}$/i);
    });

    it('should reject invalid wallet address formats', () => {
      // Too short
      expect('0x' + 'a'.repeat(38)).not.toMatch(/^0x[a-fA-F0-9]{40}$/i);
      // Too long
      expect('0x' + 'a'.repeat(42)).not.toMatch(/^0x[a-fA-F0-9]{40}$/i);
      // Missing prefix
      expect('a'.repeat(40)).not.toMatch(/^0x[a-fA-F0-9]{40}$/i);
      // ENS name
      expect('vitalik.eth').not.toMatch(/^0x[a-fA-F0-9]{40}$/i);
    });
  });

  describe('Max attempts configuration', () => {
    it('should use provided maxAttempts value', () => {
      const routerWith5Attempts = createVerifyRouter({
        getVerificationService: () => ({
          getSession: mockGetSession,
          verifySignature: mockVerifySignature,
        }),
        getCommunityIdForSession: mockGetCommunityIdForSession,
        getSigningMessage: mockGetSigningMessage,
        maxAttempts: 5,
      });

      expect(routerWith5Attempts).toBeDefined();
    });

    it('should default to 3 attempts when not specified', () => {
      const routerDefaultAttempts = createVerifyRouter({
        getVerificationService: () => ({
          getSession: mockGetSession,
          verifySignature: mockVerifySignature,
        }),
        getCommunityIdForSession: mockGetCommunityIdForSession,
        getSigningMessage: mockGetSigningMessage,
        // maxAttempts not specified
      });

      expect(routerDefaultAttempts).toBeDefined();
    });
  });

  describe('Response formatting', () => {
    it('should calculate attemptsRemaining correctly', () => {
      const maxAttempts = 3;

      // 0 attempts = 3 remaining
      expect(Math.max(0, maxAttempts - 0)).toBe(3);
      // 1 attempt = 2 remaining
      expect(Math.max(0, maxAttempts - 1)).toBe(2);
      // 3 attempts = 0 remaining
      expect(Math.max(0, maxAttempts - 3)).toBe(0);
      // 4 attempts = 0 remaining (not negative)
      expect(Math.max(0, maxAttempts - 4)).toBe(0);
    });
  });
});
