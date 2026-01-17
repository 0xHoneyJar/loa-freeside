/**
 * RPC Pool Metrics
 * Sprint S-2: RPC Pool & Circuit Breakers
 *
 * Prometheus-compatible metrics for monitoring RPC pool health
 */

import type { CircuitState } from './types.js';

/**
 * Histogram bucket boundaries for latency (in ms)
 */
const LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * RPC Pool metrics collector
 */
export class RPCMetrics {
  // Request counters per provider
  private totalRequests: Map<string, number> = new Map();
  private successfulRequests: Map<string, number> = new Map();
  private failedRequests: Map<string, number> = new Map();
  private timeouts: Map<string, number> = new Map();
  private rejections: Map<string, number> = new Map();

  // Circuit breaker states
  private circuitStates: Map<string, CircuitState> = new Map();
  private circuitStateChanges: Map<string, number> = new Map();

  // Latency tracking
  private latencySum: Map<string, number> = new Map();
  private latencyCount: Map<string, number> = new Map();
  private latencyBuckets: Map<string, Map<number, number>> = new Map();

  // Cache metrics
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Record a request attempt
   */
  recordRequest(provider: string, success: boolean): void {
    const current = this.totalRequests.get(provider) || 0;
    this.totalRequests.set(provider, current + 1);

    if (success) {
      const successCount = this.successfulRequests.get(provider) || 0;
      this.successfulRequests.set(provider, successCount + 1);
    } else {
      const failCount = this.failedRequests.get(provider) || 0;
      this.failedRequests.set(provider, failCount + 1);
    }
  }

  /**
   * Record a timeout
   */
  recordTimeout(provider: string): void {
    const current = this.timeouts.get(provider) || 0;
    this.timeouts.set(provider, current + 1);
  }

  /**
   * Record a circuit rejection
   */
  recordRejection(provider: string): void {
    const current = this.rejections.get(provider) || 0;
    this.rejections.set(provider, current + 1);
  }

  /**
   * Record circuit state change
   */
  recordCircuitStateChange(provider: string, state: CircuitState): void {
    this.circuitStates.set(provider, state);
    const changeCount = this.circuitStateChanges.get(provider) || 0;
    this.circuitStateChanges.set(provider, changeCount + 1);
  }

  /**
   * Record request latency
   */
  recordLatency(provider: string, latencyMs: number): void {
    // Update sum and count for average calculation
    const sum = this.latencySum.get(provider) || 0;
    this.latencySum.set(provider, sum + latencyMs);

    const count = this.latencyCount.get(provider) || 0;
    this.latencyCount.set(provider, count + 1);

    // Update histogram buckets
    let buckets = this.latencyBuckets.get(provider);
    if (!buckets) {
      buckets = new Map();
      LATENCY_BUCKETS.forEach((b) => buckets!.set(b, 0));
      buckets.set(Infinity, 0); // +Inf bucket
      this.latencyBuckets.set(provider, buckets);
    }

    // Increment appropriate bucket
    for (const bucket of LATENCY_BUCKETS) {
      if (latencyMs <= bucket) {
        const current = buckets.get(bucket) || 0;
        buckets.set(bucket, current + 1);
      }
    }
    // Always increment +Inf
    const infCurrent = buckets.get(Infinity) || 0;
    buckets.set(Infinity, infCurrent + 1);
  }

  /**
   * Record cache hit
   */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Get average latency for a provider
   */
  getAverageLatency(provider: string): number | null {
    const sum = this.latencySum.get(provider);
    const count = this.latencyCount.get(provider);

    if (sum === undefined || count === undefined || count === 0) {
      return null;
    }

    return sum / count;
  }

  /**
   * Get error rate for a provider (0-1)
   */
  getErrorRate(provider: string): number | null {
    const total = this.totalRequests.get(provider);
    const failed = this.failedRequests.get(provider);

    if (total === undefined || total === 0) {
      return null;
    }

    return (failed || 0) / total;
  }

  /**
   * Get cache hit rate (0-1)
   */
  getCacheHitRate(): number | null {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) {
      return null;
    }
    return this.cacheHits / total;
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    // Request counters
    lines.push('# HELP rpc_requests_total Total RPC requests per provider');
    lines.push('# TYPE rpc_requests_total counter');
    this.totalRequests.forEach((count, provider) => {
      lines.push(`rpc_requests_total{provider="${provider}"} ${count}`);
    });

