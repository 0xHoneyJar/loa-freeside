/**
 * Agent Gateway Facade
 * Sprint S4-T1: Orchestrates the full request lifecycle
 *
 * State machine: RECEIVED → RESERVED → EXECUTING → FINALIZED
 *
 * invoke(): validate model → rate limit → reserve → sign JWT → call loa-finn → finalize → return
 * stream(): same pre-steps → proxy SSE → finalize on 'usage' event → reconcile if dropped
 *
 * @see SDD §4.1 Agent Gateway Facade
 */

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Queue } from 'bullmq';
import type {
  IAgentGateway,
  AgentInvokeRequest,
  AgentInvokeResponse,
  AgentStreamEvent,
  AccessLevel,
  ModelAlias,
  BudgetStatus,
  AgentHealthStatus,
} from '@arrakis/core/ports';
import type { BudgetManager } from './budget-manager.js';
import type { AgentRateLimiter } from './agent-rate-limiter.js';
import type { LoaFinnClient } from './loa-finn-client.js';
import type { TierAccessMapper } from './tier-access-mapper.js';
import type { StreamReconciliationJob } from './stream-reconciliation-worker.js';
import { getCurrentMonth } from './budget-manager.js';
import { BUDGET_WARNING_THRESHOLD } from './config.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface AgentGatewayDeps {
  budgetManager: BudgetManager;
  rateLimiter: AgentRateLimiter;
  loaFinnClient: LoaFinnClient;
  tierMapper: TierAccessMapper;
  redis: Redis;
  logger: Logger;
  reconciliationQueue?: Queue<StreamReconciliationJob>;
}

// --------------------------------------------------------------------------
// Gateway Implementation
// --------------------------------------------------------------------------

export class AgentGateway implements IAgentGateway {
  private readonly budget: BudgetManager;
  private readonly rateLimiter: AgentRateLimiter;
  private readonly loaFinn: LoaFinnClient;
  private readonly tierMapper: TierAccessMapper;
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly reconciliationQueue?: Queue<StreamReconciliationJob>;

  constructor(deps: AgentGatewayDeps) {
    this.budget = deps.budgetManager;
    this.rateLimiter = deps.rateLimiter;
    this.loaFinn = deps.loaFinnClient;
    this.tierMapper = deps.tierMapper;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.reconciliationQueue = deps.reconciliationQueue;
  }

  // --------------------------------------------------------------------------
  // invoke() — synchronous request lifecycle
  // --------------------------------------------------------------------------

  async invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
    const { context } = request;
    const log = this.logger.child({ traceId: context.traceId, communityId: context.tenantId });

    // 1. Validate model alias
    if (request.modelAlias && !context.allowedModelAliases.includes(request.modelAlias)) {
      throw new AgentGatewayError('MODEL_NOT_ALLOWED', `Model '${request.modelAlias}' is not available for your tier`, 403);
    }

    // 2. Rate limit check (all 4 dimensions: community, user, channel, burst)
    const rateLimitResult = await this.rateLimiter.check({
      communityId: context.tenantId,
      userId: context.userId,
      channelId: context.channelId,
      accessLevel: context.accessLevel,
    });

    if (!rateLimitResult.allowed) {
      throw new AgentGatewayError(
        'RATE_LIMITED',
        'Rate limit exceeded',
        429,
        {
          dimension: rateLimitResult.dimension,
          retryAfterMs: rateLimitResult.retryAfterMs,
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
        },
      );
    }

    // 3. Estimate cost and reserve budget
    const estimatedCost = this.budget.estimateCost({
      modelAlias: request.modelAlias ?? 'cheap',
      estimatedInputTokens: this.estimateInputTokens(request),
      // 1000: Conservative sync estimate. Median Claude response is ~500 tokens;
      // 1000 covers p90 without over-reserving budget. See SDD §4.3.
      estimatedOutputTokens: 1000,
      hasTools: (request.tools?.length ?? 0) > 0,
    });

