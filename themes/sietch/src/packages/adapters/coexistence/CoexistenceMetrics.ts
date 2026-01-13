/**
 * Coexistence Metrics - Prometheus Metrics for Coexistence System
 *
 * Sprint 65: Full Social Layer & Polish
 *
 * Provides metrics for monitoring coexistence mode operation:
 * - Mode transitions and current state
 * - Shadow ledger divergences
 * - Migration progress
 * - Health monitoring status
 * - Social layer unlocks
 *
 * @module packages/adapters/coexistence/CoexistenceMetrics
 */

import type { CoexistenceMode } from '../storage/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Coexistence metrics state
 */
interface CoexistenceMetricsState {
  // Mode metrics (per community)
  communitiesByMode: Map<CoexistenceMode, number>;

  // Shadow ledger metrics
  totalDivergences: number;
  unresolvedDivergences: number;
  divergencesByType: Map<string, number>;

  // Migration metrics
  migrationsInProgress: number;
  migrationsCompleted: number;
  rollbacksTriggered: number;
  takeoverCompleted: number;

  // Health monitoring metrics
  healthChecksTotal: number;
  healthChecksPassed: number;
  healthChecksFailed: number;
  alertsSent: number;
  emergencyBackupsActivated: number;

  // Social layer metrics
  socialLayerUnlocks: number;
  featuresUnlocked: Map<string, number>;

  // Discount metrics
  discountsGenerated: number;
  discountsRedeemed: number;
  discountsExpired: number;
}

// =============================================================================
// Metrics State
// =============================================================================

const metricsState: CoexistenceMetricsState = {
  communitiesByMode: new Map([
    ['shadow', 0],
    ['parallel', 0],
    ['primary', 0],
    ['exclusive', 0],
  ]),
  totalDivergences: 0,
  unresolvedDivergences: 0,
  divergencesByType: new Map([
    ['false_positive', 0],
    ['false_negative', 0],
    ['timing_difference', 0],
    ['threshold_mismatch', 0],
  ]),
  migrationsInProgress: 0,
  migrationsCompleted: 0,
  rollbacksTriggered: 0,
  takeoverCompleted: 0,
  healthChecksTotal: 0,
  healthChecksPassed: 0,
  healthChecksFailed: 0,
  alertsSent: 0,
  emergencyBackupsActivated: 0,
  socialLayerUnlocks: 0,
  featuresUnlocked: new Map(),
  discountsGenerated: 0,
  discountsRedeemed: 0,
  discountsExpired: 0,
};

// =============================================================================
// Metric Recording Functions
// =============================================================================

/**
 * Record a mode transition
 */
export function recordModeTransition(
  previousMode: CoexistenceMode | undefined,
  newMode: CoexistenceMode
): void {
  if (previousMode) {
    metricsState.communitiesByMode.set(
      previousMode,
      Math.max(0, (metricsState.communitiesByMode.get(previousMode) ?? 0) - 1)
    );
  }
  metricsState.communitiesByMode.set(
    newMode,
    (metricsState.communitiesByMode.get(newMode) ?? 0) + 1
  );
}

/**
 * Record a divergence
 */
export function recordDivergence(
  type: 'false_positive' | 'false_negative' | 'timing_difference' | 'threshold_mismatch',
  resolved: boolean = false
): void {
  metricsState.totalDivergences++;
  if (!resolved) {
    metricsState.unresolvedDivergences++;
  }
  metricsState.divergencesByType.set(
    type,
    (metricsState.divergencesByType.get(type) ?? 0) + 1
  );
}

/**
 * Record divergence resolution
 */
export function recordDivergenceResolved(): void {
  metricsState.unresolvedDivergences = Math.max(0, metricsState.unresolvedDivergences - 1);
}

/**
 * Record migration start
 */
export function recordMigrationStart(): void {
  metricsState.migrationsInProgress++;
}

/**
 * Record migration completion
 */
