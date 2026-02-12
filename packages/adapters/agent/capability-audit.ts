/**
 * Capability Audit Log — Structured Event Emitter
 * Cycle 019 Sprint 4, Task 4.2
 *
 * Emits structured audit events for every capability exercise:
 * pool_access, byok_usage, ensemble_invocation, model_access.
 *
 * Events are emitted via structured log (CloudWatch Log Metric Filters
 * can aggregate). No PII or message content is included (AC-4.12).
 *
 * @see SDD §4.1 Agent Gateway Facade
 * @see Bridgebuilder Round 6, Sprint 4 — Observability
 */

import type { Logger } from 'pino';
import type { ModelInvocationResult } from './ensemble-accounting.js';
import type { LifecycleEvent } from './request-lifecycle.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type CapabilityEventType =
  | 'pool_access'
  | 'byok_usage'
  | 'ensemble_invocation'
  | 'model_access';

export interface CapabilityAuditEvent {
  event_type: CapabilityEventType;
  timestamp: string;
  trace_id: string;
  community_id: string;
  user_id: string;
  pool_id: string;
  access_level: string;
  // Ensemble-specific
  ensemble_strategy?: string;
  ensemble_n?: number;
  // BYOK-specific
  byok_provider?: string;
  // Per-model breakdown (ensemble only)
  model_breakdown?: ModelInvocationResult[];
  // Budget info
  budget_reserved_micro?: number;
  budget_committed_micro?: number;
  // Lifecycle trace for debugging
  lifecycle_trace?: readonly LifecycleEvent[];
}

// --------------------------------------------------------------------------
// CapabilityAuditLogger
// --------------------------------------------------------------------------

export class CapabilityAuditLogger {
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.child({ component: 'capability_audit' });
  }

  /**
   * Validate required fields before emission (BB7 R7-3).
   * CloudWatch Log Metric Filters silently drop events with missing fields.
   * Guard warns + skips rather than throwing — audit must never crash requests.
   */
  private validateRequiredFields(event: CapabilityAuditEvent): boolean {
    const required: Array<[string, unknown]> = [
      ['trace_id', event.trace_id],
      ['community_id', event.community_id],
      ['event_type', event.event_type],
      ['pool_id', event.pool_id],
    ];

    for (const [field, value] of required) {
      if (typeof value !== 'string' || value.length === 0) {
        this.log.warn(
          { field, event_type: event.event_type || 'unknown' },
          'audit_event_validation_failure',
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Emit a capability audit event (AC-4.8).
   * All events are structured JSON for CloudWatch Log Metric Filters.
   * No PII or message content is ever included (AC-4.12).
   * Required fields validated before emission (BB7 R7-3, AC-1.8).
   */
  emit(event: CapabilityAuditEvent): void {
    if (!this.validateRequiredFields(event)) {
      return;
    }

    this.log.info(
      {
        audit: {
          event_type: event.event_type,
          trace_id: event.trace_id,
          community_id: event.community_id,
          user_id: event.user_id,
          pool_id: event.pool_id,
          access_level: event.access_level,
          // Conditional fields
          ...(event.ensemble_strategy != null && {
            ensemble_strategy: event.ensemble_strategy,
            ensemble_n: event.ensemble_n,
          }),
          ...(event.byok_provider != null && {
            byok_provider: event.byok_provider,
          }),
          ...(event.model_breakdown != null && {
            model_breakdown: event.model_breakdown,
          }),
          ...(event.budget_reserved_micro != null && {
            budget_reserved_micro: event.budget_reserved_micro,
            budget_committed_micro: event.budget_committed_micro,
          }),
          ...(event.lifecycle_trace != null && {
            lifecycle_trace: event.lifecycle_trace,
          }),
        },
      },
      'capability_audit',
    );
  }

  /** Emit pool_access event for standard (non-ensemble) requests */
  emitPoolAccess(params: {
    traceId: string;
    communityId: string;
    userId: string;
    poolId: string;
    accessLevel: string;
    budgetReservedMicro?: number;
    budgetCommittedMicro?: number;
    lifecycleTrace?: readonly LifecycleEvent[];
  }): void {
    this.emit({
      event_type: 'pool_access',
      timestamp: new Date().toISOString(),
      trace_id: params.traceId,
      community_id: params.communityId,
      user_id: params.userId,
      pool_id: params.poolId,
      access_level: params.accessLevel,
      budget_reserved_micro: params.budgetReservedMicro,
      budget_committed_micro: params.budgetCommittedMicro,
      lifecycle_trace: params.lifecycleTrace,
    });
  }

  /** Emit byok_usage event (AC-4.10) */
  emitByokUsage(params: {
    traceId: string;
    communityId: string;
    userId: string;
    poolId: string;
    accessLevel: string;
    byokProvider: string;
    lifecycleTrace?: readonly LifecycleEvent[];
  }): void {
    this.emit({
      event_type: 'byok_usage',
      timestamp: new Date().toISOString(),
      trace_id: params.traceId,
      community_id: params.communityId,
      user_id: params.userId,
      pool_id: params.poolId,
      access_level: params.accessLevel,
      byok_provider: params.byokProvider,
      lifecycle_trace: params.lifecycleTrace,
    });
  }

  /** Emit ensemble_invocation event with model breakdown (AC-4.9) */
  emitEnsembleInvocation(params: {
    traceId: string;
    communityId: string;
    userId: string;
    poolId: string;
    accessLevel: string;
    ensembleStrategy: string;
    ensembleN: number;
    modelBreakdown: ModelInvocationResult[];
    budgetReservedMicro?: number;
    budgetCommittedMicro?: number;
    lifecycleTrace?: readonly LifecycleEvent[];
  }): void {
    this.emit({
      event_type: 'ensemble_invocation',
      timestamp: new Date().toISOString(),
      trace_id: params.traceId,
      community_id: params.communityId,
      user_id: params.userId,
      pool_id: params.poolId,
      access_level: params.accessLevel,
      ensemble_strategy: params.ensembleStrategy,
      ensemble_n: params.ensembleN,
      model_breakdown: params.modelBreakdown,
      budget_reserved_micro: params.budgetReservedMicro,
      budget_committed_micro: params.budgetCommittedMicro,
      lifecycle_trace: params.lifecycleTrace,
    });
  }
}
