/**
 * Ensemble Mapper Unit Tests
 * Sprint 2, Task 2.1: Tier gating, n/quorum clamping, budget multiplier, partial failure
 *
 * @see SDD §3.3.1 Ensemble Mapper
 * @see SDD §3.3.2 IMP-008 Partial Failure Reconciliation
 */

import { describe, it, expect } from 'vitest';
import { EnsembleMapper } from '../../packages/adapters/agent/ensemble-mapper.js';
import type { EnsembleRequest, EnsembleValidationResult, EnsembleValidationError } from '../../packages/adapters/agent/ensemble-mapper.js';

const mapper = new EnsembleMapper();

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function expectValid(result: ReturnType<EnsembleMapper['validate']>): EnsembleValidationResult {
  expect(result.valid).toBe(true);
  return result as EnsembleValidationResult;
}

function expectError(result: ReturnType<EnsembleMapper['validate']>): EnsembleValidationError {
  expect(result.valid).toBe(false);
  return result as EnsembleValidationError;
}

// --------------------------------------------------------------------------
// AC-3.4: Free tier → 400 error
// --------------------------------------------------------------------------

describe('tier gating', () => {
  it('rejects free tier with 400 ENSEMBLE_NOT_AVAILABLE', () => {
    const result = expectError(
      mapper.validate({ strategy: 'best_of_n' }, 'free'),
    );
    expect(result.statusCode).toBe(400);
    expect(result.code).toBe('ENSEMBLE_NOT_AVAILABLE');
  });

  it('allows pro tier', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n' }, 'pro'),
    );
    expect(result.request.strategy).toBe('best_of_n');
  });

  it('allows enterprise tier', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus' }, 'enterprise'),
    );
    expect(result.request.strategy).toBe('consensus');
  });
});

// --------------------------------------------------------------------------
// AC-3.6: n/quorum clamped to tier maximums
// --------------------------------------------------------------------------

describe('n/quorum clamping', () => {
  it('clamps n to pro maxN=3', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 10 }, 'pro'),
    );
    expect(result.request.n).toBe(3);
  });

  it('clamps n to enterprise maxN=5', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 10 }, 'enterprise'),
    );
    expect(result.request.n).toBe(5);
  });

  it('enforces minimum n=2', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 1 }, 'pro'),
    );
    expect(result.request.n).toBe(2);
  });

  it('defaults n to 2 when not specified', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'fallback' }, 'pro'),
    );
    expect(result.request.n).toBe(2);
  });

  it('derives n from models array length', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', models: ['a', 'b', 'c'] }, 'pro'),
    );
    expect(result.request.n).toBe(3);
  });

  it('clamps quorum to tier maximum for consensus', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus', n: 3, quorum: 10 }, 'pro'),
    );
    // quorum clamped to maxQuorum=3, then clamped to n=3
    expect(result.request.quorum).toBe(3);
  });

  it('defaults quorum to majority for consensus', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus', n: 3 }, 'pro'),
    );
    // majority of 3 = ceil(3/2) + 1 = 3, clamped to min(3, maxQuorum=3) = 3
    expect(result.request.quorum).toBe(3);
  });

  it('enforces minimum quorum=2 for consensus', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus', n: 2, quorum: 1 }, 'pro'),
    );
    expect(result.request.quorum).toBe(2);
  });

  it('does not set quorum for non-consensus strategies', () => {
    const bestOfN = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 3 }, 'pro'),
    );
    expect(bestOfN.request.quorum).toBeUndefined();

    const fallback = expectValid(
      mapper.validate({ strategy: 'fallback', n: 3 }, 'pro'),
    );
    expect(fallback.request.quorum).toBeUndefined();
  });

  it('slices models array to match clamped n', () => {
    const result = expectValid(
      mapper.validate(
        { strategy: 'best_of_n', models: ['a', 'b', 'c', 'd', 'e'] },
        'pro', // maxN=3
      ),
    );
    expect(result.request.models).toEqual(['a', 'b', 'c']);
    expect(result.request.n).toBe(3);
  });
});

// --------------------------------------------------------------------------
// AC-3.7: Unit tests for each strategy + tier gating + clamping
// --------------------------------------------------------------------------

