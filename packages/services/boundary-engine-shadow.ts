/**
 * Boundary Engine Shadow — Feature-flagged canonical decision engine spike
 *
 * Runs the canonical `evaluateEconomicBoundary()` alongside the existing
 * conservation guard in SHADOW MODE only. The canonical engine never drives
 * decisions — it logs comparison results for equivalence analysis.
 *
 * Feature flag: ENABLE_CANONICAL_BOUNDARY_ENGINE (default: false)
 *
 * Input mapping: grimoires/loa/a2a/boundary-engine-mapping.md
 *
 * Sprint: 5 (Global ID: 347), cycle-039
 * SDD ref: §3.5 — evaluateEconomicBoundary spike
 * PRD ref: FR-5 (Stretch)
 */

import {
  evaluateEconomicBoundary,
} from '@0xhoneyjar/loa-hounfour';

import type {
  TrustLayerSnapshot,
  CapitalLayerSnapshot,
  QualificationCriteria,
  EconomicBoundaryEvaluationResult,
  ReputationStateName,
} from '@0xhoneyjar/loa-hounfour/economy';

import type { ConservationCheckResult } from './conservation-guard.js';

// =============================================================================
// Feature Flag
// =============================================================================

let cachedEngineEnabled: boolean | null = null;

/**
 * Check if the canonical boundary engine is enabled.
 * Cached at first call to avoid process.env read on every check.
 * Default: false — the engine is off unless explicitly enabled.
 */
export function isBoundaryEngineEnabled(): boolean {
  if (cachedEngineEnabled !== null) return cachedEngineEnabled;
  const flag = process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE;
  cachedEngineEnabled = flag === 'true' || flag === '1';
  return cachedEngineEnabled;
}

/** Reset the cached boundary engine flag — for use in tests. */
export function resetBoundaryEngineCache(): void {
  cachedEngineEnabled = null;
}

// =============================================================================
// Types
// =============================================================================

/** Logger interface for boundary engine shadow operations */
export interface BoundaryEngineLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Input context from the conservation guard for boundary engine evaluation */
export interface BoundaryEngineContext {
  /** Community tier (1-9) */
  tier: number;
  /** Redis budget limit (in cents) */
  redisLimitCents: bigint;
  /** Redis committed (in cents) */
  redisCommittedCents: bigint;
  /** Redis reserved (in cents) */
  redisReservedCents: bigint;
  /** Budget month in "YYYY-MM" format */
  month: string;
  /** Community ID */
  communityId: string;
}

/** Comparison result between existing and canonical decisions */
export interface BoundaryEngineComparisonResult {
  /** Existing conservation guard result */
  existingDecision: {
    pass: boolean;
    violationCount: number;
  };
  /** Canonical engine result */
  canonicalDecision: {
    granted: boolean;
    trustPassed: boolean;
    capitalPassed: boolean;
    denialReason?: string;
  };
  /** Whether the two engines agree */
  match: boolean;
  /** Mapping used for the canonical evaluation */
  inputMapping: {
    reputationState: string;
    blendedScore: number;
    budgetRemainingMicroUsd: string;
    billingTier: string;
  };
}

// =============================================================================
// Input Mapping
// =============================================================================

/**
 * Map arrakis integer tier (1-9) to canonical reputation state.
 *
 * Per boundary-engine-mapping.md SS 3.1:
 *   Tier 1-3 (free)       -> 'cold'
 *   Tier 4-6 (pro)        -> 'warming'
 *   Tier 7-8 (enterprise) -> 'established'
 *   Tier 9   (enterprise) -> 'authoritative'
 */
export function mapTierToReputationState(tier: number): ReputationStateName {
  if (tier <= 0) return 'cold';
  if (tier <= 3) return 'cold';
  if (tier <= 6) return 'warming';
  if (tier <= 8) return 'established';
  return 'authoritative';
}

/**
 * Map arrakis integer tier (1-9) to a blended score (0.0-1.0).
 *
 * Linear normalization: tier/9. Lossy mapping — the canonical engine
 * expects a continuous reputation score, but arrakis only has discrete tiers.
 */
export function mapTierToBlendedScore(tier: number): number {
  if (tier <= 0) return 0;
  if (tier >= 9) return 1.0;
  return Math.round((tier / 9) * 100) / 100; // 2 decimal places
}

/**
 * Map arrakis access level to canonical billing tier string.
 */
export function mapTierToBillingTier(tier: number): string {
  if (tier <= 3) return 'free';
  if (tier <= 6) return 'pro';
  return 'enterprise';
}

/**
 * Compute the budget period end from a month string ("YYYY-MM").
 * Returns the start of the next month in ISO 8601 format.
 */
export function computeBudgetPeriodEnd(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNum, 1)); // monthNum is 0-indexed in Date, but our monthNum is 1-indexed, so monthNum here = next month
  return nextMonth.toISOString();
}

/**
 * Convert Redis cents values to micro-USD remaining budget string.
 *
 * Formula: (limit - committed - reserved) * 10_000 (cents to micro-USD)
 * Result is clamped to 0 (no negative budgets in canonical format).
 */
export function computeBudgetRemainingMicroUsd(
  limitCents: bigint,
  committedCents: bigint,
  reservedCents: bigint,
): string {
  const remainingCents = limitCents - committedCents - reservedCents;
  const remainingMicro = remainingCents > 0n
    ? remainingCents * 10_000n
    : 0n;
  return remainingMicro.toString();
}

// =============================================================================
// Default Qualification Criteria
// =============================================================================

