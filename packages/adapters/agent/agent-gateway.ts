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
import { resolvePoolId, ALIAS_TO_POOL, POOL_PROVIDER_HINT } from './pool-mapping.js';
import type { PoolId } from './pool-mapping.js';
import { EnsembleMapper } from './ensemble-mapper.js';
import type { EnsembleValidationResult } from './ensemble-mapper.js';
import type { BYOKManager } from './byok-manager.js';
import { computeEnsembleAccounting } from './ensemble-accounting.js';
import type { ModelInvocationResult } from './ensemble-accounting.js';
import type { AgentMetrics } from './agent-metrics.js';
import { RequestLifecycle } from './request-lifecycle.js';
import { TokenEstimator } from './token-estimator.js';

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
  /** Whether ensemble orchestration is enabled (ENSEMBLE_ENABLED env var) */
  ensembleEnabled?: boolean;
  /** Whether BYOK is enabled (BYOK_ENABLED env var) */
  byokEnabled?: boolean;
  /** BYOK manager instance (required when byokEnabled) */
  byokManager?: BYOKManager;
  /** BYOK daily request quota per community (default: 10_000) */
  byokDailyQuota?: number;
  /** Agent metrics emitter for per-model EMF metrics (cycle-019) */
  metrics?: AgentMetrics;
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
  private readonly ensembleMapper = new EnsembleMapper();
  private readonly ensembleEnabled: boolean;
  private readonly byokEnabled: boolean;
  private readonly byokManager?: BYOKManager;
  private readonly byokDailyQuota: number;
  private readonly metrics?: AgentMetrics;
  private readonly tokenEstimator: TokenEstimator;

  constructor(deps: AgentGatewayDeps) {
    this.budget = deps.budgetManager;
    this.rateLimiter = deps.rateLimiter;
    this.loaFinn = deps.loaFinnClient;
    this.tierMapper = deps.tierMapper;
    this.redis = deps.redis;
    this.logger = deps.logger;
    this.reconciliationQueue = deps.reconciliationQueue;
    this.ensembleEnabled = deps.ensembleEnabled ?? false;
    this.byokEnabled = deps.byokEnabled ?? false;
    this.byokManager = deps.byokManager;
    this.byokDailyQuota = deps.byokDailyQuota ?? 10_000;
    this.metrics = deps.metrics;
    this.tokenEstimator = new TokenEstimator(deps.logger);
  }

  // --------------------------------------------------------------------------
  // invoke() — synchronous request lifecycle
  // --------------------------------------------------------------------------

  async invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
    const { context } = request;
    const log = this.logger.child({ traceId: context.traceId, communityId: context.tenantId });
    const lifecycle = new RequestLifecycle(context.traceId, log);

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
      lifecycle.fail({ reason: 'RATE_LIMITED', dimension: rateLimitResult.dimension });
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

    // Lifecycle: RECEIVED → VALIDATED (rate limit + model alias checks passed)
    lifecycle.validate({ accessLevel: context.accessLevel });

    // 3. Pool resolution — tier-aware model→pool mapping (Sprint 3)
    //    Must run BEFORE budget estimation so cost uses resolved pool pricing (F-2)
    const { poolId, allowedPools } = resolvePoolId(request.modelAlias, context.accessLevel);

    // Log pool fallback when resolved pool differs from requested alias (F-4)
    if (request.modelAlias && poolId !== ALIAS_TO_POOL[request.modelAlias]) {
      log.info(
        { requested: request.modelAlias, resolved: poolId, accessLevel: context.accessLevel },
        'pool-fallback: resolved pool differs from requested alias',
      );
    }

    // 3b. Ensemble validation — between pool resolution and budget reservation (FR-3)
    let ensembleResult: EnsembleValidationResult | undefined;
    let budgetMultiplier = 1;

    if (request.ensemble) {
      if (!this.ensembleEnabled) {
        lifecycle.fail({ reason: 'ENSEMBLE_DISABLED' });
        throw new AgentGatewayError('ENSEMBLE_DISABLED', 'Ensemble orchestration is not enabled', 400);
      }

      const validation = this.ensembleMapper.validate(request.ensemble, context.accessLevel);
      if (!validation.valid) {
        lifecycle.fail({ reason: validation.code });
        throw new AgentGatewayError(validation.code, validation.message, validation.statusCode);
      }

      ensembleResult = validation;
      budgetMultiplier = validation.budgetMultiplier;
    }

    // 3c. BYOK check — between ensemble and budget (FR-4)
    //     Server-side eligibility: derive from BYOK key existence, NOT from client claims (AC-4.31)
    //     Provider resolved via pool→provider hint mapping (BB3-1)
    let isByok = false;
    let byokProvider: string | undefined;

    if (this.byokEnabled && this.byokManager) {
      const resolved = await this.resolveByokProvider(context.tenantId, poolId, log);

      if (resolved) {
        isByok = true;
        byokProvider = resolved;

        // AC-4.30: BYOK daily quota enforcement (atomic INCR — BB3-2)
        await this.checkByokQuota(context.tenantId, log);

        log.info({ provider: byokProvider }, 'BYOK key active — zero-cost accounting');
      }
    }

    // 3d. Hybrid BYOK/platform multiplier (cycle-019 BB6 Finding #6)
    //     For ensemble requests, only PLATFORM_BUDGET models count toward reservation.
    //     BYOK models are zero-cost and don't need budget reservation.
    if (ensembleResult && isByok && ensembleResult.request.n) {
      // If primary pool is BYOK, reduce multiplier by 1 (this model is free)
      budgetMultiplier = this.ensembleMapper.computeHybridMultiplier(
        ensembleResult.request.n,
        1, // Current model is BYOK; other models assumed platform
      );
    }

    // 4. Estimate cost and reserve budget (using resolved poolId, not raw alias)
    //    BYOK_NO_BUDGET: reserve $0 when using community's own key (AC-4.7)
    //    Budget multiplier applied for ensemble strategies (platform models only)
    const baseCostCents = isByok ? 0 : this.budget.estimateCost({
      modelAlias: poolId,
      estimatedInputTokens: this.tokenEstimator.estimate(request.messages, { modelAlias: poolId }),
      // 1000: Conservative sync estimate. Median Claude response is ~500 tokens;
      // 1000 covers p90 without over-reserving budget. See SDD §4.3.
      estimatedOutputTokens: 1000,
      hasTools: (request.tools?.length ?? 0) > 0,
    });
    const estimatedCostCents = baseCostCents * budgetMultiplier;

    const reserveResult = await this.budget.reserve({
      communityId: context.tenantId,
      userId: context.userId,
      idempotencyKey: context.idempotencyKey,
      modelAlias: poolId,
      estimatedCost: estimatedCostCents,
    });

    if (reserveResult.status === 'BUDGET_EXCEEDED') {
      lifecycle.fail({ reason: 'BUDGET_EXCEEDED' });
      throw new AgentGatewayError('BUDGET_EXCEEDED', 'Community budget exhausted', 402);
    }

    if (reserveResult.status !== 'RESERVED' && reserveResult.status !== 'ALREADY_RESERVED') {
      lifecycle.fail({ reason: 'BUDGET_ERROR' });
      throw new AgentGatewayError('BUDGET_ERROR', 'Budget reservation failed', 500);
    }

    // Lifecycle: VALIDATED → RESERVED
    lifecycle.reserve({ poolId, estimatedCostCents, isByok });

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

    // 5. Set max-cost ceiling in metadata (S11-T5, SDD §4.5.1)
    // 3× estimated cost (cents) × 100 → micro-cents. loa-finn enforces this ceiling.
    // BYOK: max_cost = 0 (community pays provider directly)
    const maxCostMicroCents = estimatedCostCents * 3 * 100;
    request = {
      ...request,
      context: { ...context, poolId, allowedPools },
      metadata: {
        ...request.metadata,
        max_cost_micro_cents: maxCostMicroCents,
        ...(ensembleResult ? { ensemble: ensembleResult.jwtClaims } : {}),
        // AC-4.4: BYOK JWT claims — server-side derived, never from client
        ...(isByok ? { byok: true, byok_provider: byokProvider } : {}),
      },
    };

    // Lifecycle: RESERVED → EXECUTING
    lifecycle.execute({ poolId });

    // 6. Execute via loa-finn
    try {
      const response = await this.loaFinn.invoke(request);

      // 6b. Finalize budget with actual cost + drift detection
      // AC-4.7 + AC-4.8: BYOK uses $0 cost (community pays provider directly)
      const actualCostCents = isByok ? 0 : Math.round(response.usage.costUsd * 100);
      await this.budget.finalize({
        communityId: context.tenantId,
        userId: context.userId,
        idempotencyKey: context.idempotencyKey,
        actualCost: actualCostCents,
        usage: response.usage,
        modelAlias: request.modelAlias,
        traceId: context.traceId,
      });

      // Lifecycle: EXECUTING → FINALIZED
      lifecycle.finalize({ actualCostCents });

      // 6c. Budget drift detection uses platform cost only (BB6 AC-1.11)
      this.checkBudgetDrift(actualCostCents, estimatedCostCents, context.traceId, log, {
        ensembleN: ensembleResult?.jwtClaims?.ensemble_n,
      });

      // 6d. Per-model ensemble accounting (cycle-019 BB6 Finding #6)
      if (ensembleResult) {
        const costMicro = actualCostCents * 100; // cents → micro-USD
        const reservedMicro = estimatedCostCents * 100;
        const accountingMode = isByok ? 'BYOK_NO_BUDGET' as const : 'PLATFORM_BUDGET' as const;
        const provider = (byokProvider ?? POOL_PROVIDER_HINT[poolId as PoolId] ?? 'openai') as 'openai' | 'anthropic';

        // Build per-model result for the primary invocation
        const modelResult: ModelInvocationResult = {
          model_id: poolId,
          provider,
          succeeded: true,
          input_tokens: response.usage.promptTokens,
          output_tokens: response.usage.completionTokens,
          cost_micro: isByok ? 0 : costMicro,
          accounting_mode: accountingMode,
          latency_ms: 0, // Would need request timing; placeholder for now
        };

        const ensembleAccounting = computeEnsembleAccounting(
          ensembleResult.request.strategy!,
          [modelResult],
          reservedMicro,
        );

        // Emit per-model EMF metrics (AC-1.22, AC-1.23)
        if (this.metrics) {
          await this.metrics.emitPerModelCost({
            modelId: poolId,
            provider,
            accountingMode,
            costMicro: modelResult.cost_micro,
          });
          await this.metrics.emitEnsembleSavings({
            strategy: ensembleResult.request.strategy!,
            savingsMicro: ensembleAccounting.savings_micro,
          });
        }

        return { ...response, ensemble_accounting: ensembleAccounting };
      }

      return response;
    } catch (err) {
      // Lifecycle: → FAILED (only if not already terminal)
      if (!lifecycle.isTerminal()) {
        lifecycle.fail({ reason: err instanceof Error ? err.message : 'unknown' });
      }

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
    const lifecycle = new RequestLifecycle(context.traceId, log);

    // 1. Validate model alias
    if (request.modelAlias && !context.allowedModelAliases.includes(request.modelAlias)) {
      lifecycle.fail({ reason: 'MODEL_NOT_ALLOWED' });
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
      lifecycle.fail({ reason: 'RATE_LIMITED', dimension: rateLimitResult.dimension });
      throw new AgentGatewayError('RATE_LIMITED', 'Rate limit exceeded', 429, {
        dimension: rateLimitResult.dimension,
        retryAfterMs: rateLimitResult.retryAfterMs,
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
      });
    }

    // Lifecycle: RECEIVED → VALIDATED
    lifecycle.validate({ accessLevel: context.accessLevel });

    // 3. Pool resolution — tier-aware model→pool mapping (Sprint 3)
    //    Must run BEFORE budget estimation so cost uses resolved pool pricing (F-2)
    const { poolId, allowedPools } = resolvePoolId(request.modelAlias, context.accessLevel);

    // Log pool fallback when resolved pool differs from requested alias (F-4)
    if (request.modelAlias && poolId !== ALIAS_TO_POOL[request.modelAlias]) {
      log.info(
        { requested: request.modelAlias, resolved: poolId, accessLevel: context.accessLevel },
        'pool-fallback: resolved pool differs from requested alias',
      );
    }

    // 3b. Ensemble validation — between pool resolution and budget reservation (FR-3)
    let ensembleResult: EnsembleValidationResult | undefined;
    let budgetMultiplier = 1;

    if (request.ensemble) {
      if (!this.ensembleEnabled) {
        lifecycle.fail({ reason: 'ENSEMBLE_DISABLED' });
        throw new AgentGatewayError('ENSEMBLE_DISABLED', 'Ensemble orchestration is not enabled', 400);
      }

      const validation = this.ensembleMapper.validate(request.ensemble, context.accessLevel);
      if (!validation.valid) {
        lifecycle.fail({ reason: validation.code });
        throw new AgentGatewayError(validation.code, validation.message, validation.statusCode);
      }

      ensembleResult = validation;
      budgetMultiplier = validation.budgetMultiplier;
    }

    // 3c. BYOK check — between ensemble and budget (FR-4)
    //     Provider resolved via pool→provider hint mapping (BB3-1)
    let isByok = false;
    let byokProvider: string | undefined;

    if (this.byokEnabled && this.byokManager) {
      const resolved = await this.resolveByokProvider(context.tenantId, poolId, log);

      if (resolved) {
        isByok = true;
        byokProvider = resolved;
        // AC-4.30: BYOK daily quota enforcement (atomic INCR — BB3-2)
        await this.checkByokQuota(context.tenantId, log);
        log.info({ provider: byokProvider }, 'BYOK key active — zero-cost accounting');
      }
    }

    // 3d. Hybrid BYOK/platform multiplier (cycle-019 BB6 Finding #6)
    if (ensembleResult && isByok && ensembleResult.request.n) {
      budgetMultiplier = this.ensembleMapper.computeHybridMultiplier(
        ensembleResult.request.n,
        1,
      );
    }

    // 4. Reserve budget (using resolved poolId, not raw alias)
    //    BYOK_NO_BUDGET: reserve $0 when using community's own key (AC-4.7)
    //    Budget multiplier applied for ensemble strategies (platform models only)
    const baseCostCents = isByok ? 0 : this.budget.estimateCost({
      modelAlias: poolId,
      estimatedInputTokens: this.tokenEstimator.estimate(request.messages, { modelAlias: poolId }),
      // 2000: Stream requests tend to produce longer responses (multi-turn, tool use).
      // 2x sync estimate balances budget accuracy vs over-reservation. See SDD §4.3.
      estimatedOutputTokens: 2000,
      hasTools: (request.tools?.length ?? 0) > 0,
    });
    const estimatedCostCents = baseCostCents * budgetMultiplier;

    const reserveResult = await this.budget.reserve({
      communityId: context.tenantId,
      userId: context.userId,
      idempotencyKey: context.idempotencyKey,
      modelAlias: poolId,
      estimatedCost: estimatedCostCents,
    });

    if (reserveResult.status === 'BUDGET_EXCEEDED') {
      lifecycle.fail({ reason: 'BUDGET_EXCEEDED' });
      throw new AgentGatewayError('BUDGET_EXCEEDED', 'Community budget exhausted', 402);
    }

    if (reserveResult.status !== 'RESERVED' && reserveResult.status !== 'ALREADY_RESERVED') {
      lifecycle.fail({ reason: 'BUDGET_ERROR' });
      throw new AgentGatewayError('BUDGET_ERROR', 'Budget reservation failed', 500);
    }

    // Lifecycle: VALIDATED → RESERVED
    lifecycle.reserve({ poolId, estimatedCostCents, isByok });

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

    // 5. Set max-cost ceiling in metadata (S11-T5, SDD §4.5.1)
    // 3× estimated cost (cents) × 100 → micro-cents. loa-finn enforces this ceiling.
    const maxCostMicroCents = estimatedCostCents * 3 * 100;
    request = {
      ...request,
      context: { ...context, poolId, allowedPools },
      metadata: {
        ...request.metadata,
        max_cost_micro_cents: maxCostMicroCents,
        ...(ensembleResult ? { ensemble: ensembleResult.jwtClaims } : {}),
        ...(isByok ? { byok: true, byok_provider: byokProvider } : {}),
      },
    };

    // Lifecycle: RESERVED → EXECUTING
    lifecycle.execute({ poolId });

    // 6. Stream from loa-finn with finalize-once semantics
    //    Pass downstream signal for abort propagation (SDD §4.7)
    let finalized = false;

    try {
      for await (const event of this.loaFinn.stream(request, { signal: options?.signal, lastEventId: options?.lastEventId })) {
        // Finalize on usage event (exactly once)
        if (event.type === 'usage' && !finalized) {
          const actualCostCents = isByok ? 0 : Math.round(event.data.costUsd * 100);
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

          // Lifecycle: EXECUTING → FINALIZED
          lifecycle.finalize({ actualCostCents });

          this.checkBudgetDrift(actualCostCents, estimatedCostCents, context.traceId, log, {
            ensembleN: ensembleResult?.jwtClaims?.ensemble_n,
          });
        }

        yield event;
      }
    } finally {
      // Lifecycle: → FAILED if not already terminal (abort/error path)
      if (!lifecycle.isTerminal()) {
        lifecycle.fail({ reason: finalized ? 'POST_FINALIZE_ERROR' : 'STREAM_NOT_FINALIZED' });
      }

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
   * - ensemble invariant: actual ≤ reserved (N × base estimate) (BB3-6)
   */
  private checkBudgetDrift(
    actualCostCents: number,
    estimatedCostCents: number,
    traceId: string,
    log: Logger,
    opts?: { ensembleN?: number },
  ): void {
    // BB3-6: Ensemble budget assertion — committed ≤ reserved invariant
    // estimatedCostCents already includes the N× multiplier from ensemble-mapper.
    // If actual exceeds reserved, it means loa-finn's max_cost ceiling was breached.
    if (opts?.ensembleN && opts.ensembleN > 1 && actualCostCents > estimatedCostCents && estimatedCostCents > 0) {
      log.error(
        {
          traceId,
          actualCostCents,
          reservedCostCents: estimatedCostCents,
          ensembleN: opts.ensembleN,
          alarm: 'ENSEMBLE_BUDGET_OVERRUN',
        },
        'ENSEMBLE_BUDGET_OVERRUN: actual cost exceeds N× reserved ceiling — investigate loa-finn max_cost enforcement',
      );
    }

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

  /**
   * Resolve which BYOK provider to use for this community and pool.
   *
   * Strategy:
   * 1. Use pool→provider hint (reasoning/architect → anthropic, cheap/fast-code/reviewer → openai)
   * 2. Fall back to checking all known providers if hint has no key
   * 3. Return undefined if no BYOK keys exist for any provider
   *
   * @see Bridgebuilder BB3-1 — fixes poolId.startsWith('anthropic') always being false
   * @see POOL_PROVIDER_HINT in pool-mapping.ts
   */
  private async resolveByokProvider(
    tenantId: string,
    poolId: string,
    log: Logger,
  ): Promise<string | undefined> {
    if (!this.byokManager) return undefined;

    // Prefer the provider matching this pool's intent
    const hint = POOL_PROVIDER_HINT[poolId as PoolId];
    if (hint) {
      const hasKey = await this.byokManager.hasBYOKKey(tenantId, hint);
      if (hasKey) return hint;
    }

    // Fallback: check all known providers (skip the hint we already checked)
    const providers = ['openai', 'anthropic'] as const;
    for (const provider of providers) {
      if (provider === hint) continue;
      const hasKey = await this.byokManager.hasBYOKKey(tenantId, provider);
      if (hasKey) return provider;
    }

    return undefined;
  }

  /**
   * Check and increment BYOK daily quota per community (AC-4.30).
   * Uses atomic Redis INCR for race-condition-free quota enforcement.
   * Fail-closed on Redis error (IMP-010).
   *
   * @see Bridgebuilder BB3-2 — fixes GET-then-INCR race condition
   */
  private async checkByokQuota(communityId: string, log: Logger): Promise<void> {
    try {
      const key = `agent:byok:count:${communityId}:${this.currentDay()}`;
      const newCount = await this.redis.incr(key);

      // Set 24h TTL on first increment (daily counter auto-expiry)
      if (newCount === 1) {
        await this.redis.expire(key, 86400);
      }

      if (newCount > this.byokDailyQuota) {
        throw new AgentGatewayError(
          'BYOK_QUOTA_EXCEEDED',
          'Daily BYOK request quota exceeded',
          429,
        );
      }
    } catch (err) {
      if (err instanceof AgentGatewayError) throw err;
      // Redis unavailable → fail-closed for BYOK routing (IMP-010)
      log.error({ err }, 'Redis unavailable for BYOK quota check — fail-closed');
      throw new AgentGatewayError('BYOK_SERVICE_UNAVAILABLE', 'BYOK quota check unavailable', 503);
    }
  }

  /** Current UTC date string for daily counters (YYYY-MM-DD) */
  private currentDay(): string {
    return new Date().toISOString().slice(0, 10);
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
