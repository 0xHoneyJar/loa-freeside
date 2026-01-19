/**
 * Optimistic Lock Middleware Tests
 *
 * Sprint 122: Optimistic Locking
 *
 * Tests version extraction, conflict handling, and retry flow.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createOptimisticLockMiddleware,
  type OptimisticLockRequest,
} from '../../../src/api/middleware/optimisticLock.js';
import {
  getOptimisticLockMetricsRaw,
  resetOptimisticLockMetrics,
  getConflictRate,
  isHighConflictRate,
} from '../../../src/api/middleware/optimisticLockMetrics.js';
import { ConflictError } from '../../../src/api/errors.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    params: {},
    path: '/test',
    ...overrides,
  } as Request;
}

function createMockResponse(): Response & {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response & {
    json: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
}

function createMockNext(): NextFunction {
  return vi.fn();
}

// =============================================================================
// Version Extraction Tests
// =============================================================================

describe('createOptimisticLockMiddleware', () => {
  beforeEach(() => {
    resetOptimisticLockMetrics();
    vi.clearAllMocks();
  });

  describe('extractVersion', () => {
    it('should extract version from header', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        headers: { 'x-expected-version': '5' },
      });

      const version = extractVersion(req);
      expect(version).toBe(5);
    });

    it('should extract version from body field', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        body: { expectedVersion: 10 },
      });

      const version = extractVersion(req);
      expect(version).toBe(10);
    });

    it('should extract version from fallback body field', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        body: { version: 15 },
      });

      const version = extractVersion(req);
      expect(version).toBe(15);
    });

    it('should prefer header over body', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        headers: { 'x-expected-version': '5' },
        body: { expectedVersion: 10 },
      });

      const version = extractVersion(req);
      expect(version).toBe(5);
    });

    it('should prefer expectedVersion over version in body', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        body: { expectedVersion: 10, version: 5 },
      });

      const version = extractVersion(req);
      expect(version).toBe(10);
    });

    it('should return null for missing version', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({});

      const version = extractVersion(req);
      expect(version).toBeNull();
    });

    it('should return null for invalid version', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        headers: { 'x-expected-version': 'invalid' },
      });

      const version = extractVersion(req);
      expect(version).toBeNull();
    });

    it('should handle string version in body', () => {
      const { extractVersion } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        body: { expectedVersion: '20' },
      });

      const version = extractVersion(req);
      expect(version).toBe(20);
    });

    it('should use custom header name', () => {
      const { extractVersion } = createOptimisticLockMiddleware({
        headerName: 'x-custom-version',
      });
      const req = createMockRequest({
        headers: { 'x-custom-version': '25' },
      });

      const version = extractVersion(req);
      expect(version).toBe(25);
    });

    it('should use custom body field', () => {
      const { extractVersion } = createOptimisticLockMiddleware({
        bodyField: 'customVersion',
      });
      const req = createMockRequest({
        body: { customVersion: 30 },
      });

      const version = extractVersion(req);
      expect(version).toBe(30);
    });
  });

  describe('optimisticLock middleware', () => {
    it('should attach version to request', async () => {
      const { optimisticLock } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        headers: { 'x-expected-version': '5' },
      }) as OptimisticLockRequest;
      const res = createMockResponse();
      const next = createMockNext();

      await optimisticLock(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.expectedVersion).toBe(5);
    });

    it('should return 400 when required version is missing', async () => {
      const { optimisticLock } = createOptimisticLockMiddleware({ required: true });
      const req = createMockRequest({}) as OptimisticLockRequest;
      const res = createMockResponse();
      const next = createMockNext();

      await optimisticLock(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VERSION_REQUIRED',
        })
      );
    });

    it('should continue when optional version is missing', async () => {
      const { optimisticLock } = createOptimisticLockMiddleware({ required: false });
      const req = createMockRequest({}) as OptimisticLockRequest;
      const res = createMockResponse();
      const next = createMockNext();

      await optimisticLock(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should record version check metric', async () => {
      const { optimisticLock } = createOptimisticLockMiddleware();
      const req = createMockRequest({
        headers: { 'x-expected-version': '5' },
      }) as OptimisticLockRequest;
      const res = createMockResponse();
      const next = createMockNext();

      await optimisticLock(req, res, next);

      const metrics = getOptimisticLockMetricsRaw();
      expect(metrics.versionChecks).toBe(1);
    });
  });

  describe('handleVersionConflict error handler', () => {
    it('should handle OptimisticLockError with 409 response', () => {
      const { handleVersionConflict } = createOptimisticLockMiddleware();
      const req = createMockRequest({}) as OptimisticLockRequest;
      req.serverId = 'server-123';
      req.expectedVersion = 5;
      req.dashboardSession = {
        userId: 'user-123',
        username: 'test',
        avatar: null,
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: Date.now() + 3600000,
        adminGuilds: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const error = new Error('Version conflict for server server-123: expected 5, got 10');
      error.name = 'OptimisticLockError';

      const res = createMockResponse();
      const next = createMockNext();

      handleVersionConflict(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VERSION_CONFLICT',
          details: expect.objectContaining({
            currentVersion: 10,
            yourVersion: 5,
          }),
        })
      );
    });

    it('should record version conflict metric', () => {
      const { handleVersionConflict } = createOptimisticLockMiddleware();
      const req = createMockRequest({}) as OptimisticLockRequest;
      req.serverId = 'server-123';
      req.expectedVersion = 5;

      const error = new Error('Version conflict: expected 5, got 10');
      error.name = 'OptimisticLockError';

      const res = createMockResponse();
      const next = createMockNext();

      handleVersionConflict(error, req, res, next);

      const metrics = getOptimisticLockMetricsRaw();
      expect(metrics.versionConflicts).toBe(1);
    });

    it('should pass non-conflict errors to next handler', () => {
      const { handleVersionConflict } = createOptimisticLockMiddleware();
      const req = createMockRequest({}) as OptimisticLockRequest;
      const error = new Error('Some other error');
      const res = createMockResponse();
      const next = createMockNext();

      handleVersionConflict(error, req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle ApiError directly', () => {
      const { handleVersionConflict } = createOptimisticLockMiddleware();
      const req = createMockRequest({}) as OptimisticLockRequest;
      const error = new ConflictError('server-123', 10, 5);
      const res = createMockResponse();
      const next = createMockNext();

      handleVersionConflict(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// ConflictError Tests
// =============================================================================

describe('ConflictError', () => {
  it('should create with correct properties', () => {
    const error = new ConflictError('server-123', 10, 5);

    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('VERSION_CONFLICT');
    expect(error.currentVersion).toBe(10);
    expect(error.yourVersion).toBe(5);
    expect(error.serverId).toBe('server-123');
  });

  it('should include details in toJSON', () => {
    const error = new ConflictError('server-123', 10, 5);
    const json = error.toJSON();

    expect(json.error).toBe('VERSION_CONFLICT');
    expect(json.details).toEqual(
      expect.objectContaining({
        currentVersion: 10,
        yourVersion: 5,
        serverId: 'server-123',
      })
    );
  });

  it('should create helpful message', () => {
    const error = new ConflictError('server-123', 10, 5);

    expect(error.message).toContain('version 5');
    expect(error.message).toContain('version is 10');
    expect(error.message).toContain('refresh and retry');
  });
});

// =============================================================================
// Metrics Tests
// =============================================================================

describe('Optimistic Lock Metrics', () => {
  beforeEach(() => {
    resetOptimisticLockMetrics();
  });

  it('should track conflict rate', () => {
    // Add 3 conflicts
    for (let i = 0; i < 3; i++) {
      const { handleVersionConflict } = createOptimisticLockMiddleware();
      const req = createMockRequest({}) as OptimisticLockRequest;
      req.serverId = 'server-123';
      req.expectedVersion = 5;

      const error = new Error('Version conflict: expected 5, got 10');
      error.name = 'OptimisticLockError';

      handleVersionConflict(error, req, createMockResponse(), createMockNext());
    }

    const metrics = getOptimisticLockMetricsRaw();
    expect(metrics.versionConflicts).toBe(3);
    expect(metrics.conflictTimestamps).toHaveLength(3);
  });

  it('should calculate conflict rate', () => {
    // Rate should be 0 initially
    expect(getConflictRate()).toBe(0);

    // Add some conflicts
    const { handleVersionConflict } = createOptimisticLockMiddleware();
    for (let i = 0; i < 60; i++) {
      const req = createMockRequest({}) as OptimisticLockRequest;
      req.serverId = 'server-123';
      req.expectedVersion = 5;

      const error = new Error('Version conflict: expected 5, got 10');
      error.name = 'OptimisticLockError';

      handleVersionConflict(error, req, createMockResponse(), createMockNext());
    }

    // 60 conflicts in 10 minutes = 0.1/sec
    const rate = getConflictRate();
    expect(rate).toBeGreaterThan(0);
  });

  it('should detect high conflict rate', () => {
    // Add many conflicts to exceed threshold
    const { handleVersionConflict } = createOptimisticLockMiddleware();
    for (let i = 0; i < 100; i++) {
      const req = createMockRequest({}) as OptimisticLockRequest;
      req.serverId = 'server-123';
      req.expectedVersion = 5;

      const error = new Error('Version conflict: expected 5, got 10');
      error.name = 'OptimisticLockError';

      handleVersionConflict(error, req, createMockResponse(), createMockNext());
    }

    // 100 conflicts should exceed 0.1/sec threshold
    expect(isHighConflictRate(0.1)).toBe(true);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Client Retry Flow', () => {
  beforeEach(() => {
    resetOptimisticLockMetrics();
  });

  it('should provide enough info for client to retry', () => {
    const { handleVersionConflict } = createOptimisticLockMiddleware();
    const req = createMockRequest({}) as OptimisticLockRequest;
    req.serverId = 'server-123';
    req.expectedVersion = 5;

    const error = new Error('Version conflict for server server-123: expected 5, got 10');
    error.name = 'OptimisticLockError';

    const res = createMockResponse();
    handleVersionConflict(error, req, res, createMockNext());

    // Verify response has all info needed for retry
    const responseCall = res.json.mock.calls[0][0];
    expect(responseCall.details.currentVersion).toBe(10);
    expect(responseCall.details.serverId).toBe('server-123');
    expect(responseCall.message).toContain('refresh');

    // Client can now:
    // 1. Fetch current config to see changes
    // 2. Merge their changes with current state
    // 3. Retry with new expectedVersion: 10
  });
});
