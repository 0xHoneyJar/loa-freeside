/**
 * BillingMetrics — Phase 1A Observability Baseline
 *
 * Structured metric emission for all Creator Economy subsystems.
 * Emits counters and histograms via structured logging (CloudWatch Insights compatible).
 *
 * Designed for integration with existing pino logger infrastructure.
 * Production deployment can wire these to CloudWatch EMF or Prometheus.
 *
 * SDD refs: §4.8 Observability
 * Sprint refs: Task 7.5
 *
 * @module packages/adapters/billing/BillingMetrics
 */

import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface MetricEvent {
  metric: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
}

// =============================================================================
// BillingMetrics
// =============================================================================

export class BillingMetrics {
  private events: MetricEvent[] = [];

  /** Emit a counter metric */
  counter(metric: string, value: number = 1, tags?: Record<string, string>): void {
    const event: MetricEvent = { metric, value, unit: 'count', tags };
    this.events.push(event);
    logger.info({
      event: 'metric.counter',
      metric,
      value,
      ...tags,
    }, `${metric}: ${value}`);
  }

  /** Emit a histogram metric */
  histogram(metric: string, value: number, unit: string = 'none', tags?: Record<string, string>): void {
    const event: MetricEvent = { metric, value, unit, tags };
    this.events.push(event);
    logger.info({
      event: 'metric.histogram',
      metric,
      value,
      unit,
      ...tags,
    }, `${metric}: ${value} ${unit}`);
  }

  // ---------------------------------------------------------------------------
  // Referral Metrics
  // ---------------------------------------------------------------------------

  emitRegistration(outcome: 'accepted' | 'rejected'): void {
    this.counter('referral.registrations.total');
    if (outcome === 'rejected') {
      this.counter('referral.registrations.rejected');
    }
  }

  // ---------------------------------------------------------------------------
  // Bonus Metrics
  // ---------------------------------------------------------------------------

  emitBonusOutcome(verdict: 'granted' | 'flagged' | 'withheld'): void {
    this.counter(`referral.bonuses.${verdict}`);
  }

  // ---------------------------------------------------------------------------
  // Revenue Distribution Metrics
  // ---------------------------------------------------------------------------

  emitDistribution(totalMicro: bigint): void {
    this.counter('revenue.distribution.count');
    this.counter('revenue.distribution.total_micro', Number(totalMicro));
  }

  // ---------------------------------------------------------------------------
  // Settlement Metrics
  // ---------------------------------------------------------------------------

  emitSettlement(count: number): void {
    this.counter('settlement.settled.count', count);
  }

  emitClawback(): void {
    this.counter('settlement.clawback.count');
  }

  // ---------------------------------------------------------------------------
  // Fraud Metrics
  // ---------------------------------------------------------------------------

  emitFraudScore(score: number): void {
    this.histogram('fraud.score.histogram', score, 'ratio');
  }

  // ---------------------------------------------------------------------------
  // Database Metrics
  // ---------------------------------------------------------------------------

  emitWriteLatency(durationMs: number): void {
    this.histogram('sqlite.write_latency_ms', durationMs, 'ms');
  }

  // ---------------------------------------------------------------------------
  // Alert Metrics
  // ---------------------------------------------------------------------------

  emitTreasuryViolation(): void {
    this.counter('alert.treasury_invariant_violation');
  }

  emitConservationFailure(): void {
    this.counter('alert.conservation_assert_failure');
  }

  emitSqliteBusyTimeout(): void {
    this.counter('alert.sqlite_busy_timeout');
  }

  // ---------------------------------------------------------------------------
  // Test Helpers
  // ---------------------------------------------------------------------------

  /** Get all emitted events (for testing) */
  getEvents(): MetricEvent[] {
    return [...this.events];
  }

  /** Get events matching a metric name pattern */
  getEventsByMetric(pattern: string): MetricEvent[] {
    return this.events.filter(e => e.metric.includes(pattern));
  }

  /** Clear recorded events */
  reset(): void {
    this.events = [];
  }
}
