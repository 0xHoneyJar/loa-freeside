/**
 * Boundary graduation criteria for parseBoundaryMicroUsd shadow→enforce transition.
 *
 * All criteria are computable from existing BoundaryMetrics counters
 * (shadowTotal, wouldRejectTotal, divergenceTotal) plus deployment timestamps.
 * No new storage or quarantine mechanism required.
 *
 * Part of the Commons Protocol — community-governed economic protocol for AI inference.
 *
 * @see SDD cycle-040 §3.1
 */

import type { BoundaryContext } from './parse-boundary-micro-usd.js';
import type { BoundaryMetricsRegistry } from './boundary-metrics.js';

export interface BoundaryGraduationCriteria {
  /** Maximum divergence rate as parts-per-million (PPM). 1000 PPM = 0.1% */
  readonly maxDivergenceRatePpm: bigint;
  /** Minimum observation window in milliseconds. 604_800_000 = 7 days */
  readonly minObservationWindowMs: number;
  /** Consecutive window in ms where wouldRejectTotal must not increment. 259_200_000 = 72h */
  readonly wouldRejectConsecutiveWindowMs: number;
}

export const DEFAULT_GRADUATION_CRITERIA: BoundaryGraduationCriteria = {
  maxDivergenceRatePpm: 1000n,      // 0.1% = 1000 parts per million
  minObservationWindowMs: 604_800_000, // 7 days
  wouldRejectConsecutiveWindowMs: 259_200_000, // 72 hours
};

/**
 * Counter snapshot for graduation evaluation.
 *
 * These are the accumulated BigInt counter values read from the
 * BoundaryMetricsRegistry, NOT the BoundaryMetrics callback interface.
 * The caller converts registry counters (number) to BigInt before passing.
 */
export interface GraduationCounters {
  readonly shadowTotal: bigint;
  readonly wouldRejectTotal: bigint;
  readonly divergenceTotal: bigint;
}

export interface GraduationStatus {
  readonly context: BoundaryContext;
  readonly ready: boolean;
  readonly criteria: {
    divergenceRate: { met: boolean; currentPpm: bigint; thresholdPpm: bigint };
    observationWindow: { met: boolean; currentMs: number; thresholdMs: number };
    wouldRejectClean: { met: boolean; wouldRejectTotal: bigint; consecutiveCleanMs: number; thresholdMs: number };
  };
  /** Operational warnings — empty when no anomalies detected */
  readonly warnings: readonly string[];
  readonly evaluatedAt: string; // ISO 8601
}

const PPM = 1_000_000n;

/**
 * Evaluate graduation readiness for a given boundary context.
 *
 * All BigInt counter comparisons use integer arithmetic (PPM = parts per million)
 * to avoid Number precision loss. Counters are never converted to Number.
 *
 * @param context - Boundary context being evaluated
 * @param counters - Current accumulated counter values for the context
 * @param deployTimestamp - When shadow mode was deployed (ms since epoch)
 * @param lastWouldRejectTimestamp - Last time wouldRejectTotal incremented (ms since epoch).
 *        Source: in-memory timestamp updated by the parseBoundaryMicroUsd metrics emitter
 *        when a would-reject event occurs. If wouldRejectTotal is 0, this value is ignored.
 *        NOTE: This timestamp is per-process and resets on cold restart. After restart,
 *        the consecutive-clean window restarts from the deploy/restart timestamp.
 *        For cross-restart durability, use PromQL: `increase(wouldRejectTotal[72h]) == 0`.
 * @param criteria - Graduation criteria (defaults to DEFAULT_GRADUATION_CRITERIA)
 * @param now - Current timestamp in ms (defaults to Date.now(), injectable for testing)
 */
export function evaluateGraduation(
  context: BoundaryContext,
  counters: GraduationCounters,
  deployTimestamp: number,
  lastWouldRejectTimestamp: number,
  criteria: BoundaryGraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
  now: number = Date.now(),
): GraduationStatus {
  const warnings: string[] = [];

  // BigInt integer arithmetic: divergenceTotal * 1_000_000 <= shadowTotal * thresholdPpm
  // This avoids Number conversion and maintains full precision.
  const divergenceMet = counters.shadowTotal > 0n
    ? counters.divergenceTotal * PPM <= counters.shadowTotal * criteria.maxDivergenceRatePpm
    : true; // No traffic yet — vacuously met (zero-traffic rule)
  const currentPpm = counters.shadowTotal > 0n
    ? (counters.divergenceTotal * PPM) / counters.shadowTotal
    : 0n;

  if (counters.shadowTotal === 0n) {
    warnings.push('zero_traffic: graduation evaluated with no shadow traffic, divergence criterion is vacuously met');
  }

  // Clamp to zero to prevent negative window durations under clock skew
  const observationMs = Math.max(0, now - deployTimestamp);
  if (now < deployTimestamp) {
    warnings.push('clock_skew: now < deployTimestamp, observation window clamped to 0');
  }
  const observationMet = observationMs >= criteria.minObservationWindowMs;

  // Would-reject consecutive-clean window:
  // - If wouldRejectTotal === 0n, system has been clean since deploy
  // - If wouldRejectTotal > 0n, check elapsed time since last would-reject event.
  //   Graduation is allowed once the consecutive-clean window has elapsed
  //   since the last would-reject, regardless of the total count.
  // Zero-traffic rule: when shadowTotal === 0n, divergence is vacuously met
  // but time windows still must elapse regardless of traffic volume.
  const consecutiveCleanMs = counters.wouldRejectTotal === 0n
    ? observationMs // never incremented — clean since deploy
    : Math.max(0, now - lastWouldRejectTimestamp);
  const wouldRejectMet = consecutiveCleanMs >= criteria.wouldRejectConsecutiveWindowMs;

  return {
    context,
    ready: divergenceMet && observationMet && wouldRejectMet,
    criteria: {
      divergenceRate: { met: divergenceMet, currentPpm, thresholdPpm: criteria.maxDivergenceRatePpm },
      observationWindow: { met: observationMet, currentMs: observationMs, thresholdMs: criteria.minObservationWindowMs },
      wouldRejectClean: { met: wouldRejectMet, wouldRejectTotal: counters.wouldRejectTotal, consecutiveCleanMs, thresholdMs: criteria.wouldRejectConsecutiveWindowMs },
    },
    warnings,
    evaluatedAt: new Date(now).toISOString(),
  };
}

/**
 * Compute boundary_graduation_ready gauge value from a BoundaryMetricsRegistry.
 *
 * Returns 1 when graduation criteria are met, 0 otherwise.
 * Designed to be called on the same cadence as existing shadow metrics —
 * not a separate loop.
 *
 * Protected by existing metrics port (internal-only, not tenant-accessible).
 *
 * @param registry - The BoundaryMetricsRegistry singleton
 * @param context - Boundary context to evaluate
 * @param deployTimestamp - When shadow mode was deployed (ms since epoch)
 * @param criteria - Graduation criteria (defaults to DEFAULT_GRADUATION_CRITERIA)
 * @returns 0 or 1 for Prometheus gauge emission
 */
export function computeGraduationGauge(
  registry: BoundaryMetricsRegistry,
  context: BoundaryContext,
  deployTimestamp: number,
  criteria: BoundaryGraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
): { value: 0 | 1; status: GraduationStatus } {
  const counters = registry.getGraduationCounters(context);
  const lastWouldReject = registry.getLastWouldRejectTimestamp(context);
  const status = evaluateGraduation(context, counters, deployTimestamp, lastWouldReject, criteria);
  return {
    value: status.ready ? 1 : 0,
    status,
  };
}
