/**
 * Cache Metrics Collector
 * Sprint S-12: Multi-Layer Caching
 *
 * Collects and exposes cache metrics for monitoring and alerting.
 * Integrates with the observability stack (Prometheus-compatible).
 *
 * Metrics tracked:
 * - cache_hits_total (by layer)
 * - cache_misses_total
 * - cache_hit_rate (gauge)
 * - cache_size (L1 entries)
 * - cache_latency_ms (histogram buckets)
 * - cache_invalidations_total
 */

import type { Logger } from 'pino';
import type { MultiLayerCache, MultiLayerCacheStats } from './MultiLayerCache.js';
import { CacheLayer } from './types.js';

/**
 * Latency histogram buckets (in milliseconds)
 */
const LATENCY_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];

/**
 * Metric labels for categorization
 */
export interface MetricLabels {
  layer: CacheLayer;
  namespace?: string;
  operation?: string;
}

/**
 * Histogram bucket data
 */
export interface HistogramBucket {
  le: number;
  count: number;
}

/**
 * Latency histogram data
 */
export interface LatencyHistogram {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Full metrics snapshot
 */
export interface CacheMetricsSnapshot {
  timestamp: number;
  l1: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    sets: number;
    deletes: number;
    invalidations: number;
  };
  l2: {
    hits: number;
    misses: number;
    hitRate: number;
    sets: number;
    deletes: number;
    invalidations: number;
  };
  combined: {
    overallHitRate: number;
    totalHits: number;
    totalMisses: number;
  };
  latency: {
    l1: LatencyHistogram;
    l2: LatencyHistogram;
  };
}

/**
 * Cache Metrics Collector
 */
export class CacheMetrics {
  private readonly log: Logger;
  private readonly cache: MultiLayerCache;
  private readonly namespace: string;

  // Latency tracking
  private l1Latencies: number[] = [];
  private l2Latencies: number[] = [];
  private readonly maxLatencySamples = 1000;

  // Collection interval
  private collectionInterval: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: CacheMetricsSnapshot | null = null;

  constructor(cache: MultiLayerCache, logger: Logger, namespace: string = 'arrakis') {
    this.log = logger.child({ component: 'CacheMetrics' });
    this.cache = cache;
    this.namespace = namespace;
  }

  /**
   * Record a cache operation latency
   */
  recordLatency(layer: CacheLayer, latencyMs: number): void {
    if (layer === CacheLayer.L1_MEMORY) {
      this.l1Latencies.push(latencyMs);
      if (this.l1Latencies.length > this.maxLatencySamples) {
        this.l1Latencies.shift();
      }
    } else if (layer === CacheLayer.L2_REDIS) {
      this.l2Latencies.push(latencyMs);
      if (this.l2Latencies.length > this.maxLatencySamples) {
        this.l2Latencies.shift();
      }
    }
  }

  /**
   * Build histogram from latency samples
   */
  private buildHistogram(samples: number[]): LatencyHistogram {
    const buckets: HistogramBucket[] = LATENCY_BUCKETS.map((le) => ({
      le,
      count: samples.filter((s) => s <= le).length,
    }));

    // Add +Inf bucket
    buckets.push({
      le: Infinity,
      count: samples.length,
    });

    return {
      buckets,
      sum: samples.reduce((a, b) => a + b, 0),
      count: samples.length,
    };
  }

  /**
   * Get current metrics snapshot
   */
  getSnapshot(): CacheMetricsSnapshot {
    const stats = this.cache.getStats();

    return {
      timestamp: Date.now(),
      l1: {
        hits: stats.l1.hits,
        misses: stats.l1.misses,
        hitRate: stats.l1.hitRate,
        size: stats.l1.size,
        sets: stats.l1.sets,
        deletes: stats.l1.deletes,
        invalidations: stats.l1.invalidations,
      },
      l2: {
        hits: stats.l2.hits,
        misses: stats.l2.misses,
        hitRate: stats.l2.hitRate,
        sets: stats.l2.sets,
        deletes: stats.l2.deletes,
        invalidations: stats.l2.invalidations,
      },
      combined: {
        overallHitRate: stats.combined.overallHitRate,
        totalHits: stats.combined.totalHits,
        totalMisses: stats.combined.totalMisses,
      },
      latency: {
        l1: this.buildHistogram(this.l1Latencies),
        l2: this.buildHistogram(this.l2Latencies),
      },
    };
  }

