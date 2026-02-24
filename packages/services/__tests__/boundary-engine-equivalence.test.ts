/**
 * Boundary Engine Equivalence Test Suite — 10 Scenarios
 *
 * Verifies that the canonical evaluateEconomicBoundary() produces decisions
 * consistent with the existing conservation guard logic when inputs are mapped
 * through the arrakis→canonical translation layer.
 *
 * Per SDD §6.3 and Sprint Plan Task 5.3 (AC-5.3.1):
 *   1. Sufficient budget, highest tier → ALLOW
 *   2. Sufficient budget, lowest tier → ALLOW (limited pools)
 *   3. Zero budget remaining → DENY
 *   4. Budget below threshold → DENY
 *   5. Invalid tier → DENY
 *   6. Expired conviction → DENY
 *   7. Exact budget boundary (1 micro-USD) → ALLOW
 *   8. Negative budget → DENY
 *   9. Maximum budget → ALLOW
 *  10. Mixed trust dimensions → expected resolution
 *
 * Sprint: 5 (Global ID: 347), cycle-039
 * PRD ref: FR-5 AC-5.2
 */

import { describe, it, expect, afterEach } from 'vitest';

import {
  evaluateEconomicBoundary,
} from '@0xhoneyjar/loa-hounfour';

import type {
  TrustLayerSnapshot,
  CapitalLayerSnapshot,
  QualificationCriteria,
  EconomicBoundaryEvaluationResult,
} from '@0xhoneyjar/loa-hounfour/economy';

import {
  mapTierToReputationState,
  mapTierToBlendedScore,
  mapTierToBillingTier,
  computeBudgetRemainingMicroUsd,
  DEFAULT_QUALIFICATION_CRITERIA,
  evaluateBoundaryEngineShadow,
  isBoundaryEngineEnabled,
} from '../boundary-engine-shadow.js';

import type {
  ConservationCheckResult,
  ConservationViolation,
} from '../conservation-guard.js';

// =============================================================================
// Test Helpers
// =============================================================================

const FIXED_TIMESTAMP = '2026-02-24T00:00:00Z';

/** Build a TrustLayerSnapshot from an arrakis tier */
function trustFromTier(tier: number): TrustLayerSnapshot {
  return {
    reputation_state: mapTierToReputationState(tier),
    blended_score: mapTierToBlendedScore(tier),
    snapshot_at: FIXED_TIMESTAMP,
  };
}

/** Build a CapitalLayerSnapshot from micro-USD budget string */
function capitalFromBudget(budgetMicroUsd: string): CapitalLayerSnapshot {
  return {
    budget_remaining: budgetMicroUsd,
    billing_tier: 'standard',
    budget_period_end: '2026-03-01T00:00:00Z',
  };
}

/** Build criteria with a specific min budget */
function criteriaWithBudget(minBudget: string): QualificationCriteria {
  return {
    min_trust_score: 0.1,
    min_reputation_state: 'cold',
    min_available_budget: minBudget,
  };
}

/** Simulate a conservation check result */
function mockConservationResult(
  pass: boolean,
  violations: ConservationViolation[] = [],
): ConservationCheckResult {
  return {
    pass,
    fenceToken: 1n,
    driftMicro: 0n,
    driftExceeded: false,
    governancePending: false,
    violations,
  };
}

/** No-op logger for tests */
const testLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// =============================================================================
// Input Mapping Tests
// =============================================================================

