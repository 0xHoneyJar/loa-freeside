/**
 * Ensemble Mapper — Multi-Model Strategy Validation
 * Sprint 2, Task 2.1: Tier gating, n/quorum clamping, budget multiplier
 *
 * Validates ensemble requests against tier limits and produces JWT claims
 * for loa-finn's ensemble orchestrator.
 *
 * @see SDD §3.3.1 Ensemble Mapper
 * @see PRD FR-3 Ensemble Orchestration
 */

import type { AccessLevel } from '@arrakis/core/ports';
import type { ModelInvocationResult } from './ensemble-accounting.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type EnsembleStrategy = 'best_of_n' | 'consensus' | 'fallback';

export interface EnsembleRequest {
  strategy: EnsembleStrategy;
  models?: string[];
  n?: number;
  quorum?: number;
}

export interface EnsembleValidationResult {
  valid: true;
  request: EnsembleRequest;
  budgetMultiplier: number;
  jwtClaims: {
    ensemble_strategy: string;
    ensemble_n: number;
    ensemble_quorum?: number;
    ensemble_models?: string[];
  };
}

export interface EnsembleValidationError {
  valid: false;
  code: string;
  message: string;
  statusCode: number;
}

export type EnsembleResult = EnsembleValidationResult | EnsembleValidationError;

// --------------------------------------------------------------------------
// Tier Limits
// --------------------------------------------------------------------------

interface TierEnsembleLimits {
  allowed: boolean;
  maxN: number;
  maxQuorum: number;
}

const TIER_LIMITS: Record<AccessLevel, TierEnsembleLimits> = {
  free:       { allowed: false, maxN: 0, maxQuorum: 0 },
  pro:        { allowed: true,  maxN: 3, maxQuorum: 3 },
  enterprise: { allowed: true,  maxN: 5, maxQuorum: 5 },
};

// --------------------------------------------------------------------------
// Ensemble Mapper
// --------------------------------------------------------------------------

export class EnsembleMapper {
  /**
   * Validate an ensemble request against tier limits.
   *
   * - free tier → 400 ENSEMBLE_NOT_AVAILABLE
   * - n/quorum clamped to tier maximums
   * - Budget multiplier = N for all strategies (worst-case reservation)
   */
  validate(
    ensemble: EnsembleRequest,
    accessLevel: AccessLevel,
  ): EnsembleResult {
    const limits = TIER_LIMITS[accessLevel];

    // Tier gating: free tier cannot use ensemble
    if (!limits.allowed) {
      return {
        valid: false,
        code: 'ENSEMBLE_NOT_AVAILABLE',
        message: 'Ensemble orchestration is not available for your tier',
        statusCode: 400,
      };
    }

    // Determine N — from explicit n, models array length, or default 2
    let n = ensemble.n ?? ensemble.models?.length ?? 2;

    // Clamp to tier maximum
    n = Math.min(n, limits.maxN);
    n = Math.max(n, 2); // Minimum 2 for any ensemble strategy

    // Clamp quorum (only meaningful for consensus strategy)
    let quorum: number | undefined;
    if (ensemble.strategy === 'consensus') {
      quorum = ensemble.quorum ?? Math.ceil(n / 2) + 1; // Default: majority
      quorum = Math.min(quorum, limits.maxQuorum);
      quorum = Math.min(quorum, n); // quorum cannot exceed n
      quorum = Math.max(quorum, 2); // Minimum quorum of 2
    }

    // Budget multiplier for initial reservation:
    // best_of_n: N× (parallel — all run simultaneously)
    // consensus: N× (parallel — all run simultaneously)
    // fallback: 1× (incremental — reserve more per failed attempt, AC-4.1)
    const budgetMultiplier = ensemble.strategy === 'fallback' ? 1 : n;

    // Validate models array length matches n
    const models = ensemble.models?.slice(0, n);

    return {
      valid: true,
      request: {
        ...ensemble,
        n,
        quorum,
        models,
      },
      budgetMultiplier,
      jwtClaims: {
        ensemble_strategy: ensemble.strategy,
        ensemble_n: n,
        ...(quorum != null ? { ensemble_quorum: quorum } : {}),
        ...(models?.length ? { ensemble_models: models } : {}),
      },
    };
  }

