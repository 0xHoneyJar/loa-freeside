/**
 * Unit tests for computeEnsembleAccounting (money path).
 *
 * Surfaced by the Icebreaker meta-loop-builder's evidence loop (2026-06-28): this per-model cost
 * attribution function was asserted in CLAUDE.md + exercised only by an e2e *stub* — no genuine unit
 * test held its money invariants. A cost-accounting function with no meter can drift from correctness
 * with no failure. These tests pin the invariants that matter for money:
 *   - a FAILED invocation is never charged (only succeeded costs sum into the total)
 *   - total == platform + byok (every succeeded model is exactly one accounting mode)
 *   - BYOK costs are segregated from the platform budget
 *   - savings = reserved - total, and goes NEGATIVE on overspend (surfaced, not hidden)
 */
import { describe, it, expect } from 'vitest';
import {
  computeEnsembleAccounting,
  computeHybridMultiplier,
  type ModelInvocationResult,
} from '../../packages/adapters/agent/ensemble-accounting.js';

const model = (over: Partial<ModelInvocationResult>): ModelInvocationResult => ({
  model_id: 'gpt-x',
  provider: 'openai',
  succeeded: true,
  input_tokens: 100,
  output_tokens: 50,
  cost_micro: 1000,
  accounting_mode: 'PLATFORM_BUDGET',
  latency_ms: 200,
  ...over,
});

describe('computeEnsembleAccounting — money path', () => {
  it('charges only SUCCEEDED invocations — a failed model never enters the total', () => {
    const r = computeEnsembleAccounting(
      'best_of_n',
      [model({ cost_micro: 1000, succeeded: true }), model({ cost_micro: 9999, succeeded: false })],
      5000,
    );
    expect(r.total_cost_micro).toBe(1000);
    expect(r.n_succeeded).toBe(1);
    expect(r.n_failed).toBe(1);
  });

  it('the money invariant: total == platform + byok (every succeeded model is one accounting mode)', () => {
    const r = computeEnsembleAccounting(
      'consensus',
      [
        model({ cost_micro: 1000, accounting_mode: 'PLATFORM_BUDGET' }),
        model({ cost_micro: 0, accounting_mode: 'BYOK_NO_BUDGET' }),
        model({ cost_micro: 500, accounting_mode: 'PLATFORM_BUDGET' }),
      ],
      3000,
    );
    expect(r.platform_cost_micro).toBe(1500);
    expect(r.byok_cost_micro).toBe(0);
    expect(r.total_cost_micro).toBe(r.platform_cost_micro + r.byok_cost_micro);
  });

  it('segregates BYOK cost from the platform budget — a BYOK charge never hits platform_cost', () => {
    const r = computeEnsembleAccounting('fallback', [model({ cost_micro: 2000, accounting_mode: 'BYOK_NO_BUDGET' })], 0);
    expect(r.byok_cost_micro).toBe(2000);
    expect(r.platform_cost_micro).toBe(0);
    expect(r.total_cost_micro).toBe(2000);
  });

  it('savings = reserved - total, and goes NEGATIVE on overspend (surfaced)', () => {
    expect(computeEnsembleAccounting('best_of_n', [model({ cost_micro: 1000 })], 5000).savings_micro).toBe(4000);
    expect(computeEnsembleAccounting('best_of_n', [model({ cost_micro: 8000 })], 5000).savings_micro).toBe(-3000);
  });

  it('all-failed ensemble → zero cost, the full reservation is savings', () => {
    const r = computeEnsembleAccounting('consensus', [model({ succeeded: false }), model({ succeeded: false })], 4000);
    expect(r.total_cost_micro).toBe(0);
    expect(r.savings_micro).toBe(4000);
    expect(r.n_succeeded).toBe(0);
    expect(r.n_failed).toBe(2);
  });

  it('model_breakdown carries ALL invocations (succeeded + failed) for attribution', () => {
    const r = computeEnsembleAccounting('best_of_n', [model({ succeeded: true }), model({ succeeded: false })], 1000);
    expect(r.model_breakdown).toHaveLength(2);
    expect(r.n_requested).toBe(2);
  });
});

describe('computeHybridMultiplier', () => {
  it('counts only platform models — BYOK models do not consume the reservation', () => {
    expect(computeHybridMultiplier(['a', 'b', 'c'], (m) => m === 'b')).toBe(2); // a,c platform; b byok
    expect(computeHybridMultiplier(['x'], () => true)).toBe(0); // all byok
    expect(computeHybridMultiplier(['x', 'y'], () => false)).toBe(2); // all platform
  });
});