    const reserveResult = await this.budget.reserve({
      communityId: context.tenantId,
      userId: context.userId,
      idempotencyKey: context.idempotencyKey,
      modelAlias: request.modelAlias ?? 'cheap',
      estimatedCost,
    });

    if (reserveResult.status === 'BUDGET_EXCEEDED') {
      throw new AgentGatewayError('BUDGET_EXCEEDED', 'Community budget exhausted', 402);
    }

    if (reserveResult.status !== 'RESERVED' && reserveResult.status !== 'ALREADY_RESERVED') {
      throw new AgentGatewayError('BUDGET_ERROR', 'Budget reservation failed', 500);
    }

    // Log idempotent hit (S10-T4: IMP-001)
    if (reserveResult.status === 'ALREADY_RESERVED') {
      log.debug({ idempotencyKey: context.idempotencyKey }, 'budget-reserve: idempotent hit');
    }

    // Emit budget warning if threshold reached
    if (reserveResult.warning) {
      log.warn(
        { remaining: reserveResult.remaining, limit: reserveResult.limit },
        'Budget warning threshold reached',
      );
    }

    // 4. Set max-cost ceiling in metadata (S11-T5, SDD §4.5.1)
    // 3× estimated cost in micro-cents — loa-finn enforces this ceiling
    const maxCostMicroCents = estimatedCost * 3 * 100; // cents → micro-cents (×100)
    request = {
      ...request,
      metadata: { ...request.metadata, max_cost_micro_cents: maxCostMicroCents },
    };

