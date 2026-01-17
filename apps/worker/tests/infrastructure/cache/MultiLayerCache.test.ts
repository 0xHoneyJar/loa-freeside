/**
 * Multi-Layer Cache Unit Tests
 * Sprint S-12: Multi-Layer Caching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MultiLayerCache } from '../../../src/infrastructure/cache/MultiLayerCache.js';
import { CacheLayer } from '../../../src/infrastructure/cache/types.js';
import type { StateManager } from '../../../src/services/StateManager.js';
import type { Logger } from 'pino';

// Mock logger
const mockLogger = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

// Mock StateManager
const mockStateManager = {
  isConnected: vi.fn().mockReturnValue(true),
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn().mockReturnValue(() => {}),
} as unknown as StateManager;

describe('MultiLayerCache', () => {
  let cache: MultiLayerCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStateManager.get = vi.fn().mockResolvedValue(null);
    mockStateManager.set = vi.fn().mockResolvedValue(undefined);
    mockStateManager.delete = vi.fn().mockResolvedValue(undefined);
    mockStateManager.exists = vi.fn().mockResolvedValue(false);
    mockStateManager.publish = vi.fn().mockResolvedValue(1);

    cache = new MultiLayerCache(mockStateManager, mockLogger, {
      l1: {
        maxEntries: 1000,
        defaultTtlMs: 60000, // 1 minute
        cleanupIntervalMs: 30000,
        enableStats: true,
      },
      l2: {
        defaultTtlMs: 300000, // 5 minutes
        enableStats: true,
      },
      warmL1OnL2Hit: true,
      namespace: 'test',
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('get', () => {
    it('should return L1 hit when data is in L1', async () => {
      // Set value in cache (will be in L1)
      await cache.set('key1', { data: 'value1' });

      const result = await cache.get<{ data: string }>('key1');

      expect(result.value).toEqual({ data: 'value1' });
      expect(result.layer).toBe(CacheLayer.L1_MEMORY);
      expect(result.latencyMs).toBeDefined();
    });

    it('should return L2 hit when data is only in L2', async () => {
      // Mock L2 returning data
      mockStateManager.get = vi.fn().mockResolvedValue(JSON.stringify({ data: 'from-l2' }));

      const result = await cache.get<{ data: string }>('key2');

      expect(result.value).toEqual({ data: 'from-l2' });
      expect(result.layer).toBe(CacheLayer.L2_REDIS);
    });

    it('should warm L1 on L2 hit when enabled', async () => {
      // Mock L2 returning data
      mockStateManager.get = vi.fn().mockResolvedValue(JSON.stringify({ data: 'from-l2' }));

      // First call - L2 hit, warms L1
      await cache.get<{ data: string }>('key3');

      // Reset mock so L2 returns null
      mockStateManager.get = vi.fn().mockResolvedValue(null);

      // Second call - should hit L1 (warmed)
      const result = await cache.get<{ data: string }>('key3');

      expect(result.value).toEqual({ data: 'from-l2' });
      expect(result.layer).toBe(CacheLayer.L1_MEMORY);
    });

    it('should return MISS when data not found', async () => {
      const result = await cache.get('nonexistent');

      expect(result.value).toBeNull();
      expect(result.layer).toBe(CacheLayer.MISS);
    });
  });

  describe('getOrCompute', () => {
    it('should return cached value if available', async () => {
      await cache.set('existing', { computed: false });

      const result = await cache.getOrCompute('existing', async () => ({ computed: true }));

      expect(result.value).toEqual({ computed: false });
      expect(result.layer).toBe(CacheLayer.L1_MEMORY);
    });

    it('should compute and cache value on miss', async () => {
      const computeFn = vi.fn().mockResolvedValue({ computed: true });

      const result = await cache.getOrCompute('new-key', computeFn);

      expect(computeFn).toHaveBeenCalled();
      expect(result.value).toEqual({ computed: true });
      expect(result.layer).toBe(CacheLayer.MISS);

      // Verify it was cached
      const cached = await cache.get<{ computed: boolean }>('new-key');
      expect(cached.value).toEqual({ computed: true });
      expect(cached.layer).toBe(CacheLayer.L1_MEMORY);
    });
  });

  describe('set', () => {
    it('should set value in both L1 and L2', async () => {
      await cache.set('key', { data: 'value' });

      // Verify L1 has value
      const l1Result = await cache.get('key');
      expect(l1Result.layer).toBe(CacheLayer.L1_MEMORY);

      // Verify L2 was called
      expect(mockStateManager.set).toHaveBeenCalledWith(
        'test:key',
        JSON.stringify({ data: 'value' }),
        300000 // Default L2 TTL
      );
    });

    it('should use custom TTLs when provided', async () => {
      await cache.set('key', { data: 'value' }, { l1TtlMs: 30000, l2TtlMs: 60000 });

      expect(mockStateManager.set).toHaveBeenCalledWith(
        'test:key',
        JSON.stringify({ data: 'value' }),
        60000
      );
    });
  });

  describe('delete', () => {
    it('should delete from both L1 and L2', async () => {
      await cache.set('to-delete', { data: 'value' });
      mockStateManager.exists = vi.fn().mockResolvedValue(true);

      await cache.delete('to-delete');

      // Verify L1 doesn't have value
      mockStateManager.get = vi.fn().mockResolvedValue(null);
      const result = await cache.get('to-delete');
      expect(result.layer).toBe(CacheLayer.MISS);

      // Verify L2 delete was called
      expect(mockStateManager.delete).toHaveBeenCalledWith('test:to-delete');
    });
  });

  describe('has', () => {
    it('should return L1 layer when in L1', async () => {
      await cache.set('exists-l1', 'value');

      const result = await cache.has('exists-l1');

      expect(result.exists).toBe(true);
      expect(result.layer).toBe(CacheLayer.L1_MEMORY);
    });

    it('should return L2 layer when only in L2', async () => {
      mockStateManager.exists = vi.fn().mockResolvedValue(true);

      const result = await cache.has('exists-l2');

      expect(result.exists).toBe(true);
      expect(result.layer).toBe(CacheLayer.L2_REDIS);
    });

    it('should return MISS when not found', async () => {
      const result = await cache.has('nonexistent');

      expect(result.exists).toBe(false);
      expect(result.layer).toBe(CacheLayer.MISS);
    });
  });

  describe('invalidateByPattern', () => {
    it('should invalidate L1 entries and broadcast to L2', async () => {
      await cache.set('prefix:key1', 'value1');
      await cache.set('prefix:key2', 'value2');
      await cache.set('other:key3', 'value3');

      await cache.invalidateByPattern('prefix:');

      // Verify L1 entries are gone
      const result1 = await cache.get('prefix:key1');
      expect(result1.layer).toBe(CacheLayer.MISS);

      // Verify L2 publish was called for invalidation
      expect(mockStateManager.publish).toHaveBeenCalled();
    });
  });

  describe('statistics', () => {
    it('should track combined statistics', async () => {
      // Generate some activity
      await cache.set('stat-key', 'value');
      await cache.get('stat-key'); // L1 hit
      await cache.get('missing'); // Miss

      const stats = cache.getStats();

      expect(stats.l1.hits).toBeGreaterThanOrEqual(1);
      expect(stats.combined).toBeDefined();
    });

    it('should reset statistics', async () => {
      await cache.set('key', 'value');
      await cache.get('key');

      cache.resetStats();
      const stats = cache.getStats();

      expect(stats.l1.hits).toBe(0);
      expect(stats.l1.misses).toBe(0);
    });
  });

  describe('l1Size', () => {
    it('should return L1 cache size', async () => {
      expect(cache.l1Size).toBe(0);

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      expect(cache.l1Size).toBe(2);
    });
  });
});
