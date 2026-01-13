/**
 * RedisService Tests (v4.0 - Sprint 24)
 *
 * Tests for Redis connection management and caching functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Entitlements } from '../../../types/billing.js';

// Mock ioredis
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      status: 'ready',
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn(),
      set: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      info: vi.fn(),
      quit: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
    })),
  };
});

// Mock config
vi.mock('../../../src/config.js', () => ({
  config: {
    redis: {
      url: 'redis://localhost:6379',
      maxRetries: 3,
      connectTimeout: 5000,
      entitlementTtl: 300,
    },
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RedisService', () => {
  let redisService: any;
  let mockRedisClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import RedisService after mocks are set up
    const module = await import('../../../src/services/cache/RedisService.js');
    redisService = module.redisService;

    // Reset service state
    if (redisService.client) {
      await redisService.disconnect();
    }

    await redisService.connect();
    mockRedisClient = redisService.client;
  });

  afterEach(async () => {
    if (redisService.client) {
      await redisService.disconnect();
    }
  });

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  describe('connect', () => {
    it('should connect to Redis successfully', async () => {
      expect(redisService.isConnected()).toBe(true);
      expect(mockRedisClient.status).toBe('ready');
    });

    it('should handle Redis URL not configured', async () => {
      const { config } = await import('../../../config.js');
      const originalUrl = config.redis.url;
      config.redis.url = undefined;

      await redisService.disconnect();
      await redisService.connect();

      expect(redisService.isConnected()).toBe(false);

      // Restore
      config.redis.url = originalUrl;
    });

    it('should not reconnect if already connected', async () => {
      const pingCallCount = mockRedisClient.ping.mock.calls.length;
      await redisService.connect();
      expect(mockRedisClient.ping.mock.calls.length).toBe(pingCallCount);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      await redisService.disconnect();
      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(redisService.client).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', () => {
      expect(redisService.isConnected()).toBe(true);
    });

    it('should return false when disconnected', async () => {
      await redisService.disconnect();
      expect(redisService.isConnected()).toBe(false);
    });
  });

  describe('getConnectionStatus', () => {
    it('should return connection status', () => {
      const status = redisService.getConnectionStatus();
      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('error');
      expect(status).toHaveProperty('status');
    });
  });

  // ===========================================================================
  // Basic Operations
  // ===========================================================================

  describe('get', () => {
    it('should get value from Redis', async () => {
      mockRedisClient.get.mockResolvedValue('test-value');
      const result = await redisService.get('test-key');
      expect(result).toBe('test-value');
      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null if key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await redisService.get('missing-key');
      expect(result).toBeNull();
    });

    it('should return null if Redis unavailable', async () => {
      await redisService.disconnect();
      const result = await redisService.get('test-key');
      expect(result).toBeNull();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));
      const result = await redisService.get('test-key');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set value without TTL', async () => {
      await redisService.set('test-key', 'test-value');
      expect(mockRedisClient.set).toHaveBeenCalledWith('test-key', 'test-value');
    });

    it('should set value with TTL', async () => {
      await redisService.set('test-key', 'test-value', 300);
      expect(mockRedisClient.setex).toHaveBeenCalledWith('test-key', 300, 'test-value');
    });

    it('should do nothing if Redis unavailable', async () => {
      await redisService.disconnect();
      await redisService.set('test-key', 'test-value');
      // Should not throw
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.setex.mockRejectedValue(new Error('Redis error'));
      await redisService.set('test-key', 'test-value', 300);
      // Should not throw
    });
  });

  describe('del', () => {
    it('should delete key from Redis', async () => {
      await redisService.del('test-key');
      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
    });

    it('should do nothing if Redis unavailable', async () => {
      await redisService.disconnect();
      await redisService.del('test-key');
      // Should not throw
    });
  });

  describe('exists', () => {
    it('should return true if key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      const result = await redisService.exists('test-key');
      expect(result).toBe(true);
    });

    it('should return false if key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      const result = await redisService.exists('test-key');
      expect(result).toBe(false);
    });

    it('should return false if Redis unavailable', async () => {
      await redisService.disconnect();
      const result = await redisService.exists('test-key');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Entitlement Cache Helpers
  // ===========================================================================

  describe('getEntitlements', () => {
    it('should get cached entitlements', async () => {
      const cachedData = {
        communityId: 'test-community',
        tier: 'premium',
        maxMembers: 1000,
        features: ['nine_tier_system', 'stats_leaderboard'],
        source: 'subscription',
        inGracePeriod: false,
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await redisService.getEntitlements('test-community');
      expect(result).toMatchObject({
        communityId: 'test-community',
        tier: 'premium',
        maxMembers: 1000,
      });
    });

    it('should return null if no cached entitlements', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await redisService.getEntitlements('test-community');
      expect(result).toBeNull();
    });

    it('should return null if cached data is invalid JSON', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');
      const result = await redisService.getEntitlements('test-community');
      expect(result).toBeNull();
    });
  });

  describe('setEntitlements', () => {
    it('should cache entitlements with TTL', async () => {
      const entitlements: Entitlements = {
        communityId: 'test-community',
        tier: 'premium',
        maxMembers: 1000,
        features: ['nine_tier_system', 'stats_leaderboard'],
        source: 'subscription',
        inGracePeriod: false,
        cachedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
      };

      await redisService.setEntitlements('test-community', entitlements);
      expect(mockRedisClient.setex).toHaveBeenCalled();
      const call = mockRedisClient.setex.mock.calls[0];
      expect(call[0]).toBe('entitlement:test-community');
      expect(call[1]).toBe(300); // TTL
      expect(JSON.parse(call[2])).toMatchObject({
        communityId: 'test-community',
        tier: 'premium',
      });
    });
  });

  describe('invalidateEntitlements', () => {
    it('should delete entitlements from cache', async () => {
      await redisService.invalidateEntitlements('test-community');
      expect(mockRedisClient.del).toHaveBeenCalledWith('entitlement:test-community');
    });
  });

  // ===========================================================================
  // Webhook Deduplication Helpers
  // ===========================================================================

  describe('isEventProcessed', () => {
    it('should return true if event exists in cache', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      const result = await redisService.isEventProcessed('evt_test123');
      expect(result).toBe(true);
    });

    it('should return false if event does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      const result = await redisService.isEventProcessed('evt_test123');
      expect(result).toBe(false);
    });
  });

  describe('markEventProcessed', () => {
    it('should mark event as processed with 24h TTL', async () => {
      await redisService.markEventProcessed('evt_test123');
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'webhook:event:evt_test123',
        86400,
        'processed'
      );
    });
  });

  // ===========================================================================
  // Event Lock Helpers
  // ===========================================================================

  describe('acquireEventLock', () => {
    it('should acquire lock successfully', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      const result = await redisService.acquireEventLock('evt_test123');
      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'webhook:lock:evt_test123',
        '1',
        'EX',
        30,
        'NX'
      );
    });

    it('should fail to acquire lock if already held', async () => {
      mockRedisClient.set.mockResolvedValue(null);
      const result = await redisService.acquireEventLock('evt_test123');
      expect(result).toBe(false);
    });

    it('should allow processing if Redis unavailable', async () => {
      await redisService.disconnect();
      const result = await redisService.acquireEventLock('evt_test123');
      expect(result).toBe(true);
    });

    it('should allow processing on error', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Redis error'));
      const result = await redisService.acquireEventLock('evt_test123');
      expect(result).toBe(true);
    });
  });

  describe('releaseEventLock', () => {
    it('should release lock', async () => {
      await redisService.releaseEventLock('evt_test123');
      expect(mockRedisClient.del).toHaveBeenCalledWith('webhook:lock:evt_test123');
    });
  });

  // ===========================================================================
  // Health & Monitoring
  // ===========================================================================

  describe('ping', () => {
    it('should return true on successful ping', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');
      const result = await redisService.ping();
      expect(result).toBe(true);
    });

    it('should return false if Redis unavailable', async () => {
      await redisService.disconnect();
      const result = await redisService.ping();
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Redis error'));
      const result = await redisService.ping();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return Redis stats', async () => {
      mockRedisClient.info.mockResolvedValue('# Stats\r\ntotal_commands_processed:1000\r\n');
      const result = await redisService.getInfo();
      expect(result).toHaveProperty('total_commands_processed', '1000');
    });

    it('should return null if Redis unavailable', async () => {
      await redisService.disconnect();
      const result = await redisService.getInfo();
      expect(result).toBeNull();
    });
  });
});