    // 5. Execute via loa-finn
    try {
      const response = await this.loaFinn.invoke(request);

      // 6. Finalize budget with actual cost + drift detection
      const actualCostCents = Math.round(response.usage.costUsd * 100);
      await this.budget.finalize({
        communityId: context.tenantId,
        userId: context.userId,
        idempotencyKey: context.idempotencyKey,
        actualCost: actualCostCents,
        usage: response.usage,
        modelAlias: request.modelAlias,
        traceId: context.traceId,
      });

      this.checkBudgetDrift(actualCostCents, estimatedCost, context.traceId, log);

      return response;
    } catch (err) {
      // On non-retryable failure: cancel reservation immediately
      // On retryable failure: reservation expires via TTL (Flatline IMP-001)
      if (err instanceof Error && isNonRetryable(err)) {
        await this.budget.cancelReservation({
          communityId: context.tenantId,
          userId: context.userId,
          idempotencyKey: context.idempotencyKey,
        });
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // stream() — SSE streaming lifecycle
  // --------------------------------------------------------------------------

  async *stream(
    request: AgentInvokeRequest,
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): AsyncGenerator<AgentStreamEvent> {
    const { context } = request;
    const log = this.logger.child({ traceId: context.traceId, communityId: context.tenantId });

    // 1. Validate model alias
    if (request.modelAlias && !context.allowedModelAliases.includes(request.modelAlias)) {
      throw new AgentGatewayError('MODEL_NOT_ALLOWED', `Model '${request.modelAlias}' is not available for your tier`, 403);
    }

    // 2. Rate limit check (all 4 dimensions: community, user, channel, burst)
    const rateLimitResult = await this.rateLimiter.check({
      communityId: context.tenantId,
      userId: context.userId,
      channelId: context.channelId,
      accessLevel: context.accessLevel,
    });

    if (!rateLimitResult.allowed) {
      throw new AgentGatewayError('RATE_LIMITED', 'Rate limit exceeded', 429, {
        dimension: rateLimitResult.dimension,
        retryAfterMs: rateLimitResult.retryAfterMs,
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
      });
    }

    // 3. Reserve budget
    const estimatedCost = this.budget.estimateCost({
      modelAlias: request.modelAlias ?? 'cheap',
      estimatedInputTokens: this.estimateInputTokens(request),
      // 2000: Stream requests tend to produce longer responses (multi-turn, tool use).
      // 2x sync estimate balances budget accuracy vs over-reservation. See SDD §4.3.
      estimatedOutputTokens: 2000,
      hasTools: (request.tools?.length ?? 0) > 0,
    });

    const reserveResult = await this.budget.reserve({
      communityId: context.tenantId,
      userId: context.userId,
      idempotencyKey: context.idempotencyKey,
      modelAlias: request.modelAlias ?? 'cheap',
      estimatedCost,
    });

    if (reserveResult.status === 'BUDGET_EXCEEDED') {
      throw new AgentGatewayError('BUDGET_EXCEEDED', 'Community budget exhausted', 402);
    }

    if (reserveResult.status !== 'RESERVED' && reserveResult.status !== 'ALREADY_RESERVED') {
      throw new AgentGatewayError('BUDGET_ERROR', 'Budget reservation failed', 500);
    }

    // Log idempotent hit (S10-T4: IMP-001)
    if (reserveResult.status === 'ALREADY_RESERVED') {
      log.debug({ idempotencyKey: context.idempotencyKey }, 'budget-reserve: idempotent hit');
    }

    if (reserveResult.warning) {
      log.warn(
        { remaining: reserveResult.remaining, limit: reserveResult.limit },
        'Budget warning threshold reached',
      );
    }

    // 4. Set max-cost ceiling in metadata (S11-T5, SDD §4.5.1)
    const maxCostMicroCents = estimatedCost * 3 * 100; // cents → micro-cents (×100)
    request = {
      ...request,
      metadata: { ...request.metadata, max_cost_micro_cents: maxCostMicroCents },
    };

    // 5. Stream from loa-finn with finalize-once semantics
    //    Pass downstream signal for abort propagation (SDD §4.7)
    let finalized = false;

    try {
      for await (const event of this.loaFinn.stream(request, { signal: options?.signal, lastEventId: options?.lastEventId })) {
        // Finalize on usage event (exactly once)
        if (event.type === 'usage' && !finalized) {
          const actualCostCents = Math.round(event.data.costUsd * 100);
          await this.budget.finalize({
            communityId: context.tenantId,
            userId: context.userId,
            idempotencyKey: context.idempotencyKey,
            actualCost: actualCostCents,
            usage: event.data,
            modelAlias: request.modelAlias,
            traceId: context.traceId,
          });
          finalized = true;

          this.checkBudgetDrift(actualCostCents, estimatedCost, context.traceId, log);
        }

        yield event;
      }
    } finally {
      // Reconciliation in finally block ensures budget accounting even on abort (S10-T2)
      if (!finalized) {
        await this.scheduleReconciliation(context, log);
      }
    }
  }

  // --------------------------------------------------------------------------
  // getAvailableModels()
  // --------------------------------------------------------------------------

  getAvailableModels(accessLevel: AccessLevel): ModelAlias[] {
    // Returns default models for the access level (no community context).
    // Per-community overrides are resolved per-request via context.allowedModelAliases.
    const tierForAccess: Record<AccessLevel, number> = { free: 1, pro: 4, enterprise: 7 };
    const tier = tierForAccess[accessLevel] ?? 1;
    return this.tierMapper.getDefaultModels(tier);
  }

  // --------------------------------------------------------------------------
  // getBudgetStatus()
  // --------------------------------------------------------------------------

  async getBudgetStatus(communityId: string): Promise<BudgetStatus> {
    const month = getCurrentMonth();
    const [committedStr, reservedStr, limitStr] = await Promise.all([
      this.redis.get(`agent:budget:committed:${communityId}:${month}`),
      this.redis.get(`agent:budget:reserved:${communityId}:${month}`),
      this.redis.get(`agent:budget:limit:${communityId}`),
    ]);

    const committed = safeInt(committedStr);
    const reserved = safeInt(reservedStr);
    const limit = safeInt(limitStr);
    const currentSpend = committed + reserved;
    const remaining = Math.max(0, limit - currentSpend);
    const percentUsed = limit > 0 ? Math.round((currentSpend / limit) * 100) : 0;

    return {
      communityId,
      monthlyLimitCents: limit,
      currentSpendCents: currentSpend,
      remainingCents: remaining,
      percentUsed,
      warningThresholdReached: limit > 0 && (currentSpend / limit) >= BUDGET_WARNING_THRESHOLD,
    };
  }

  // --------------------------------------------------------------------------
  // getHealth()
  // --------------------------------------------------------------------------

  async getHealth(): Promise<AgentHealthStatus> {
    const [loaFinn, redisPing] = await Promise.all([
      this.loaFinn.healthCheck(),
      this.pingRedis(),
    ]);

    return { loaFinn, redis: redisPing };
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Detect budget drift between estimated and actual cost (S11-T5, SDD §4.5.1).
   * - any overrun → emit agent_budget_drift_micro_cents metric via structured log
   * - actual > 2× estimate → warn log
   * - actual > 3× estimate → BUDGET_DRIFT_HIGH alarm (error log)
   */
  private checkBudgetDrift(
    actualCostCents: number,
    estimatedCostCents: number,
    traceId: string,
    log: Logger,
  ): void {
    if (estimatedCostCents <= 0 || actualCostCents <= estimatedCostCents) return;

    const driftMicroCents = (actualCostCents - estimatedCostCents) * 100;
    const ratio = actualCostCents / estimatedCostCents;

    // Emit drift metric on any overrun (scraped by log-based metrics pipeline)
    log.info(
      { traceId, metric: 'agent_budget_drift_micro_cents', value: driftMicroCents, ratio: ratio.toFixed(2) },
      'budget drift metric',
    );

    if (ratio > 3) {
      log.error(
        {
          traceId,
          actualCostCents,
          estimatedCostCents,
          ratio: ratio.toFixed(2),
          driftMicroCents,
          alarm: 'BUDGET_DRIFT_HIGH',
        },
        'BUDGET_DRIFT_HIGH: actual cost exceeds 3× estimate',
      );
    } else if (ratio > 2) {
      log.warn(
        {
          traceId,
          actualCostCents,
          estimatedCostCents,
          ratio: ratio.toFixed(2),
          driftMicroCents,
        },
        'Budget drift detected: actual cost exceeds 2× estimate',
      );
    }
  }

  private estimateInputTokens(request: AgentInvokeRequest): number {
    // Rough estimate: ~4 chars per token
    const totalChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  private async scheduleReconciliation(
    context: AgentInvokeRequest['context'],
    log: Logger,
  ): Promise<void> {
    if (!this.reconciliationQueue) {
      log.warn('Stream not finalized and no reconciliation queue available');
      return;
    }

    try {
      await this.reconciliationQueue.add('stream-reconcile', {
        idempotencyKey: context.idempotencyKey,
        communityId: context.tenantId,
        userId: context.userId,
        traceId: context.traceId,
        reservedAt: Date.now(),
      }, {
        // 30s: Delay before first reconciliation attempt. Gives loa-finn time to
        // process the stream and record usage before we query. See SDD §4.7.1.
        delay: 30_000,
        // 3 attempts with 10s exponential backoff (10s, 20s, 40s). Total window ~100s.
        // After 3 failures, reservation falls through to reaper cleanup (§8.4).
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
      });

      log.info('Scheduled stream reconciliation');
    } catch (err) {
      log.error({ err }, 'Failed to schedule stream reconciliation');
    }
  }

  private async pingRedis(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function safeInt(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
}

function isNonRetryable(err: Error): boolean {
  // Check for status codes in the error (LoaFinnError pattern)
  const statusCode = (err as { statusCode?: number }).statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

// --------------------------------------------------------------------------
// Gateway Error
// --------------------------------------------------------------------------

export class AgentGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentGatewayError';
  }
}
