/**
 * ConfigCache Tests
 *
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Tests multi-layer cache (L1 in-memory, L2 Redis), TTL, and metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConfigCache,
  createConfigCache,
} from '../../../src/services/config/ConfigCache.js';
import {
  getCacheMetricsRaw,
  resetCacheMetrics,
} from '../../../src/services/config/cacheMetrics.js';
import type { CurrentConfiguration } from '../../../src/db/types/config.types.js';

// =============================================================================
// Mock Redis
// =============================================================================

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted++;
      }
      return deleted;
    }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    }),
    store,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createTestConfig(overrides: Partial<CurrentConfiguration> = {}): CurrentConfiguration {
  return {
    serverId: 'server-123',
    thresholds: { 'tier-1': { bgt: 1000 } },
    featureGates: {},
    roleMappings: {},
    activeThemeId: null,
    lastRecordId: null,
    version: 1,
    schemaVersion: 1,
    createdAt: new Date('2026-01-20T10:00:00Z'),
    updatedAt: new Date('2026-01-20T12:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ConfigCache', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let cache: ConfigCache;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    resetCacheMetrics();

    cache = new ConfigCache({
      redis: mockRedis as any,
      logger: mockLogger as any,
      ttlMs: 5000, // 5 seconds for testing
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // L1 Cache Tests
  // ===========================================================================

  describe('L1 cache (in-memory)', () => {
    it('should cache config in L1 on set', async () => {
      const config = createTestConfig();

      await cache.set('server-123', config);

      // Get should hit L1
      const result = await cache.get('server-123');

      expect(result).not.toBeNull();
      expect(result?.serverId).toBe('server-123');

      // Redis get should not be called for L1 hit
      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheHits.get('l1')).toBe(1);
    });

    it('should expire L1 cache after TTL', async () => {
      const cache = new ConfigCache({
        redis: mockRedis as any,
        ttlMs: 50, // 50ms TTL
      });

      const config = createTestConfig();
      await cache.set('server-123', config);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should miss L1, hit L2
      const result = await cache.get('server-123');
      expect(result).not.toBeNull();

      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheHits.get('l2')).toBe(1);
    });
  });

  // ===========================================================================
  // L2 Cache Tests
  // ===========================================================================

  describe('L2 cache (Redis)', () => {
    it('should cache config in L2 on set', async () => {
      const config = createTestConfig();

      await cache.set('server-123', config);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'config:cache:server-123',
        5, // TTL in seconds (5000ms / 1000)
        expect.any(String)
      );
    });

    it('should hit L2 on L1 miss', async () => {
      // Pre-populate Redis
      const config = createTestConfig();
      mockRedis.store.set(
        'config:cache:server-123',
        JSON.stringify({
          ...config,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        })
      );

      // New cache instance (empty L1)
      const newCache = new ConfigCache({
        redis: mockRedis as any,
        logger: mockLogger as any,
      });

      const result = await newCache.get('server-123');

      expect(result).not.toBeNull();
      expect(result?.serverId).toBe('server-123');

      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheHits.get('l2')).toBe(1);
    });

    it('should populate L1 from L2 hit', async () => {
      // Pre-populate Redis
      const config = createTestConfig();
      mockRedis.store.set(
        'config:cache:server-123',
        JSON.stringify({
          ...config,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        })
      );

      // First get - L2 hit
      await cache.get('server-123');
      mockRedis.get.mockClear();

      // Second get - should be L1 hit (no Redis call)
      await cache.get('server-123');

      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheHits.get('l1')).toBe(1);
      expect(metrics.cacheHits.get('l2')).toBe(1);
    });
  });

  // ===========================================================================
  // Cache Miss Tests
  // ===========================================================================

  describe('cache miss', () => {
    it('should return null on complete miss', async () => {
      const result = await cache.get('nonexistent-server');

      expect(result).toBeNull();

      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheMisses).toBe(1);
    });
  });

  // ===========================================================================
  // Invalidation Tests
  // ===========================================================================

  describe('invalidate', () => {
    it('should remove from L1 and L2', async () => {
      const config = createTestConfig();
      await cache.set('server-123', config);

      await cache.invalidate('server-123');

      // Should miss now
      const result = await cache.get('server-123');
      expect(result).toBeNull();

      const metrics = getCacheMetricsRaw();
      expect(metrics.cacheInvalidations).toBe(1);
    });

    it('should handle invalidation of non-existent key', async () => {
      await cache.invalidate('nonexistent-server');

      // Should not throw
      const metrics = getCacheMetricsRaw();
      // No invalidation metric recorded since nothing was cached
      expect(metrics.cacheInvalidations).toBe(0);
    });
  });

  // ===========================================================================
  // Clear Tests
  // ===========================================================================

  describe('clear', () => {
    it('should clear all cached configs', async () => {
      await cache.set('server-1', createTestConfig({ serverId: 'server-1' }));
      await cache.set('server-2', createTestConfig({ serverId: 'server-2' }));

      await cache.clear();

      expect(await cache.get('server-1')).toBeNull();
      expect(await cache.get('server-2')).toBeNull();
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should handle Redis get error gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis unavailable'));

      const result = await cache.get('server-123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle Redis set error gracefully', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis unavailable'));

      const config = createTestConfig();

      // Should not throw
      await expect(cache.set('server-123', config)).resolves.not.toThrow();

      // L1 should still work
      const result = await cache.get('server-123');
      expect(result).not.toBeNull();
    });
  });

  // ===========================================================================
  // Stats Tests
  // ===========================================================================

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      await cache.set('server-1', createTestConfig({ serverId: 'server-1' }));
      await cache.set('server-2', createTestConfig({ serverId: 'server-2' }));

      const stats = cache.getStats();

      expect(stats.l1Size).toBe(2);
      expect(stats.ttlMs).toBe(5000);
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createConfigCache', () => {
  it('should create cache without Redis', () => {
    const cache = createConfigCache();

    expect(cache).toBeInstanceOf(ConfigCache);

    // Should still work for L1 only
    cache.set('server-1', createTestConfig());
    expect(cache.getStats().l1Size).toBe(1);
  });

  it('should create cache with Redis', () => {
    const mockRedis = createMockRedis();
    const cache = createConfigCache(mockRedis as any);

    expect(cache).toBeInstanceOf(ConfigCache);
  });
});
