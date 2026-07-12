import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditOutputSchema, CohortCountSchema } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

function output(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'audit-output.valid.json'), 'utf-8'));
}
function recordFixture(): unknown {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'access-decision-record.valid.json'), 'utf-8'),
  );
}

describe('AuditOutputSchema', () => {
  it('accepts a valid aggregate-only output (anonymous caller)', () => {
    expect(AuditOutputSchema.safeParse(output()).success).toBe(true);
  });

  it('accepts an output WITH records (authed caller)', () => {
    const authed = output();
    authed.records = [recordFixture()];
    expect(AuditOutputSchema.safeParse(authed).success).toBe(true);
  });

  it('requires run_id (IMP-007)', () => {
    const bad = output();
    delete bad.run_id;
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a 64-char lowercase hex inputs_hash (IMP-001)', () => {
    const bad = output();
    bad.inputs_hash = 'NOTAHASH';
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('seals mode to dogfood-full (external is never an output)', () => {
    const bad = output();
    bad.mode = 'external';
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CohortCountSchema (k-anonymity, AC-7)', () => {
  it('accepts an exact count', () => {
    expect(CohortCountSchema.safeParse({ kind: 'exact', value: 9 }).success).toBe(true);
  });

  it('accepts a coarse bucket', () => {
    expect(CohortCountSchema.safeParse({ kind: 'bucketed', bucket: '<5' }).success).toBe(true);
  });

  it('rejects a negative exact count', () => {
    expect(CohortCountSchema.safeParse({ kind: 'exact', value: -1 }).success).toBe(false);
  });

  it('rejects a bare number (must be exact-or-bucketed, nothing else)', () => {
    expect(CohortCountSchema.safeParse(3).success).toBe(false);
  });
});

/**
 * The k-anon coverage invariant is a CONTRACT, not a comment (bug 20260712-486383, C-2).
 *
 * Publishing a true ratio beside a k-anon-SUPPRESSED cohort back-computes the suppressed numerator
 * (`unmatched = total × (1 − coverage)`) the moment the total is known — and a Discord role's member
 * count is visible to the guild. That is the exact BB-4 leak access-risk.ts documents:
 * "rounding is not suppression". Before this refinement the invariant lived only in the producer,
 * so any other producer — a replay, a cache, a hand-built fixture — could violate it silently.
 *
 * These are KNOWN-BAD inputs: each one MUST fail to parse.
 */
describe('AuditAggregateSchema — the coverage/k-anon invariant has teeth', () => {
  function agg(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      holder_turnover: 0.25,
      sold_lapsed: { kind: 'exact', value: 42 },
      newly_eligible: { kind: 'exact', value: 17 },
      stale_access: { kind: 'bucketed', bucket: '<5' },
      whale_concentration: 0.6,
      stale_access_risk_band: 'elevated',
      unmatched_role_holders: { kind: 'exact', value: 8 },
      role_coverage: 0.92,
      coverage_uncertain: false,
      ...over,
    };
  }
  const parse = (a: Record<string, unknown>) =>
    AuditOutputSchema.safeParse({ ...output(), aggregate: a }).success;

  it('REJECTS a suppressed cohort published beside a true ratio (the back-computation leak)', () => {
    expect(
      parse(agg({ unmatched_role_holders: { kind: 'bucketed', bucket: '<5' }, role_coverage: 0.7 })),
    ).toBe(false);
  });

  it('REJECTS a positive unmatched cohort claiming full coverage (a contradiction)', () => {
    expect(parse(agg({ unmatched_role_holders: { kind: 'exact', value: 8 }, role_coverage: 1 }))).toBe(
      false,
    );
  });

  it('ACCEPTS a suppressed cohort with a NULL ratio (the suppression the rule demands)', () => {
    expect(
      parse(agg({ unmatched_role_holders: { kind: 'bucketed', bucket: '<5' }, role_coverage: null })),
    ).toBe(true);
  });

  it('ACCEPTS full coverage (ratio 1 ⇔ zero unmatched — an empty cohort identifies nobody)', () => {
    expect(
      parse(agg({ unmatched_role_holders: { kind: 'bucketed', bucket: '<5' }, role_coverage: 1 })),
    ).toBe(true);
  });

  it('ACCEPTS an EXACT cohort with its true ratio (>= k cannot be back-computed into a hidden number)', () => {
    expect(
      parse(agg({ unmatched_role_holders: { kind: 'exact', value: 6 }, role_coverage: 0.7 })),
    ).toBe(true);
  });
});