describe('Boundary Engine Input Mapping', () => {
  describe('mapTierToReputationState', () => {
    it('maps tiers 1-3 to cold', () => {
      expect(mapTierToReputationState(1)).toBe('cold');
      expect(mapTierToReputationState(2)).toBe('cold');
      expect(mapTierToReputationState(3)).toBe('cold');
    });

    it('maps tiers 4-6 to warming', () => {
      expect(mapTierToReputationState(4)).toBe('warming');
      expect(mapTierToReputationState(5)).toBe('warming');
      expect(mapTierToReputationState(6)).toBe('warming');
    });

    it('maps tiers 7-8 to established', () => {
      expect(mapTierToReputationState(7)).toBe('established');
      expect(mapTierToReputationState(8)).toBe('established');
    });

    it('maps tier 9 to authoritative', () => {
      expect(mapTierToReputationState(9)).toBe('authoritative');
    });

    it('maps tier 0 and negatives to cold', () => {
      expect(mapTierToReputationState(0)).toBe('cold');
      expect(mapTierToReputationState(-1)).toBe('cold');
    });
  });

  describe('mapTierToBlendedScore', () => {
    it('maps tier 1 to ~0.11', () => {
      expect(mapTierToBlendedScore(1)).toBeCloseTo(0.11, 2);
    });

    it('maps tier 9 to 1.0', () => {
      expect(mapTierToBlendedScore(9)).toBe(1.0);
    });

    it('maps tier 5 to ~0.56', () => {
      expect(mapTierToBlendedScore(5)).toBeCloseTo(0.56, 2);
    });

    it('clamps tier 0 to 0', () => {
      expect(mapTierToBlendedScore(0)).toBe(0);
    });
  });

  describe('computeBudgetRemainingMicroUsd', () => {
    it('converts cents to micro-USD correctly', () => {
      // 100 cents = $1 = 1,000,000 micro-USD
      expect(computeBudgetRemainingMicroUsd(100n, 0n, 0n)).toBe('1000000');
    });

    it('subtracts committed and reserved', () => {
      // 1000 cents limit, 300 committed, 200 reserved = 500 cents remaining = 5,000,000 micro-USD
      expect(computeBudgetRemainingMicroUsd(1000n, 300n, 200n)).toBe('5000000');
    });

    it('clamps negative remaining to 0', () => {
      // Over-committed: 100 limit, 150 committed, 0 reserved → negative
      expect(computeBudgetRemainingMicroUsd(100n, 150n, 0n)).toBe('0');
    });

    it('handles zero budget', () => {
      expect(computeBudgetRemainingMicroUsd(0n, 0n, 0n)).toBe('0');
    });
  });

  describe('mapTierToBillingTier', () => {
    it('maps tiers 1-3 to free', () => {
      expect(mapTierToBillingTier(1)).toBe('free');
      expect(mapTierToBillingTier(3)).toBe('free');
    });

    it('maps tiers 4-6 to pro', () => {
      expect(mapTierToBillingTier(4)).toBe('pro');
      expect(mapTierToBillingTier(6)).toBe('pro');
    });

    it('maps tiers 7-9 to enterprise', () => {
      expect(mapTierToBillingTier(7)).toBe('enterprise');
      expect(mapTierToBillingTier(9)).toBe('enterprise');
    });
  });
});

// =============================================================================
// Feature Flag Tests
// =============================================================================

describe('Boundary Engine Feature Flag', () => {
  const originalEnv = process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = originalEnv;
    } else {
      delete process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE;
    }
  });

  it('defaults to false when not set', () => {
    delete process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE;
    expect(isBoundaryEngineEnabled()).toBe(false);
  });

  it('returns true when set to "true"', () => {
    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = 'true';
    expect(isBoundaryEngineEnabled()).toBe(true);
  });

  it('returns true when set to "1"', () => {
    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = '1';
    expect(isBoundaryEngineEnabled()).toBe(true);
  });

  it('returns false for any other value', () => {
    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = 'false';
    expect(isBoundaryEngineEnabled()).toBe(false);

    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = '0';
    expect(isBoundaryEngineEnabled()).toBe(false);

    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE = 'yes';
    expect(isBoundaryEngineEnabled()).toBe(false);
  });
});

// =============================================================================
// Equivalence Test Suite — 10 Scenarios (SDD §6.3)
// =============================================================================

