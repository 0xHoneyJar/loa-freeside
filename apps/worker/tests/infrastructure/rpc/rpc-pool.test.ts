/**
 * RPC Pool Tests
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Tests for multi-provider RPC access with circuit breakers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RPCPool } from '../../../src/infrastructure/rpc/rpc-pool.js';
import { RPCCache } from '../../../src/infrastructure/rpc/cache.js';
import { RPCMetrics } from '../../../src/infrastructure/rpc/metrics.js';
import type { RPCProvider, CircuitBreakerOptions } from '../../../src/infrastructure/rpc/types.js';
import pino from 'pino';

// Mock viem module
vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    readContract: vi.fn(),
    getBlockNumber: vi.fn(),
  })),
  http: vi.fn((url: string) => ({ url })),
  fallback: vi.fn((transports: unknown[]) => ({ transports })),
}));

// Mock opossum
vi.mock('opossum', () => {
  return {
    default: vi.fn().mockImplementation((fn, options) => {
      let isOpen = false;
      let isHalfOpen = false;
      const eventHandlers: Map<string, Function[]> = new Map();

      return {
        fire: async (...args: unknown[]) => {
          if (isOpen && !isHalfOpen) {
            const rejectHandlers = eventHandlers.get('reject') || [];
            rejectHandlers.forEach((h) => h());
            throw new Error('Circuit is open');
          }
          try {
            const result = await fn(...args);
            const successHandlers = eventHandlers.get('success') || [];
            successHandlers.forEach((h) => h());
            return result;
          } catch (error) {
            const failureHandlers = eventHandlers.get('failure') || [];
            failureHandlers.forEach((h) => h());
            throw error;
          }
        },
        get opened() {
          return isOpen;
        },
        get halfOpen() {
          return isHalfOpen;
        },
        open: () => {
          isOpen = true;
          isHalfOpen = false;
          const handlers = eventHandlers.get('open') || [];
          handlers.forEach((h) => h());
        },
        close: () => {
          isOpen = false;
          isHalfOpen = false;
          const handlers = eventHandlers.get('close') || [];
          handlers.forEach((h) => h());
        },
        on: (event: string, handler: Function) => {
          if (!eventHandlers.has(event)) {
            eventHandlers.set(event, []);
          }
          eventHandlers.get(event)!.push(handler);
        },
      };
    }),
  };
});

// Create test logger
const logger = pino({ level: 'silent' });

// Test providers
const testProviders: RPCProvider[] = [
  { name: 'provider1', url: 'https://rpc1.test', priority: 1, weight: 1 },
  { name: 'provider2', url: 'https://rpc2.test', priority: 2, weight: 1 },
  { name: 'provider3', url: 'https://rpc3.test', priority: 3, weight: 1 },
];

// Test circuit breaker options
const testOptions: CircuitBreakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
  volumeThreshold: 3,
};

describe('RPCPool', () => {
  let pool: RPCPool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (pool) {
      pool.clearCache();
    }
  });

  describe('initialization', () => {
    it('should initialize with default providers', () => {
      pool = new RPCPool(undefined, undefined, logger);

      expect(pool).toBeDefined();
      expect(pool.getClient()).toBeDefined();
    });

    it('should initialize with custom providers', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      expect(pool).toBeDefined();
      expect(pool.isHealthy()).toBe(true);
      expect(pool.getAvailableProviderCount()).toBe(3);
    });

    it('should sort providers by priority', () => {
      const shuffledProviders: RPCProvider[] = [
        { name: 'low', url: 'https://low.test', priority: 3, weight: 1 },
        { name: 'high', url: 'https://high.test', priority: 1, weight: 1 },
        { name: 'medium', url: 'https://medium.test', priority: 2, weight: 1 },
      ];

      pool = new RPCPool(shuffledProviders, testOptions, logger);

      const states = pool.getCircuitStates();
      expect(Object.keys(states)).toEqual(['high', 'medium', 'low']);
    });
  });

  describe('circuit breaker states', () => {
    it('should return circuit states for all providers', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      const states = pool.getCircuitStates();

      expect(states).toEqual({
        provider1: 'closed',
        provider2: 'closed',
        provider3: 'closed',
      });
    });

    it('should allow manual tripping of circuits', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      pool.tripCircuit('provider1');
      const states = pool.getCircuitStates();

      expect(states.provider1).toBe('open');
      expect(states.provider2).toBe('closed');
      expect(states.provider3).toBe('closed');
    });

    it('should allow manual resetting of circuits', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      pool.tripCircuit('provider1');
      pool.resetCircuit('provider1');
      const states = pool.getCircuitStates();

      expect(states.provider1).toBe('closed');
    });
  });

  describe('health checks', () => {
    it('should report healthy when at least one provider available', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      expect(pool.isHealthy()).toBe(true);

      pool.tripCircuit('provider1');
      pool.tripCircuit('provider2');
      expect(pool.isHealthy()).toBe(true);
    });

    it('should report unhealthy when all circuits are open', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      pool.tripCircuit('provider1');
      pool.tripCircuit('provider2');
      pool.tripCircuit('provider3');

      expect(pool.isHealthy()).toBe(false);
    });

    it('should count available providers', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      expect(pool.getAvailableProviderCount()).toBe(3);

      pool.tripCircuit('provider1');
      expect(pool.getAvailableProviderCount()).toBe(2);

      pool.tripCircuit('provider2');
      expect(pool.getAvailableProviderCount()).toBe(1);
    });
  });

  describe('metrics', () => {
    it('should expose metrics', () => {
      pool = new RPCPool(testProviders, testOptions, logger);

      const metrics = pool.getMetrics();

      expect(metrics).toBeInstanceOf(RPCMetrics);
    });
  });
});

describe('RPCCache', () => {
  let cache: RPCCache;

  beforeEach(() => {
    cache = new RPCCache(logger, 60000);
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1', 10000);

      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should delete values', () => {
      cache.set('key1', 'value1', 10000);
      cache.delete('key1');

      expect(cache.get('key1')).toBeUndefined();
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1', 10000);
      cache.set('key2', 'value2', 10000);
      cache.clear();

      expect(cache.size).toBe(0);
    });

    it('should check existence', () => {
      cache.set('key1', 'value1', 10000);

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });
  });

  describe('TTL behavior', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL

      expect(cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cache.get('key1')).toBeUndefined();
    });

    it('should not expire entries before TTL', async () => {
      cache.set('key1', 'value1', 1000); // 1s TTL

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('statistics', () => {
    it('should report cache stats', () => {
      cache.set('key1', 'value1', 10000);
      cache.set('key2', 'value2', 10000);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.oldestEntryAgeMs).toBeGreaterThanOrEqual(0);
      expect(stats.newestEntryAgeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty cache stats', () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.oldestEntryAgeMs).toBeNull();
      expect(stats.newestEntryAgeMs).toBeNull();
    });
  });
});

describe('RPCMetrics', () => {
  let metrics: RPCMetrics;

  beforeEach(() => {
    metrics = new RPCMetrics();
  });

  describe('request counting', () => {
    it('should count successful requests', () => {
      metrics.recordRequest('provider1', true);
      metrics.recordRequest('provider1', true);
      metrics.recordRequest('provider1', false);

      const json = metrics.toJSON() as { totalRequests: Record<string, number>; successfulRequests: Record<string, number> };

      expect(json.totalRequests.provider1).toBe(3);
      expect(json.successfulRequests.provider1).toBe(2);
    });

    it('should track timeouts and rejections', () => {
      metrics.recordTimeout('provider1');
      metrics.recordTimeout('provider1');
      metrics.recordRejection('provider1');

      const json = metrics.toJSON() as { timeouts: Record<string, number>; rejections: Record<string, number> };

      expect(json.timeouts.provider1).toBe(2);
      expect(json.rejections.provider1).toBe(1);
    });
  });

  describe('latency tracking', () => {
    it('should calculate average latency', () => {
      metrics.recordLatency('provider1', 100);
      metrics.recordLatency('provider1', 200);
      metrics.recordLatency('provider1', 300);

      expect(metrics.getAverageLatency('provider1')).toBe(200);
    });

    it('should return null for providers with no latency data', () => {
      expect(metrics.getAverageLatency('unknown')).toBeNull();
    });
  });

  describe('error rate', () => {
    it('should calculate error rate', () => {
      metrics.recordRequest('provider1', true);
      metrics.recordRequest('provider1', true);
      metrics.recordRequest('provider1', false);
      metrics.recordRequest('provider1', false);

      expect(metrics.getErrorRate('provider1')).toBe(0.5);
    });

    it('should return null for providers with no requests', () => {
      expect(metrics.getErrorRate('unknown')).toBeNull();
    });
  });

  describe('cache metrics', () => {
    it('should track cache hit rate', () => {
      metrics.recordCacheHit();
      metrics.recordCacheHit();
      metrics.recordCacheMiss();

      expect(metrics.getCacheHitRate()).toBeCloseTo(0.666, 2);
    });

    it('should return null when no cache activity', () => {
      expect(metrics.getCacheHitRate()).toBeNull();
    });
  });

  describe('circuit state tracking', () => {
    it('should track circuit state changes', () => {
      metrics.recordCircuitStateChange('provider1', 'open');
      metrics.recordCircuitStateChange('provider1', 'halfOpen');
      metrics.recordCircuitStateChange('provider1', 'closed');

      const json = metrics.toJSON() as { circuitStates: Record<string, string>; circuitStateChanges: Record<string, number> };

      expect(json.circuitStates.provider1).toBe('closed');
      expect(json.circuitStateChanges.provider1).toBe(3);
    });
  });

  describe('Prometheus format', () => {
    it('should export metrics in Prometheus format', () => {
      metrics.recordRequest('provider1', true);
      metrics.recordLatency('provider1', 100);
      metrics.recordCircuitStateChange('provider1', 'closed');

      const prometheus = metrics.toPrometheusFormat();

      expect(prometheus).toContain('rpc_requests_total{provider="provider1"}');
      expect(prometheus).toContain('rpc_circuit_breaker_state{provider="provider1"}');
      expect(prometheus).toContain('rpc_request_duration_ms_bucket');
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      metrics.recordRequest('provider1', true);
      metrics.recordLatency('provider1', 100);
      metrics.recordCacheHit();

      metrics.reset();

      const json = metrics.toJSON() as { totalRequests: Record<string, number>; cacheHits: number };

      expect(json.totalRequests.provider1).toBeUndefined();
      expect(json.cacheHits).toBe(0);
    });
  });
});
