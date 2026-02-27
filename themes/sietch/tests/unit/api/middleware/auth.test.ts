/**
 * Authentication/Authorization Middleware Tests
 *
 * Sprint 111: Security Remediation (CRITICAL-002)
 *
 * Tests for authentication and authorization middleware covering:
 * - API key validation
 * - Sandbox access control
 * - Self-or-admin authorization
 * - QA role requirements
 * - Error handling and generic error messages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock AuthService used by Bearer token path
vi.mock('../../../../src/services/auth/AuthService.js', () => ({
  getAuthService: () => ({
    getAuthContext: vi.fn().mockResolvedValue(null),
  }),
}));
import {
  requireAuth,
  requireSandboxAccess,
  requireSelfOrAdmin,
  requireQARole,
  requireAdminRole,
  hasAdminRole,
  hasQARole,
  hasSandboxAccess,
  setApiKeyConfigs,
  getApiKeyConfigs,
  type Caller,
  type AuthenticatedRequest,
  type ApiKeyConfig,
  ADMIN_ROLES,
  QA_ROLES,
} from '../../../../src/api/middleware/auth.js';

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock Express request
 */
function createMockRequest(
  overrides: Partial<AuthenticatedRequest> = {}
): AuthenticatedRequest {
  return {
    headers: {},
    params: {},
    ...overrides,
  } as AuthenticatedRequest;
}

/**
 * Create a mock Express response
 */
function createMockResponse() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    headersSent: false,
  };
  return res as Response;
}

/**
 * Create a mock next function
 */
function createMockNext(): NextFunction {
  return vi.fn() as NextFunction;
}

/**
 * Create test API key configurations
 */
function createTestApiKeyConfigs(): Map<string, ApiKeyConfig> {
  const configs = new Map<string, ApiKeyConfig>();

  // Admin user with all access
  configs.set('admin-key-123', {
    key: 'admin-key-123',
    userId: 'admin-user-1',
    roles: ['admin', 'qa_admin'],
    sandboxAccess: ['*'],
  });

  // QA Admin with specific sandbox access
  configs.set('qa-admin-key-456', {
    key: 'qa-admin-key-456',
    userId: 'qa-admin-1',
    roles: ['qa_admin'],
    sandboxAccess: ['sandbox-1', 'sandbox-2'],
  });

  // QA Tester with limited access
  configs.set('qa-tester-key-789', {
    key: 'qa-tester-key-789',
    userId: 'qa-tester-1',
    roles: ['qa_tester'],
    sandboxAccess: ['sandbox-1'],
  });

  // Regular user
  configs.set('user-key-abc', {
    key: 'user-key-abc',
    userId: 'regular-user-1',
    roles: ['user'],
    sandboxAccess: ['sandbox-1'],
  });

  return configs;
}

// =============================================================================
// Test Setup
// =============================================================================