describe('strategy validation', () => {
  it('validates best_of_n strategy', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 3 }, 'pro'),
    );
    expect(result.jwtClaims.ensemble_strategy).toBe('best_of_n');
    expect(result.jwtClaims.ensemble_n).toBe(3);
    expect(result.jwtClaims.ensemble_quorum).toBeUndefined();
  });

  it('validates consensus strategy with quorum', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus', n: 3, quorum: 2 }, 'pro'),
    );
    expect(result.jwtClaims.ensemble_strategy).toBe('consensus');
    expect(result.jwtClaims.ensemble_n).toBe(3);
    expect(result.jwtClaims.ensemble_quorum).toBe(2);
  });

  it('validates fallback strategy', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'fallback', n: 3 }, 'enterprise'),
    );
    expect(result.jwtClaims.ensemble_strategy).toBe('fallback');
    expect(result.jwtClaims.ensemble_n).toBe(3);
  });

  it('includes models in JWT claims when provided', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', models: ['a', 'b'] }, 'pro'),
    );
    expect(result.jwtClaims.ensemble_models).toEqual(['a', 'b']);
  });

  it('excludes models from JWT claims when not provided', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 2 }, 'pro'),
    );
    expect(result.jwtClaims.ensemble_models).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// AC-3.8: Budget multiplier = N for each strategy
// --------------------------------------------------------------------------

describe('budget multiplier', () => {
  it('sets multiplier = N for best_of_n', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 3 }, 'pro'),
    );
    expect(result.budgetMultiplier).toBe(3);
  });

  it('sets multiplier = N for consensus', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'consensus', n: 3 }, 'pro'),
    );
    expect(result.budgetMultiplier).toBe(3);
  });

  it('sets multiplier = N for fallback (worst-case)', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'fallback', n: 3 }, 'pro'),
    );
    expect(result.budgetMultiplier).toBe(3);
  });

  it('multiplier matches enterprise maxN when clamped', () => {
    const result = expectValid(
      mapper.validate({ strategy: 'best_of_n', n: 10 }, 'enterprise'),
    );
    expect(result.budgetMultiplier).toBe(5);
    expect(result.request.n).toBe(5);
  });
});

// --------------------------------------------------------------------------
// AC-3.9: committed ≤ reserved under partial failure (1 of N fails)
// --------------------------------------------------------------------------

describe('partial failure reconciliation', () => {
  it('computes committed cost from successful models only', () => {
    const committed = mapper.computePartialCost([
      { succeeded: true, costCents: 100 },
      { succeeded: false, costCents: 0 },
      { succeeded: true, costCents: 120 },
    ]);
    expect(committed).toBe(220);
  });

  it('committed ≤ reserved when 1 of N fails', () => {
    const n = 3;
    const estimatedCostPerModel = 150;
    const reserved = n * estimatedCostPerModel; // 450

    const committed = mapper.computePartialCost([
      { succeeded: true, costCents: 140 },
      { succeeded: false, costCents: 0 },
      { succeeded: true, costCents: 130 },
    ]);

    expect(committed).toBeLessThanOrEqual(reserved);
    expect(committed).toBe(270);
  });

  it('committed = 0 when all models fail', () => {
    const committed = mapper.computePartialCost([
      { succeeded: false, costCents: 0 },
      { succeeded: false, costCents: 0 },
      { succeeded: false, costCents: 0 },
    ]);
    expect(committed).toBe(0);
  });

  it('committed = sum of all costs when all succeed', () => {
    const committed = mapper.computePartialCost([
      { succeeded: true, costCents: 100 },
      { succeeded: true, costCents: 110 },
      { succeeded: true, costCents: 105 },
    ]);
    expect(committed).toBe(315);
  });
});

// --------------------------------------------------------------------------
// AC-3.10: committed ≤ reserved under stream abort mid-ensemble
// --------------------------------------------------------------------------

describe('stream abort reconciliation', () => {
  it('committed includes partial token costs on abort', () => {
    // Stream abort: models may have consumed partial tokens before abort
    const committed = mapper.computePartialCost([
      { succeeded: true, costCents: 50 },  // completed before abort
      { succeeded: true, costCents: 20 },  // partial tokens consumed
      { succeeded: false, costCents: 0 },  // never started
    ]);

    const reserved = 3 * 150; // N=3, estimated 150 each
    expect(committed).toBeLessThanOrEqual(reserved);
    expect(committed).toBe(70);
  });

  it('committed ≤ reserved invariant holds with maximum single-model cost', () => {
    const n = 5;
    const estimatedCostPerModel = 200;
    const reserved = n * estimatedCostPerModel; // 1000

    // Worst case: all models succeed at maximum cost
    const committed = mapper.computePartialCost([
      { succeeded: true, costCents: 200 },
      { succeeded: true, costCents: 200 },
      { succeeded: true, costCents: 200 },
      { succeeded: true, costCents: 200 },
      { succeeded: true, costCents: 200 },
    ]);

    expect(committed).toBeLessThanOrEqual(reserved);
    expect(committed).toBe(1000);
  });
});
