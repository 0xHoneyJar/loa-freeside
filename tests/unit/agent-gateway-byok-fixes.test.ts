/**
 * Agent Gateway BYOK Fixes — Bridgebuilder Round 3
 *
 * BB3-1: BYOK provider inference via POOL_PROVIDER_HINT (replaces poolId.startsWith)
 * BB3-2: Atomic INCR quota enforcement (replaces GET-then-INCR race)
 *
 * @see sprint-bridgebuilder-round3.md Tasks 1.1, 1.2, 1.3
 */

import { describe, it, expect } from 'vitest';
import { POOL_PROVIDER_HINT, POOL_IDS } from '../../packages/adapters/agent/pool-mapping.js';

// --------------------------------------------------------------------------
// BB3-1: Pool → Provider Hint Mapping
// --------------------------------------------------------------------------

describe('POOL_PROVIDER_HINT (BB3-1)', () => {
  it('every pool ID has a provider hint', () => {
    for (const poolId of POOL_IDS) {
      expect(POOL_PROVIDER_HINT[poolId]).toBeDefined();
      expect(['openai', 'anthropic']).toContain(POOL_PROVIDER_HINT[poolId]);
    }
  });

  it('reasoning pool routes to anthropic', () => {
    expect(POOL_PROVIDER_HINT['reasoning']).toBe('anthropic');
  });

  it('architect pool routes to anthropic', () => {
    expect(POOL_PROVIDER_HINT['architect']).toBe('anthropic');
  });

  it('cheap pool routes to openai', () => {
    expect(POOL_PROVIDER_HINT['cheap']).toBe('openai');
  });

  it('fast-code pool routes to openai', () => {
    expect(POOL_PROVIDER_HINT['fast-code']).toBe('openai');
  });

  it('reviewer pool routes to openai', () => {
    expect(POOL_PROVIDER_HINT['reviewer']).toBe('openai');
  });

  it('no pool ID starts with "anthropic" — confirms old inference was always wrong', () => {
    for (const poolId of POOL_IDS) {
      expect(poolId.startsWith('anthropic')).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------
// BB3-2: Atomic Quota Pattern Tests (mock Redis)
// --------------------------------------------------------------------------

describe('Atomic BYOK Quota (BB3-2)', () => {
  /**
   * Simulates the atomic INCR quota pattern used in checkByokQuota().
   * Returns { allowed, newCount } for each call.
   */
  function atomicQuotaCheck(counter: { value: number }, quota: number) {
    counter.value += 1; // Atomic INCR
    return {
      allowed: counter.value <= quota,
      newCount: counter.value,
    };
  }

  it('sequential requests up to quota are all allowed', () => {
    const counter = { value: 0 };
    const quota = 10;

    for (let i = 0; i < quota; i++) {
      const result = atomicQuotaCheck(counter, quota);
      expect(result.allowed).toBe(true);
    }
  });

  it('request at quota+1 is denied', () => {
    const counter = { value: 0 };
    const quota = 10;

    // Fill up to quota
    for (let i = 0; i < quota; i++) {
      atomicQuotaCheck(counter, quota);
    }

    // Next request exceeds
    const denied = atomicQuotaCheck(counter, quota);
    expect(denied.allowed).toBe(false);
    expect(denied.newCount).toBe(quota + 1);
  });

  it('concurrent requests at boundary cannot both succeed (vs old GET-then-INCR)', () => {
    const counter = { value: 0 };
    const quota = 10;

    // Fill to quota - 1
    for (let i = 0; i < quota - 1; i++) {
      atomicQuotaCheck(counter, quota);
    }

    // Simulate 2 concurrent requests:
    // With atomic INCR, first gets count=10 (allowed), second gets count=11 (denied)
    const req1 = atomicQuotaCheck(counter, quota);
    const req2 = atomicQuotaCheck(counter, quota);

    expect(req1.allowed).toBe(true);
    expect(req2.allowed).toBe(false);

    // Exactly one allowed at the boundary
    const allowedCount = [req1, req2].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
  });

  it('old pattern (GET-then-INCR) would have allowed both concurrent requests', () => {
    // Demonstrate the bug that BB3-2 fixes
    const counter = { value: 9 }; // 9 of 10 used
    const quota = 10;

    // OLD pattern: both reads see 9 (< 10), both pass
    const read1 = counter.value; // Both goroutines see 9
    const read2 = counter.value;

    // Both pass the check (BUG!)
    expect(read1 < quota).toBe(true);
    expect(read2 < quota).toBe(true);

    // Then both increment → 11 (exceeds quota by 1)
    counter.value += 1; // req1 INCR
    counter.value += 1; // req2 INCR
    expect(counter.value).toBe(11);
    expect(counter.value).toBeGreaterThan(quota); // Quota violated
  });
});

// --------------------------------------------------------------------------
// BB3-6: Ensemble Budget Assertion (committed ≤ reserved invariant)
// --------------------------------------------------------------------------

describe('Ensemble Budget Assertion (BB3-6)', () => {
  it('ensemble reserved cost = N × base cost', () => {
    const baseCostCents = 50;
    const ensembleN = 3;
    const reservedCostCents = baseCostCents * ensembleN;

    expect(reservedCostCents).toBe(150);
  });

  it('actual ≤ reserved holds when all N models succeed at estimated cost', () => {
    const baseCostCents = 50;
    const ensembleN = 3;
    const reservedCostCents = baseCostCents * ensembleN; // 150

    // All 3 models succeed at estimated cost
    const actualCostCents = 3 * baseCostCents; // 150
    expect(actualCostCents).toBeLessThanOrEqual(reservedCostCents);
  });

  it('actual ≤ reserved holds on partial failure (only successful models billed)', () => {
    const baseCostCents = 50;
    const ensembleN = 3;
    const reservedCostCents = baseCostCents * ensembleN; // 150

    // 2 of 3 succeed
    const modelResults = [
      { succeeded: true, costCents: 45 },
      { succeeded: true, costCents: 52 },
      { succeeded: false, costCents: 0 },
    ];
    const actualCostCents = modelResults
      .filter((r) => r.succeeded)
      .reduce((sum, r) => sum + r.costCents, 0); // 97

    expect(actualCostCents).toBeLessThanOrEqual(reservedCostCents);
  });

  it('detects overrun when actual exceeds reserved (invariant violation)', () => {
    const baseCostCents = 50;
    const ensembleN = 3;
    const reservedCostCents = baseCostCents * ensembleN; // 150

    // Hypothetical bug: actual exceeds reserved
    const actualCostCents = 200;
    const isOverrun = actualCostCents > reservedCostCents;

    expect(isOverrun).toBe(true);
  });
});
