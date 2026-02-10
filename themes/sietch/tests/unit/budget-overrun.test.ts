/**
 * Budget Overrun Policy Tests
 * Sprint S11-T5: Max-Cost Ceiling + Drift Detection (§4.5.1, IMP-008)
 *
 * Tests:
 * 1. max_cost_micro_cents = 3× estimate in loa-finn metadata
 * 2. Drift metric emitted on any overrun
 * 3. Warn at >2× estimate
 * 4. BUDGET_DRIFT_HIGH alarm at >3× estimate
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before any imports that trigger Lua loading
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import { AgentGateway, type AgentGatewayDeps } from '@arrakis/adapters/agent';
import type { AgentInvokeRequest } from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

function mockLogger() {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import('pino').Logger;
}

function buildRequest(overrides: Partial<AgentInvokeRequest> = {}): AgentInvokeRequest {
  return {
    context: {
      tenantId: 'comm-1',
      userId: '0xUser',
      nftId: null,
      tier: 3,
      accessLevel: 'pro' as const,
      allowedModelAliases: ['cheap' as const],
      platform: 'discord' as const,
      channelId: 'ch-1',
      idempotencyKey: 'key-1',
      traceId: 'trace-1',
    },
    agent: 'default',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

function buildDeps(overrides: Partial<AgentGatewayDeps> = {}): AgentGatewayDeps {
  return {
    budgetManager: {
      estimateCost: vi.fn().mockReturnValue(10), // 10 cents
      reserve: vi.fn().mockResolvedValue({ status: 'RESERVED', remaining: 990, limit: 1000, warning: false }),
      finalize: vi.fn().mockResolvedValue({ status: 'FINALIZED', actualCost: 10 }),
      cancelReservation: vi.fn().mockResolvedValue({ status: 'FINALIZED', actualCost: 0 }),
      reap: vi.fn(),
    } as any,
    rateLimiter: {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    } as any,
    loaFinnClient: {
      invoke: vi.fn().mockResolvedValue({
        content: 'response',
        usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.10 },
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { type: 'content', data: { text: 'hi' } };
        yield { type: 'usage', data: { promptTokens: 100, completionTokens: 50, costUsd: 0.10 } };
        yield { type: 'done', data: null };
      }),
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10 }),
    } as any,
    tierMapper: {
      getDefaultModels: vi.fn().mockReturnValue(['cheap']),
    } as any,
    redis: {
      get: vi.fn().mockResolvedValue(null),
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any,
    logger: mockLogger(),
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests: Max-Cost Ceiling in Metadata
// --------------------------------------------------------------------------

describe('Budget overrun policy — max-cost ceiling', () => {
  it('should set max_cost_micro_cents = 3× estimate × 100 on invoke', async () => {
    const deps = buildDeps();
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10); // 10 cents
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest());

    // loaFinnClient.invoke receives the request with metadata
    const invokeCall = (deps.loaFinnClient as any).invoke.mock.calls[0][0] as AgentInvokeRequest;
    expect(invokeCall.metadata).toBeDefined();
    expect(invokeCall.metadata!.max_cost_micro_cents).toBe(10 * 3 * 100); // 3000
  });

  it('should set max_cost_micro_cents = 3× estimate × 100 on stream', async () => {
    const deps = buildDeps();
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(25); // 25 cents
    const gateway = new AgentGateway(deps);

    const events: unknown[] = [];
    for await (const event of gateway.stream(buildRequest())) {
      events.push(event);
    }

    const streamCall = (deps.loaFinnClient as any).stream.mock.calls[0][0] as AgentInvokeRequest;
    expect(streamCall.metadata).toBeDefined();
    expect(streamCall.metadata!.max_cost_micro_cents).toBe(25 * 3 * 100); // 7500
  });

  it('should preserve existing metadata when adding ceiling', async () => {
    const deps = buildDeps();
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(5);
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest({ metadata: { custom_field: 'value' } }));

    const invokeCall = (deps.loaFinnClient as any).invoke.mock.calls[0][0] as AgentInvokeRequest;
    expect(invokeCall.metadata!.custom_field).toBe('value');
    expect(invokeCall.metadata!.max_cost_micro_cents).toBe(5 * 3 * 100);
  });
});

// --------------------------------------------------------------------------
// Tests: Drift Detection
// --------------------------------------------------------------------------

describe('Budget overrun policy — drift detection', () => {
  it('should emit drift metric on any overrun (actual > estimate)', async () => {
    const deps = buildDeps();
    const logger = deps.logger as ReturnType<typeof mockLogger>;
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10);
    // actual cost: 15 cents (1.5×) — under 2× but still an overrun
    (deps.loaFinnClient as any).invoke.mockResolvedValue({
      content: 'r',
      usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.15 },
    });
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest());

    // child logger is returned by child(), and info/warn/error are called on it
    const childLogger = logger.child.mock.results[0]?.value ?? logger;
    const infoCalls = childLogger.info.mock.calls;
    const driftMetricCall = infoCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.metric === 'agent_budget_drift_micro_cents',
    );
    expect(driftMetricCall).toBeDefined();
    expect((driftMetricCall![0] as Record<string, unknown>).value).toBe((15 - 10) * 100); // 500 micro-cents
  });

  it('should NOT emit drift metric when actual <= estimate', async () => {
    const deps = buildDeps();
    const logger = deps.logger as ReturnType<typeof mockLogger>;
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10);
    // actual cost: 8 cents — under estimate
    (deps.loaFinnClient as any).invoke.mockResolvedValue({
      content: 'r',
      usage: { promptTokens: 50, completionTokens: 25, costUsd: 0.08 },
    });
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest());

    const childLogger = logger.child.mock.results[0]?.value ?? logger;
    const infoCalls = childLogger.info.mock.calls;
    const driftMetricCall = infoCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.metric === 'agent_budget_drift_micro_cents',
    );
    expect(driftMetricCall).toBeUndefined();
  });

  it('should log warn when actual > 2× estimate', async () => {
    const deps = buildDeps();
    const logger = deps.logger as ReturnType<typeof mockLogger>;
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10);
    // actual cost: 25 cents (2.5×) — triggers warn
    (deps.loaFinnClient as any).invoke.mockResolvedValue({
      content: 'r',
      usage: { promptTokens: 200, completionTokens: 100, costUsd: 0.25 },
    });
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest());

    const childLogger = logger.child.mock.results[0]?.value ?? logger;
    const warnCalls = childLogger.warn.mock.calls;
    const driftWarn = warnCalls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1].includes('2× estimate'),
    );
    expect(driftWarn).toBeDefined();
    expect((driftWarn![0] as Record<string, unknown>).actualCostCents).toBe(25);
    expect((driftWarn![0] as Record<string, unknown>).estimatedCostCents).toBe(10);
  });

  it('should fire BUDGET_DRIFT_HIGH alarm when actual > 3× estimate', async () => {
    const deps = buildDeps();
    const logger = deps.logger as ReturnType<typeof mockLogger>;
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10);
    // actual cost: 35 cents (3.5×) — triggers alarm
    (deps.loaFinnClient as any).invoke.mockResolvedValue({
      content: 'r',
      usage: { promptTokens: 300, completionTokens: 200, costUsd: 0.35 },
    });
    const gateway = new AgentGateway(deps);

    await gateway.invoke(buildRequest());

    const childLogger = logger.child.mock.results[0]?.value ?? logger;
    const errorCalls = childLogger.error.mock.calls;
    const alarmCall = errorCalls.find(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.alarm === 'BUDGET_DRIFT_HIGH',
    );
    expect(alarmCall).toBeDefined();
    expect((alarmCall![0] as Record<string, unknown>).driftMicroCents).toBe((35 - 10) * 100);
  });

  it('should detect drift in stream finalize', async () => {
    const deps = buildDeps();
    const logger = deps.logger as ReturnType<typeof mockLogger>;
    (deps.budgetManager.estimateCost as ReturnType<typeof vi.fn>).mockReturnValue(10);
    // Stream usage event with 25 cents (2.5×)
    (deps.loaFinnClient as any).stream.mockImplementation(async function* () {
      yield { type: 'content', data: { text: 'streaming' } };
      yield { type: 'usage', data: { promptTokens: 200, completionTokens: 100, costUsd: 0.25 } };
      yield { type: 'done', data: null };
    });
    const gateway = new AgentGateway(deps);

    const events: unknown[] = [];
    for await (const event of gateway.stream(buildRequest())) {
      events.push(event);
    }

    const childLogger = logger.child.mock.results[0]?.value ?? logger;
    const warnCalls = childLogger.warn.mock.calls;
    const driftWarn = warnCalls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1].includes('2× estimate'),
    );
    expect(driftWarn).toBeDefined();
  });
});
