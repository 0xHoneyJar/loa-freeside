/**
 * S5-T4 — DriftReportSchema is the ENFORCEMENT SITE, not a shape.
 *
 * "A declared bound with no enforcement site is fiction" — the finding this repo already made once. The
 * k-anon rule for the drift floors is not a producer convention: it is re-derived HERE, at the boundary
 * every producer crosses (the service, a replay, a cache, a hand-built fixture), and anything else refuses
 * to parse. These tests are the known-bad inputs that must FAIL.
 */

import { describe, it, expect } from 'vitest';
import {
  DriftReportSchema,
  DRIFT_DISCLOSURE,
  STALE_FLOOR_ASSUMPTION,
  STALE_FLOOR_BREAKS_WHEN,
  UNDERGRANT_FLOOR_ASSUMPTION,
  UNDERGRANT_FLOOR_BREAKS_WHEN,
  publicSourceBounds,
  type CohortCount,
  type DriftReport,
} from '../index.js';

const K = 5;

/** HoneyJar3's live shape: 244 role members, berachain 157, ethereum SUPPRESSED (<5). */
function hj3(over: Partial<DriftReport> = {}): DriftReport {
  const per_source_holders: Array<{ chain: string; holders: CohortCount }> = [
    { chain: 'berachain', holders: { kind: 'exact', value: 157 } },
    { chain: 'ethereum', holders: { kind: 'bucketed', bucket: '<5' } },
  ];
  return {
    access_basis: 'counts-only',
    role_members: { kind: 'exact', value: 244 },
    per_source_holders,
    k_anonymity: K,
    // 244 − (157 + (k−1)) = 83. The ONLY value derivable from what is published.
    stale_floor: {
      value: 83,
      bounds: 'wallets',
      assumption: STALE_FLOOR_ASSUMPTION,
      breaks_when: STALE_FLOOR_BREAKS_WHEN,
      direction_if_violated: 'overstates',
    },
    undergrant_floor: {
      value: 0,
      bounds: 'wallets',
      assumption: UNDERGRANT_FLOOR_ASSUMPTION,
      breaks_when: UNDERGRANT_FLOOR_BREAKS_WHEN,
      direction_if_violated: 'overstates',
    },
    floors_from_public_bound: true,
    disclosure: DRIFT_DISCLOSURE,
    ...over,
  } as DriftReport;
}

describe('publicSourceBounds — the floors may only see what was published', () => {
  it('counts every suppressed source at its WORST case (k−1) for the SUM, and at ZERO for the MAX', () => {
    const b = publicSourceBounds(
      [
        { holders: { kind: 'exact', value: 157 } },
        { holders: { kind: 'bucketed', bucket: '<5' } },
        { holders: { kind: 'bucketed', bucket: '<5' } },
      ],
      K,
    );
    expect(b.sumUpper).toBe(157 + 4 + 4); // widest total consistent with two `<5` buckets
    expect(b.maxLower).toBe(157); //          a suppressed count is < k <= any exact one, so never the max
    expect(b.suppressed).toBe(2);
  });

  it('yields a ZERO max when every source is suppressed (so undergrant_floor collapses to 0)', () => {
    const b = publicSourceBounds([{ holders: { kind: 'bucketed', bucket: '<5' } }], K);
    expect(b.maxLower).toBe(0);
    expect(b.sumUpper).toBe(4);
  });
});

