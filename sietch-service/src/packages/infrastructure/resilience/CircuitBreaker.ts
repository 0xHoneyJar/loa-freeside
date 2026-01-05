/**
 * Circuit Breaker - Resilience Pattern for External APIs
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides circuit breaker wrapper using Opossum to protect against
 * cascading failures when external services (like Paddle API) are down.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service failure detected, requests fail fast
 * - HALF-OPEN: Testing if service recovered
 *
 * Features:
 * - Automatic failure detection
 * - Fail-fast when circuit is open
 * - Automatic recovery testing
 * - Configurable thresholds
 * - Metrics and events
 * - Trace context integration
 *
 * @module packages/infrastructure/resilience/CircuitBreaker
 */

import CircuitBreakerLib from 'opossum';
import type { Options as OpossumOptions, Status } from 'opossum';
import {
  getCurrentTrace,
  createSpan,
  setTraceAttribute,
} from '../tracing';
import { createLogger, ILogger } from '../logging';

// =============================================================================
// Types
// =============================================================================

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen';

/**
 * Circuit breaker event types
 */
export type CircuitEvent =
  | 'success'
  | 'timeout'
  | 'reject'
  | 'open'
  | 'halfOpen'
  | 'close'
  | 'fallback';

/**
 * Circuit breaker metrics
 */
export interface CircuitMetrics {
  /** Number of successful calls */
  successes: number;
  /** Number of failed calls */
  failures: number;
  /** Number of rejected calls (circuit open) */
  rejects: number;
  /** Number of timeouts */
  timeouts: number;
  /** Number of fallback calls */
  fallbacks: number;
  /** Current state */
  state: CircuitState;
  /** Percentage of failures */
  failurePercentage: number;
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  /** Name for logging/metrics */
  name: string;
  /** Timeout in ms (default: 10000) */
  timeout?: number;
  /** Percentage of failures to trip (default: 50) */
  errorThresholdPercentage?: number;
  /** Time to wait before half-open (default: 30000) */
  resetTimeout?: number;
  /** Volume threshold to start monitoring (default: 5) */
  volumeThreshold?: number;
  /** Rolling window for statistics (default: 10000) */
  rollingCountTimeout?: number;
  /** Number of buckets in rolling window (default: 10) */
  rollingCountBuckets?: number;
  /** Fallback function when circuit is open */
  fallback?: (...args: unknown[]) => Promise<unknown>;
  /** Custom logger */
  logger?: ILogger;
  /** Event callback */
  onEvent?: (event: CircuitEvent, data?: unknown) => void;
}

// =============================================================================
// CircuitBreaker Class
// =============================================================================

/**
 * Circuit breaker wrapper around Opossum with tracing integration
 */
export class CircuitBreaker<TArgs extends unknown[], TResult> {
  private breaker: CircuitBreakerLib<TArgs, TResult>;
  private logger: ILogger;
  private options: Required<Omit<CircuitBreakerOptions, 'fallback' | 'onEvent' | 'logger'>> & {
    fallback?: (...args: unknown[]) => Promise<unknown>;
    onEvent?: (event: CircuitEvent, data?: unknown) => void;
  };

  // Internal metrics
  private internalMetrics = {
    successes: 0,
    failures: 0,
    rejects: 0,
    timeouts: 0,
    fallbacks: 0,
  };

  constructor(
    fn: (...args: TArgs) => Promise<TResult>,
    options: CircuitBreakerOptions
  ) {
    this.options = {
      name: options.name,
      timeout: options.timeout ?? 10000,
      errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
      resetTimeout: options.resetTimeout ?? 30000,
      volumeThreshold: options.volumeThreshold ?? 5,
      rollingCountTimeout: options.rollingCountTimeout ?? 10000,
      rollingCountBuckets: options.rollingCountBuckets ?? 10,
      fallback: options.fallback,
      onEvent: options.onEvent,
    };

    this.logger = options.logger ?? createLogger({ service: `circuit-${options.name}` });

    // Create Opossum circuit breaker
    const opossumOptions: OpossumOptions = {
      timeout: this.options.timeout,
      errorThresholdPercentage: this.options.errorThresholdPercentage,
      resetTimeout: this.options.resetTimeout,
      volumeThreshold: this.options.volumeThreshold,
      rollingCountTimeout: this.options.rollingCountTimeout,
      rollingCountBuckets: this.options.rollingCountBuckets,
    };

    this.breaker = new CircuitBreakerLib(fn, opossumOptions);

    // Set up fallback if provided
    if (this.options.fallback) {
      this.breaker.fallback(this.options.fallback as (...args: TArgs) => Promise<TResult>);
    }

    // Set up event handlers
    this.setupEventHandlers();

    this.logger.info(
      {
        name: this.options.name,
        timeout: this.options.timeout,
        errorThreshold: this.options.errorThresholdPercentage,
        resetTimeout: this.options.resetTimeout,
      },
      'Circuit breaker created'
    );
  }

