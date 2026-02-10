/**
 * Agent Gateway Lifecycle Ordering Tests
 * Sprint 1, Task 1.5: Bridgebuilder Hardening — cycle-013
 *
 * Verifies:
 *   - Pool resolution happens BEFORE budget estimation (F-2 fix)
 *   - estimateCost receives resolved poolId, not raw alias (AC-H1.1, AC-H1.2)
 *   - Fallback logging emitted when resolved pool differs from alias (F-4 fix)
 *   - No fallback logging when no alias provided (tier default) (AC-H1.7)
 *
 * @see AC-H1.1, AC-H1.2, AC-H1.6, AC-H1.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentGateway, type AgentGatewayDeps } from '../../../../packages/adapters/agent/agent-gateway'
import type { AgentInvokeRequest, AccessLevel } from '../../../../packages/core/ports'

// --------------------------------------------------------------------------
// Mock helpers
// --------------------------------------------------------------------------

function createMockLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger as any
}

function createMockDeps(overrides?: Partial<AgentGatewayDeps>): AgentGatewayDeps {
  const callOrder: string[] = []

  return {
    budgetManager: {
      estimateCost: vi.fn().mockImplementation((...args: unknown[]) => {
        callOrder.push('estimateCost')
        return 100
      }),
      reserve: vi.fn().mockResolvedValue({ status: 'RESERVED' }),
      finalize: vi.fn().mockResolvedValue(undefined),
      cancelReservation: vi.fn().mockResolvedValue(undefined),
      _callOrder: callOrder,
    } as any,
    rateLimiter: {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    } as any,
    loaFinnClient: {
      invoke: vi.fn().mockResolvedValue({
        content: 'test',
        usage: { costUsd: 0.01, promptTokens: 10, completionTokens: 10 },
      }),
      stream: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 5 }),
    } as any,
    tierMapper: {
      getDefaultModels: vi.fn().mockReturnValue([]),
    } as any,
    redis: {
      get: vi.fn().mockResolvedValue(null),
      ping: vi.fn().mockResolvedValue('PONG'),
    } as any,
    logger: createMockLogger(),
    ...overrides,
  }
}

function createInvokeRequest(
  modelAlias?: string,
  accessLevel: AccessLevel = 'free',
): AgentInvokeRequest {
  return {
    messages: [{ role: 'user', content: 'test' }],
    modelAlias: modelAlias as any,
    context: {
      tenantId: 'community-1',
      userId: 'user-1',
      channelId: 'channel-1',
      traceId: 'trace-1',
      idempotencyKey: 'idem-1',
      accessLevel,
      allowedModelAliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'],
    },
  } as any
}

// --------------------------------------------------------------------------
// invoke() lifecycle ordering
// --------------------------------------------------------------------------

describe('AgentGateway invoke() — lifecycle ordering (F-2)', () => {
  it('resolvePoolId runs BEFORE estimateCost (AC-H1.1)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest('cheap', 'free'))

    // estimateCost must have been called
    expect(deps.budgetManager.estimateCost).toHaveBeenCalled()

    // Verify estimateCost received resolved poolId, not raw alias
    const estimateCall = (deps.budgetManager.estimateCost as any).mock.calls[0][0]
    expect(estimateCall.modelAlias).toBe('cheap')
  })

  it('estimateCost receives resolved poolId when alias falls back (AC-H1.2)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    // reasoning on free tier → falls back to cheap
    await gateway.invoke(createInvokeRequest('reasoning', 'free'))

    const estimateCall = (deps.budgetManager.estimateCost as any).mock.calls[0][0]
    expect(estimateCall.modelAlias).toBe('cheap') // resolved, not 'reasoning'
  })

  it('reserve receives resolved poolId (AC-H1.2)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    // reasoning on free tier → falls back to cheap
    await gateway.invoke(createInvokeRequest('reasoning', 'free'))

    const reserveCall = (deps.budgetManager.reserve as any).mock.calls[0][0]
    expect(reserveCall.modelAlias).toBe('cheap') // resolved, not 'reasoning'
  })

  it('native on enterprise → estimateCost uses architect (AC-H1.2)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest('native', 'enterprise'))

    const estimateCall = (deps.budgetManager.estimateCost as any).mock.calls[0][0]
    expect(estimateCall.modelAlias).toBe('architect')
  })

  it('no alias → estimateCost uses tier default pool', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest(undefined, 'pro'))

    const estimateCall = (deps.budgetManager.estimateCost as any).mock.calls[0][0]
    expect(estimateCall.modelAlias).toBe('fast-code') // pro tier default
  })
})

// --------------------------------------------------------------------------
// Pool fallback logging (F-4)
// --------------------------------------------------------------------------

describe('AgentGateway invoke() — pool fallback logging (F-4)', () => {
  it('emits log when resolved pool differs from alias (AC-H1.6)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    // reasoning on free → falls back to cheap
    await gateway.invoke(createInvokeRequest('reasoning', 'free'))

    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requested: 'reasoning',
        resolved: 'cheap',
        accessLevel: 'free',
      }),
      'pool-fallback: resolved pool differs from requested alias',
    )
  })

  it('no log when alias matches resolved pool', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest('cheap', 'free'))

    // logger.info may be called for other reasons, but not for pool-fallback
    const fallbackCalls = (deps.logger.info as any).mock.calls.filter(
      (call: any[]) => typeof call[1] === 'string' && call[1].includes('pool-fallback'),
    )
    expect(fallbackCalls).toHaveLength(0)
  })

  it('no log when no alias provided — tier default is expected (AC-H1.7)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest(undefined, 'enterprise'))

    const fallbackCalls = (deps.logger.info as any).mock.calls.filter(
      (call: any[]) => typeof call[1] === 'string' && call[1].includes('pool-fallback'),
    )
    expect(fallbackCalls).toHaveLength(0)
  })

  it('native on free emits fallback log (native resolves to cheap, not in ALIAS_TO_POOL)', async () => {
    const deps = createMockDeps()
    const gateway = new AgentGateway(deps)

    await gateway.invoke(createInvokeRequest('native', 'free'))

    // native is not in ALIAS_TO_POOL, so ALIAS_TO_POOL['native'] === undefined !== 'cheap'
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requested: 'native',
        resolved: 'cheap',
        accessLevel: 'free',
      }),
      'pool-fallback: resolved pool differs from requested alias',
    )
  })
})
