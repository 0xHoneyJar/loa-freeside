/**
 * Velocity Alert Service — Exhaustion Alerts (F-2)
 *
 * Evaluates velocity snapshots against exhaustion thresholds and emits
 * CloudWatch metrics + SNS alert payloads.
 *
 * Design:
 *   - Three-tier thresholds: warning (72h), critical (24h), emergency (4h) (AC-3.5.2)
 *   - Confidence gating: alerts only when confidence is 'high' by default (AC-3.5.3)
 *   - CloudWatch metrics: velocity_micro_per_hour, estimated_exhaustion_hours (AC-3.5.4)
 *   - SNS topic for alert routing (AC-3.5.1)
 *
 * @see SDD §4.5 Temporal Dimension
 * @see Sprint 3, Task 3.5
 * @module packages/services/velocity-alert-service
 */

import type { VelocitySnapshot } from './velocity-service.js';
import { emitEconomicMetric } from '../adapters/telemetry/economic-metrics.js';
import { isFeatureEnabled } from './feature-flags.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Alert severity levels matching AC-3.5.2 thresholds */
export type AlertSeverity = 'warning' | 'critical' | 'emergency';

/** Confidence levels that permit alert emission */
export type AlertConfidence = 'high' | 'medium' | 'low';

/** A velocity exhaustion alert */
export interface VelocityAlert {
  communityId: string;
  severity: AlertSeverity;
  estimatedExhaustionHours: bigint;
  velocityMicroPerHour: bigint;
  confidence: 'high' | 'medium' | 'low';
  timestamp: Date;
}

