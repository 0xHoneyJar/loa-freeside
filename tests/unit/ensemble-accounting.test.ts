/**
 * Ensemble Accounting Unit Tests
 * Cycle 019 Sprint 1, Task 1.1: per-model cost decomposition (MONEY path)
 *
 * Covers computeEnsembleAccounting — the per-model cost attribution that splits
 * an ensemble's spend into platform vs BYOK budget and computes reservation
 * savings. Expected values below are computed directly from the source logic in
 * packages/adapters/agent/ensemble-accounting.ts (filter succeeded → sum by
 * accounting_mode; savings = reserved − total).
 *
 * @see packages/adapters/agent/ensemble-accounting.ts
 * @see SDD §3.3.2 IMP-008 Partial Failure Reconciliation
 */

import { describe, it, expect } from 'vitest';
import { computeEnsembleAccounting } from '../../packages/adapters/agent/ensemble-accounting.js';
import type { ModelInvocationResult } from '../../packages/adapters/agent/ensemble-accounting.js';

// --------------------------------------------------------------------------
// Helper — build a ModelInvocationResult with sane defaults (succeeded,
// platform-budget, zero cost) so each test overrides only the load-bearing
// fields (cost_micro, accounting_mode, succeeded).
// --------------------------------------------------------------------------

function mk(overrides: Partial<ModelInvocationResult> = {}): ModelInvocationResult {
  return {
    model_id: 'm',
    provider: 'anthropic',
    succeeded: true,
    input_tokens: 100,
    output_tokens: 50,
    cost_micro: 0,
    accounting_mode: 'PLATFORM_BUDGET',
    latency_ms: 10,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// (a) All-platform ensemble: platform_cost = sum, byok = 0
// --------------------------------------------------------------------------

describe('all-platform ensemble', () => {
  it('routes every succeeded cost to platform_cost_micro, byok stays 0', () => {
    const results = [
      mk({ model_id: 'p1', cost_micro: 100 }),
      mk({ model_id: 'p2', cost_micro: 150 }),
      mk({ model_id: 'p3', cost_micro: 200 }),
    ];
    const r = computeEnsembleAccounting('best_of_n', results, 600);

    // total = 100 + 150 + 200 = 450 (all succeeded)
    expect(r.total_cost_micro).toBe(450);
    // all PLATFORM_BUDGET → platform = total
    expect(r.platform_cost_micro).toBe(450);
    expect(r.byok_cost_micro).toBe(0);

    expect(r.n_requested).toBe(3);
    expect(r.n_succeeded).toBe(3);
    expect(r.n_failed).toBe(0);
    expect(r.strategy).toBe('best_of_n');
    expect(r.reserved_cost_micro).toBe(600);
    // savings = 600 − 450 = 150
    expect(r.savings_micro).toBe(150);
    // model_breakdown carries every invocation
    expect(r.model_breakdown).toHaveLength(3);
  });
});

// --------------------------------------------------------------------------
// (b) BYOK invocation: cost lands in byok_cost_micro, NOT in platform budget
// --------------------------------------------------------------------------

describe('BYOK accounting isolation', () => {
  it('charges a BYOK invocation to byok_cost_micro and excludes it from platform_cost_micro', () => {
    const results = [
      mk({ model_id: 'p1', cost_micro: 100, accounting_mode: 'PLATFORM_BUDGET' }),
      mk({ model_id: 'p2', cost_micro: 200, accounting_mode: 'PLATFORM_BUDGET' }),
      // A BYOK model that DID incur a cost (300). It must NOT touch the platform budget.
      mk({ model_id: 'byok1', provider: 'openai', cost_micro: 300, accounting_mode: 'BYOK_NO_BUDGET' }),
    ];
    const r = computeEnsembleAccounting('consensus', results, 1000);

    // platform = 100 + 200 = 300 — the 300 BYOK cost is NOT charged to the platform budget
    expect(r.platform_cost_micro).toBe(300);
    // byok = 300 — the BYOK cost is tracked here, separately
    expect(r.byok_cost_micro).toBe(300);
    // total spans both budgets: 100 + 200 + 300 = 600
    expect(r.total_cost_micro).toBe(600);
    // platform + byok partition the total exactly
    expect(r.platform_cost_micro + r.byok_cost_micro).toBe(r.total_cost_micro);
    // savings = reserved − total (source subtracts TOTAL, incl. BYOK): 1000 − 600 = 400
    expect(r.savings_micro).toBe(400);
  });
});

// --------------------------------------------------------------------------
// (c) savings_micro = unused reservation (reserved − total), no clamp
// --------------------------------------------------------------------------

describe('reservation savings', () => {
  it('reports unused reservation as reserved − total', () => {
    const results = [
      mk({ cost_micro: 250 }),
      mk({ cost_micro: 250 }),
    ];
    // total = 500; reserved = 1000 → savings = 500
    const r = computeEnsembleAccounting('best_of_n', results, 1000);
    expect(r.total_cost_micro).toBe(500);
    expect(r.savings_micro).toBe(500);
  });

  it('savings is exactly 0 when spend equals the reservation', () => {
    const results = [mk({ cost_micro: 400 }), mk({ cost_micro: 100 })];
    // total = 500; reserved = 500 → savings = 0
    const r = computeEnsembleAccounting('best_of_n', results, 500);
    expect(r.savings_micro).toBe(0);
  });

  it('does not clamp: over-spend surfaces as negative savings', () => {
    const results = [mk({ cost_micro: 400 }), mk({ cost_micro: 100 })];
    // total = 500; reserved = 400 → savings = 400 − 500 = −100 (source applies no Math.max)
    const r = computeEnsembleAccounting('best_of_n', results, 400);
    expect(r.savings_micro).toBe(-100);
  });
});

// --------------------------------------------------------------------------
// (d) Partial failure (SDD §3.3.2 IMP-008): a failed model's cost is NOT
//     charged — only succeeded invocations count toward total/platform/byok,
//     but the failed entry still appears in model_breakdown and n_failed.
// --------------------------------------------------------------------------

describe('partial failure reconciliation (IMP-008)', () => {
  it('excludes a failed invocation cost from every total but keeps it in the breakdown', () => {
    const results = [
      mk({ model_id: 'p_ok', cost_micro: 100, accounting_mode: 'PLATFORM_BUDGET', succeeded: true }),
      // Failed model reporting a non-zero cost — must be excluded from charges.
      mk({ model_id: 'p_fail', cost_micro: 500, accounting_mode: 'PLATFORM_BUDGET', succeeded: false, error_code: 'TIMEOUT' }),
      mk({ model_id: 'byok_ok', provider: 'openai', cost_micro: 200, accounting_mode: 'BYOK_NO_BUDGET', succeeded: true }),
    ];
    const r = computeEnsembleAccounting('fallback', results, 600);

    // total = 100 + 200 = 300 — NOT 800; the failed 500 is excluded (succeeded filter)
    expect(r.total_cost_micro).toBe(300);
    // platform = 100 (the succeeded platform model only; failed one excluded)
    expect(r.platform_cost_micro).toBe(100);
    expect(r.byok_cost_micro).toBe(200);

    expect(r.n_requested).toBe(3);
    expect(r.n_succeeded).toBe(2);
    expect(r.n_failed).toBe(1);

    // committed (=total) ≤ reserved invariant: 300 ≤ 600
    expect(r.total_cost_micro).toBeLessThanOrEqual(r.reserved_cost_micro);
    // savings = 600 − 300 = 300
    expect(r.savings_micro).toBe(300);

    // The failed entry is still surfaced in the breakdown with its error_code.
    expect(r.model_breakdown).toHaveLength(3);
    const failed = r.model_breakdown.find((m) => m.model_id === 'p_fail');
    expect(failed?.succeeded).toBe(false);
    expect(failed?.error_code).toBe('TIMEOUT');
  });

  it('charges nothing when every model fails; savings = full reservation', () => {
    const results = [
      mk({ model_id: 'f1', cost_micro: 500, succeeded: false, error_code: 'TIMEOUT' }),
      mk({ model_id: 'f2', cost_micro: 500, succeeded: false, error_code: 'RATE_LIMIT' }),
    ];
    const r = computeEnsembleAccounting('consensus', results, 1000);

    expect(r.total_cost_micro).toBe(0);
    expect(r.platform_cost_micro).toBe(0);
    expect(r.byok_cost_micro).toBe(0);
    expect(r.n_succeeded).toBe(0);
    expect(r.n_failed).toBe(2);
    // savings = 1000 − 0 = 1000
    expect(r.savings_micro).toBe(1000);
    expect(r.model_breakdown).toHaveLength(2);
  });
});