  /**
   * Set up event handlers for the circuit breaker
   */
  private setupEventHandlers(): void {
    this.breaker.on('success', (result) => {
      this.internalMetrics.successes++;
      this.emitEvent('success', result);
      this.logger.debug({ name: this.options.name }, 'Circuit breaker call succeeded');
    });

    this.breaker.on('timeout', () => {
      this.internalMetrics.timeouts++;
      this.internalMetrics.failures++;
      this.emitEvent('timeout');
      this.logger.warn({ name: this.options.name }, 'Circuit breaker call timed out');
    });

    this.breaker.on('reject', () => {
      this.internalMetrics.rejects++;
      this.emitEvent('reject');
      this.logger.warn({ name: this.options.name }, 'Circuit breaker rejected call (circuit open)');
    });

    this.breaker.on('open', () => {
      this.emitEvent('open');
      this.logger.error(
        {
          name: this.options.name,
          failurePercentage: this.getFailurePercentage(),
        },
        'Circuit breaker OPENED - service failures detected'
      );
    });

    this.breaker.on('halfOpen', () => {
      this.emitEvent('halfOpen');
      this.logger.info({ name: this.options.name }, 'Circuit breaker HALF-OPEN - testing recovery');
    });

    this.breaker.on('close', () => {
      this.emitEvent('close');
      this.logger.info({ name: this.options.name }, 'Circuit breaker CLOSED - service recovered');
    });

    this.breaker.on('fallback', (result) => {
      this.internalMetrics.fallbacks++;
      this.emitEvent('fallback', result);
      this.logger.debug({ name: this.options.name }, 'Circuit breaker fallback executed');
    });

    this.breaker.on('failure', (error) => {
      this.internalMetrics.failures++;
      this.logger.warn(
        { name: this.options.name, error: (error as Error).message },
        'Circuit breaker call failed'
      );
    });
  }

  /**
   * Emit event to callback if configured
   */
  private emitEvent(event: CircuitEvent, data?: unknown): void {
    if (this.options.onEvent) {
      this.options.onEvent(event, data);
    }
  }

