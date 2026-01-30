/**
 * Dune Sim Prometheus Metrics
 * Sprint 15: Dune Sim Integration & Rollout
 *
 * Prometheus metrics for monitoring the Dune Sim client.
 * Provides observability into:
 * - API request counts and latencies
 * - Cache hit/miss rates
 * - Rate limiting events
 * - Fallback events (hybrid mode)
 *
 * @see SDD Section 32 Prometheus Metrics
 */

import type { PrometheusClient, Counter, Gauge, Histogram } from './metrics.js';
import type { DuneSimMetrics as DuneSimClientMetrics } from './dune-sim-types.js';
import type { HybridProviderMetrics } from './hybrid-provider.js';

// --------------------------------------------------------------------------
// Dune Sim Metrics Registry
// --------------------------------------------------------------------------

/**
 * Dune Sim Metrics
 *
 * Creates and manages Prometheus metrics for the Dune Sim client.
 */
export class DuneSimPrometheusMetrics {
  // Counters
  private readonly requestsTotal: Counter;
  private readonly cacheHitsTotal: Counter;
  private readonly cacheMissesTotal: Counter;
  private readonly errorsTotal: Counter;
  private readonly rateLimitsTotal: Counter;
  private readonly fallbacksTotal: Counter;

  // Gauges
  private readonly cacheSize: Gauge;
  private readonly cacheHitRate: Gauge;

  // Histograms
  private readonly requestDuration: Histogram;

  constructor(prometheus: PrometheusClient) {
    // Request counter
    this.requestsTotal = new prometheus.Counter({
      name: 'dune_sim_requests_total',
      help: 'Total number of Dune Sim API requests',
      labelNames: ['endpoint', 'chain_id', 'success'],
    });

    // Cache hit counter
    this.cacheHitsTotal = new prometheus.Counter({
      name: 'dune_sim_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['endpoint'],
    });

    // Cache miss counter
    this.cacheMissesTotal = new prometheus.Counter({
      name: 'dune_sim_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['endpoint'],
    });

    // Error counter
    this.errorsTotal = new prometheus.Counter({
      name: 'dune_sim_errors_total',
      help: 'Total number of Dune Sim API errors',
      labelNames: ['endpoint', 'error_type'],
    });

    // Rate limit counter
    this.rateLimitsTotal = new prometheus.Counter({
      name: 'dune_sim_rate_limits_total',
      help: 'Total number of rate limit responses (429)',
      labelNames: ['endpoint'],
    });

    // Fallback counter (for hybrid mode)
    this.fallbacksTotal = new prometheus.Counter({
      name: 'dune_sim_fallbacks_total',
      help: 'Total number of fallbacks to RPC',
      labelNames: ['endpoint', 'reason'],
    });

    // Cache size gauge
    this.cacheSize = new prometheus.Gauge({
      name: 'dune_sim_cache_size',
      help: 'Current number of entries in the cache',
      labelNames: [],
    });

    // Cache hit rate gauge
    this.cacheHitRate = new prometheus.Gauge({
      name: 'dune_sim_cache_hit_rate',
      help: 'Current cache hit rate (0-1)',
      labelNames: [],
    });

    // Request duration histogram
    this.requestDuration = new prometheus.Histogram({
      name: 'dune_sim_request_duration_ms',
      help: 'Dune Sim API request duration in milliseconds',
      labelNames: ['endpoint', 'success'],
      buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    });
  }

  // --------------------------------------------------------------------------
  // Recording Methods
  // --------------------------------------------------------------------------

  /**
   * Record a successful request
   */
  recordRequest(
    endpoint: string,
    chainId: number | string,
    durationMs: number,
    success: boolean
  ): void {
    this.requestsTotal.inc({
      endpoint,
      chain_id: String(chainId),
      success: success ? 'true' : 'false',
    });

    this.requestDuration.observe(
      {
        endpoint,
        success: success ? 'true' : 'false',
      },
      durationMs
    );
  }

  /**
   * Record a cache hit
   */
  recordCacheHit(endpoint: string): void {
    this.cacheHitsTotal.inc({ endpoint });
  }

  /**
   * Record a cache miss
   */
  recordCacheMiss(endpoint: string): void {
    this.cacheMissesTotal.inc({ endpoint });
  }

  /**
   * Record an error
   */
  recordError(endpoint: string, errorType: string): void {
    this.errorsTotal.inc({
      endpoint,
      error_type: this.normalizeErrorType(errorType),
    });
  }

  /**
   * Record a rate limit event
   */
  recordRateLimit(endpoint: string): void {
    this.rateLimitsTotal.inc({ endpoint });
  }

