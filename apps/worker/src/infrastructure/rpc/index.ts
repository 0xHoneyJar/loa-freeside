/**
 * RPC Pool Module
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Exports the RPC pool implementation with circuit breakers,
 * caching, and Prometheus metrics.
 */

export { RPCPool } from './rpc-pool.js';
export { RPCMetrics } from './metrics.js';
export { RPCCache } from './cache.js';
export {
  type RPCProvider,
  type CircuitBreakerOptions,
  type CircuitState,
  type CircuitStateChange,
  type RPCPoolMetrics,
  type CacheEntry,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
  DEFAULT_BERACHAIN_PROVIDERS,
} from './types.js';
