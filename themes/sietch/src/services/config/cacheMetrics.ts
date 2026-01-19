/**
 * Cache Metrics
 *
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Metrics for cache layer observability.
 *
 * @see grimoires/loa/sprint.md Sprint 120 Tasks 120.5, 120.6
 */

// =============================================================================
// Histogram Configuration
// =============================================================================

/** Propagation latency histogram buckets (milliseconds) */
const PROPAGATION_LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000];

// =============================================================================
// Types
// =============================================================================

interface HistogramData {
  buckets: Map<number, number>;
  sum: number;
  count: number;
}

function createHistogram(buckets: number[]): HistogramData {
  const bucketMap = new Map<number, number>();
  for (const b of buckets) {
    bucketMap.set(b, 0);
  }
  bucketMap.set(Infinity, 0);
  return { buckets: bucketMap, sum: 0, count: 0 };
}

function observeHistogram(histogram: HistogramData, value: number): void {
  histogram.sum += value;
  histogram.count++;
  for (const [bucket, count] of histogram.buckets) {
    if (value <= bucket) {
      histogram.buckets.set(bucket, count + 1);
    }
  }
}

// =============================================================================
// Metrics Storage
// =============================================================================

interface CacheMetrics {
  /** Cache hits by layer (l1, l2) */
  cacheHits: Map<string, number>;
  /** Cache misses */
  cacheMisses: number;
  /** Cache invalidations */
  cacheInvalidations: number;
  /** Propagation latency histogram (ms) */
  propagationLatency: HistogramData;
}

const cacheMetrics: CacheMetrics = {
  cacheHits: new Map(),
  cacheMisses: 0,
  cacheInvalidations: 0,
  propagationLatency: createHistogram(PROPAGATION_LATENCY_BUCKETS),
};

// =============================================================================
// Recording Functions
// =============================================================================

/**
 * Record a cache hit.
 *
 * @param layer - The cache layer that hit (l1 or l2)
 */
export function recordCacheHit(layer: 'l1' | 'l2'): void {
  const current = cacheMetrics.cacheHits.get(layer) ?? 0;
  cacheMetrics.cacheHits.set(layer, current + 1);
}

/**
 * Record a cache miss.
 */
export function recordCacheMiss(): void {
  cacheMetrics.cacheMisses++;
}

/**
 * Record a cache invalidation.
 */
export function recordCacheInvalidation(): void {
  cacheMetrics.cacheInvalidations++;
}

/**
 * Record propagation latency (time from publish to cache invalidation).
 *
 * Alert threshold: p99 > 500ms for 5 minutes
 *
 * @param latencyMs - Latency in milliseconds
 */
export function recordPropagationLatency(latencyMs: number): void {
  observeHistogram(cacheMetrics.propagationLatency, latencyMs);
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get cache metrics in Prometheus text format.
 */
export function getCacheMetricsPrometheus(): string {
  const lines: string[] = [];

  // Cache hits by layer
  lines.push('# HELP sietch_config_cache_hits_total Total config cache hits');
  lines.push('# TYPE sietch_config_cache_hits_total counter');
  for (const layer of ['l1', 'l2']) {
    const count = cacheMetrics.cacheHits.get(layer) ?? 0;
    lines.push(`sietch_config_cache_hits_total{layer="${layer}"} ${count}`);
  }

  // Cache misses
  lines.push('# HELP sietch_config_cache_misses_total Total config cache misses');
  lines.push('# TYPE sietch_config_cache_misses_total counter');
  lines.push(`sietch_config_cache_misses_total ${cacheMetrics.cacheMisses}`);

  // Cache invalidations
  lines.push('# HELP sietch_config_cache_invalidations_total Total config cache invalidations');
  lines.push('# TYPE sietch_config_cache_invalidations_total counter');
  lines.push(`sietch_config_cache_invalidations_total ${cacheMetrics.cacheInvalidations}`);

  // Propagation latency histogram
  // Alert: p99 > 500ms for 5 minutes
  lines.push('# HELP sietch_config_propagation_latency_ms Config propagation latency from save to bot refresh');
  lines.push('# TYPE sietch_config_propagation_latency_ms histogram');
  for (const [bucket, count] of cacheMetrics.propagationLatency.buckets) {
    const le = bucket === Infinity ? '+Inf' : bucket.toString();
    lines.push(`sietch_config_propagation_latency_ms_bucket{le="${le}"} ${count}`);
  }
  lines.push(`sietch_config_propagation_latency_ms_sum ${cacheMetrics.propagationLatency.sum}`);
  lines.push(`sietch_config_propagation_latency_ms_count ${cacheMetrics.propagationLatency.count}`);

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getCacheMetricsRaw(): CacheMetrics {
  return { ...cacheMetrics };
}

/**
 * Reset all metrics (for testing).
 */
export function resetCacheMetrics(): void {
  cacheMetrics.cacheHits.clear();
  cacheMetrics.cacheMisses = 0;
  cacheMetrics.cacheInvalidations = 0;
  cacheMetrics.propagationLatency = createHistogram(PROPAGATION_LATENCY_BUCKETS);
}
