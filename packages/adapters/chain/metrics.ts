/**
 * Chain Provider Prometheus Metrics
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * Prometheus metrics for monitoring the Two-Tier Chain Provider system.
 * Provides observability into:
 * - Circuit breaker states
 * - Eligibility check latencies
 * - Degradation events
 * - Score Service health
 *
 * @see SDD §12 Observability Architecture
 */

import type { TwoTierProviderMetrics } from './two-tier-provider.js';
import type { ScoreServiceMetrics } from './score-service-client.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/**
 * Prometheus metric types
 */
export interface Counter {
  inc(labels?: Record<string, string | number>, value?: number): void;
}

export interface Gauge {
  set(labels: Record<string, string | number>, value: number): void;
  inc(labels?: Record<string, string | number>, value?: number): void;
  dec(labels?: Record<string, string | number>, value?: number): void;
}

export interface Histogram {
  observe(labels: Record<string, string | number>, value: number): void;
}

/**
 * Prometheus client interface (compatible with prom-client)
 */
export interface PrometheusClient {
  Counter: new (config: { name: string; help: string; labelNames: string[] }) => Counter;
  Gauge: new (config: { name: string; help: string; labelNames: string[] }) => Gauge;
  Histogram: new (config: {
    name: string;
    help: string;
    labelNames: string[];
    buckets?: number[];
  }) => Histogram;
}

// --------------------------------------------------------------------------
// Chain Provider Metrics Registry
// --------------------------------------------------------------------------

/**
 * Chain Provider Metrics
 *
 * Creates and manages Prometheus metrics for the chain provider system.
 * Implements TwoTierProviderMetrics and ScoreServiceMetrics interfaces.
 */
export class ChainProviderMetrics implements TwoTierProviderMetrics, ScoreServiceMetrics {
  // Counters
  private readonly eligibilityChecksTotal: Counter;
  private readonly scoreServiceRequestsTotal: Counter;
  private readonly degradationEventsTotal: Counter;

  // Gauges
  private readonly circuitBreakerState: Gauge;
  private readonly scoreServiceConnected: Gauge;

  // Histograms
  private readonly eligibilityCheckLatency: Histogram;
  private readonly scoreServiceLatency: Histogram;