describe('Boundary Engine Equivalence — 10 Scenarios', () => {
  // Default criteria for most scenarios: very permissive (spike defaults)
  const defaultCriteria: QualificationCriteria = {
    min_trust_score: 0.1,
    min_reputation_state: 'cold',
    min_available_budget: '10000000', // 10M micro-USD = $10
  };

  // Scenario 1: Sufficient budget, highest tier → ALLOW
  it('Scenario 1: sufficient budget, highest tier → ALLOW', () => {
    const trust = trustFromTier(9); // authoritative, score 1.0
    const capital = capitalFromBudget('50000000'); // $50 in micro-USD

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(true);
    expect(result.trust_evaluation.passed).toBe(true);
    expect(result.capital_evaluation.passed).toBe(true);
    expect(result.trust_evaluation.actual_state).toBe('authoritative');
    expect(result.trust_evaluation.actual_score).toBe(1.0);
  });

  // Scenario 2: Sufficient budget, lowest tier → ALLOW (limited pools)
  it('Scenario 2: sufficient budget, lowest tier → ALLOW', () => {
    const trust = trustFromTier(1); // cold, score ~0.11
    const capital = capitalFromBudget('50000000'); // $50

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(true);
    expect(result.trust_evaluation.passed).toBe(true);
    expect(result.capital_evaluation.passed).toBe(true);
    // Trust state is 'cold' but criteria only requires 'cold' minimum
    expect(result.trust_evaluation.actual_state).toBe('cold');
  });

  // Scenario 3: Zero budget remaining → DENY
  it('Scenario 3: zero budget remaining → DENY', () => {
    const trust = trustFromTier(9); // highest tier
    const capital = capitalFromBudget('0'); // zero budget

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.trust_evaluation.passed).toBe(true);
    expect(result.capital_evaluation.passed).toBe(false);
    expect(result.capital_evaluation.actual_budget).toBe('0');
  });

  // Scenario 4: Budget below threshold → DENY
  it('Scenario 4: budget below threshold → DENY', () => {
    const trust = trustFromTier(5); // warming, moderate tier
    const capital = capitalFromBudget('5000000'); // $5 — below $10 threshold

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.capital_evaluation.passed).toBe(false);
    expect(result.capital_evaluation.actual_budget).toBe('5000000');
    expect(result.capital_evaluation.required_budget).toBe('10000000');
  });

  // Scenario 5: Invalid tier → DENY
  //
  // Note: An invalid tier (e.g., 0) maps to reputation_state='cold' and
  // blended_score=0. With criteria requiring min_trust_score=0.1, this
  // is denied because score 0 < required 0.1.
  it('Scenario 5: invalid tier (0) → DENY due to zero trust score', () => {
    const trust = trustFromTier(0); // maps to cold, score 0
    const capital = capitalFromBudget('50000000'); // sufficient budget

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.trust_evaluation.passed).toBe(false);
    expect(result.trust_evaluation.actual_score).toBe(0);
  });

  // Scenario 6: Expired conviction → DENY
  //
  // "Expired conviction" maps to an unknown reputation state in the canonical
  // engine. The engine fails closed on unknown states.
  it('Scenario 6: unknown reputation state → DENY (fail-closed)', () => {
    // Directly construct a trust snapshot with unknown state to test fail-closed
    const trust: TrustLayerSnapshot = {
      reputation_state: 'legendary' as any, // unknown state
      blended_score: 0.99,
      snapshot_at: FIXED_TIMESTAMP,
    };
    const capital = capitalFromBudget('999999999');

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.trust_evaluation.passed).toBe(false);
  });

  // Scenario 7: Exact budget boundary (1 micro-USD above threshold) → ALLOW
  it('Scenario 7: exact budget boundary (at threshold) → ALLOW', () => {
    const trust = trustFromTier(5);
    const capital = capitalFromBudget('10000000'); // exactly at threshold

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    // Canonical engine uses >= semantics per threshold-exact.json vector
    expect(result.access_decision.granted).toBe(true);
    expect(result.capital_evaluation.passed).toBe(true);
    expect(result.capital_evaluation.actual_budget).toBe('10000000');
    expect(result.capital_evaluation.required_budget).toBe('10000000');
  });

  // Scenario 8: Negative budget → DENY
  //
  // Note: computeBudgetRemainingMicroUsd clamps negative to '0', so the
  // canonical engine sees '0' which is below the threshold.
  it('Scenario 8: negative budget (clamped to 0) → DENY', () => {
    // Simulate over-committed Redis state
    const budgetMicro = computeBudgetRemainingMicroUsd(100n, 200n, 0n);
    expect(budgetMicro).toBe('0'); // clamped

    const trust = trustFromTier(5);
    const capital = capitalFromBudget(budgetMicro);

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.capital_evaluation.passed).toBe(false);
  });

  // Scenario 9: Maximum budget → ALLOW
  it('Scenario 9: maximum budget (BigInt > MAX_SAFE_INTEGER) → ALLOW', () => {
    const trust = trustFromTier(9);
    const capital = capitalFromBudget('99999999999999999999'); // > 2^53

    const result = evaluateEconomicBoundary(
      trust, capital, defaultCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(true);
    expect(result.capital_evaluation.passed).toBe(true);
    expect(result.capital_evaluation.actual_budget).toBe('99999999999999999999');
  });

  // Scenario 10: Mixed trust dimensions → expected resolution
  //
  // High conviction (tier 7→established, score ~0.78) but strict criteria
  // that require 'authoritative'. Trust state fails, even though score passes.
  it('Scenario 10: high trust score but insufficient reputation state → DENY', () => {
    const trust = trustFromTier(7); // established, score ~0.78
    const capital = capitalFromBudget('50000000');

    const strictCriteria: QualificationCriteria = {
      min_trust_score: 0.5,           // passes (0.78 >= 0.5)
      min_reputation_state: 'authoritative', // fails (established < authoritative)
      min_available_budget: '10000000',
    };

    const result = evaluateEconomicBoundary(
      trust, capital, strictCriteria, FIXED_TIMESTAMP,
    );

    expect(result.access_decision.granted).toBe(false);
    expect(result.trust_evaluation.passed).toBe(false);
    // Score check passes but state check fails — trust overall fails
    expect(result.trust_evaluation.actual_state).toBe('established');
    expect(result.trust_evaluation.required_state).toBe('authoritative');
  });
});

