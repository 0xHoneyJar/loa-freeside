/**
 * Config Service Metrics
 *
 * Sprint 119: Pub/Sub Publisher Metrics
 * Sprint 120: Cache & Subscriber Metrics (TODO)
 *
 * Metrics for configuration management observability.
 *
 * @see grimoires/loa/sprint.md Sprint 119 Task 119.4
 */

import type { RecordableType } from '../../db/types/config.types.js';

// =============================================================================
// Metrics Storage
// =============================================================================

interface ConfigMetrics {
  // Sprint 119: Publisher metrics
  /** Total invalidations published (by type) */
  invalidationsPublished: Map<string, number>;
  /** Publish errors (by type) */
  publishErrors: Map<string, number>;

  // Sprint 120: Cache metrics (TODO)
  // cacheHits: Map<string, number>;
  // cacheMisses: Map<string, number>;
  // propagationLatency: HistogramData;
}

const configMetrics: ConfigMetrics = {
  invalidationsPublished: new Map(),
  publishErrors: new Map(),
};

// =============================================================================
// Sprint 119: Publisher Metrics
// =============================================================================

/**
 * Record a config invalidation published.
 *
 * @param type - The type of config change (ThresholdChange, FeatureGateChange, RoleMapChange)
 */
export function recordConfigInvalidation(type: RecordableType): void {
  const current = configMetrics.invalidationsPublished.get(type) ?? 0;
  configMetrics.invalidationsPublished.set(type, current + 1);
}

/**
 * Record a config publish error.
 *
 * @param type - The type of config change that failed to publish
 */
export function recordConfigPublishError(type: RecordableType): void {
  const current = configMetrics.publishErrors.get(type) ?? 0;
  configMetrics.publishErrors.set(type, current + 1);
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get config metrics in Prometheus text format.
 *
 * These lines can be appended to the main metrics output.
 */
export function getConfigMetricsPrometheus(): string {
  const lines: string[] = [];

  // Sprint 119: Invalidations published
  lines.push('# HELP sietch_config_invalidations_published_total Total config invalidations published');
  lines.push('# TYPE sietch_config_invalidations_published_total counter');
  for (const [type, count] of configMetrics.invalidationsPublished) {
    lines.push(`sietch_config_invalidations_published_total{type="${type}"} ${count}`);
  }
  // Ensure we have at least one data point for each type
  const allTypes: RecordableType[] = ['ThresholdChange', 'FeatureGateChange', 'RoleMapChange'];
  for (const type of allTypes) {
    if (!configMetrics.invalidationsPublished.has(type)) {
      lines.push(`sietch_config_invalidations_published_total{type="${type}"} 0`);
    }
  }

  // Sprint 119: Publish errors
  lines.push('# HELP sietch_config_publish_errors_total Total config publish errors');
  lines.push('# TYPE sietch_config_publish_errors_total counter');
  for (const [type, count] of configMetrics.publishErrors) {
    lines.push(`sietch_config_publish_errors_total{type="${type}"} ${count}`);
  }
  for (const type of allTypes) {
    if (!configMetrics.publishErrors.has(type)) {
      lines.push(`sietch_config_publish_errors_total{type="${type}"} 0`);
    }
  }

  // TODO Sprint 120: Add cache metrics
  // lines.push('# HELP sietch_config_cache_hits_total Total config cache hits');
  // lines.push('# TYPE sietch_config_cache_hits_total counter');
  // ...

  // TODO Sprint 120: Add propagation latency histogram
  // lines.push('# HELP sietch_config_propagation_latency_ms Config propagation latency');
  // lines.push('# TYPE sietch_config_propagation_latency_ms histogram');
  // ...

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getConfigMetricsRaw(): ConfigMetrics {
  return { ...configMetrics };
}

/**
 * Reset all metrics (for testing).
 */
export function resetConfigMetrics(): void {
  configMetrics.invalidationsPublished.clear();
  configMetrics.publishErrors.clear();
}