    lines.push('# HELP rpc_requests_success_total Successful RPC requests per provider');
    lines.push('# TYPE rpc_requests_success_total counter');
    this.successfulRequests.forEach((count, provider) => {
      lines.push(`rpc_requests_success_total{provider="${provider}"} ${count}`);
    });

    lines.push('# HELP rpc_requests_failed_total Failed RPC requests per provider');
    lines.push('# TYPE rpc_requests_failed_total counter');
    this.failedRequests.forEach((count, provider) => {
      lines.push(`rpc_requests_failed_total{provider="${provider}"} ${count}`);
    });

    lines.push('# HELP rpc_timeouts_total RPC request timeouts per provider');
    lines.push('# TYPE rpc_timeouts_total counter');
    this.timeouts.forEach((count, provider) => {
      lines.push(`rpc_timeouts_total{provider="${provider}"} ${count}`);
    });

    lines.push('# HELP rpc_rejections_total Circuit breaker rejections per provider');
    lines.push('# TYPE rpc_rejections_total counter');
    this.rejections.forEach((count, provider) => {
      lines.push(`rpc_rejections_total{provider="${provider}"} ${count}`);
    });

    // Circuit breaker state (0=closed, 1=halfOpen, 2=open)
    lines.push('# HELP rpc_circuit_breaker_state Circuit breaker state (0=closed, 1=halfOpen, 2=open)');
    lines.push('# TYPE rpc_circuit_breaker_state gauge');
    this.circuitStates.forEach((state, provider) => {
      const stateValue = state === 'closed' ? 0 : state === 'halfOpen' ? 1 : 2;
      lines.push(`rpc_circuit_breaker_state{provider="${provider}"} ${stateValue}`);
    });

    // Circuit state change counter
    lines.push('# HELP rpc_circuit_state_changes_total Total circuit state changes');
    lines.push('# TYPE rpc_circuit_state_changes_total counter');
    this.circuitStateChanges.forEach((count, provider) => {
      lines.push(`rpc_circuit_state_changes_total{provider="${provider}"} ${count}`);
    });

    // Latency histogram
    lines.push('# HELP rpc_request_duration_ms Request latency in milliseconds');
    lines.push('# TYPE rpc_request_duration_ms histogram');
    this.latencyBuckets.forEach((buckets, provider) => {
      buckets.forEach((count, le) => {
        const leStr = le === Infinity ? '+Inf' : le.toString();
        lines.push(`rpc_request_duration_ms_bucket{provider="${provider}",le="${leStr}"} ${count}`);
      });
      const sum = this.latencySum.get(provider) || 0;
      const count = this.latencyCount.get(provider) || 0;
      lines.push(`rpc_request_duration_ms_sum{provider="${provider}"} ${sum}`);
      lines.push(`rpc_request_duration_ms_count{provider="${provider}"} ${count}`);
    });

    // Cache metrics
    lines.push('# HELP rpc_cache_hits_total Cache hits for graceful degradation');
    lines.push('# TYPE rpc_cache_hits_total counter');
    lines.push(`rpc_cache_hits_total ${this.cacheHits}`);

    lines.push('# HELP rpc_cache_misses_total Cache misses');
    lines.push('# TYPE rpc_cache_misses_total counter');
    lines.push(`rpc_cache_misses_total ${this.cacheMisses}`);

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON for debugging
   */
  toJSON(): Record<string, unknown> {
    return {
      totalRequests: Object.fromEntries(this.totalRequests),
      successfulRequests: Object.fromEntries(this.successfulRequests),
      failedRequests: Object.fromEntries(this.failedRequests),
      timeouts: Object.fromEntries(this.timeouts),
      rejections: Object.fromEntries(this.rejections),
      circuitStates: Object.fromEntries(this.circuitStates),
      circuitStateChanges: Object.fromEntries(this.circuitStateChanges),
      averageLatencies: Object.fromEntries(
        [...this.latencyCount.keys()].map((p) => [p, this.getAverageLatency(p)]),
      ),
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate: this.getCacheHitRate(),
    };
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.totalRequests.clear();
    this.successfulRequests.clear();
    this.failedRequests.clear();
    this.timeouts.clear();
    this.rejections.clear();
    this.circuitStates.clear();
    this.circuitStateChanges.clear();
    this.latencySum.clear();
    this.latencyCount.clear();
    this.latencyBuckets.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}
