/**
 * CircuitBreakerMetrics - Prometheus Metrics Exporter for Circuit Breaker
 *
 * Sprint 51: High Priority Hardening (P1) - Observability & Session Security
 *
 * Exports circuit breaker state, error rates, and latency percentiles to Prometheus.
 * Enables real-time monitoring and alerting for circuit breaker health.
 *
 * @module packages/adapters/chain/CircuitBreakerMetrics
 */

import { Registry, Counter, Gauge, Histogram } from 'prom-client';
import type { ScoreServiceAdapter } from './ScoreServiceAdapter.js';
import { createChildLogger } from '../../../utils/logger.js';

/**
 * Circuit breaker state as enum for type safety
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

/**
 * Metrics configuration
 */
export interface CircuitBreakerMetricsConfig {
  /** Metric prefix (default: arrakis) */
  prefix?: string;
  /** Prometheus registry (default: shared global registry) */
  registry?: Registry;
  /** Update interval in milliseconds (default: 5000 = 5 seconds) */
  updateInterval?: number;
}

/**
 * CircuitBreakerMetrics
 *
 * Tracks circuit breaker state transitions, error rates, and request latency.
 * Provides Prometheus-compatible metrics for Grafana dashboards.
 */
export class CircuitBreakerMetrics {
  private readonly adapter: ScoreServiceAdapter;
  private readonly registry: Registry;
  private readonly updateInterval: number;
  private intervalId?: NodeJS.Timeout;
  private readonly logger = createChildLogger({ module: 'CircuitBreakerMetrics' });

  // Metrics
  private readonly stateGauge: Gauge<string>;
  private readonly requestCounter: Counter<string>;
  private readonly errorCounter: Counter<string>;
  private readonly latencyHistogram: Histogram<string>;
  private readonly stateTransitionCounter: Counter<string>;

  // State tracking for transition detection
  private lastState: CircuitBreakerState = CircuitBreakerState.CLOSED;

  constructor(
    adapter: ScoreServiceAdapter,
    config: CircuitBreakerMetricsConfig = {}
  ) {
    this.adapter = adapter;
    this.registry = config.registry ?? new Registry();
    this.updateInterval = config.updateInterval ?? 5000;

    const prefix = config.prefix ?? 'arrakis';

    // Circuit breaker state gauge (0 = closed, 1 = half-open, 2 = open)
    this.stateGauge = new Gauge({
      name: `${prefix}_circuit_breaker_state`,
      help: 'Current state of the circuit breaker (0=closed, 1=half-open, 2=open)',
      labelNames: ['service'],
      registers: [this.registry],
    });

    // Request counters
    this.requestCounter = new Counter({
      name: `${prefix}_circuit_breaker_requests_total`,
      help: 'Total number of requests through circuit breaker',
      labelNames: ['service', 'result'], // result: success, failure, rejected
      registers: [this.registry],
    });

    // Error counter
    this.errorCounter = new Counter({
      name: `${prefix}_circuit_breaker_errors_total`,
      help: 'Total number of errors from circuit breaker',
      labelNames: ['service', 'error_type'], // error_type: timeout, api_error, network_error
      registers: [this.registry],
    });

    // Latency histogram (percentiles: p50, p90, p95, p99)
    this.latencyHistogram = new Histogram({
      name: `${prefix}_circuit_breaker_latency_seconds`,
      help: 'Request latency through circuit breaker in seconds',
      labelNames: ['service'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], // 5ms to 10s
      registers: [this.registry],
    });

    // State transition counter
    this.stateTransitionCounter = new Counter({
      name: `${prefix}_circuit_breaker_state_transitions_total`,
      help: 'Total number of circuit breaker state transitions',
      labelNames: ['service', 'from_state', 'to_state'],
      registers: [this.registry],
    });
  }

  /**
   * Start collecting metrics at configured interval
   */
  start(): void {
    if (this.intervalId) {
      throw new Error('Metrics collection already started');
    }

    // Initial update
    this.updateMetrics();

    // Start periodic updates
    this.intervalId = setInterval(() => {
      this.updateMetrics();
    }, this.updateInterval);
  }

  /**
   * Stop collecting metrics
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Update all metrics from circuit breaker stats
   */
  private updateMetrics(): void {
    try {
      const stats = this.adapter.getCircuitBreakerStats();
      const state = stats.state;

      // Update state gauge (0=closed, 1=half-open, 2=open)
      const stateValue = this.stateToNumber(state);
      this.stateGauge.set({ service: 'score_service' }, stateValue);

      // Detect state transitions
      const currentState = this.stringToState(state);
      if (currentState !== this.lastState) {
        this.stateTransitionCounter.inc({
          service: 'score_service',
          from_state: this.lastState,
          to_state: currentState,
        });
        this.lastState = currentState;
      }

      // Update request counters
      this.requestCounter.inc(
        { service: 'score_service', result: 'success' },
        stats.successes
      );
      this.requestCounter.inc(
        { service: 'score_service', result: 'failure' },
        stats.failures
      );
      this.requestCounter.inc(
        { service: 'score_service', result: 'rejected' },
        stats.rejects
      );
    } catch (error) {
      // Log error but don't crash metrics collection
      this.logger.error({ err: error }, 'Error updating metrics');
    }
  }

  /**
   * Record a successful request with latency
   */
  recordSuccess(latencySeconds: number): void {
    this.latencyHistogram.observe({ service: 'score_service' }, latencySeconds);
    this.requestCounter.inc({ service: 'score_service', result: 'success' });
  }

  /**
   * Record a failed request with error type
   */
  recordError(errorType: 'timeout' | 'api_error' | 'network_error'): void {
    this.errorCounter.inc({ service: 'score_service', error_type: errorType });
    this.requestCounter.inc({ service: 'score_service', result: 'failure' });
  }

  /**
   * Record a rejected request (circuit breaker open)
   */
  recordRejection(): void {
    this.requestCounter.inc({ service: 'score_service', result: 'rejected' });
  }

  /**
   * Convert circuit breaker state to numeric value for Prometheus gauge
   */
  private stateToNumber(state: 'closed' | 'open' | 'half-open'): number {
    switch (state) {
      case 'closed':
        return 0;
      case 'half-open':
        return 1;
      case 'open':
        return 2;
    }
  }

  /**
   * Convert string state to enum
   */
  private stringToState(state: 'closed' | 'open' | 'half-open'): CircuitBreakerState {
    switch (state) {
      case 'closed':
        return CircuitBreakerState.CLOSED;
      case 'half-open':
        return CircuitBreakerState.HALF_OPEN;
      case 'open':
        return CircuitBreakerState.OPEN;
    }
  }

  /**
   * Get Prometheus metrics in text format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get content type for metrics endpoint
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Get current circuit breaker state as number
   */
  getCurrentState(): number {
    const stats = this.adapter.getCircuitBreakerStats();
    return this.stateToNumber(stats.state);
  }

  /**
   * Get registry for custom metrics
   */
  getRegistry(): Registry {
    return this.registry;
  }
}

/**
 * Factory function to create CircuitBreakerMetrics
 */
export function createCircuitBreakerMetrics(
  adapter: ScoreServiceAdapter,
  config?: CircuitBreakerMetricsConfig
): CircuitBreakerMetrics {
  return new CircuitBreakerMetrics(adapter, config);
}