describe('DriftReportSchema — the k-anon enforcement site', () => {
  it('accepts the bound-derived floor', () => {
    expect(DriftReportSchema.safeParse(hj3()).success).toBe(true);
  });

  it('REFUSES a floor that back-computes a k-anon-suppressed cohort', () => {
    // 85 is the TRUE floor when ethereum holds 2. Published beside role_members=244 and berachain=157, it
    // says "ethereum holds 2" — the exact cohort the `<5` bucket exists to hide. THE leak this guards.
    const leak = hj3({
      stale_floor: { ...hj3().stale_floor!, value: 85 },
    });
    const r = DriftReportSchema.safeParse(leak);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.path).toEqual(['stale_floor', 'value']);
    expect(r.error.issues[0]!.message).toContain('back-computes');
  });

  it('REFUSES every other back-computable value, not just the one the fixture happens to use', () => {
    // Each of these discloses a different hidden ethereum count (4→83 is the only one that is also the
    // bound, and it is the only one that parses).
    for (const [hidden, floor] of [[1, 86], [2, 85], [3, 84]] as const) {
      const r = DriftReportSchema.safeParse(hj3({ stale_floor: { ...hj3().stale_floor!, value: floor } }));
      expect(r.success, `eth=${hidden} → stale_floor=${floor} must not parse`).toBe(false);
    }
    expect(DriftReportSchema.safeParse(hj3()).success).toBe(true); // 83 (the bound) is the only survivor
  });

  it('REFUSES an undergrant_floor that back-computes a suppressed cohort', () => {
    const r = DriftReportSchema.safeParse(hj3({ undergrant_floor: { ...hj3().undergrant_floor!, value: 7 } }));
    expect(r.success).toBe(false);
  });

  it('REFUSES an EXACT sub-k role size — an exact sub-k count identifies the members it counts', () => {
    // The producer buckets this (`kAnonCohort`), so it can only arrive from a replay, a cache, or a
    // hand-built payload. The contract refuses it regardless of who built it.
    const tiny = hj3({
      role_members: { kind: 'exact', value: 3 }, // < k
      stale_floor: null,
      undergrant_floor: null,
      floors_from_public_bound: false,
    });
    const r = DriftReportSchema.safeParse(tiny);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path[0] === 'role_members')).toBe(true);
  });

  it('ACCEPTS a suppressed role count with BOTH floors null — the audit serves, the floors do not', () => {
    const suppressed = hj3({
      role_members: { kind: 'bucketed', bucket: '<5' },
      stale_floor: null,
      undergrant_floor: null,
      floors_from_public_bound: false,
    });
    expect(DriftReportSchema.safeParse(suppressed).success).toBe(true);
  });

  it('REFUSES a floor published beside a SUPPRESSED role count — it back-computes R', () => {
    // R = stale_floor + SUM(holders). A floor here hands the `<5` bucket straight back.
    const leak = hj3({
      role_members: { kind: 'bucketed', bucket: '<5' },
      floors_from_public_bound: false,
    });
    const r = DriftReportSchema.safeParse(leak);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.message).toContain('back-computes');
  });

  it('REFUSES a NULL floor when the role count is exact — the floors are only optional when R is suppressed', () => {
    expect(DriftReportSchema.safeParse(hj3({ stale_floor: null })).success).toBe(false);
    expect(DriftReportSchema.safeParse(hj3({ undergrant_floor: null })).success).toBe(false);
  });

  it('REFUSES a `floors_from_public_bound` flag that lies about suppression', () => {
    expect(DriftReportSchema.safeParse(hj3({ floors_from_public_bound: false })).success).toBe(false);
  });

  it('REFUSES a floor stripped of its assumption, or wearing the SIBLING floor`s assumption', () => {
    // A floor without its epistemic basis is the confidently-wrong artifact. It must not be representable.
    const stripped = hj3();
    delete (stripped.stale_floor as Partial<NonNullable<DriftReport['stale_floor']>>).assumption;
    expect(DriftReportSchema.safeParse(stripped).success).toBe(false);

    const swapped = hj3({
      stale_floor: {
        ...hj3().stale_floor!,
        // the undergrant floor's assumption — a different claim entirely
        assumption: UNDERGRANT_FLOOR_ASSUMPTION as unknown as typeof STALE_FLOOR_ASSUMPTION,
      },
    });
    expect(DriftReportSchema.safeParse(swapped).success).toBe(false);
  });

  it('REFUSES a floor claiming it errs in the SAFE direction — both floors OVERSTATE under violation', () => {
    const understates = hj3({
      stale_floor: {
        ...hj3().stale_floor!,
        direction_if_violated: 'understates' as unknown as 'overstates',
      },
    });
    expect(DriftReportSchema.safeParse(understates).success).toBe(false);
  });

  it('REFUSES a floor presented as a bound over PEOPLE — holders are wallets', () => {
    const people = hj3({
      stale_floor: { ...hj3().stale_floor!, bounds: 'people' as unknown as 'wallets' },
    });
    expect(DriftReportSchema.safeParse(people).success).toBe(false);
  });
});
