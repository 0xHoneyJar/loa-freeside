/**
 * ScyllaDB Metrics
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Prometheus-compatible metrics for ScyllaDB operations
 */

/**
 * Histogram bucket boundaries for latency (in ms)
 */
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

/**
 * ScyllaDB metrics collector
 */
export class ScyllaMetrics {
  // Connection metrics
  private connectionAttempts = 0;
  private connectionSuccesses = 0;
  private connectionFailures = 0;

  // Query metrics per operation
  private queryCount: Map<string, number> = new Map();
  private querySuccesses: Map<string, number> = new Map();
  private queryFailures: Map<string, number> = new Map();
  private queryLatencySum: Map<string, number> = new Map();
  private queryLatencyBuckets: Map<string, Map<number, number>> = new Map();

  // Cache metrics (for eligibility snapshots)
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Record connection attempt
   */
  recordConnection(success: boolean): void {
    this.connectionAttempts++;
    if (success) {
      this.connectionSuccesses++;
    } else {
      this.connectionFailures++;
    }
  }

  /**
   * Record query execution
   */
  recordQuery(operation: string, latencyMs: number, success: boolean): void {
    // Update counts
    const count = this.queryCount.get(operation) || 0;
    this.queryCount.set(operation, count + 1);

    if (success) {
      const successes = this.querySuccesses.get(operation) || 0;
      this.querySuccesses.set(operation, successes + 1);
    } else {
      const failures = this.queryFailures.get(operation) || 0;
      this.queryFailures.set(operation, failures + 1);
    }

    // Update latency sum
    const latencySum = this.queryLatencySum.get(operation) || 0;
    this.queryLatencySum.set(operation, latencySum + latencyMs);

    // Update histogram buckets
    let buckets = this.queryLatencyBuckets.get(operation);
    if (!buckets) {
      buckets = new Map();
      LATENCY_BUCKETS.forEach((b) => buckets!.set(b, 0));
      buckets.set(Infinity, 0);
      this.queryLatencyBuckets.set(operation, buckets);
    }

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
   * Record cache hit (eligibility snapshots)
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
   * Get average latency for an operation
   */
  getAverageLatency(operation: string): number | null {
    const sum = this.queryLatencySum.get(operation);
    const count = this.queryCount.get(operation);

    if (sum === undefined || count === undefined || count === 0) {
      return null;
    }

    return sum / count;
  }

  /**
   * Get error rate for an operation
   */
  getErrorRate(operation: string): number | null {
    const total = this.queryCount.get(operation);
    const failures = this.queryFailures.get(operation);

    if (total === undefined || total === 0) {
      return null;
    }

    return (failures || 0) / total;
  }

  /**
   * Get cache hit rate
   */
  getCacheHitRate(): number | null {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) return null;
    return this.cacheHits / total;
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    // Connection metrics
    lines.push('# HELP scylla_connection_attempts_total Total connection attempts');
    lines.push('# TYPE scylla_connection_attempts_total counter');
    lines.push(`scylla_connection_attempts_total ${this.connectionAttempts}`);

    lines.push('# HELP scylla_connection_successes_total Successful connections');
    lines.push('# TYPE scylla_connection_successes_total counter');
    lines.push(`scylla_connection_successes_total ${this.connectionSuccesses}`);

    lines.push('# HELP scylla_connection_failures_total Failed connections');
    lines.push('# TYPE scylla_connection_failures_total counter');
    lines.push(`scylla_connection_failures_total ${this.connectionFailures}`);

    // Query counts
    lines.push('# HELP scylla_queries_total Total queries per operation');
    lines.push('# TYPE scylla_queries_total counter');
    this.queryCount.forEach((count, operation) => {
      lines.push(`scylla_queries_total{operation="${operation}"} ${count}`);
    });

    lines.push('# HELP scylla_queries_success_total Successful queries per operation');
    lines.push('# TYPE scylla_queries_success_total counter');
    this.querySuccesses.forEach((count, operation) => {
      lines.push(`scylla_queries_success_total{operation="${operation}"} ${count}`);
    });

    lines.push('# HELP scylla_queries_failed_total Failed queries per operation');
    lines.push('# TYPE scylla_queries_failed_total counter');
    this.queryFailures.forEach((count, operation) => {
      lines.push(`scylla_queries_failed_total{operation="${operation}"} ${count}`);
    });

    // Query latency histogram
    lines.push('# HELP scylla_query_duration_ms Query latency in milliseconds');
    lines.push('# TYPE scylla_query_duration_ms histogram');
    this.queryLatencyBuckets.forEach((buckets, operation) => {
      buckets.forEach((count, le) => {
        const leStr = le === Infinity ? '+Inf' : le.toString();
        lines.push(`scylla_query_duration_ms_bucket{operation="${operation}",le="${leStr}"} ${count}`);
      });
      const sum = this.queryLatencySum.get(operation) || 0;
      const queryCount = this.queryCount.get(operation) || 0;
      lines.push(`scylla_query_duration_ms_sum{operation="${operation}"} ${sum}`);
      lines.push(`scylla_query_duration_ms_count{operation="${operation}"} ${queryCount}`);
    });

    // Cache metrics
    lines.push('# HELP scylla_eligibility_cache_hits_total Cache hits for eligibility snapshots');
    lines.push('# TYPE scylla_eligibility_cache_hits_total counter');
    lines.push(`scylla_eligibility_cache_hits_total ${this.cacheHits}`);

    lines.push('# HELP scylla_eligibility_cache_misses_total Cache misses');
    lines.push('# TYPE scylla_eligibility_cache_misses_total counter');
    lines.push(`scylla_eligibility_cache_misses_total ${this.cacheMisses}`);

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON for debugging
   */
  toJSON(): Record<string, unknown> {
    const averageLatencies: Record<string, number | null> = {};
    this.queryCount.forEach((_, operation) => {
      averageLatencies[operation] = this.getAverageLatency(operation);
    });

    return {
      connections: {
        attempts: this.connectionAttempts,
        successes: this.connectionSuccesses,
        failures: this.connectionFailures,
      },
      queries: {
        total: Object.fromEntries(this.queryCount),
        successes: Object.fromEntries(this.querySuccesses),
        failures: Object.fromEntries(this.queryFailures),
        averageLatencies,
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: this.getCacheHitRate(),
      },
    };
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    this.connectionAttempts = 0;
    this.connectionSuccesses = 0;
    this.connectionFailures = 0;
    this.queryCount.clear();
    this.querySuccesses.clear();
    this.queryFailures.clear();
    this.queryLatencySum.clear();
    this.queryLatencyBuckets.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}