export function recordMigrationComplete(): void {
  metricsState.migrationsInProgress = Math.max(0, metricsState.migrationsInProgress - 1);
  metricsState.migrationsCompleted++;
}

/**
 * Record rollback
 */
export function recordRollback(): void {
  metricsState.migrationsInProgress = Math.max(0, metricsState.migrationsInProgress - 1);
  metricsState.rollbacksTriggered++;
}

/**
 * Record takeover completion
 */
export function recordTakeoverComplete(): void {
  metricsState.takeoverCompleted++;
}

/**
 * Record health check result
 */
export function recordHealthCheck(passed: boolean): void {
  metricsState.healthChecksTotal++;
  if (passed) {
    metricsState.healthChecksPassed++;
  } else {
    metricsState.healthChecksFailed++;
  }
}

/**
 * Record alert sent
 */
export function recordAlertSent(): void {
  metricsState.alertsSent++;
}

/**
 * Record emergency backup activation
 */
export function recordEmergencyBackup(): void {
  metricsState.emergencyBackupsActivated++;
}

/**
 * Record social layer unlock
 */
export function recordSocialLayerUnlock(): void {
  metricsState.socialLayerUnlocks++;
}

/**
 * Record feature unlock
 */
export function recordFeatureUnlock(featureId: string): void {
  metricsState.featuresUnlocked.set(
    featureId,
    (metricsState.featuresUnlocked.get(featureId) ?? 0) + 1
  );
}

/**
 * Record discount generated
 */
export function recordDiscountGenerated(): void {
  metricsState.discountsGenerated++;
}

/**
 * Record discount redeemed
 */
export function recordDiscountRedeemed(): void {
  metricsState.discountsRedeemed++;
}

/**
 * Record discount expired
 */
export function recordDiscountExpired(): void {
  metricsState.discountsExpired++;
}

/**
 * Set community count for a mode (for bulk updates from database)
 */
export function setCommunitiesInMode(mode: CoexistenceMode, count: number): void {
  metricsState.communitiesByMode.set(mode, count);
}

/**
 * Set divergence counts (for bulk updates from database)
 */
export function setDivergenceCounts(total: number, unresolved: number): void {
  metricsState.totalDivergences = total;
  metricsState.unresolvedDivergences = unresolved;
}

// =============================================================================
// Prometheus Export
// =============================================================================

/**
 * Generate Prometheus-format metrics for coexistence system
 */
