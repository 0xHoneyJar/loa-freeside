/**
 * Reputation Event Router — Exhaustive routing for all ReputationEvent variants (cycle-043)
 *
 * Routes the 4-variant discriminated union: quality_signal, task_completed,
 * credential_update, model_performance (v8.2.0).
 *
 * Audit trail integration via AuditTrailPort — Sprint 2 provides a fail-closed
 * stub; Sprint 3 wires the real implementation.
 *
 * SDD ref: §3.4.5 (Reputation Event Routing), §3.4.7 (AuditTrailPort)
 * Sprint: 359, Task 2.2 (FR-7)
 */

import type { Logger } from 'pino';

// ─── AuditTrailPort ──────────────────────────────────────────────────────────

/**
 * Port interface for audit trail append operations.
 * Sprint 2: fail-closed stub (throws AuditTrailNotReady).
 * Sprint 3: real AuditTrailService wired via dependency injection.
 */
export interface AuditTrailPort {
  append(entry: {
    domain_tag: string;
    event_type: string;
    actor_id: string;
    payload: Record<string, unknown>;
    event_time: Date;
  }): Promise<{ entry_id: string; entry_hash: string }>;
}

export class AuditTrailNotReady extends Error {
  constructor() {
    super(
      'AuditTrailPort not wired: audit trail infrastructure is not yet available. ' +
      'This is expected in Sprint 2 — real implementation wired in Sprint 3.',
    );
    this.name = 'AuditTrailNotReady';
  }
}

/**
 * Fail-closed stub: any audit append attempt throws AuditTrailNotReady.
 * This prevents silent swallowing of audit failures.
 */
