/**
 * RPC Pool Types
 * Sprint S-2: RPC Pool & Circuit Breakers
 */

/**
 * RPC Provider configuration
 */
export interface RPCProvider {
  /** Provider name for logging/metrics */
  name: string;
  /** RPC endpoint URL */
  url: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Weight for load balancing */
  weight: number;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /** Request timeout in ms */
  timeout: number;
  /** Error percentage threshold to trip (0-100) */
  errorThresholdPercentage: number;
  /** Time in ms before attempting reset */
  resetTimeout: number;
  /** Minimum requests before circuit can trip */
  volumeThreshold: number;
  /** Rolling window size in ms */
  rollingCountTimeout?: number;
  /** Number of successful calls in half-open to close */
  rollingCountBuckets?: number;
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen';

/**
 * Circuit breaker state change event
 */
export interface CircuitStateChange {
  provider: string;
  previousState: CircuitState;
  newState: CircuitState;
  timestamp: Date;
}

/**
 * RPC Pool metrics
 */
export interface RPCPoolMetrics {
  /** Total requests per provider */
  totalRequests: Map<string, number>;
  /** Successful requests per provider */
  successfulRequests: Map<string, number>;
  /** Failed requests per provider */
  failedRequests: Map<string, number>;
  /** Circuit state per provider */
  circuitStates: Map<string, CircuitState>;
  /** Request latency histogram */
  latencyHistogram: Map<string, number[]>;
}

/**
 * Cache entry for RPC results
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttlMs: number;
}

/**
 * Default circuit breaker options
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  timeout: 10000, // 10s timeout per request
  errorThresholdPercentage: 50, // Trip at 50% error rate
  resetTimeout: 30000, // Try again after 30s
  volumeThreshold: 5, // Need at least 5 requests before tripping
  rollingCountTimeout: 10000, // 10s rolling window
  rollingCountBuckets: 10, // 10 buckets
};

/**
 * Default RPC providers for Berachain
 */
export const DEFAULT_BERACHAIN_PROVIDERS: RPCProvider[] = [
  {
    name: 'drpc',
    url: 'https://berachain.drpc.org',
    priority: 1,
    weight: 1,
  },
  {
    name: 'publicnode',
    url: 'https://berachain-rpc.publicnode.com',
    priority: 2,
    weight: 1,
  },
  {
    name: 'bartio',
    url: 'https://bartio.rpc.berachain.com',
    priority: 3,
    weight: 1,
  },
];