  /**
   * Record a fallback to RPC
   */
  recordFallback(endpoint: string, reason: string): void {
    this.fallbacksTotal.inc({
      endpoint,
      reason: this.normalizeErrorType(reason),
    });
  }

  /**
   * Update cache statistics
   */
  updateCacheStats(size: number, hitRate: number): void {
    this.cacheSize.set({}, size);
    this.cacheHitRate.set({}, hitRate);
  }

  // --------------------------------------------------------------------------
  // Sync Methods
  // --------------------------------------------------------------------------

  /**
   * Sync metrics from DuneSimClient internal metrics
   */
  syncFromClientMetrics(metrics: DuneSimClientMetrics): void {
    // Update cache stats
    const total = metrics.cacheHits + metrics.cacheMisses;
    const hitRate = total > 0 ? metrics.cacheHits / total : 0;
    this.updateCacheStats(0, hitRate); // Size not available from client metrics
  }

  /**
   * Sync metrics from HybridChainProvider
   */
  syncFromHybridMetrics(metrics: HybridProviderMetrics): void {
    // Record fallback reasons
    for (const [_reason, _count] of Object.entries(metrics.fallbackReasons)) {
      // Note: This may create duplicate counts if called repeatedly
      // In production, use delta tracking
    }
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  /**
   * Normalize error type to prevent high cardinality
   */
  private normalizeErrorType(error: string): string {
    const lower = error.toLowerCase();

    if (lower.includes('timeout') || lower.includes('etimedout')) return 'timeout';
    if (lower.includes('rate') || lower.includes('429')) return 'rate_limit';
    if (lower.includes('auth') || lower.includes('401') || lower.includes('403')) return 'auth';
    if (lower.includes('not found') || lower.includes('404')) return 'not_found';
    if (lower.includes('500') || lower.includes('server')) return 'server_error';
    if (lower.includes('network') || lower.includes('econnrefused')) return 'network';

    return 'other';
  }
}

// --------------------------------------------------------------------------
// No-Op Implementation (for testing)
// --------------------------------------------------------------------------

/**
 * No-op metrics implementation for testing
 */
export class NoOpDuneSimMetrics {
  recordRequest(): void {
    // No-op
  }
  recordCacheHit(): void {
    // No-op
  }
  recordCacheMiss(): void {
    // No-op
  }
  recordError(): void {
    // No-op
  }
  recordRateLimit(): void {
    // No-op
  }
  recordFallback(): void {
    // No-op
  }
  updateCacheStats(): void {
    // No-op
  }
  syncFromClientMetrics(): void {
    // No-op
  }
  syncFromHybridMetrics(): void {
    // No-op
  }
}

// --------------------------------------------------------------------------
// Test Implementation
// --------------------------------------------------------------------------

/**
 * In-memory metrics for testing
 */
export class TestDuneSimMetrics {
  readonly requests: Array<{
    endpoint: string;
    chainId: string;
    durationMs: number;
    success: boolean;
  }> = [];
  readonly cacheHits: Array<{ endpoint: string }> = [];
  readonly cacheMisses: Array<{ endpoint: string }> = [];
  readonly errors: Array<{ endpoint: string; errorType: string }> = [];
  readonly rateLimits: Array<{ endpoint: string }> = [];
  readonly fallbacks: Array<{ endpoint: string; reason: string }> = [];
  cacheSize = 0;
  cacheHitRate = 0;

  recordRequest(
    endpoint: string,
    chainId: number | string,
    durationMs: number,
    success: boolean
  ): void {
    this.requests.push({ endpoint, chainId: String(chainId), durationMs, success });
  }

  recordCacheHit(endpoint: string): void {
    this.cacheHits.push({ endpoint });
  }

  recordCacheMiss(endpoint: string): void {
    this.cacheMisses.push({ endpoint });
  }

  recordError(endpoint: string, errorType: string): void {
    this.errors.push({ endpoint, errorType });
  }

  recordRateLimit(endpoint: string): void {
    this.rateLimits.push({ endpoint });
  }

  recordFallback(endpoint: string, reason: string): void {
    this.fallbacks.push({ endpoint, reason });
  }

  updateCacheStats(size: number, hitRate: number): void {
    this.cacheSize = size;
    this.cacheHitRate = hitRate;
  }

  syncFromClientMetrics(): void {
    // No-op for test
  }

  syncFromHybridMetrics(): void {
    // No-op for test
  }

  reset(): void {
    this.requests.length = 0;
    this.cacheHits.length = 0;
    this.cacheMisses.length = 0;
    this.errors.length = 0;
    this.rateLimits.length = 0;
    this.fallbacks.length = 0;
    this.cacheSize = 0;
    this.cacheHitRate = 0;
  }
}