export const failClosedAuditStub: AuditTrailPort = {
  append: async () => {
    throw new AuditTrailNotReady();
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReputationEventBase {
  type: string;
  event_id: string;
  agent_id: string;
  collection_id: string;
  timestamp: string;
  sequence?: number;
}

export interface QualitySignalEvent extends ReputationEventBase {
  type: 'quality_signal';
  score: number;
  task_type?: string;
  dimensions?: Record<string, number>;
}

export interface TaskCompletedEvent extends ReputationEventBase {
  type: 'task_completed';
  task_type: string;
  success: boolean;
  duration_ms?: number;
}

export interface CredentialUpdateEvent extends ReputationEventBase {
  type: 'credential_update';
  credential_id: string;
  action: 'issued' | 'revoked' | 'renewed' | 'suspended';
}

export interface ModelPerformanceEvent extends ReputationEventBase {
  type: 'model_performance';
  model_id: string;
  provider: string;
  pool_id: string;
  task_type: string;
  quality_observation: {
    score: number;
    dimensions?: Record<string, number>;
    latency_ms?: number;
    evaluated_by?: string;
  };
  request_context?: {
    request_id?: string;
    delegation_id?: string;
  };
}

export type ReputationEvent =
  | QualitySignalEvent
  | TaskCompletedEvent
  | CredentialUpdateEvent
  | ModelPerformanceEvent;

// ─── Routing Result ──────────────────────────────────────────────────────────

export interface RoutingResult {
  routed: boolean;
  variant: string;
  aggregate_only?: boolean;
  error?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateQualityObservation(
  obs: ModelPerformanceEvent['quality_observation'],
): string | null {
  if (typeof obs.score !== 'number' || obs.score < 0 || obs.score > 1) {
    return `QualityObservation score must be in [0, 1], got ${obs.score}`;
  }

  if (obs.dimensions) {
    for (const [key, value] of Object.entries(obs.dimensions)) {
      if (typeof value !== 'number') {
        return `QualityObservation dimension '${key}' must be a number, got ${typeof value}`;
      }
    }
  }

  return null;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export interface ReputationEventRouterDeps {
  logger: Logger;
  auditTrail: AuditTrailPort;
  enqueueForScoring?: (event: ReputationEvent, options?: { aggregateOnly?: boolean }) => Promise<void>;
}

/**
 * Route a ReputationEvent to the appropriate handler.
 *
 * Exhaustive switch with `never` type check for compile-time safety.
 * All 4 variants handled: quality_signal, task_completed, credential_update, model_performance.
 */
export async function routeReputationEvent(
  event: ReputationEvent,
  deps: ReputationEventRouterDeps,
): Promise<RoutingResult> {
  const { logger, auditTrail, enqueueForScoring } = deps;

  // Validate timestamp before routing — Invalid Date in a hash chain corrupts the entire domain
  const eventTime = new Date(event.timestamp);
  if (isNaN(eventTime.getTime())) {
    logger.warn(
      { event_id: event.event_id, timestamp: event.timestamp },
      'reputation event rejected: invalid timestamp',
    );
    return { routed: false, variant: event.type, error: `invalid timestamp: ${event.timestamp}` };
  }

  switch (event.type) {
    case 'quality_signal': {
      logger.info(
        { event_id: event.event_id, agent_id: event.agent_id, score: event.score },
        'routing quality_signal event',
      );

      await auditTrail.append({
        domain_tag: `reputation:${event.collection_id}`,
        event_type: 'quality_signal',
        actor_id: event.agent_id,
        payload: { event_id: event.event_id, score: event.score, task_type: event.task_type },
        event_time: eventTime,
      });

      if (enqueueForScoring) {
        await enqueueForScoring(event);
      }

      return { routed: true, variant: 'quality_signal' };
    }

    case 'task_completed': {
      logger.info(
        { event_id: event.event_id, agent_id: event.agent_id, task_type: event.task_type, success: event.success },
        'routing task_completed event',
      );

      await auditTrail.append({
        domain_tag: `reputation:${event.collection_id}`,
        event_type: 'task_completed',
        actor_id: event.agent_id,
        payload: { event_id: event.event_id, task_type: event.task_type, success: event.success },
        event_time: eventTime,
      });

      if (enqueueForScoring) {
        await enqueueForScoring(event);
      }

      return { routed: true, variant: 'task_completed' };
    }

    case 'credential_update': {
      logger.info(
        { event_id: event.event_id, agent_id: event.agent_id, action: event.action },
        'routing credential_update event',
      );

      await auditTrail.append({
        domain_tag: `reputation:${event.collection_id}`,
        event_type: 'credential_update',
        actor_id: event.agent_id,
        payload: { event_id: event.event_id, credential_id: event.credential_id, action: event.action },
        event_time: eventTime,
      });

      if (enqueueForScoring) {
        await enqueueForScoring(event);
      }

      return { routed: true, variant: 'credential_update' };
    }

    case 'model_performance': {
      // Validate QualityObservation
      const validationError = validateQualityObservation(event.quality_observation);
      if (validationError) {
        logger.warn(
          { event_id: event.event_id, model_id: event.model_id, error: validationError },
          'model_performance event rejected: invalid QualityObservation',
        );
        return { routed: false, variant: 'model_performance', error: validationError };
      }

      // 'unspecified' TaskType → aggregate-only scoring (no task-type cohort)
      const aggregateOnly = event.task_type === 'unspecified';

      logger.info(
        {
          event_id: event.event_id,
          model_id: event.model_id,
          provider: event.provider,
          pool_id: event.pool_id,
          score: event.quality_observation.score,
          aggregate_only: aggregateOnly,
        },
        'routing model_performance event',
      );

      await auditTrail.append({
        domain_tag: `reputation:${event.collection_id}`,
        event_type: 'model_performance',
        actor_id: event.agent_id,
        payload: {
          event_id: event.event_id,
          model_id: event.model_id,
          provider: event.provider,
          pool_id: event.pool_id,
          score: event.quality_observation.score,
          task_type: event.task_type,
          aggregate_only: aggregateOnly,
        },
        event_time: eventTime,
      });

      if (enqueueForScoring) {
        await enqueueForScoring(event, { aggregateOnly });
      }

      return { routed: true, variant: 'model_performance', aggregate_only: aggregateOnly };
    }

    default: {
      // Exhaustive check — compile-time safety for future variants
      const _exhaustive: never = event;
      logger.error(
        { event: _exhaustive },
        'unhandled ReputationEvent variant — this should never happen',
      );
      return { routed: false, variant: 'unknown', error: 'unhandled variant' };
    }
  }
}