  constructor(prometheus: PrometheusClient) {
    // Eligibility check counter
    this.eligibilityChecksTotal = new prometheus.Counter({
      name: 'arrakis_eligibility_checks_total',
      help: 'Total number of eligibility checks',
      labelNames: ['rule_type', 'source', 'eligible'],
    });

    // Score Service request counter
    this.scoreServiceRequestsTotal = new prometheus.Counter({
      name: 'arrakis_score_service_requests_total',
      help: 'Total number of Score Service requests',
      labelNames: ['method', 'success'],
    });

    // Degradation event counter
    this.degradationEventsTotal = new prometheus.Counter({
      name: 'arrakis_degradation_events_total',
      help: 'Total number of degradation events',
      labelNames: ['rule_type', 'reason'],
    });

    // Circuit breaker state gauge
    // 0 = closed, 1 = half-open, 2 = open
    this.circuitBreakerState = new prometheus.Gauge({
      name: 'arrakis_circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
      labelNames: ['service'],
    });

    // Score Service connection gauge
    this.scoreServiceConnected = new prometheus.Gauge({
      name: 'arrakis_score_service_connected',
      help: 'Whether Score Service is connected (1=yes, 0=no)',
      labelNames: [],
    });

    // Eligibility check latency histogram
    this.eligibilityCheckLatency = new prometheus.Histogram({
      name: 'arrakis_eligibility_check_latency_seconds',
      help: 'Eligibility check latency in seconds',
      labelNames: ['rule_type', 'source'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    });

    // Score Service latency histogram
    this.scoreServiceLatency = new prometheus.Histogram({
      name: 'arrakis_score_service_latency_seconds',
      help: 'Score Service request latency in seconds',
      labelNames: ['method'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    });

    // Initialize circuit breaker states to closed (0)
    this.circuitBreakerState.set({ service: 'score_service' }, 0);
    this.circuitBreakerState.set({ service: 'native_reader' }, 0);
  }

  // --------------------------------------------------------------------------
  // TwoTierProviderMetrics Implementation
  // --------------------------------------------------------------------------

  /**
   * Record eligibility check result
   */
  recordEligibilityCheck(
    ruleType: string,
    source: string,
    eligible: boolean,
    latencyMs: number
  ): void {
    // Increment counter
    this.eligibilityChecksTotal.inc({
      rule_type: ruleType,
      source,
      eligible: eligible ? 'true' : 'false',
    });

    // Record latency
    this.eligibilityCheckLatency.observe(
      { rule_type: ruleType, source },
      latencyMs / 1000 // Convert to seconds
    );
  }

  /**
   * Record circuit breaker state change
   */
  recordCircuitState(service: string, state: number): void {
    this.circuitBreakerState.set({ service }, state);
  }

  /**
   * Record degradation event
   */
  recordDegradation(ruleType: string, reason: string): void {
    // Truncate reason to prevent high cardinality
    const normalizedReason = this.normalizeReason(reason);
    this.degradationEventsTotal.inc({
      rule_type: ruleType,
      reason: normalizedReason,
    });
  }

  // --------------------------------------------------------------------------
  // ScoreServiceMetrics Implementation
  // --------------------------------------------------------------------------

  /**
   * Record Score Service request latency
   */
  recordLatency(method: string, latencyMs: number, success: boolean): void {
    this.scoreServiceLatency.observe({ method }, latencyMs / 1000);

    // Also update connected status based on success
    if (!success) {
      // Don't immediately mark as disconnected, let health check handle it
    }
  }

  /**
   * Increment Score Service request counter
   */
  incrementRequests(method: string, success: boolean): void {
    this.scoreServiceRequestsTotal.inc({
      method,
      success: success ? 'true' : 'false',
    });
  }

  // --------------------------------------------------------------------------
  // Additional Methods
  // --------------------------------------------------------------------------

  /**
   * Set Score Service connection status
   */
  setScoreServiceConnected(connected: boolean): void {
    this.scoreServiceConnected.set({}, connected ? 1 : 0);
  }

  /**
   * Normalize error reason to prevent high cardinality
   */
  private normalizeReason(reason: string): string {
    // Categorize common error patterns
    if (reason.includes('timeout')) return 'timeout';
    if (reason.includes('circuit')) return 'circuit_open';
    if (reason.includes('connection')) return 'connection_error';
    if (reason.includes('ECONNREFUSED')) return 'connection_refused';
    if (reason.includes('ETIMEDOUT')) return 'timeout';
    if (reason.includes('500')) return 'server_error';
    if (reason.includes('503')) return 'service_unavailable';
    return 'other';
  }
}

// --------------------------------------------------------------------------
// Mock Metrics (for testing)
// --------------------------------------------------------------------------

/**
 * No-op metrics implementation for testing
 */
export class NoOpMetrics implements TwoTierProviderMetrics, ScoreServiceMetrics {
  recordEligibilityCheck(): void {
    // No-op
  }
  recordCircuitState(): void {
    // No-op
  }
  recordDegradation(): void {
    // No-op
  }
  recordLatency(): void {
    // No-op
  }
  incrementRequests(): void {
    // No-op
  }
}

/**
 * In-memory metrics for testing
 *
 * Records all metric calls for assertion in tests
 */
export class TestMetrics implements TwoTierProviderMetrics, ScoreServiceMetrics {
  readonly eligibilityChecks: Array<{
    ruleType: string;
    source: string;
    eligible: boolean;
    latencyMs: number;
  }> = [];
  readonly circuitStates: Array<{ service: string; state: number }> = [];
  readonly degradations: Array<{ ruleType: string; reason: string }> = [];
  readonly latencies: Array<{ method: string; latencyMs: number; success: boolean }> = [];
  readonly requests: Array<{ method: string; success: boolean }> = [];

  recordEligibilityCheck(
    ruleType: string,
    source: string,
    eligible: boolean,
    latencyMs: number
  ): void {
    this.eligibilityChecks.push({ ruleType, source, eligible, latencyMs });
  }

  recordCircuitState(service: string, state: number): void {
    this.circuitStates.push({ service, state });
  }

  recordDegradation(ruleType: string, reason: string): void {
    this.degradations.push({ ruleType, reason });
  }

  recordLatency(method: string, latencyMs: number, success: boolean): void {
    this.latencies.push({ method, latencyMs, success });
  }

  incrementRequests(method: string, success: boolean): void {
    this.requests.push({ method, success });
  }

  reset(): void {
    this.eligibilityChecks.length = 0;
    this.circuitStates.length = 0;
    this.degradations.length = 0;
    this.latencies.length = 0;
    this.requests.length = 0;
  }
}
