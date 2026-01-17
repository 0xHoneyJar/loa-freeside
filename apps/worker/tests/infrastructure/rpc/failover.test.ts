/**
 * RPC Pool Failover Tests
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Tests for provider failover and graceful degradation scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';

// Create test logger
const logger = pino({ level: 'silent' });

// Mock viem with configurable responses
const mockClients: Map<string, {
  readContract: ReturnType<typeof vi.fn>;
  getBlockNumber: ReturnType<typeof vi.fn>;
}> = new Map();

vi.mock('viem', () => ({
  createPublicClient: vi.fn((config: { transport: { url?: string } }) => {
    const url = config?.transport?.url || 'fallback';
    let client = mockClients.get(url);
    if (!client) {
      client = {
        readContract: vi.fn(),
        getBlockNumber: vi.fn(),
      };
      mockClients.set(url, client);
    }
    return client;
  }),
  http: vi.fn((url: string) => ({ url })),
  fallback: vi.fn((transports: { url: string }[]) => ({
    transports,
    url: 'fallback',
  })),
}));

// Mock opossum with controllable behavior
const mockBreakerStates: Map<string, { open: boolean; halfOpen: boolean }> = new Map();
const mockBreakerEventHandlers: Map<string, Map<string, Function[]>> = new Map();

vi.mock('opossum', () => {
  return {
    default: vi.fn().mockImplementation((fn) => {
      const id = `breaker-${Math.random().toString(36).substr(2, 9)}`;
      mockBreakerStates.set(id, { open: false, halfOpen: false });
      mockBreakerEventHandlers.set(id, new Map());

      const state = mockBreakerStates.get(id)!;
      const handlers = mockBreakerEventHandlers.get(id)!;

      const emit = (event: string) => {
        const eventHandlers = handlers.get(event) || [];
        eventHandlers.forEach((h) => h());
      };

      return {
        fire: async (...args: unknown[]) => {
          if (state.open && !state.halfOpen) {
            emit('reject');
            throw new Error('Circuit is open');
          }
          try {
            const result = await fn(...args);
            emit('success');
            return result;
          } catch (error) {
            emit('failure');
            throw error;
          }
        },
        get opened() {
          return state.open;
        },
        get halfOpen() {
          return state.halfOpen;
        },
        open: () => {
          state.open = true;
          state.halfOpen = false;
          emit('open');
        },
        close: () => {
          state.open = false;
          state.halfOpen = false;
          emit('close');
        },
        on: (event: string, handler: Function) => {
          if (!handlers.has(event)) {
            handlers.set(event, []);
          }
          handlers.get(event)!.push(handler);
        },
      };
    }),
  };
});

// Import after mocks are set up
import { RPCPool } from '../../../src/infrastructure/rpc/rpc-pool.js';
import type { RPCProvider, CircuitBreakerOptions } from '../../../src/infrastructure/rpc/types.js';

// Test providers
const testProviders: RPCProvider[] = [
  { name: 'primary', url: 'https://primary.test', priority: 1, weight: 1 },
  { name: 'secondary', url: 'https://secondary.test', priority: 2, weight: 1 },
  { name: 'tertiary', url: 'https://tertiary.test', priority: 3, weight: 1 },
];

// Fast circuit breaker options for testing
const fastOptions: CircuitBreakerOptions = {
  timeout: 1000,
  errorThresholdPercentage: 50,
  resetTimeout: 1000, // Fast reset for tests
  volumeThreshold: 2,
};

describe('Failover Scenarios', () => {
  let pool: RPCPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClients.clear();
    mockBreakerStates.clear();
    mockBreakerEventHandlers.clear();
  });

  afterEach(() => {
    if (pool) {
      pool.clearCache();
    }
  });

  describe('S-2.5: Provider Outage Scenarios', () => {
    it('should failover to secondary when primary circuit is open', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Trip primary circuit
      pool.tripCircuit('primary');

      const states = pool.getCircuitStates();
      expect(states.primary).toBe('open');
      expect(states.secondary).toBe('closed');

      // Pool should still be healthy
      expect(pool.isHealthy()).toBe(true);
      expect(pool.getAvailableProviderCount()).toBe(2);
    });

    it('should failover to tertiary when primary and secondary circuits are open', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Trip primary and secondary circuits
      pool.tripCircuit('primary');
      pool.tripCircuit('secondary');

      const states = pool.getCircuitStates();
      expect(states.primary).toBe('open');
      expect(states.secondary).toBe('open');
      expect(states.tertiary).toBe('closed');

      // Pool should still be healthy with one provider
      expect(pool.isHealthy()).toBe(true);
      expect(pool.getAvailableProviderCount()).toBe(1);
    });

    it('should report unhealthy when all circuits are open', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Trip all circuits
      pool.tripCircuit('primary');
      pool.tripCircuit('secondary');
      pool.tripCircuit('tertiary');

      expect(pool.isHealthy()).toBe(false);
      expect(pool.getAvailableProviderCount()).toBe(0);
    });

    it('should recover when circuit resets', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Trip and then reset primary
      pool.tripCircuit('primary');
      expect(pool.getCircuitStates().primary).toBe('open');

      pool.resetCircuit('primary');
      expect(pool.getCircuitStates().primary).toBe('closed');
      expect(pool.getAvailableProviderCount()).toBe(3);
    });

    it('should meet <30s failover requirement (circuit opens immediately on trip)', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      const startTime = Date.now();
      pool.tripCircuit('primary');
      const endTime = Date.now();

      // Failover should be near-instant (< 100ms)
      expect(endTime - startTime).toBeLessThan(100);
      expect(pool.getCircuitStates().primary).toBe('open');
    });
  });

  describe('Graceful Degradation', () => {
    it('should track circuit state changes in metrics', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      pool.tripCircuit('primary');
      pool.tripCircuit('secondary');
      pool.resetCircuit('primary');

      const metrics = pool.getMetrics();
      const metricsJson = metrics.toJSON() as {
        circuitStates: Record<string, string>;
        circuitStateChanges: Record<string, number>;
      };

      expect(metricsJson.circuitStates.primary).toBe('closed');
      expect(metricsJson.circuitStates.secondary).toBe('open');
      // State changes: primary open(1), secondary open(1), primary close(2)
      expect(metricsJson.circuitStateChanges.primary).toBe(2);
      expect(metricsJson.circuitStateChanges.secondary).toBe(1);
    });

    it('should continue operating with reduced capacity', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Simulate progressive failure
      expect(pool.getAvailableProviderCount()).toBe(3);

      pool.tripCircuit('primary');
      expect(pool.getAvailableProviderCount()).toBe(2);
      expect(pool.isHealthy()).toBe(true);

      pool.tripCircuit('secondary');
      expect(pool.getAvailableProviderCount()).toBe(1);
      expect(pool.isHealthy()).toBe(true);

      // Still operational with one provider
      const client = pool.getClient();
      expect(client).toBeDefined();
    });
  });

  describe('Metrics During Failover', () => {
    it('should record circuit state in Prometheus format', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      pool.tripCircuit('primary');

      const prometheus = pool.getMetrics().toPrometheusFormat();

      // Circuit state: 0=closed, 1=halfOpen, 2=open
      expect(prometheus).toContain('rpc_circuit_breaker_state{provider="primary"} 2');
      expect(prometheus).toContain('rpc_circuit_breaker_state{provider="secondary"} 0');
    });

    it('should track state changes count', () => {
      pool = new RPCPool(testProviders, fastOptions, logger);

      // Toggle primary circuit multiple times
      pool.tripCircuit('primary');
      pool.resetCircuit('primary');
      pool.tripCircuit('primary');

      const prometheus = pool.getMetrics().toPrometheusFormat();
      expect(prometheus).toContain('rpc_circuit_state_changes_total{provider="primary"} 3');
    });
  });
});

describe('Multi-Provider Redundancy', () => {
  it('should support configurable number of providers', () => {
    const manyProviders: RPCProvider[] = [
      { name: 'p1', url: 'https://p1.test', priority: 1, weight: 1 },
      { name: 'p2', url: 'https://p2.test', priority: 2, weight: 1 },
      { name: 'p3', url: 'https://p3.test', priority: 3, weight: 1 },
      { name: 'p4', url: 'https://p4.test', priority: 4, weight: 1 },
      { name: 'p5', url: 'https://p5.test', priority: 5, weight: 1 },
    ];

    const pool = new RPCPool(manyProviders, fastOptions, logger);

    expect(pool.getAvailableProviderCount()).toBe(5);

    const states = pool.getCircuitStates();
    expect(Object.keys(states)).toHaveLength(5);
  });

  it('should maintain priority order after initialization', () => {
    const shuffled: RPCProvider[] = [
      { name: 'third', url: 'https://third.test', priority: 3, weight: 1 },
      { name: 'first', url: 'https://first.test', priority: 1, weight: 1 },
      { name: 'second', url: 'https://second.test', priority: 2, weight: 1 },
    ];

    const pool = new RPCPool(shuffled, fastOptions, logger);

    // States should be iterated in priority order
    const states = pool.getCircuitStates();
    const keys = Object.keys(states);

    expect(keys[0]).toBe('first');
    expect(keys[1]).toBe('second');
    expect(keys[2]).toBe('third');
  });
});