// =============================================================================
// Shadow Comparison Integration Tests
// =============================================================================

describe('Boundary Engine Shadow Comparison', () => {
  it('reports MATCH when both engines agree on ALLOW', () => {
    const existingResult = mockConservationResult(true);
    const ctx = {
      tier: 9,
      redisLimitCents: 10000n, // $100
      redisCommittedCents: 100n,
      redisReservedCents: 0n,
      month: '2026-02',
      communityId: 'test-community-1',
    };

    const comparison = evaluateBoundaryEngineShadow(
      existingResult,
      ctx,
      testLogger,
      DEFAULT_QUALIFICATION_CRITERIA,
    );

    expect(comparison.match).toBe(true);
    expect(comparison.existingDecision.pass).toBe(true);
    expect(comparison.canonicalDecision.granted).toBe(true);
    expect(comparison.inputMapping.reputationState).toBe('authoritative');
  });

  it('reports MATCH when both engines agree on DENY', () => {
    const existingResult = mockConservationResult(false, [
      { invariant: 'I-1', expected: 'ok', actual: 'overspend', severity: 'critical' },
    ]);
    const ctx = {
      tier: 1,
      redisLimitCents: 0n, // zero budget
      redisCommittedCents: 0n,
      redisReservedCents: 0n,
      month: '2026-02',
      communityId: 'test-community-2',
    };

    // Use criteria that requires some budget
    const criteria: QualificationCriteria = {
      min_trust_score: 0.1,
      min_reputation_state: 'cold',
      min_available_budget: '10000000',
    };

    const comparison = evaluateBoundaryEngineShadow(
      existingResult,
      ctx,
      testLogger,
      criteria,
    );

    expect(comparison.match).toBe(true);
    expect(comparison.existingDecision.pass).toBe(false);
    expect(comparison.canonicalDecision.granted).toBe(false);
  });

  it('reports DIVERGE when engines disagree', () => {
    // Existing says PASS (conservation OK), but canonical will DENY (budget below criteria)
    const existingResult = mockConservationResult(true);
    const ctx = {
      tier: 5,
      redisLimitCents: 50n, // only $0.50 = 500,000 micro-USD
      redisCommittedCents: 0n,
      redisReservedCents: 0n,
      month: '2026-02',
      communityId: 'test-community-3',
    };

    // Criteria requires $10 minimum
    const criteria: QualificationCriteria = {
      min_trust_score: 0.1,
      min_reputation_state: 'cold',
      min_available_budget: '10000000',
    };

    const comparison = evaluateBoundaryEngineShadow(
      existingResult,
      ctx,
      testLogger,
      criteria,
    );

    expect(comparison.match).toBe(false);
    expect(comparison.existingDecision.pass).toBe(true);
    expect(comparison.canonicalDecision.granted).toBe(false);
  });

  it('always returns existing result (shadow mode never drives decisions)', () => {
    // The function returns a comparison, not a decision.
    // The conservation guard's result is what drives the actual decision.
    const existingResult = mockConservationResult(true);
    const ctx = {
      tier: 9,
      redisLimitCents: 10000n,
      redisCommittedCents: 0n,
      redisReservedCents: 0n,
      month: '2026-02',
      communityId: 'test-community-4',
    };

    const comparison = evaluateBoundaryEngineShadow(
      existingResult,
      ctx,
      testLogger,
    );

    // The comparison describes both sides but the existing result is unchanged
    expect(comparison.existingDecision.pass).toBe(existingResult.pass);
  });
});