export function getCoexistenceMetrics(): string {
  const lines: string[] = [];

  // Helper to add a metric
  const addMetric = (
    name: string,
    type: 'counter' | 'gauge',
    help: string,
    value: number,
    labels?: Record<string, string>
  ) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);

    if (labels && Object.keys(labels).length > 0) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}{${labelStr}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  };

  // Mode distribution metrics
  lines.push('# HELP sietch_coexistence_communities_by_mode Number of communities in each coexistence mode');
  lines.push('# TYPE sietch_coexistence_communities_by_mode gauge');
  for (const [mode, count] of metricsState.communitiesByMode) {
    lines.push(`sietch_coexistence_communities_by_mode{mode="${mode}"} ${count}`);
  }

  // Divergence metrics
  addMetric(
    'sietch_coexistence_divergences_total',
    'counter',
    'Total shadow ledger divergences detected',
    metricsState.totalDivergences
  );

  addMetric(
    'sietch_coexistence_divergences_unresolved',
    'gauge',
    'Number of unresolved divergences',
    metricsState.unresolvedDivergences
  );

  lines.push('# HELP sietch_coexistence_divergences_by_type Divergences by type');
  lines.push('# TYPE sietch_coexistence_divergences_by_type counter');
  for (const [type, count] of metricsState.divergencesByType) {
    lines.push(`sietch_coexistence_divergences_by_type{type="${type}"} ${count}`);
  }

  // Migration metrics
  addMetric(
    'sietch_coexistence_migrations_in_progress',
    'gauge',
    'Number of migrations currently in progress',
    metricsState.migrationsInProgress
  );

  addMetric(
    'sietch_coexistence_migrations_completed_total',
    'counter',
    'Total migrations completed successfully',
    metricsState.migrationsCompleted
  );

  addMetric(
    'sietch_coexistence_rollbacks_total',
    'counter',
    'Total rollbacks triggered',
    metricsState.rollbacksTriggered
  );

  addMetric(
    'sietch_coexistence_takeovers_completed_total',
    'counter',
    'Total takeovers completed',
    metricsState.takeoverCompleted
  );

  // Health monitoring metrics
  addMetric(
    'sietch_coexistence_health_checks_total',
    'counter',
    'Total health checks performed',
    metricsState.healthChecksTotal
  );

  addMetric(
    'sietch_coexistence_health_checks_passed_total',
    'counter',
    'Total health checks passed',
    metricsState.healthChecksPassed
  );

  addMetric(
    'sietch_coexistence_health_checks_failed_total',
    'counter',
    'Total health checks failed',
    metricsState.healthChecksFailed
  );

  addMetric(
    'sietch_coexistence_alerts_sent_total',
    'counter',
    'Total alerts sent to admins',
    metricsState.alertsSent
  );

  addMetric(
    'sietch_coexistence_emergency_backups_total',
    'counter',
    'Total emergency backups activated',
    metricsState.emergencyBackupsActivated
  );

  // Social layer metrics
  addMetric(
    'sietch_coexistence_social_layer_unlocks_total',
    'counter',
    'Total social layer unlocks',
    metricsState.socialLayerUnlocks
  );

  if (metricsState.featuresUnlocked.size > 0) {
    lines.push('# HELP sietch_coexistence_features_unlocked_total Features unlocked by ID');
    lines.push('# TYPE sietch_coexistence_features_unlocked_total counter');
    for (const [featureId, count] of metricsState.featuresUnlocked) {
      lines.push(`sietch_coexistence_features_unlocked_total{feature="${featureId}"} ${count}`);
    }
  }

  // Discount metrics
  addMetric(
    'sietch_coexistence_discounts_generated_total',
    'counter',
    'Total takeover discounts generated',
    metricsState.discountsGenerated
  );

  addMetric(
    'sietch_coexistence_discounts_redeemed_total',
    'counter',
    'Total takeover discounts redeemed',
    metricsState.discountsRedeemed
  );

  addMetric(
    'sietch_coexistence_discounts_expired_total',
    'counter',
    'Total takeover discounts expired',
    metricsState.discountsExpired
  );

  return lines.join('\n') + '\n';
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics(): void {
  metricsState.communitiesByMode = new Map([
    ['shadow', 0],
    ['parallel', 0],
    ['primary', 0],
    ['exclusive', 0],
  ]);
  metricsState.totalDivergences = 0;
  metricsState.unresolvedDivergences = 0;
  metricsState.divergencesByType = new Map([
    ['false_positive', 0],
    ['false_negative', 0],
    ['timing_difference', 0],
    ['threshold_mismatch', 0],
  ]);
  metricsState.migrationsInProgress = 0;
  metricsState.migrationsCompleted = 0;
  metricsState.rollbacksTriggered = 0;
  metricsState.takeoverCompleted = 0;
  metricsState.healthChecksTotal = 0;
  metricsState.healthChecksPassed = 0;
  metricsState.healthChecksFailed = 0;
  metricsState.alertsSent = 0;
  metricsState.emergencyBackupsActivated = 0;
  metricsState.socialLayerUnlocks = 0;
  metricsState.featuresUnlocked = new Map();
  metricsState.discountsGenerated = 0;
  metricsState.discountsRedeemed = 0;
  metricsState.discountsExpired = 0;
}

/**
 * Get current metrics state (for testing)
 */
export function getMetricsState(): CoexistenceMetricsState {
  return { ...metricsState };
}
