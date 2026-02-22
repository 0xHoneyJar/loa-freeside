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
import type { DomainEvent } from '@0xhoneyjar/loa-hounfour';
import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour';
import { randomUUID } from 'node:crypto';

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

// --------------------------------------------------------------------------
// DomainEvent Adapter (Sprint 323, Task 2.4)
// --------------------------------------------------------------------------

/** Map CapabilityEventType to canonical DomainEvent aggregate_type */
const EVENT_TO_AGGREGATE: Record<CapabilityEventType, 'billing' | 'agent'> = {
  pool_access: 'billing',
  byok_usage: 'billing',
  ensemble_invocation: 'agent',
  model_access: 'agent',
};

/** Map CapabilityEventType to canonical DomainEvent dotted type string */
const EVENT_TO_DOMAIN_TYPE: Record<CapabilityEventType, string> = {
  pool_access: 'billing.pool.accessed',
  byok_usage: 'billing.byok.used',
  ensemble_invocation: 'agent.ensemble.invoked',
  model_access: 'agent.model.accessed',
};

/** Validate a required string field for DomainEvent envelope. */
function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid CapabilityAuditEvent: ${field} is required`);
  }
  return value;
}

/**
 * Wrap a CapabilityAuditEvent in the canonical DomainEvent<T> envelope.
 *
 * Non-breaking: existing emit() and CloudWatch consumers are unchanged.
 * Use this when forwarding audit events to canonical event stores or
 * cross-system event buses that expect the v7.0.0 DomainEvent format.
 *
 * @throws {Error} if required fields (event_type, timestamp, trace_id, community_id, user_id) are missing
 */
export function toDomainEvent(event: CapabilityAuditEvent): DomainEvent<CapabilityAuditEvent> {
  const eventType = assertNonEmptyString(event.event_type, 'event_type') as CapabilityEventType;
  const timestamp = assertNonEmptyString(event.timestamp, 'timestamp');
  const traceId = assertNonEmptyString(event.trace_id, 'trace_id');
  const communityId = assertNonEmptyString(event.community_id, 'community_id');
  const userId = assertNonEmptyString(event.user_id, 'user_id');

  return {
    event_id: randomUUID(),
    aggregate_id: communityId,
    aggregate_type: EVENT_TO_AGGREGATE[eventType],
    type: EVENT_TO_DOMAIN_TYPE[eventType],
    version: 1,
    occurred_at: timestamp,
    actor: userId,
    correlation_id: traceId,
    causation_id: traceId,
    payload: event,
    contract_version: CONTRACT_VERSION,
  };
}
