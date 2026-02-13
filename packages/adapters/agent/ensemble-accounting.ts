/**
 * Ensemble Accounting — Per-Model Cost Attribution
 * Cycle 019 Sprint 1, Task 1.1: ModelInvocationResult + EnsembleAccountingResult
 *
 * Decomposes ensemble cost to per-model granularity, supporting hybrid
 * BYOK/platform accounting within a single ensemble request.
 *
 * @see Bridgebuilder Round 6, Finding #6 — Ensemble Budget
 * @see SDD §3.3.2 IMP-008: Partial Failure Reconciliation
 */

// Re-define locally to avoid circular dependency with @arrakis/core/ports during TS resolution
type EnsembleStrategy = 'best_of_n' | 'consensus' | 'fallback';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Accounting mode for a single model invocation within an ensemble */
export type AccountingMode = 'PLATFORM_BUDGET' | 'BYOK_NO_BUDGET';

/**
 * Per-model invocation result within an ensemble.
 * Each model in the ensemble produces one of these, regardless of success/failure.
 */
export interface ModelInvocationResult {
  /** Pool ID or model alias used for this invocation */
  model_id: string;
  /** Provider that handled this invocation */
  provider: 'openai' | 'anthropic';
  /** Whether this model invocation completed successfully */
  succeeded: boolean;
  /** Input tokens consumed by this model */
  input_tokens: number;
  /** Output tokens produced by this model */
  output_tokens: number;
  /** Cost in micro-USD for this model (0 for BYOK) */
  cost_micro: number;
  /** How this model's cost is accounted */
  accounting_mode: AccountingMode;
  /** Per-model latency in milliseconds */
  latency_ms: number;
  /** Error code if the invocation failed */
  error_code?: string;
}

/**
 * Aggregate accounting result for an entire ensemble request.
 * Computed from the individual ModelInvocationResult entries.
 */
export interface EnsembleAccountingResult {
  /** Ensemble strategy used */
  strategy: EnsembleStrategy;
  /** Number of models requested */
  n_requested: number;
  /** Number of models that succeeded */
  n_succeeded: number;
  /** Number of models that failed */
  n_failed: number;
  /** Per-model breakdown of all invocations */
  model_breakdown: ModelInvocationResult[];
  /** Sum of succeeded model costs (micro-USD) */
  total_cost_micro: number;
  /** Sum of PLATFORM_BUDGET costs only (micro-USD) */
  platform_cost_micro: number;
  /** Sum of BYOK_NO_BUDGET costs only (micro-USD) */
  byok_cost_micro: number;
  /** Original reservation amount (micro-USD) */
  reserved_cost_micro: number;
  /** Unused reservation capacity: reserved - total (micro-USD) */
  savings_micro: number;
}

// --------------------------------------------------------------------------
// Computation
// --------------------------------------------------------------------------

/**
 * Build an EnsembleAccountingResult from individual model results.
 *
 * @param strategy - Ensemble strategy used
 * @param results - Per-model invocation results
 * @param reservedCostMicro - Original budget reservation in micro-USD
 */
export function computeEnsembleAccounting(
  strategy: EnsembleStrategy,
  results: ModelInvocationResult[],
  reservedCostMicro: number,
): EnsembleAccountingResult {
  const succeeded = results.filter((r) => r.succeeded);
  const failed = results.filter((r) => !r.succeeded);

  const totalCostMicro = succeeded.reduce((sum, r) => sum + r.cost_micro, 0);
  const platformCostMicro = succeeded
    .filter((r) => r.accounting_mode === 'PLATFORM_BUDGET')
    .reduce((sum, r) => sum + r.cost_micro, 0);
  const byokCostMicro = succeeded
    .filter((r) => r.accounting_mode === 'BYOK_NO_BUDGET')
    .reduce((sum, r) => sum + r.cost_micro, 0);

  return {
    strategy,
    n_requested: results.length,
    n_succeeded: succeeded.length,
    n_failed: failed.length,
    model_breakdown: results,
    total_cost_micro: totalCostMicro,
    platform_cost_micro: platformCostMicro,
    byok_cost_micro: byokCostMicro,
    reserved_cost_micro: reservedCostMicro,
    savings_micro: reservedCostMicro - totalCostMicro,
  };
}

/**
 * Compute the budget multiplier for an ensemble with mixed BYOK/platform models.
 * Only PLATFORM_BUDGET models count toward the reservation multiplier.
 *
 * @param models - Array of model IDs in the ensemble
 * @param isByokModel - Predicate: returns true if a model will use BYOK accounting
 * @returns Number of platform models (the reservation multiplier)
 */
export function computeHybridMultiplier(
  models: string[],
  isByokModel: (modelId: string) => boolean,
): number {
  const platformCount = models.filter((m) => !isByokModel(m)).length;
  // At least 1 to avoid zero-reservation edge case
  return Math.max(platformCount, 0);
}
