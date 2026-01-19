/**
 * Optimistic Lock Metrics
 *
 * Sprint 122: Optimistic Locking
 *
 * Metrics for tracking version conflicts and optimistic lock operations.
 * Alert: Warning if conflict rate > 0.1/sec for 10 minutes.
 *
 * @see grimoires/loa/sprint.md Sprint 122 Tasks 122.5, 122.6
 */

// =============================================================================
// Metrics Storage
// =============================================================================

interface OptimisticLockMetrics {
  /** Total version conflicts */
  versionConflicts: number;
  /** Total version checks performed */
  versionChecks: number;
  /** Conflict timestamps for rate calculation */
  conflictTimestamps: number[];
  /** Conflicts by server (for detection of hot servers) */
  conflictsByServer: Map<string, number>;
}

const metrics: OptimisticLockMetrics = {
  versionConflicts: 0,
  versionChecks: 0,
  conflictTimestamps: [],
  conflictsByServer: new Map(),
};

// Rate calculation window (10 minutes)
const RATE_WINDOW_MS = 10 * 60 * 1000;

// =============================================================================
// Recording Functions
// =============================================================================

/**
 * Record a version conflict.
 *
 * Alert: Warning if > 0.1 conflicts/sec for 10 minutes
 *
 * @param serverId - Optional server ID for tracking hot servers
 */
export function recordVersionConflict(serverId?: string): void {
  metrics.versionConflicts++;
  metrics.conflictTimestamps.push(Date.now());

  if (serverId) {
    const current = metrics.conflictsByServer.get(serverId) ?? 0;
    metrics.conflictsByServer.set(serverId, current + 1);
  }

  // Clean up old timestamps
  const cutoff = Date.now() - RATE_WINDOW_MS;
  metrics.conflictTimestamps = metrics.conflictTimestamps.filter((ts) => ts > cutoff);
}

/**
 * Record a version check (successful or not).
 */
export function recordVersionCheck(): void {
  metrics.versionChecks++;
}

/**
 * Calculate current conflict rate (conflicts per second in the last 10 minutes).
 */
export function getConflictRate(): number {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  const recentConflicts = metrics.conflictTimestamps.filter((ts) => ts > cutoff);
  return recentConflicts.length / (RATE_WINDOW_MS / 1000);
}

/**
 * Check if conflict rate exceeds threshold.
 *
 * @param threshold - Conflicts per second (default: 0.1)
 * @returns True if rate exceeds threshold
 */
export function isHighConflictRate(threshold: number = 0.1): boolean {
  return getConflictRate() > threshold;
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get optimistic lock metrics in Prometheus text format.
 */
export function getOptimisticLockMetricsPrometheus(): string {
  const lines: string[] = [];

  // Version conflicts counter
  // ALERT: Warning if rate > 0.1/sec for 10 minutes
  lines.push('# HELP sietch_config_version_conflicts_total Total version conflicts (concurrent edit collisions)');
  lines.push('# TYPE sietch_config_version_conflicts_total counter');
  lines.push(`sietch_config_version_conflicts_total ${metrics.versionConflicts}`);

  // Version checks counter
  lines.push('# HELP sietch_config_version_checks_total Total version checks performed');
  lines.push('# TYPE sietch_config_version_checks_total counter');
  lines.push(`sietch_config_version_checks_total ${metrics.versionChecks}`);

  // Current conflict rate gauge
  const conflictRate = getConflictRate();
  lines.push('# HELP sietch_config_conflict_rate_per_second Current version conflict rate (conflicts/sec over 10m window)');
  lines.push('# TYPE sietch_config_conflict_rate_per_second gauge');
  lines.push(`sietch_config_conflict_rate_per_second ${conflictRate.toFixed(6)}`);

  // High rate indicator
  const isHigh = isHighConflictRate() ? 1 : 0;
  lines.push('# HELP sietch_config_high_conflict_rate Whether conflict rate exceeds threshold (0=ok, 1=high)');
  lines.push('# TYPE sietch_config_high_conflict_rate gauge');
  lines.push(`sietch_config_high_conflict_rate ${isHigh}`);

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getOptimisticLockMetricsRaw(): OptimisticLockMetrics {
  return {
    ...metrics,
    conflictTimestamps: [...metrics.conflictTimestamps],
    conflictsByServer: new Map(metrics.conflictsByServer),
  };
}

/**
 * Reset all metrics (for testing).
 */
export function resetOptimisticLockMetrics(): void {
  metrics.versionConflicts = 0;
  metrics.versionChecks = 0;
  metrics.conflictTimestamps = [];
  metrics.conflictsByServer.clear();
}

/**
 * Get conflict count for a specific server.
 */
export function getServerConflictCount(serverId: string): number {
  return metrics.conflictsByServer.get(serverId) ?? 0;
}