describe('Authentication Middleware (CRITICAL-002)', () => {
  let originalConfigs: Map<string, ApiKeyConfig>;

  beforeEach(() => {
    // Save original configs
    originalConfigs = getApiKeyConfigs();
    // Set test configs
    setApiKeyConfigs(createTestApiKeyConfigs());
  });

  afterEach(() => {
    // Restore original configs
    setApiKeyConfigs(originalConfigs);
    vi.clearAllMocks();
  });

  // ===========================================================================
  // requireAuth Tests
  // ===========================================================================

  describe('requireAuth', () => {
    it('should reject requests without any authentication', async () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid API key', async () => {
      const req = createMockRequest({
        headers: { 'x-api-key': 'invalid-key' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authentication credentials' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept valid API key and attach caller', async () => {
      const req = createMockRequest({
        headers: { 'x-api-key': 'admin-key-123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.caller).toBeDefined();
      expect(req.caller!.userId).toBe('admin-user-1');
      expect(req.caller!.roles).toContain('admin');
    });

    it('should reject invalid Bearer token authentication', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer some-jwt-token' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid or expired session',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should not leak API key details in error messages', async () => {
      const req = createMockRequest({
        headers: { 'x-api-key': 'secret-invalid-key-with-sensitive-info' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      // Verify error message doesn't contain the actual key
      const errorResponse = (res.json as vi.Mock).mock.calls[0][0];
      expect(errorResponse.error).not.toContain('secret-invalid-key');
      expect(errorResponse.error).not.toContain('sensitive');
    });
  });

  // ===========================================================================
  // requireSandboxAccess Tests
  // ===========================================================================

  describe('requireSandboxAccess', () => {
    it('should allow admin access to any sandbox', () => {
      const req = createMockRequest({
        caller: {
          userId: 'admin-user-1',
          roles: ['admin'],
          sandboxAccess: [],
        },
        params: { sandboxId: 'any-sandbox' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.sandboxId).toBe('any-sandbox');
    });

    it('should allow qa_admin access to any sandbox', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-admin-1',
          roles: ['qa_admin'],
          sandboxAccess: [],
        },
        params: { sandboxId: 'any-sandbox' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow wildcard sandbox access', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-1',
          roles: ['user'],
          sandboxAccess: ['*'],
        },
        params: { sandboxId: 'any-sandbox' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow explicit sandbox access', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-1',
          roles: ['user'],
          sandboxAccess: ['sandbox-1', 'sandbox-2'],
        },
        params: { sandboxId: 'sandbox-1' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject access to unauthorized sandbox', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-1',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: { sandboxId: 'sandbox-2' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied to this sandbox' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if caller is missing', () => {
      const req = createMockRequest({
        params: { sandboxId: 'sandbox-1' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    it('should pass through if no sandboxId in params', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-1',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // requireSelfOrAdmin Tests
  // ===========================================================================

  describe('requireSelfOrAdmin', () => {
    it('should allow users to access their own resources', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-123',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: { userId: 'user-123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject access to other user resources', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-123',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: { userId: 'user-456' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied to other user resources' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow admin to access any user resources', () => {
      const req = createMockRequest({
        caller: {
          userId: 'admin-user',
          roles: ['admin'],
          sandboxAccess: ['*'],
        },
        params: { userId: 'any-user' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow qa_admin to access any user resources', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-admin-user',
          roles: ['qa_admin'],
          sandboxAccess: ['sandbox-1'],
        },
        params: { userId: 'any-user' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 401 if caller is missing', () => {
      const req = createMockRequest({
        params: { userId: 'user-123' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    it('should pass through if no userId in params', () => {
      const req = createMockRequest({
        caller: {
          userId: 'user-123',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // requireQARole Tests
  // ===========================================================================

  describe('requireQARole', () => {
    it('should allow user with qa_tester role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-tester-1',
          roles: ['qa_tester'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireQARole(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow user with qa_admin role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-admin-1',
          roles: ['qa_admin'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireQARole(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow user with admin role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'admin-1',
          roles: ['admin'],
          sandboxAccess: ['*'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireQARole(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject user without QA role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'regular-user',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireQARole(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'QA role required for this operation' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if caller is missing', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      requireQARole(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ===========================================================================
  // requireAdminRole Tests
  // ===========================================================================

  describe('requireAdminRole', () => {
    it('should allow user with admin role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'admin-1',
          roles: ['admin'],
          sandboxAccess: ['*'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireAdminRole(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow user with qa_admin role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-admin-1',
          roles: ['qa_admin'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireAdminRole(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject qa_tester role', () => {
      const req = createMockRequest({
        caller: {
          userId: 'qa-tester-1',
          roles: ['qa_tester'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireAdminRole(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Admin role required for this operation' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject regular user', () => {
      const req = createMockRequest({
        caller: {
          userId: 'regular-user',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireAdminRole(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ===========================================================================
  // Helper Function Tests
  // ===========================================================================

  describe('hasAdminRole', () => {
    it('should return true for admin role', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['admin'],
        sandboxAccess: [],
      };
      expect(hasAdminRole(caller)).toBe(true);
    });

    it('should return true for qa_admin role', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['qa_admin'],
        sandboxAccess: [],
      };
      expect(hasAdminRole(caller)).toBe(true);
    });

    it('should return false for non-admin roles', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['qa_tester', 'user'],
        sandboxAccess: [],
      };
      expect(hasAdminRole(caller)).toBe(false);
    });
  });

  describe('hasQARole', () => {
    it('should return true for qa_tester role', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['qa_tester'],
        sandboxAccess: [],
      };
      expect(hasQARole(caller)).toBe(true);
    });

    it('should return true for qa_admin role', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['qa_admin'],
        sandboxAccess: [],
      };
      expect(hasQARole(caller)).toBe(true);
    });

    it('should return true for admin role', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['admin'],
        sandboxAccess: [],
      };
      expect(hasQARole(caller)).toBe(true);
    });

    it('should return false for regular user', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['user'],
        sandboxAccess: [],
      };
      expect(hasQARole(caller)).toBe(false);
    });
  });

  describe('hasSandboxAccess', () => {
    it('should return true for admin role', () => {
      const caller: Caller = {
        userId: 'admin-1',
        roles: ['admin'],
        sandboxAccess: [],
      };
      expect(hasSandboxAccess(caller, 'any-sandbox')).toBe(true);
    });

    it('should return true for wildcard access', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['user'],
        sandboxAccess: ['*'],
      };
      expect(hasSandboxAccess(caller, 'any-sandbox')).toBe(true);
    });

    it('should return true for explicit access', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['user'],
        sandboxAccess: ['sandbox-1', 'sandbox-2'],
      };
      expect(hasSandboxAccess(caller, 'sandbox-1')).toBe(true);
      expect(hasSandboxAccess(caller, 'sandbox-2')).toBe(true);
    });

    it('should return false for unauthorized sandbox', () => {
      const caller: Caller = {
        userId: 'user-1',
        roles: ['user'],
        sandboxAccess: ['sandbox-1'],
      };
      expect(hasSandboxAccess(caller, 'sandbox-2')).toBe(false);
    });
  });

  // ===========================================================================
  // Error Message Security Tests
  // ===========================================================================

  describe('Error message security', () => {
    it('should not include sensitive information in sandbox denial', () => {
      const req = createMockRequest({
        caller: {
          userId: 'secret-user-id',
          roles: ['user'],
          sandboxAccess: ['secret-sandbox-access'],
        },
        params: { sandboxId: 'unauthorized-sandbox' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSandboxAccess(req, res, next);

      const errorResponse = (res.json as vi.Mock).mock.calls[0][0];
      expect(errorResponse.error).not.toContain('secret-user-id');
      expect(errorResponse.error).not.toContain('secret-sandbox-access');
      expect(errorResponse.error).not.toContain('unauthorized-sandbox');
    });

    it('should not include sensitive information in user access denial', () => {
      const req = createMockRequest({
        caller: {
          userId: 'secret-caller-id',
          roles: ['user'],
          sandboxAccess: ['sandbox-1'],
        },
        params: { userId: 'secret-target-id' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      requireSelfOrAdmin(req, res, next);

      const errorResponse = (res.json as vi.Mock).mock.calls[0][0];
      expect(errorResponse.error).not.toContain('secret-caller-id');
      expect(errorResponse.error).not.toContain('secret-target-id');
    });
  });

  // ===========================================================================
  // Constants Tests
  // ===========================================================================

  describe('Role constants', () => {
    it('should have correct ADMIN_ROLES', () => {
      expect(ADMIN_ROLES).toContain('admin');
      expect(ADMIN_ROLES).toContain('qa_admin');
      expect(ADMIN_ROLES).not.toContain('qa_tester');
    });

    it('should have correct QA_ROLES', () => {
      expect(QA_ROLES).toContain('admin');
      expect(QA_ROLES).toContain('qa_admin');
      expect(QA_ROLES).toContain('qa_tester');
      expect(QA_ROLES).not.toContain('user');
    });
  });
});
