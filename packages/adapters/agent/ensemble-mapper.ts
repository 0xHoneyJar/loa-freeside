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

    // Budget multiplier: reserve N × base cost for all strategies
    // best_of_n: N parallel calls
    // consensus: N parallel calls
    // fallback: worst-case all N models tried sequentially
    const budgetMultiplier = n;

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
}