  /**
   * Compute committed cost from partial ensemble results.
   * Only successful model invocations contribute to the committed total.
   *
   * Invariant: committed ≤ reserved (= N × estimatedCost) always holds
   * because each individual cost ≤ estimatedCost by design.
   *
   * @see SDD §3.3.2 IMP-008: Partial Failure Reconciliation
   */
  computePartialCost(
    results: ReadonlyArray<{ succeeded: boolean; costCents: number }>,
  ): number {
    return results
      .filter((r) => r.succeeded)
      .reduce((sum, r) => sum + r.costCents, 0);
  }

  /**
   * Compute per-model partial cost with breakdown by accounting mode.
   * Returns platform-only committed cost (for budget finalization) plus full breakdown.
   *
   * @see cycle-019 BB6 Finding #6 — per-model ensemble accounting
   */
  computePartialCostWithBreakdown(
    results: ReadonlyArray<ModelInvocationResult>,
  ): { platformCostMicro: number; totalCostMicro: number; breakdown: ModelInvocationResult[] } {
    const succeeded = results.filter((r) => r.succeeded);
    const platformCostMicro = succeeded
      .filter((r) => r.accounting_mode === 'PLATFORM_BUDGET')
      .reduce((sum, r) => sum + r.cost_micro, 0);
    const totalCostMicro = succeeded.reduce((sum, r) => sum + r.cost_micro, 0);

    return { platformCostMicro, totalCostMicro, breakdown: [...results] };
  }

  /**
   * Compute budget multiplier for hybrid BYOK/platform ensembles.
   * Only PLATFORM_BUDGET models count toward the reservation.
   *
   * @param totalN - Total number of models in ensemble
   * @param byokModelCount - Number of models using BYOK keys
   * @returns Multiplier for budget reservation (platform models only)
   */
  computeHybridMultiplier(totalN: number, byokModelCount: number): number {
    const platformCount = totalN - byokModelCount;
    return Math.max(platformCount, 0);
  }

  /**
   * Compute incremental reservation for fallback strategy (AC-4.1–AC-4.4).
   *
   * Fallback: reserve 1× initially, add 1× per failed platform attempt.
   * BYOK attempts skip reservation (cost 0 for platform budget).
   * best_of_n / consensus: return 0 (they use N× upfront, no incremental).
   *
   * Invariant: total reserved never exceeds platformModelCount × baseCost.
   *
   * @param strategy - Ensemble strategy
   * @param attemptNumber - 1-indexed, counts only platform model attempts
   * @param platformModelCount - Number of non-BYOK models in ensemble
   * @param baseCost - Estimated cost for a single model invocation
   * @param accountingMode - Whether current attempt is platform or BYOK
   */
  computeIncrementalReservation(
    strategy: EnsembleStrategy,
    attemptNumber: number,
    platformModelCount: number,
    baseCost: number,
    accountingMode: 'PLATFORM_BUDGET' | 'BYOK_NO_BUDGET',
  ): { reserveAdditional: number; releaseCapacity: number } {
    // Only fallback uses incremental reservation (AC-4.5)
    if (strategy !== 'fallback') {
      return { reserveAdditional: 0, releaseCapacity: 0 };
    }

    // BYOK attempts don't affect platform budget reservation (AC-4.22/AC-4.23)
    if (accountingMode === 'BYOK_NO_BUDGET') {
      return { reserveAdditional: 0, releaseCapacity: 0 };
    }

    // First platform attempt: reserve 1×
    // Subsequent platform attempts: reserve 1× additional
    // Invariant: attemptNumber × baseCost ≤ platformModelCount × baseCost (AC-4.4)
    const clampedAttempt = Math.min(attemptNumber, platformModelCount);
    const reserveAdditional = clampedAttempt === attemptNumber ? baseCost : 0;

    // Release capacity when attempt succeeds (called separately)
    // Here we calculate what WOULD be released if this attempt succeeds
    const remainingAfterSuccess = platformModelCount - clampedAttempt;
    const releaseCapacity = remainingAfterSuccess * baseCost;

    return { reserveAdditional, releaseCapacity };
  }
}
