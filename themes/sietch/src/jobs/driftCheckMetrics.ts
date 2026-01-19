/**
 * Drift Check Job Metrics
 *
 * Sprint 124: Drift API & Scheduled Check
 *
 * Metrics for tracking drift check job executions and errors.
 *
 * @see grimoires/loa/sprint.md Sprint 124 Task 124.5
 */

// =============================================================================
// Metrics Storage
// =============================================================================

interface DriftJobMetrics {
  /** Total job runs */
  jobRuns: number;
  /** Total job errors */
  jobErrors: number;
  /** Last run timestamp */
  lastRunAt: number | null;
  /** Last run duration in ms */
  lastRunDurationMs: number | null;
}

const metrics: DriftJobMetrics = {
  jobRuns: 0,
  jobErrors: 0,
  lastRunAt: null,
  lastRunDurationMs: null,
};

// =============================================================================
// Recording Functions
// =============================================================================

/**
 * Record a drift job run.
 */
export function recordDriftJobRun(): void {
  metrics.jobRuns++;
  metrics.lastRunAt = Date.now();
}

/**
 * Record drift job completion with duration.
 */
export function recordDriftJobDuration(durationMs: number): void {
  metrics.lastRunDurationMs = durationMs;
}

/**
 * Record a drift job error.
 */
export function recordDriftJobError(): void {
  metrics.jobErrors++;
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get drift job metrics in Prometheus text format.
 */
export function getDriftJobMetricsPrometheus(): string {
  const lines: string[] = [];

  // Job runs counter
  lines.push('# HELP sietch_drift_job_runs_total Total drift check job runs');
  lines.push('# TYPE sietch_drift_job_runs_total counter');
  lines.push(`sietch_drift_job_runs_total ${metrics.jobRuns}`);

  // Job errors counter
  lines.push('# HELP sietch_drift_job_errors_total Total drift check job errors');
  lines.push('# TYPE sietch_drift_job_errors_total counter');
  lines.push(`sietch_drift_job_errors_total ${metrics.jobErrors}`);

  // Last run timestamp gauge
  lines.push('# HELP sietch_drift_job_last_run_timestamp Last drift job run timestamp (unix epoch seconds)');
  lines.push('# TYPE sietch_drift_job_last_run_timestamp gauge');
  lines.push(`sietch_drift_job_last_run_timestamp ${metrics.lastRunAt ? Math.floor(metrics.lastRunAt / 1000) : 0}`);

  // Last run duration gauge
  lines.push('# HELP sietch_drift_job_last_run_duration_seconds Last drift job run duration');
  lines.push('# TYPE sietch_drift_job_last_run_duration_seconds gauge');
  lines.push(`sietch_drift_job_last_run_duration_seconds ${metrics.lastRunDurationMs ? metrics.lastRunDurationMs / 1000 : 0}`);

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getDriftJobMetricsRaw(): DriftJobMetrics {
  return { ...metrics };
}

/**
 * Reset all metrics (for testing).
 */
export function resetDriftJobMetrics(): void {
  metrics.jobRuns = 0;
  metrics.jobErrors = 0;
  metrics.lastRunAt = null;
  metrics.lastRunDurationMs = null;
}
