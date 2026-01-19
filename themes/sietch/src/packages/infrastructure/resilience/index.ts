/**
 * Resilience Infrastructure Module
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides resilience patterns for handling failures gracefully:
 * - Circuit breaker for external API protection
 * - Retry policies
 * - Fallback strategies
 *
 * @module packages/infrastructure/resilience
 */

export {
  CircuitBreaker,
  createCircuitBreaker,
  PAYMENT_API_CONFIG,
  WEBHOOK_DELIVERY_CONFIG,
  CRITICAL_API_CONFIG,
} from './CircuitBreaker.js';

export type {
  CircuitState,
  CircuitEvent,
  CircuitMetrics,
  CircuitBreakerOptions,
} from './CircuitBreaker.js';
