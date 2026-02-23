/**
 * Economic Metrics Emitter — CloudWatch EMF
 *
 * Emits economic health metrics via CloudWatch Embedded Metric Format (EMF).
 * These metrics feed the economic health dashboard and conservation alarms.
 *
 * Metrics emitted:
 *   - reserve_latency_ms         — Time to complete budget reservation
 *   - finalize_latency_ms        — Time to complete Postgres-first finalize
 *   - conservation_result        — 1=pass, 0=violation
 *   - conservation_drift_micro   — Absolute drift between Redis and Postgres
 *   - lot_expiry_count           — Number of lots expired per sweep
 *   - circuit_breaker_state      — 0=closed, 1=half-open, 2=open
 *   - pgbouncer_pool_utilization — Pool usage percentage
 *
 * @see SDD §4.4 Observability
 * @see Sprint 0B, Task 0B.4
 * @module packages/adapters/telemetry/economic-metrics
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Supported metric names for the economic subsystem */
export type EconomicMetricName =
  | 'reserve_latency_ms'
  | 'finalize_latency_ms'
  | 'conservation_result'
  | 'conservation_drift_micro'
  | 'lot_expiry_count'
  | 'circuit_breaker_state'
  | 'pgbouncer_pool_utilization'
  | 'budget_drift'
  | 'usage_event_count';

/** Dimension key-value pairs for metric context */
export interface MetricDimensions {
  community_id?: string;
  operation?: string;
  component?: string;
  [key: string]: string | undefined;
}

/** A single metric emission */
export interface MetricEmission {
  name: EconomicMetricName;
  value: number;
  unit: 'Milliseconds' | 'Count' | 'Percent' | 'None';
  dimensions?: MetricDimensions;
  timestamp?: Date;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const EMF_NAMESPACE = 'Arrakis/Economic';

// --------------------------------------------------------------------------
// EMF Emitter
// --------------------------------------------------------------------------

/**
 * Emit a single metric in CloudWatch EMF format.
 *
 * EMF log lines are picked up by the ADOT sidecar (or CloudWatch Logs agent)
 * and published as CloudWatch Metrics automatically.
 *
 * @param metric - The metric to emit
 */
export function emitEconomicMetric(metric: MetricEmission): void {
  const dimensions: Record<string, string> = {};
  const dimensionKeys: string[] = [];

  if (metric.dimensions) {
    for (const [key, value] of Object.entries(metric.dimensions)) {
      if (value !== undefined) {
        dimensions[key] = value;
        dimensionKeys.push(key);
      }
    }
  }

  const emfLog = {
    _aws: {
      Timestamp: (metric.timestamp ?? new Date()).getTime(),
      CloudWatchMetrics: [
        {
          Namespace: EMF_NAMESPACE,
          Dimensions: dimensionKeys.length > 0 ? [dimensionKeys] : [[]],
          Metrics: [
            {
              Name: metric.name,
              Unit: metric.unit,
            },
          ],
        },
      ],
    },
    ...dimensions,
    [metric.name]: metric.value,
  };

  // EMF lines must be written to stdout as single-line JSON
  process.stdout.write(JSON.stringify(emfLog) + '\n');
}

// --------------------------------------------------------------------------
// Convenience Functions
// --------------------------------------------------------------------------

/**
 * Emit reserve latency metric.
 */
export function emitReserveLatency(
  communityId: string,
  latencyMs: number,
): void {
  emitEconomicMetric({
    name: 'reserve_latency_ms',
    value: latencyMs,
    unit: 'Milliseconds',
    dimensions: { community_id: communityId, operation: 'reserve' },
  });
}

/**
 * Emit finalize latency metric.
 */
export function emitFinalizeLatency(
  communityId: string,
  latencyMs: number,
): void {
  emitEconomicMetric({
    name: 'finalize_latency_ms',
    value: latencyMs,
    unit: 'Milliseconds',
    dimensions: { community_id: communityId, operation: 'finalize' },
  });
}

/**
 * Emit conservation check result.
 *
 * @param communityId - Tenant community UUID
 * @param pass - Whether invariants held
 * @param driftMicro - Absolute drift in micro-USD
 */
export function emitConservationResult(
  communityId: string,
  pass: boolean,
  driftMicro: bigint,
): void {
  emitEconomicMetric({
    name: 'conservation_result',
    value: pass ? 1 : 0,
    unit: 'Count',
    dimensions: { community_id: communityId },
  });

  emitEconomicMetric({
    name: 'conservation_drift_micro',
    value: Number(driftMicro),
    unit: 'None',
    dimensions: { community_id: communityId },
  });
}

/**
 * Emit lot expiry sweep count.
 */
export function emitLotExpiryCount(count: number): void {
  emitEconomicMetric({
    name: 'lot_expiry_count',
    value: count,
    unit: 'Count',
  });
}

/**
 * Emit circuit breaker state for a component.
 *
 * @param component - Component name (e.g., 'conservation-guard', 'redis')
 * @param state - 0=closed, 1=half-open, 2=open
 */
export function emitCircuitBreakerState(
  component: string,
  state: 0 | 1 | 2,
): void {
  emitEconomicMetric({
    name: 'circuit_breaker_state',
    value: state,
    unit: 'None',
    dimensions: { component },
  });
}

/**
 * Emit PgBouncer pool utilization.
 *
 * @param utilizationPercent - Pool usage percentage (0-100)
 */
export function emitPgBouncerUtilization(utilizationPercent: number): void {
  emitEconomicMetric({
    name: 'pgbouncer_pool_utilization',
    value: utilizationPercent,
    unit: 'Percent',
  });
}

/**
 * Create a latency timer helper.
 * Returns a function that, when called, emits the elapsed time as a metric.
 */
export function startTimer(
  metricName: 'reserve_latency_ms' | 'finalize_latency_ms',
  communityId: string,
): () => number {
  const start = performance.now();
  return () => {
    const elapsed = Math.round(performance.now() - start);
    emitEconomicMetric({
      name: metricName,
      value: elapsed,
      unit: 'Milliseconds',
      dimensions: { community_id: communityId, operation: metricName.replace('_latency_ms', '') },
    });
    return elapsed;
  };
}
