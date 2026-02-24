/**
 * Boundary Metrics — Shadow-Mode Instrumentation
 *
 * Concrete metrics implementation for parseBoundaryMicroUsd counters.
 * Emits per-boundary-context counters for:
 *   - parseMicroUsd_shadow_total: Total shadow-mode parses
 *   - parseMicroUsd_would_reject_total: Canonical rejected but legacy accepted
 *   - parseMicroUsd_divergence_total: Canonical and legacy produced different values
 *
 * Designed to be CI-verifiable: counters are in-memory and inspectable.
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.2
 * @see grimoires/loa/sdd.md §3.6 IMP-003
 */

import type { BoundaryContext, BoundaryMetrics } from './parse-boundary-micro-usd.js';
import type { GraduationCounters } from './graduation.js';

// =============================================================================
// Types
// =============================================================================

/** Counter key format: metric_name:context */
export type MetricKey = `${string}:${BoundaryContext}`;

/** Metric name constants */
export const METRIC_NAMES = {
  SHADOW_TOTAL: 'parseMicroUsd_shadow_total',
  WOULD_REJECT_TOTAL: 'parseMicroUsd_would_reject_total',
  DIVERGENCE_TOTAL: 'parseMicroUsd_divergence_total',
  MODE_SWITCH: 'parseMicroUsd_mode_switch',
  ERROR_TOTAL: 'parseMicroUsd_error_total',
} as const;

/** Supported boundary contexts */
export const BOUNDARY_CONTEXTS: readonly BoundaryContext[] = ['http', 'db', 'redis', 'jwt'] as const;

/** Metric emission event for audit trail */
export interface MetricEmission {
  name: string;
  context: BoundaryContext;
  value: number;
  timestamp: number;
}

// =============================================================================
// Counter Registry
// =============================================================================

/**
 * In-memory counter registry for boundary parse metrics.
 *
 * Thread-safe for single-threaded Node.js. Each counter is keyed by
 * metric_name:context (e.g., "parseMicroUsd_shadow_total:http").
 *
 * In production, this would delegate to Prometheus/CloudWatch/StatsD.
 * The in-memory implementation enables CI-verifiable testing.
 */
export class BoundaryMetricsRegistry {
  private readonly counters = new Map<MetricKey, number>();
  private readonly emissions: MetricEmission[] = [];
  private readonly maxEmissions: number;
  /** Per-context timestamp of last wouldRejectTotal increment (cycle-040 FR-1) */
  private readonly lastWouldRejectTimestamps = new Map<BoundaryContext, number>();

  constructor(options?: { maxEmissions?: number }) {
    this.maxEmissions = options?.maxEmissions ?? 10_000;

    // Pre-register all counters at 0
    for (const metric of Object.values(METRIC_NAMES)) {
      for (const context of BOUNDARY_CONTEXTS) {
        this.counters.set(`${metric}:${context}` as MetricKey, 0);
      }
    }
  }

  /**
   * Increment a counter by 1.
   */
  increment(name: string, context: BoundaryContext): void {
    const key = `${name}:${context}` as MetricKey;
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + 1);

    // Record emission for audit
    if (this.emissions.length < this.maxEmissions) {
      this.emissions.push({
        name,
        context,
        value: current + 1,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get the current value of a counter.
   */
  get(name: string, context: BoundaryContext): number {
    return this.counters.get(`${name}:${context}` as MetricKey) ?? 0;
  }

  /**
   * Get all counters as a plain object snapshot.
   */
  snapshot(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Get recent emissions (for testing/audit).
   */
  getEmissions(): readonly MetricEmission[] {
    return this.emissions;
  }

  /**
   * Get the last wouldRejectTotal timestamp for a given context.
   * Returns 0 if no would-reject event has occurred for that context.
   */
  getLastWouldRejectTimestamp(context: BoundaryContext): number {
    return this.lastWouldRejectTimestamps.get(context) ?? 0;
  }

  /**
   * Get graduation-compatible counter snapshot for a given context.
   * Converts internal number counters to BigInt for precision-safe comparison.
   *
   * @see SDD cycle-040 §3.1
   */
  getGraduationCounters(context: BoundaryContext): GraduationCounters {
    return {
      shadowTotal: BigInt(this.get(METRIC_NAMES.SHADOW_TOTAL, context)),
      wouldRejectTotal: BigInt(this.get(METRIC_NAMES.WOULD_REJECT_TOTAL, context)),
      divergenceTotal: BigInt(this.get(METRIC_NAMES.DIVERGENCE_TOTAL, context)),
    };
  }

  /**
   * Reset all counters to 0 and clear emissions.
   */
  reset(): void {
    for (const key of this.counters.keys()) {
      this.counters.set(key, 0);
    }
    this.emissions.length = 0;
    this.lastWouldRejectTimestamps.clear();
  }

  /**
   * Create a BoundaryMetrics adapter that delegates to this registry.
   * This is the bridge between the parseBoundaryMicroUsd interface
   * and the concrete counter implementation.
   */
  toBoundaryMetrics(): BoundaryMetrics {
    return {
      shadowTotal: (context: BoundaryContext) => {
        this.increment(METRIC_NAMES.SHADOW_TOTAL, context);
      },
      wouldRejectTotal: (context: BoundaryContext) => {
        this.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, context);
        this.lastWouldRejectTimestamps.set(context, Date.now());
      },
      divergenceTotal: (context: BoundaryContext) => {
        this.increment(METRIC_NAMES.DIVERGENCE_TOTAL, context);
      },
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/** Global metrics registry singleton */
let globalRegistry: BoundaryMetricsRegistry | null = null;

/**
 * Get or create the global BoundaryMetricsRegistry singleton.
 */
export function getBoundaryMetricsRegistry(): BoundaryMetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new BoundaryMetricsRegistry();
  }
  return globalRegistry;
}

/**
 * Get the global BoundaryMetrics adapter for use with parseBoundaryMicroUsd.
 */
export function getBoundaryMetrics(): BoundaryMetrics {
  return getBoundaryMetricsRegistry().toBoundaryMetrics();
}

/**
 * Reset the global registry (for testing only).
 */
export function resetBoundaryMetricsRegistry(): void {
  if (globalRegistry) {
    globalRegistry.reset();
  }
  globalRegistry = null;
}