  /**
   * Format metrics in Prometheus exposition format
   */
  toPrometheusFormat(): string {
    const snapshot = this.getSnapshot();
    const ns = this.namespace;
    const lines: string[] = [];

    // Helper to add metric
    const addMetric = (name: string, help: string, type: string, value: number, labels?: Record<string, string>) => {
      lines.push(`# HELP ${ns}_${name} ${help}`);
      lines.push(`# TYPE ${ns}_${name} ${type}`);
      const labelStr = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
      lines.push(`${ns}_${name}${labelStr} ${value}`);
    };

    // L1 metrics
    addMetric('cache_hits_total', 'Total cache hits', 'counter', snapshot.l1.hits, { layer: 'l1' });
    addMetric('cache_misses_total', 'Total cache misses', 'counter', snapshot.l1.misses, { layer: 'l1' });
    addMetric('cache_hit_rate', 'Cache hit rate', 'gauge', snapshot.l1.hitRate, { layer: 'l1' });
    addMetric('cache_size', 'Current cache size', 'gauge', snapshot.l1.size, { layer: 'l1' });
    addMetric('cache_sets_total', 'Total cache sets', 'counter', snapshot.l1.sets, { layer: 'l1' });
    addMetric('cache_deletes_total', 'Total cache deletes', 'counter', snapshot.l1.deletes, { layer: 'l1' });
    addMetric('cache_invalidations_total', 'Total cache invalidations', 'counter', snapshot.l1.invalidations, { layer: 'l1' });

    // L2 metrics
    addMetric('cache_hits_total', 'Total cache hits', 'counter', snapshot.l2.hits, { layer: 'l2' });
    addMetric('cache_misses_total', 'Total cache misses', 'counter', snapshot.l2.misses, { layer: 'l2' });
    addMetric('cache_hit_rate', 'Cache hit rate', 'gauge', snapshot.l2.hitRate, { layer: 'l2' });
    addMetric('cache_sets_total', 'Total cache sets', 'counter', snapshot.l2.sets, { layer: 'l2' });
    addMetric('cache_deletes_total', 'Total cache deletes', 'counter', snapshot.l2.deletes, { layer: 'l2' });
    addMetric('cache_invalidations_total', 'Total cache invalidations', 'counter', snapshot.l2.invalidations, { layer: 'l2' });

    // Combined metrics
    addMetric('cache_overall_hit_rate', 'Overall cache hit rate', 'gauge', snapshot.combined.overallHitRate);
    addMetric('cache_total_hits', 'Total hits across all layers', 'counter', snapshot.combined.totalHits);
    addMetric('cache_total_misses', 'Total misses (L2 misses)', 'counter', snapshot.combined.totalMisses);

    // Latency histograms
    const addHistogram = (layer: string, histogram: LatencyHistogram) => {
      lines.push(`# HELP ${ns}_cache_latency_ms Cache operation latency in milliseconds`);
      lines.push(`# TYPE ${ns}_cache_latency_ms histogram`);
      for (const bucket of histogram.buckets) {
        const le = bucket.le === Infinity ? '+Inf' : bucket.le.toString();
        lines.push(`${ns}_cache_latency_ms_bucket{layer="${layer}",le="${le}"} ${bucket.count}`);
      }
      lines.push(`${ns}_cache_latency_ms_sum{layer="${layer}"} ${histogram.sum}`);
      lines.push(`${ns}_cache_latency_ms_count{layer="${layer}"} ${histogram.count}`);
    };

    addHistogram('l1', snapshot.latency.l1);
    addHistogram('l2', snapshot.latency.l2);

    return lines.join('\n');
  }

  /**
   * Format metrics as JSON for API responses
   */
  toJSON(): CacheMetricsSnapshot {
    return this.getSnapshot();
  }

  /**
   * Start periodic metrics collection
   */
  startCollection(intervalMs: number = 60000): void {
    if (this.collectionInterval) {
      return;
    }

    this.collectionInterval = setInterval(() => {
      this.lastSnapshot = this.getSnapshot();
      this.log.debug(
        {
          l1HitRate: this.lastSnapshot.l1.hitRate,
          l2HitRate: this.lastSnapshot.l2.hitRate,
          overallHitRate: this.lastSnapshot.combined.overallHitRate,
          l1Size: this.lastSnapshot.l1.size,
        },
        'Cache metrics collected'
      );
    }, intervalMs);

    // Don't block process exit
    if (this.collectionInterval.unref) {
      this.collectionInterval.unref();
    }

    this.log.info({ intervalMs }, 'Cache metrics collection started');
  }

  /**
   * Stop periodic metrics collection
   */
  stopCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      this.log.info('Cache metrics collection stopped');
    }
  }

  /**
   * Get last collected snapshot (for quick access)
   */
  getLastSnapshot(): CacheMetricsSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Reset all metrics and latency samples
   */
  reset(): void {
    this.cache.resetStats();
    this.l1Latencies = [];
    this.l2Latencies = [];
    this.lastSnapshot = null;
    this.log.info('Cache metrics reset');
  }
}
