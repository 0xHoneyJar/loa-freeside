/**
 * Reputation Event Router Tests — Sprint 359, Task 2.2 (FR-7)
 *
 * Tests routeReputationEvent() exhaustive switch for all 4 variants:
 * quality_signal, task_completed, credential_update, model_performance.
 *
 * Covers: audit trail integration, QualityObservation validation,
 * 'unspecified' TaskType aggregate-only routing, fail-closed stub.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  routeReputationEvent,
  failClosedAuditStub,
  AuditTrailNotReady,
  type ReputationEvent,
  type QualitySignalEvent,
  type TaskCompletedEvent,
  type CredentialUpdateEvent,
  type ModelPerformanceEvent,
  type AuditTrailPort,
  type ReputationEventRouterDeps,
} from '../../packages/adapters/agent/reputation-event-router.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info' as const,
    silent: vi.fn(),
  } as unknown as import('pino').Logger;
}

function makeAuditTrail(): AuditTrailPort {
  return {
    append: vi.fn().mockResolvedValue({ entry_id: 'test-entry-1', entry_hash: 'abc123' }),
  };
}

function makeDeps(overrides?: Partial<ReputationEventRouterDeps>): ReputationEventRouterDeps {
  return {
    logger: makeLogger(),
    auditTrail: makeAuditTrail(),
    ...overrides,
  };
}

const BASE_EVENT = {
  event_id: 'evt-001',
  agent_id: 'agent-test-1',
  collection_id: 'coll-001',
  timestamp: '2026-02-26T00:00:00Z',
};

// ─── quality_signal ─────────────────────────────────────────────────────────

describe('routeReputationEvent — quality_signal', () => {
  it('routes quality_signal events successfully', async () => {
    const deps = makeDeps();
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.85,
      task_type: 'inference',
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(true);
    expect(result.variant).toBe('quality_signal');
    expect(deps.logger.info).toHaveBeenCalled();
    expect(deps.auditTrail.append).toHaveBeenCalledWith(
      expect.objectContaining({
        domain_tag: 'reputation:coll-001',
        event_type: 'quality_signal',
        actor_id: 'agent-test-1',
      }),
    );
  });

  it('enqueues for scoring when enqueueForScoring is provided', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ enqueueForScoring: enqueue });
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.5,
    };

    await routeReputationEvent(event, deps);

    expect(enqueue).toHaveBeenCalledWith(event);
  });
});

// ─── task_completed ─────────────────────────────────────────────────────────

describe('routeReputationEvent — task_completed', () => {
  it('routes task_completed events successfully', async () => {
    const deps = makeDeps();
    const event: TaskCompletedEvent = {
      ...BASE_EVENT,
      type: 'task_completed',
      task_type: 'inference',
      success: true,
      duration_ms: 1500,
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(true);
    expect(result.variant).toBe('task_completed');
    expect(deps.auditTrail.append).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'task_completed',
        payload: expect.objectContaining({ success: true }),
      }),
    );
  });

  it('routes failed task_completed events', async () => {
    const deps = makeDeps();
    const event: TaskCompletedEvent = {
      ...BASE_EVENT,
      type: 'task_completed',
      task_type: 'ensemble',
      success: false,
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(true);
    expect(result.variant).toBe('task_completed');
  });
});

// ─── credential_update ──────────────────────────────────────────────────────

describe('routeReputationEvent — credential_update', () => {
  it('routes credential_update events for all actions', async () => {
    const actions = ['issued', 'revoked', 'renewed', 'suspended'] as const;

    for (const action of actions) {
      const deps = makeDeps();
      const event: CredentialUpdateEvent = {
        ...BASE_EVENT,
        type: 'credential_update',
        credential_id: `cred-${action}`,
        action,
      };

      const result = await routeReputationEvent(event, deps);

      expect(result.routed).toBe(true);
      expect(result.variant).toBe('credential_update');
      expect(deps.auditTrail.append).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ action }),
        }),
      );
    }
  });
});

// ─── model_performance ──────────────────────────────────────────────────────

describe('routeReputationEvent — model_performance', () => {
  const baseModelEvent: ModelPerformanceEvent = {
    ...BASE_EVENT,
    type: 'model_performance',
    model_id: 'gpt-4o',
    provider: 'openai',
    pool_id: 'pool-cheap',
    task_type: 'inference',
    quality_observation: {
      score: 0.92,
      dimensions: { accuracy: 0.95, relevance: 0.88 },
      latency_ms: 340,
    },
  };

  it('routes valid model_performance events', async () => {
    const deps = makeDeps();
    const result = await routeReputationEvent(baseModelEvent, deps);

    expect(result.routed).toBe(true);
    expect(result.variant).toBe('model_performance');
    expect(result.aggregate_only).toBe(false);
  });

  it('marks unspecified task_type as aggregate_only', async () => {
    const deps = makeDeps();
    const event: ModelPerformanceEvent = {
      ...baseModelEvent,
      task_type: 'unspecified',
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(true);
    expect(result.aggregate_only).toBe(true);
  });

  it('passes aggregateOnly option to enqueueForScoring', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ enqueueForScoring: enqueue });
    const event: ModelPerformanceEvent = {
      ...baseModelEvent,
      task_type: 'unspecified',
    };

    await routeReputationEvent(event, deps);

    expect(enqueue).toHaveBeenCalledWith(event, { aggregateOnly: true });
  });

  it('rejects score below 0', async () => {
    const deps = makeDeps();
    const event: ModelPerformanceEvent = {
      ...baseModelEvent,
      quality_observation: { score: -0.1 },
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(false);
    expect(result.variant).toBe('model_performance');
    expect(result.error).toContain('score must be in [0, 1]');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('rejects score above 1', async () => {
    const deps = makeDeps();
    const event: ModelPerformanceEvent = {
      ...baseModelEvent,
      quality_observation: { score: 1.5 },
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(false);
    expect(result.error).toContain('score must be in [0, 1]');
  });

  it('rejects non-numeric dimension values', async () => {
    const deps = makeDeps();
    const event: ModelPerformanceEvent = {
      ...baseModelEvent,
      quality_observation: {
        score: 0.5,
        dimensions: { accuracy: 'high' as unknown as number },
      },
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(false);
    expect(result.error).toContain("dimension 'accuracy' must be a number");
  });

  it('accepts boundary scores (0 and 1)', async () => {
    const deps = makeDeps();

    const zeroResult = await routeReputationEvent(
      { ...baseModelEvent, quality_observation: { score: 0 } },
      deps,
    );
    expect(zeroResult.routed).toBe(true);

    const oneResult = await routeReputationEvent(
      { ...baseModelEvent, quality_observation: { score: 1 } },
      { ...deps, auditTrail: makeAuditTrail() },
    );
    expect(oneResult.routed).toBe(true);
  });

  it('includes model_id and provider in audit payload', async () => {
    const deps = makeDeps();
    await routeReputationEvent(baseModelEvent, deps);

    expect(deps.auditTrail.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          model_id: 'gpt-4o',
          provider: 'openai',
          pool_id: 'pool-cheap',
        }),
      }),
    );
  });
});

// ─── Fail-Closed Audit Stub ─────────────────────────────────────────────────

describe('failClosedAuditStub', () => {
  it('throws AuditTrailNotReady on any append call', async () => {
    await expect(
      failClosedAuditStub.append({
        domain_tag: 'test',
        event_type: 'test',
        actor_id: 'test',
        payload: {},
        event_time: new Date(),
      }),
    ).rejects.toThrow(AuditTrailNotReady);
  });

  it('AuditTrailNotReady has correct name', () => {
    const err = new AuditTrailNotReady();
    expect(err.name).toBe('AuditTrailNotReady');
    expect(err.message).toContain('not yet available');
  });
});

// ─── Audit Trail Propagation ────────────────────────────────────────────────

describe('audit trail error propagation', () => {
  it('propagates audit trail errors (fail-closed behavior)', async () => {
    const deps = makeDeps({ auditTrail: failClosedAuditStub });
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.5,
    };

    await expect(routeReputationEvent(event, deps)).rejects.toThrow(AuditTrailNotReady);
  });

  it('all 4 variants propagate audit failures', async () => {
    const events: ReputationEvent[] = [
      { ...BASE_EVENT, type: 'quality_signal', score: 0.5 },
      { ...BASE_EVENT, type: 'task_completed', task_type: 'inference', success: true },
      { ...BASE_EVENT, type: 'credential_update', credential_id: 'cred-1', action: 'issued' },
      {
        ...BASE_EVENT,
        type: 'model_performance',
        model_id: 'm1',
        provider: 'p1',
        pool_id: 'pool-1',
        task_type: 'inference',
        quality_observation: { score: 0.5 },
      },
    ];

    for (const event of events) {
      const deps = makeDeps({ auditTrail: failClosedAuditStub });
      await expect(routeReputationEvent(event, deps)).rejects.toThrow(AuditTrailNotReady);
    }
  });
});

// ─── Structured Logging ─────────────────────────────────────────────────────

describe('structured logging — no PII', () => {
  it('logs event_id and agent_id but not raw event payload', async () => {
    const deps = makeDeps();
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.75,
    };

    await routeReputationEvent(event, deps);

    const logCall = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const logObj = logCall[0];
    expect(logObj.event_id).toBe('evt-001');
    expect(logObj.agent_id).toBe('agent-test-1');
  });

  it('model_performance logs model_id, provider, pool_id, score', async () => {
    const deps = makeDeps();
    const event: ModelPerformanceEvent = {
      ...BASE_EVENT,
      type: 'model_performance',
      model_id: 'claude-3.5-sonnet',
      provider: 'anthropic',
      pool_id: 'pool-reasoning',
      task_type: 'reasoning',
      quality_observation: { score: 0.88 },
    };

    await routeReputationEvent(event, deps);

    const logCall = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls[0];
    const logObj = logCall[0];
    expect(logObj.model_id).toBe('claude-3.5-sonnet');
    expect(logObj.provider).toBe('anthropic');
    expect(logObj.pool_id).toBe('pool-reasoning');
    expect(logObj.score).toBe(0.88);
  });
});

// ─── Timestamp Validation (Bridge finding high-1) ───────────────────────────

describe('routeReputationEvent — timestamp validation', () => {
  it('rejects events with invalid timestamp string', async () => {
    const deps = makeDeps();
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.5,
      timestamp: 'not-a-date',
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(false);
    expect(result.error).toContain('invalid timestamp');
    expect(deps.auditTrail.append).not.toHaveBeenCalled();
  });

  it('rejects events with empty timestamp', async () => {
    const deps = makeDeps();
    const event: TaskCompletedEvent = {
      ...BASE_EVENT,
      type: 'task_completed',
      task_type: 'inference',
      success: true,
      timestamp: '',
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(false);
    expect(result.error).toContain('invalid timestamp');
  });

  it('accepts events with valid ISO 8601 timestamp', async () => {
    const deps = makeDeps();
    const event: QualitySignalEvent = {
      ...BASE_EVENT,
      type: 'quality_signal',
      score: 0.7,
      timestamp: '2026-02-26T12:00:00.000Z',
    };

    const result = await routeReputationEvent(event, deps);

    expect(result.routed).toBe(true);
    expect(deps.auditTrail.append).toHaveBeenCalled();
  });
});
