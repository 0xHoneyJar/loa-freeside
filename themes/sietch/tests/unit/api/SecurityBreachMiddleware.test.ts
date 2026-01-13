/**
 * SecurityBreachMiddleware Tests (Sprint 67 - Fail-Closed Pattern)
 *
 * Tests for the 503 fail-closed middleware that ensures security
 * service availability for critical operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock RedisService
vi.mock('../../../src/services/cache/RedisService.js', () => ({
  redisService: {
    isConnected: vi.fn(),
    getConnectionStatus: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock config to avoid validation errors in tests
vi.mock('../../../src/config.js', () => ({
  config: {
    redis: { url: 'redis://localhost:6379' },
    features: { billingEnabled: false },
    paddle: {},
  },
  validateApiKey: vi.fn(),
}));

describe('SecurityBreachMiddleware', () => {
  let mockRedisService: any;
  let securityBreachMiddleware: any;
  let securityHealthHandler: any;
  let getSecurityServiceStatus: any;
  let resetSecurityBreach503Count: any;
  let getSecurityBreach503Count: any;
  let updateSecurityServiceStatus: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocks
    const redisModule = await import('../../../src/services/cache/RedisService.js');
    mockRedisService = redisModule.redisService;

    // Import middleware
    const middlewareModule = await import('../../../src/api/middleware.js');
    securityBreachMiddleware = middlewareModule.securityBreachMiddleware;
    securityHealthHandler = middlewareModule.securityHealthHandler;
    getSecurityServiceStatus = middlewareModule.getSecurityServiceStatus;
    resetSecurityBreach503Count = middlewareModule.resetSecurityBreach503Count;
    getSecurityBreach503Count = middlewareModule.getSecurityBreach503Count;
    updateSecurityServiceStatus = middlewareModule.updateSecurityServiceStatus;

    // Reset counters
    resetSecurityBreach503Count();

    // Default: Redis is connected
    mockRedisService.isConnected.mockReturnValue(true);
    mockRedisService.getConnectionStatus.mockReturnValue({
      connected: true,
      error: null,
      status: 'ready',
    });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function createMockRequest(path: string, method: string = 'POST'): Request {
    return {
      path,
      method,
    } as Request;
  }

  function createMockResponse(): Response & { _statusCode?: number; _json?: any; _headers?: Record<string, string> } {
    const res: any = {
      _statusCode: 200,
      _json: null,
      _headers: {},
      status: vi.fn().mockImplementation(function(this: any, code: number) {
        this._statusCode = code;
        return this;
      }),
      json: vi.fn().mockImplementation(function(this: any, data: any) {
        this._json = data;
        return this;
      }),
      setHeader: vi.fn().mockImplementation(function(this: any, name: string, value: string) {
        this._headers[name] = value;
        return this;
      }),
    };
    return res;
  }

  // ===========================================================================
  // Distributed Lock Routes (Redis Required)
  // ===========================================================================

  describe('Routes requiring distributed locking', () => {
    it('should return 503 when Redis unavailable for /billing/webhook', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res._json).toMatchObject({
        error: 'Service temporarily unavailable',
        retryAfter: 30,
      });
      expect(res._headers['Retry-After']).toBe('30');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 503 when Redis unavailable for /admin/boosts', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/admin/boosts');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 503 when Redis unavailable for /badges/purchase', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/badges/purchase');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow request when Redis is connected', async () => {
      mockRedisService.isConnected.mockReturnValue(true);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Non-Critical Routes
  // ===========================================================================

  describe('Routes not requiring distributed locking', () => {
    it('should allow /health endpoint even if Redis unavailable', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/health');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow /api/members endpoint even if Redis unavailable', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/api/members');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Metrics
  // ===========================================================================

  describe('Metrics tracking', () => {
    it('should increment 503 counter on each security breach', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/billing/webhook');
      const res1 = createMockResponse();
      const res2 = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res1, next);
      await securityBreachMiddleware(req, res2, next);

      expect(getSecurityBreach503Count()).toBe(2);
    });

    it('should not increment counter for allowed requests', async () => {
      mockRedisService.isConnected.mockReturnValue(true);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(getSecurityBreach503Count()).toBe(0);
    });
  });

  // ===========================================================================
  // Security Service Status
  // ===========================================================================

  describe('Security service status', () => {
    it('should update Redis status when unavailable', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      const status = getSecurityServiceStatus();
      expect(status.redis).toBe(false);
      expect(status.overall).toBe(false);
    });

    it('should update Redis status when healthy', async () => {
      // First mark unhealthy
      updateSecurityServiceStatus({ redis: false });
      expect(getSecurityServiceStatus().redis).toBe(false);

      // Then make a successful request
      mockRedisService.isConnected.mockReturnValue(true);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      const status = getSecurityServiceStatus();
      expect(status.redis).toBe(true);
      expect(status.overall).toBe(true);
    });
  });

  // ===========================================================================
  // Security Health Handler
  // ===========================================================================

  describe('securityHealthHandler', () => {
    it('should return healthy status when Redis connected', () => {
      mockRedisService.isConnected.mockReturnValue(true);
      mockRedisService.getConnectionStatus.mockReturnValue({
        connected: true,
        error: null,
        status: 'ready',
      });

      const req = createMockRequest('/health/security', 'GET');
      const res = createMockResponse();

      securityHealthHandler(req, res);

      expect(res._json.status).toBe('healthy');
      expect(res._json.services.redis.healthy).toBe(true);
    });

    it('should return 503 with unhealthy status when Redis disconnected', () => {
      mockRedisService.isConnected.mockReturnValue(false);
      mockRedisService.getConnectionStatus.mockReturnValue({
        connected: false,
        error: 'Connection refused',
        status: 'disconnected',
      });

      const req = createMockRequest('/health/security', 'GET');
      const res = createMockResponse();

      securityHealthHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res._json.status).toBe('unhealthy');
      expect(res._json.services.redis.healthy).toBe(false);
      expect(res._json.services.redis.error).toBe('Connection refused');
    });

    it('should include metrics in response', async () => {
      // Generate some 503s first
      mockRedisService.isConnected.mockReturnValue(false);

      const webhookReq = createMockRequest('/billing/webhook');
      const webhookRes = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(webhookReq, webhookRes, next);

      // Now check health endpoint
      mockRedisService.isConnected.mockReturnValue(true);
      mockRedisService.getConnectionStatus.mockReturnValue({
        connected: true,
        error: null,
        status: 'ready',
      });

      const healthReq = createMockRequest('/health/security', 'GET');
      const healthRes = createMockResponse();

      securityHealthHandler(healthReq, healthRes);

      expect(healthRes._json.metrics.securityBreach503Count).toBe(1);
    });
  });

  // ===========================================================================
  // Retry-After Header
  // ===========================================================================

  describe('Retry-After header', () => {
    it('should set Retry-After header to 30 seconds', async () => {
      mockRedisService.isConnected.mockReturnValue(false);

      const req = createMockRequest('/billing/webhook');
      const res = createMockResponse();
      const next = vi.fn();

      await securityBreachMiddleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    });
  });
});
