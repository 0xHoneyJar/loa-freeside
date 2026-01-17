/**
 * L1 Cache Unit Tests
 * Sprint S-12: Multi-Layer Caching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { L1Cache } from '../../../src/infrastructure/cache/L1Cache.js';
import type { Logger } from 'pino';

// Mock logger
const mockLogger = {
  child: vi.fn().mockReturnThis(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

describe('L1Cache', () => {
  let cache: L1Cache;

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new L1Cache(mockLogger, {
      maxEntries: 100,
      defaultTtlMs: 1000, // 1 second for tests
      cleanupIntervalMs: 10000,
      enableStats: true,
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', { data: 'value1' });
      const result = cache.get<{ data: string }>('key1');
      expect(result).toEqual({ data: 'value1' });
    });

    it('should return undefined for missing keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should handle different value types', () => {
      cache.set('string', 'hello');
      cache.set('number', 42);
      cache.set('array', [1, 2, 3]);
      cache.set('object', { nested: { deep: true } });

      expect(cache.get('string')).toBe('hello');
      expect(cache.get('number')).toBe(42);
      expect(cache.get('array')).toEqual([1, 2, 3]);
      expect(cache.get<{ nested: { deep: boolean } }>('object')).toEqual({ nested: { deep: true } });
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache.set('expiring', 'value', 50); // 50ms TTL
      expect(cache.get('expiring')).toBe('value');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(cache.get('expiring')).toBeUndefined();
    });

    it('should use default TTL when not specified', () => {
      cache.set('default-ttl', 'value');
      expect(cache.get('default-ttl')).toBe('value');
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when at capacity', () => {
      // Create cache with small capacity
      const smallCache = new L1Cache(mockLogger, {
        maxEntries: 3,
        defaultTtlMs: 60000,
        cleanupIntervalMs: 60000,
        enableStats: true,
      });

      // Fill cache
      smallCache.set('a', 1);
      smallCache.set('b', 2);
      smallCache.set('c', 3);

      // Access 'a' to make it recently used
      smallCache.get('a');

      // Add new entry, should evict 'b' (least recently used)
      smallCache.set('d', 4);

      expect(smallCache.get('a')).toBe(1); // Still exists (recently used)
      expect(smallCache.get('b')).toBeUndefined(); // Evicted
      expect(smallCache.get('c')).toBe(3);
      expect(smallCache.get('d')).toBe(4);

      smallCache.destroy();
    });
  });

  describe('delete', () => {
    it('should delete existing entries', () => {
      cache.set('to-delete', 'value');
      expect(cache.delete('to-delete')).toBe(true);
      expect(cache.get('to-delete')).toBeUndefined();
    });

    it('should return false for non-existent entries', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for existing non-expired entries', () => {
      cache.set('exists', 'value');
      expect(cache.has('exists')).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired entries', async () => {
      cache.set('expiring', 'value', 50);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(cache.has('expiring')).toBe(false);
    });
  });

  describe('invalidateByPattern', () => {
    it('should invalidate entries matching pattern prefix', () => {
      cache.set('user:123:name', 'Alice');
      cache.set('user:123:email', 'alice@example.com');
      cache.set('user:456:name', 'Bob');
      cache.set('config:setting', 'value');

      const count = cache.invalidateByPattern('user:123:');

      expect(count).toBe(2);
      expect(cache.get('user:123:name')).toBeUndefined();
      expect(cache.get('user:123:email')).toBeUndefined();
      expect(cache.get('user:456:name')).toBe('Bob');
      expect(cache.get('config:setting')).toBe('value');
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('existing', 'value');

      cache.get('existing'); // Hit
      cache.get('existing'); // Hit
      cache.get('nonexistent'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should track sets and deletes', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.delete('key1');

      const stats = cache.getStats();
      expect(stats.sets).toBe(2);
      expect(stats.deletes).toBe(1);
    });

    it('should reset statistics', () => {
      cache.set('key', 'value');
      cache.get('key');
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('size', () => {
    it('should return current entry count', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
      cache.delete('key1');
      expect(cache.size).toBe(1);
    });
  });
});

describe('L1Cache Benchmark', () => {
  let cache: L1Cache;

  beforeEach(() => {
    cache = new L1Cache(mockLogger, {
      maxEntries: 100000,
      defaultTtlMs: 60000,
      cleanupIntervalMs: 60000,
      enableStats: false, // Disable stats for benchmark
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  it('should achieve sub-millisecond read latency', () => {
    // Populate cache
    for (let i = 0; i < 10000; i++) {
      cache.set(`key:${i}`, { id: i, data: `value-${i}` });
    }

    // Measure read latency
    const iterations = 10000;
    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      cache.get(`key:${i % 10000}`);
    }

    const end = process.hrtime.bigint();
    const totalNs = Number(end - start);
    const avgNs = totalNs / iterations;
    const avgMs = avgNs / 1_000_000;

    console.log(`L1 Cache Read Benchmark:`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total time: ${(totalNs / 1_000_000).toFixed(2)}ms`);
    console.log(`  Avg latency: ${avgMs.toFixed(4)}ms (${(avgNs / 1000).toFixed(2)}µs)`);

    // Assert sub-millisecond average latency
    expect(avgMs).toBeLessThan(1);
  });

  it('should achieve high write throughput', () => {
    const iterations = 10000;
    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      cache.set(`write:${i}`, { id: i, timestamp: Date.now() });
    }

    const end = process.hrtime.bigint();
    const totalMs = Number(end - start) / 1_000_000;
    const opsPerSec = (iterations / totalMs) * 1000;

    console.log(`L1 Cache Write Benchmark:`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total time: ${totalMs.toFixed(2)}ms`);
    console.log(`  Throughput: ${opsPerSec.toFixed(0)} ops/sec`);

    // Assert at least 100k ops/sec
    expect(opsPerSec).toBeGreaterThan(100000);
  });
});
