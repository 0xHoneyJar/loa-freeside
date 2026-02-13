/**
 * Agent Gateway EMF Metrics
 * Sprint 4, Task 4.1: CloudWatch Embedded Metric Format integration
 *
 * Emits structured metrics via EMF for CloudWatch Metrics without a custom agent.
 * All metrics use the namespace `Arrakis/AgentGateway` with a `feature` dimension
 * to distinguish baseline, ensemble, and BYOK traffic.
 *
 * @see SDD §3.5.1 Metric Definitions
 */

import { createMetricsLogger, Unit, StorageResolution } from 'aws-embedded-metrics';
import type { MetricsLogger } from 'aws-embedded-metrics';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type FeatureType = 'baseline' | 'ensemble' | 'byok';
export type AccountingMode = 'standard' | 'byok';

export interface RequestMetrics {
  /** Request latency in milliseconds */
  latencyMs: number;
  /** Feature type: baseline, ensemble, or byok */
  feature: FeatureType;
  /** HTTP status code of the response */
  statusCode: number;
  /** Community ID (for per-community breakdowns) */
  communityId: string;
  /** Pool ID used for the request */
  poolId: string;
  /** Whether this was a streaming request */
  isStream: boolean;
}

export interface BudgetMetrics {
  /** Committed minus reported delta (micro-USD) */
  committedReportedDelta: number;
  /** Accounting mode: standard or byok */
  accountingMode: AccountingMode;
  /** Community ID */
  communityId: string;
}

export interface CircuitBreakerMetrics {
  /** Circuit breaker state: 0=closed, 1=half-open, 2=open */
  state: number;
  /** Component name (e.g., 'loa-finn', 'redis', 'byok-kms') */
  component: string;
}

export interface PoolClaimMetrics {
  /** Pool ID */
  poolId: string;
  /** Whether it was a mismatch (warn mode) or reject (reject mode) */
  type: 'mismatch' | 'reject';
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const NAMESPACE = 'Arrakis/AgentGateway';

// --------------------------------------------------------------------------
// Agent Metrics Emitter
// --------------------------------------------------------------------------

export class AgentMetrics {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'agent-metrics' });
  }

  /**
   * Emit request completion metrics (AC-5.4, AC-5.7).
   * Called after invoke() or stream() completes.
   */
  async emitRequestComplete(metrics: RequestMetrics): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ feature: metrics.feature });

      m.putMetric('RequestLatency', metrics.latencyMs, Unit.Milliseconds, StorageResolution.Standard);
      m.putMetric('RequestCount', 1, Unit.Count);

      if (metrics.statusCode >= 500) {
        m.putMetric('Error5xxCount', 1, Unit.Count);
      }
      if (metrics.statusCode === 429) {
        m.putMetric('RateLimitCount', 1, Unit.Count);
      }

      m.setProperty('communityId', metrics.communityId);
      m.setProperty('poolId', metrics.poolId);
      m.setProperty('isStream', metrics.isStream);
      m.setProperty('statusCode', metrics.statusCode);

      await m.flush();

      // Structured log event for Log Metric Filters
      this.logger.info({
        event: 'agent_request_complete',
        feature: metrics.feature,
        latencyMs: metrics.latencyMs,
        statusCode: metrics.statusCode,
        communityId: metrics.communityId,
        poolId: metrics.poolId,
        isStream: metrics.isStream,
      }, 'agent_request_complete');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit request metrics');
    }
  }

  /**
   * Emit rate limit hit event (AC-5.4).
   */
  async emitRateLimitHit(dimension: string, communityId: string): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ dimension });
      m.putMetric('RateLimitHit', 1, Unit.Count);
      m.setProperty('communityId', communityId);
      await m.flush();

      this.logger.info({
        event: 'rate_limit_hit',
        dimension,
        communityId,
      }, 'rate_limit_hit');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit rate limit metric');
    }
  }

  /**
   * Emit budget finalization metrics (AC-5.4, AC-5.9).
   */
  async emitBudgetFinalize(metrics: BudgetMetrics): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ accounting_mode: metrics.accountingMode });

      m.putMetric('CommittedReportedDelta', metrics.committedReportedDelta, Unit.Count);
      m.setProperty('communityId', metrics.communityId);
      await m.flush();

      this.logger.info({
        event: 'budget_finalize',
        accountingMode: metrics.accountingMode,
        committedReportedDelta: metrics.committedReportedDelta,
        communityId: metrics.communityId,
      }, 'budget_finalize');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit budget metric');
    }
  }

  /**
   * Emit finalize failure event.
   */
  async emitFinalizeFailure(communityId: string, reason: string): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.putMetric('FinalizeFailure', 1, Unit.Count);
      m.setProperty('communityId', communityId);
      m.setProperty('reason', reason);
      await m.flush();

      this.logger.error({
        event: 'finalize_failure',
        communityId,
        reason,
      }, 'finalize_failure');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit finalize failure metric');
    }
  }

  /**
   * Emit circuit breaker state change (AC-5.4).
   */
  async emitCircuitBreakerState(metrics: CircuitBreakerMetrics): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ component: metrics.component });
      m.putMetric('CircuitBreakerState', metrics.state, Unit.None);
      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit circuit breaker metric');
    }
  }

  /**
   * Emit Redis latency metric (AC-5.4).
   */
  async emitRedisLatency(latencyMs: number, operation: string): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ operation });
      m.putMetric('RedisLatency', latencyMs, Unit.Milliseconds);
      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit Redis latency metric');
    }
  }

  /**
   * Emit reservation age metric (from reaper) (AC-5.4).
   */
  async emitReservationAge(ageMs: number): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.putMetric('ReservationAge', ageMs, Unit.Milliseconds);
      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit reservation age metric');
    }
  }

  /**
   * Emit pool claim enforcement metrics (AC-5.8).
   */
  async emitPoolClaimEvent(metrics: PoolClaimMetrics): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ pool_id: metrics.poolId });

      if (metrics.type === 'mismatch') {
        m.putMetric('PoolClaimMismatch', 1, Unit.Count);
      } else {
        m.putMetric('PoolClaimReject', 1, Unit.Count);
      }

      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit pool claim metric');
    }
  }

  /**
   * Emit per-model cost metric for ensemble accounting (cycle-019, BB6 Finding #6).
   * Dimensions: model_id, provider, accounting_mode
   */
  async emitPerModelCost(metrics: {
    modelId: string;
    provider: string;
    accountingMode: string;
    costMicro: number;
  }): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({
        model_id: metrics.modelId,
        provider: metrics.provider,
        accounting_mode: metrics.accountingMode,
      });
      m.putMetric('PerModelCost', metrics.costMicro, Unit.Count, StorageResolution.Standard);
      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit per-model cost metric');
    }
  }

  /**
   * Emit ensemble savings metric (cycle-019, BB6 Finding #6).
   * savings_micro = reserved - total (unused reservation capacity)
   */
  async emitEnsembleSavings(metrics: {
    strategy: string;
    savingsMicro: number;
  }): Promise<void> {
    try {
      const m = this.createLogger();
      m.setNamespace(NAMESPACE);
      m.setDimensions({ strategy: metrics.strategy });
      m.putMetric('EnsembleSavings', metrics.savingsMicro, Unit.Count, StorageResolution.Standard);
      await m.flush();
    } catch (err) {
      this.logger.warn({ err }, 'Failed to emit ensemble savings metric');
    }
  }

  /** @internal Visible for testing */
  createLogger(): MetricsLogger {
    return createMetricsLogger();
  }
}