  /**
   * Calculate failure percentage
   */
  private getFailurePercentage(): number {
    const total = this.internalMetrics.successes + this.internalMetrics.failures;
    if (total === 0) return 0;
    return (this.internalMetrics.failures / total) * 100;
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a function through the circuit breaker
   *
   * @param args - Arguments to pass to the function
   * @returns Result of the function
   */
  async fire(...args: TArgs): Promise<TResult> {
    const trace = getCurrentTrace();
    const { span, endSpan } = createSpan({
      operationName: `circuit.${this.options.name}`,
      attributes: {
        'circuit.name': this.options.name,
        'circuit.state': this.getState(),
      },
    });

    // Add circuit state to trace
    if (trace) {
      setTraceAttribute('circuit.name', this.options.name);
      setTraceAttribute('circuit.state', this.getState());
    }

    try {
      const result = await this.breaker.fire(...args);
      endSpan('ok', { 'circuit.result': 'success' });
      return result;
    } catch (error) {
      const circuitOpen = this.isOpen();
      endSpan('error', {
        'circuit.result': circuitOpen ? 'rejected' : 'failure',
        'circuit.error': (error as Error).message,
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'halfOpen';
    return 'closed';
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.breaker.opened;
  }

  /**
   * Check if circuit is closed
   */
  isClosed(): boolean {
    return !this.breaker.opened && !this.breaker.halfOpen;
  }

  /**
   * Check if circuit is half-open
   */
  isHalfOpen(): boolean {
    return this.breaker.halfOpen;
  }

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------

  /**
   * Get circuit state as numeric value for Prometheus gauge
   *
   * @returns 0 = closed (healthy), 0.5 = half-open (testing), 1 = open (unhealthy)
   *
   * @example
   * ```typescript
   * // Export to Prometheus
   * const gauge = new Gauge({
   *   name: 'sietch_paddle_circuit_state',
   *   help: 'Circuit breaker state (0=closed, 0.5=half-open, 1=open)',
   *   labelNames: ['circuit_name'],
   * });
   *
   * gauge.set({ circuit_name: 'paddle-api' }, paddleCircuit.getPrometheusState());
   * ```
   */
  getPrometheusState(): number {
    if (this.breaker.opened) return 1;
    if (this.breaker.halfOpen) return 0.5;
    return 0;
  }

  /**
   * Get circuit metrics
   */
  getMetrics(): CircuitMetrics {
    return {
      successes: this.internalMetrics.successes,
      failures: this.internalMetrics.failures,
      rejects: this.internalMetrics.rejects,
      timeouts: this.internalMetrics.timeouts,
      fallbacks: this.internalMetrics.fallbacks,
      state: this.getState(),
      failurePercentage: this.getFailurePercentage(),
    };
  }

  /**
   * Get Opossum's internal stats
   */
  getStats(): Status['stats'] {
    return this.breaker.stats;
  }

  /**
   * Reset internal metrics
   */
  resetMetrics(): void {
    this.internalMetrics = {
      successes: 0,
      failures: 0,
      rejects: 0,
      timeouts: 0,
      fallbacks: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Control
  // ---------------------------------------------------------------------------

  /**
   * Manually open the circuit
   */
  open(): void {
    this.breaker.open();
    this.logger.warn({ name: this.options.name }, 'Circuit breaker manually opened');
  }

  /**
   * Manually close the circuit
   */
  close(): void {
    this.breaker.close();
    this.logger.info({ name: this.options.name }, 'Circuit breaker manually closed');
  }

  /**
   * Enable the circuit breaker
   */
  enable(): void {
    this.breaker.enable();
    this.logger.info({ name: this.options.name }, 'Circuit breaker enabled');
  }

  /**
   * Disable the circuit breaker (all calls pass through)
   */
  disable(): void {
    this.breaker.disable();
    this.logger.info({ name: this.options.name }, 'Circuit breaker disabled');
  }

  /**
   * Shutdown the circuit breaker
   */
  shutdown(): void {
    this.breaker.shutdown();
    this.logger.info({ name: this.options.name }, 'Circuit breaker shutdown');
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Check if the circuit is healthy (closed or half-open)
   */
  isHealthy(): boolean {
    return !this.breaker.opened;
  }

  /**
   * Get health status object
   */
  getHealthStatus(): {
    name: string;
    state: CircuitState;
    healthy: boolean;
    metrics: CircuitMetrics;
  } {
    return {
      name: this.options.name,
      state: this.getState(),
      healthy: this.isHealthy(),
      metrics: this.getMetrics(),
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a circuit breaker for a function
 *
 * @param fn - Function to protect
 * @param options - Circuit breaker options
 * @returns CircuitBreaker instance
 *
 * @example
 * ```typescript
 * import { createCircuitBreaker } from '../packages/infrastructure/resilience';
 *
 * const paddleCircuit = createCircuitBreaker(
 *   async (endpoint: string, data: unknown) => {
 *     return await paddleClient.post(endpoint, data);
 *   },
 *   {
 *     name: 'paddle-api',
 *     timeout: 10000,
 *     errorThresholdPercentage: 50,
 *     resetTimeout: 30000,
 *     fallback: async () => {
 *       // Return cached data or default response
 *       return { cached: true };
 *     },
 *     onEvent: (event) => {
 *       if (event === 'open') {
 *         alertOps('Paddle API circuit opened!');
 *       }
 *     }
 *   }
 * );
 *
 * // Use the circuit breaker
 * const result = await paddleCircuit.fire('/subscriptions', { id: '123' });
 * ```
 */
export function createCircuitBreaker<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: CircuitBreakerOptions
): CircuitBreaker<TArgs, TResult> {
  return new CircuitBreaker(fn, options);
}

// =============================================================================
// Predefined Circuit Breaker Configs
// =============================================================================

/**
 * Default circuit breaker configuration for external payment APIs
 */
export const PAYMENT_API_CONFIG: Omit<CircuitBreakerOptions, 'name'> = {
  timeout: 15000, // 15 seconds for payment operations
  errorThresholdPercentage: 50, // Trip after 50% failures
  resetTimeout: 30000, // Wait 30 seconds before testing
  volumeThreshold: 5, // Need 5 calls before monitoring
  rollingCountTimeout: 60000, // 1 minute rolling window
  rollingCountBuckets: 6, // 10-second buckets
};

/**
 * Default circuit breaker configuration for webhook delivery
 */
export const WEBHOOK_DELIVERY_CONFIG: Omit<CircuitBreakerOptions, 'name'> = {
  timeout: 5000, // 5 seconds for webhooks
  errorThresholdPercentage: 75, // More tolerant - trip after 75%
  resetTimeout: 15000, // Quick recovery check
  volumeThreshold: 10, // Need more calls for webhooks
  rollingCountTimeout: 30000, // 30-second window
  rollingCountBuckets: 6,
};

/**
 * Default circuit breaker configuration for critical operations
 */
export const CRITICAL_API_CONFIG: Omit<CircuitBreakerOptions, 'name'> = {
  timeout: 30000, // 30 seconds for critical ops
  errorThresholdPercentage: 25, // Very sensitive - trip after 25%
  resetTimeout: 60000, // Wait longer before testing
  volumeThreshold: 3, // Trip quickly
  rollingCountTimeout: 120000, // 2 minute window
  rollingCountBuckets: 12,
};