/**
 * Default qualification criteria for the spike.
 *
 * These match the implicit thresholds in the conservation guard:
 * - min_trust_score: 0.1 (any tier >= 1 qualifies)
 * - min_reputation_state: 'cold' (lowest tier maps to 'cold')
 * - min_available_budget: '0' (conservation allows 0 remaining without violation, only overspend violates)
 */
export const DEFAULT_QUALIFICATION_CRITERIA: QualificationCriteria = {
  min_trust_score: 0.1,
  min_reputation_state: 'cold',
  min_available_budget: '0',
};

// =============================================================================
// Shadow Evaluation
// =============================================================================

/**
 * Build the canonical TrustLayerSnapshot from arrakis context.
 */
export function buildTrustSnapshot(ctx: BoundaryEngineContext): TrustLayerSnapshot {
  return {
    reputation_state: mapTierToReputationState(ctx.tier),
    blended_score: mapTierToBlendedScore(ctx.tier),
    snapshot_at: new Date().toISOString(),
  };
}

/**
 * Build the canonical CapitalLayerSnapshot from arrakis context.
 */
export function buildCapitalSnapshot(ctx: BoundaryEngineContext): CapitalLayerSnapshot {
  return {
    budget_remaining: computeBudgetRemainingMicroUsd(
      ctx.redisLimitCents,
      ctx.redisCommittedCents,
      ctx.redisReservedCents,
    ),
    billing_tier: mapTierToBillingTier(ctx.tier),
    budget_period_end: computeBudgetPeriodEnd(ctx.month),
  };
}

/**
 * Run the canonical boundary engine in shadow mode and compare with
 * the existing conservation guard result.
 *
 * This function:
 * 1. Maps arrakis inputs to canonical schema
 * 2. Calls evaluateEconomicBoundary()
 * 3. Compares with existing conservation result
 * 4. Logs comparison (never drives decisions)
 *
 * @param existingResult - Result from the existing conservation guard
 * @param ctx - Arrakis context for input mapping
 * @param logger - Logger for comparison output
 * @param criteria - Qualification criteria (defaults to spike defaults)
 * @returns Comparison result for analysis
 */
export function evaluateBoundaryEngineShadow(
  existingResult: ConservationCheckResult,
  ctx: BoundaryEngineContext,
  logger: BoundaryEngineLogger,
  criteria: QualificationCriteria = DEFAULT_QUALIFICATION_CRITERIA,
): BoundaryEngineComparisonResult {
  const trustSnapshot = buildTrustSnapshot(ctx);
  const capitalSnapshot = buildCapitalSnapshot(ctx);
  const evaluatedAt = new Date().toISOString();

  let canonicalResult: EconomicBoundaryEvaluationResult;
  try {
    canonicalResult = evaluateEconomicBoundary(
      trustSnapshot,
      capitalSnapshot,
      criteria,
      evaluatedAt,
    );
  } catch (err) {
    // The canonical engine should never throw (it is total for valid TypeBox inputs),
    // but we catch defensively in shadow mode.
    logger.warn(
      {
        error: err instanceof Error ? err.message : String(err),
        communityId: ctx.communityId,
        tier: ctx.tier,
      },
      'boundary-engine-shadow: canonical engine threw unexpectedly',
    );
    return {
      existingDecision: {
        pass: existingResult.pass,
        violationCount: existingResult.violations.length,
      },
      canonicalDecision: {
        granted: false,
        trustPassed: false,
        capitalPassed: false,
        denialReason: `engine error: ${err instanceof Error ? err.message : String(err)}`,
      },
      match: !existingResult.pass, // if existing also denied, it's a match
      inputMapping: {
        reputationState: trustSnapshot.reputation_state,
        blendedScore: trustSnapshot.blended_score,
        budgetRemainingMicroUsd: capitalSnapshot.budget_remaining,
        billingTier: capitalSnapshot.billing_tier,
      },
    };
  }

  const canonicalGranted = canonicalResult.access_decision.granted;
  const existingPass = existingResult.pass;
  const match = canonicalGranted === existingPass;

  const comparison: BoundaryEngineComparisonResult = {
    existingDecision: {
      pass: existingPass,
      violationCount: existingResult.violations.length,
    },
    canonicalDecision: {
      granted: canonicalGranted,
      trustPassed: canonicalResult.trust_evaluation.passed,
      capitalPassed: canonicalResult.capital_evaluation.passed,
      denialReason: canonicalResult.access_decision.denial_reason,
    },
    match,
    inputMapping: {
      reputationState: trustSnapshot.reputation_state,
      blendedScore: trustSnapshot.blended_score,
      budgetRemainingMicroUsd: capitalSnapshot.budget_remaining,
      billingTier: capitalSnapshot.billing_tier,
    },
  };

  // Log the comparison
  if (match) {
    logger.info(
      {
        communityId: ctx.communityId,
        decision: canonicalGranted ? 'ALLOW' : 'DENY',
        tier: ctx.tier,
        reputationState: trustSnapshot.reputation_state,
        budgetRemainingMicro: capitalSnapshot.budget_remaining,
      },
      'boundary-engine-shadow: canonical and existing AGREE',
    );
  } else {
    logger.warn(
      {
        communityId: ctx.communityId,
        existingPass,
        canonicalGranted,
        tier: ctx.tier,
        reputationState: trustSnapshot.reputation_state,
        blendedScore: trustSnapshot.blended_score,
        budgetRemainingMicro: capitalSnapshot.budget_remaining,
        canonicalDenialReason: canonicalResult.access_decision.denial_reason,
        existingViolations: existingResult.violations.map(v => v.invariant),
        trustEvaluation: canonicalResult.trust_evaluation,
        capitalEvaluation: canonicalResult.capital_evaluation,
      },
      'boundary-engine-shadow: canonical and existing DIVERGE',
    );
  }

  return comparison;
}
