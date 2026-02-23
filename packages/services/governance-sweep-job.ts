/**
 * Governance Sweep Job — Scheduled Policy Lifecycle Maintenance
 *
 * EventBridge-triggered (5min interval) job that delegates to
 * governanceService.sweepExpiredAndPending() for:
 *   - Expiring policies past effective_until
 *   - Promoting pending_enforcement → active when usage drops
 *
 * @see SDD §5.4 Governance Sweep
 * @see Sprint 5, Task 5.6 (AC-5.6.1 through AC-5.6.4)
 * @module packages/services/governance-sweep-job
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Governance service port (subset needed by sweep) */
export interface GovernanceServicePort {
  sweepExpiredAndPending(): Promise<{ expired: number; promoted: number }>;
}

/** Logger interface */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Metrics port */
export interface MetricsPort {
  putMetric(name: string, value: number, unit?: string): void;
}

/** Sweep job dependencies */
export interface GovernanceSweepDeps {
  governanceService: GovernanceServicePort;
  logger: Logger;
  metrics: MetricsPort;
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createGovernanceSweepJob(deps: GovernanceSweepDeps) {
  const { governanceService, logger, metrics } = deps;

  /**
   * Execute one sweep cycle.
   * Called by EventBridge on 5-minute schedule.
   *
   * AC-5.6.1: Expired policies transitioned
   * AC-5.6.2: Pending enforcement promoted when usage allows
   * AC-5.6.3: withCommunityScope enforced (by governance service internals)
   * AC-5.6.4: CloudWatch metrics emitted
   */
  async function execute(): Promise<void> {
    const startTime = Date.now();

    try {
      const result = await governanceService.sweepExpiredAndPending();

      const durationMs = Date.now() - startTime;

      // AC-5.6.4: Emit governance_sweep_count metric
      metrics.putMetric('governance_sweep_count', result.expired + result.promoted);
      metrics.putMetric('governance_sweep_expired', result.expired);
      metrics.putMetric('governance_sweep_promoted', result.promoted);
      metrics.putMetric('governance_sweep_duration_ms', durationMs, 'Milliseconds');

      logger.info('Governance sweep completed', {
        expired: result.expired,
        promoted: result.promoted,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      metrics.putMetric('governance_sweep_errors', 1);

      logger.error('Governance sweep failed', {
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });

      throw err;
    }
  }

  return { execute };
}