/** Result of evaluating a batch of snapshots for alerts */
export interface AlertEvaluationResult {
  evaluated: number;
  alertsEmitted: number;
  skippedLowConfidence: number;
  alerts: VelocityAlert[];
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** AC-3.5.2: Alert thresholds in hours */
const THRESHOLDS: { severity: AlertSeverity; hours: bigint }[] = [
  { severity: 'emergency', hours: 4n },
  { severity: 'critical', hours: 24n },
  { severity: 'warning', hours: 72n },
];

/** AC-3.5.3: Minimum confidence to emit alerts (default: high) */
const MIN_ALERT_CONFIDENCE: AlertConfidence = 'high';

// --------------------------------------------------------------------------
// Alert Evaluation
// --------------------------------------------------------------------------

/**
 * Evaluate a velocity snapshot for exhaustion alerts.
 *
 * AC-3.5.2: Checks warning (72h), critical (24h), emergency (4h).
 * AC-3.5.3: Only emits when confidence >= minimum threshold.
 * AC-3.5.4: Emits velocity and exhaustion CloudWatch metrics.
 *
 * @param snapshot - Velocity snapshot to evaluate
 * @param minConfidence - Minimum confidence to emit alerts (default: 'high')
 * @returns Alert if threshold breached, null otherwise
 */
export function evaluateSnapshot(
  snapshot: VelocitySnapshot,
  minConfidence: AlertConfidence = MIN_ALERT_CONFIDENCE,
): VelocityAlert | null {
  if (!isFeatureEnabled('FEATURE_VELOCITY_ALERTS')) {
    return null;
  }

  // Always emit velocity metrics regardless of alert state (AC-3.5.4)
  emitVelocityMetrics(snapshot);

  // No exhaustion predicted (velocity ≤ 0 or null)
  if (
    snapshot.estimatedExhaustionHours === null ||
    snapshot.estimatedExhaustionHours <= 0n
  ) {
    return null;
  }

  // Confidence gating (AC-3.5.3)
  if (!meetsConfidenceThreshold(snapshot.confidence, minConfidence)) {
    return null;
  }

  // Check thresholds from most severe to least (AC-3.5.2)
  for (const threshold of THRESHOLDS) {
    if (snapshot.estimatedExhaustionHours <= threshold.hours) {
      const alert: VelocityAlert = {
        communityId: snapshot.communityId,
        severity: threshold.severity,
        estimatedExhaustionHours: snapshot.estimatedExhaustionHours,
        velocityMicroPerHour: snapshot.velocityMicroPerHour,
        confidence: snapshot.confidence,
        timestamp: snapshot.computedAt,
      };
      emitAlertMetric(alert);
      return alert;
    }
  }

  return null;
}

/**
 * Evaluate a batch of snapshots for alerts.
 *
 * Called after runVelocityBatch completes to check all snapshots.
 *
 * @param snapshots - Array of velocity snapshots
 * @param minConfidence - Minimum confidence for alert emission
 * @returns Evaluation result with alerts
 */
export function evaluateBatch(
  snapshots: VelocitySnapshot[],
  minConfidence: AlertConfidence = MIN_ALERT_CONFIDENCE,
): AlertEvaluationResult {
  const result: AlertEvaluationResult = {
    evaluated: snapshots.length,
    alertsEmitted: 0,
    skippedLowConfidence: 0,
    alerts: [],
  };

  for (const snapshot of snapshots) {
    if (!isFeatureEnabled('FEATURE_VELOCITY_ALERTS')) {
      break;
    }

    // Emit metrics for all snapshots
    emitVelocityMetrics(snapshot);

    if (
      snapshot.estimatedExhaustionHours === null ||
      snapshot.estimatedExhaustionHours <= 0n
    ) {
      continue;
    }

    // Check confidence before threshold evaluation
    if (!meetsConfidenceThreshold(snapshot.confidence, minConfidence)) {
      result.skippedLowConfidence++;
      continue;
    }

    // Check thresholds
    for (const threshold of THRESHOLDS) {
      if (snapshot.estimatedExhaustionHours <= threshold.hours) {
        const alert: VelocityAlert = {
          communityId: snapshot.communityId,
          severity: threshold.severity,
          estimatedExhaustionHours: snapshot.estimatedExhaustionHours,
          velocityMicroPerHour: snapshot.velocityMicroPerHour,
          confidence: snapshot.confidence,
          timestamp: snapshot.computedAt,
        };
        result.alerts.push(alert);
        result.alertsEmitted++;

        // Emit alert metric for CloudWatch alarm trigger
        emitAlertMetric(alert);
        break; // Only emit the most severe alert per community
      }
    }
  }

  return result;
}

// --------------------------------------------------------------------------
// Metric Emission
// --------------------------------------------------------------------------

/**
 * Emit velocity CloudWatch metrics for a snapshot (AC-3.5.4).
 *
 * Metrics:
 *   - velocity_micro_per_hour: current spend velocity
 *   - estimated_exhaustion_hours: predicted hours until balance exhaustion
 */
function emitVelocityMetrics(snapshot: VelocitySnapshot): void {
  // velocity_micro_per_hour
  emitEconomicMetric({
    name: 'velocity_micro_per_hour',
    value: toSafeMetricNumber(snapshot.velocityMicroPerHour),
    unit: 'None',
    dimensions: {
      community_id: snapshot.communityId,
      confidence: snapshot.confidence,
    },
  });

  // estimated_exhaustion_hours (only if not null)
  if (snapshot.estimatedExhaustionHours !== null) {
    emitEconomicMetric({
      name: 'estimated_exhaustion_hours',
      value: toSafeMetricNumber(snapshot.estimatedExhaustionHours),
      unit: 'None',
      dimensions: {
        community_id: snapshot.communityId,
        confidence: snapshot.confidence,
      },
    });
  }
}

/**
 * Emit an alert metric when a threshold is breached.
 * This metric drives the CloudWatch alarms defined in Terraform.
 */
function emitAlertMetric(alert: VelocityAlert): void {
  emitEconomicMetric({
    name: 'velocity_exhaustion_alert',
    value: 1,
    unit: 'Count',
    dimensions: {
      community_id: alert.communityId,
      severity: alert.severity,
    },
  });
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const CONFIDENCE_ORDER: Record<AlertConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Check if a confidence level meets the minimum threshold.
 */
function meetsConfidenceThreshold(
  actual: 'high' | 'medium' | 'low',
  minimum: AlertConfidence,
): boolean {
  return CONFIDENCE_ORDER[actual] >= CONFIDENCE_ORDER[minimum];
}

/**
 * Convert BigInt to safe Number for metric emission.
 * Caps at MAX_SAFE_INTEGER to prevent precision loss.
 */
function toSafeMetricNumber(value: bigint): number {
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > MAX_SAFE) return Number.MAX_SAFE_INTEGER;
  if (value < -MAX_SAFE) return -Number.MAX_SAFE_INTEGER;
  return Number(value);
}
