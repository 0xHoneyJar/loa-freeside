import { describe, it, expect } from 'vitest';
import { changeFromBand, diffShadow, DiscrepancyReportSchema } from '../discrepancy.js';
import type { AccessDecisionRecord } from '../schemas/access-decision-record.js';

const rec = (o: { band: AccessDecisionRecord['band']; holds_role: boolean; qualifies: boolean; wallet: string }): AccessDecisionRecord => ({
  wallet: o.wallet,
  community: 'honeycomb',
  holds_role: o.holds_role,
  qualifies: o.qualifies,
  band: o.band,
  evidence: { balance_at_snapshot: 1 },
  provenance: {
    rule_id: 'tier-1',
    snapshot_block: 887577,
    // The deployment the balance was READ FROM — under the union it is not necessarily the addressed one.
    evidence_source: { chain: '1', contract: `0x${'a'.repeat(40)}` },
    computed_at: '2026-06-28T00:00:00.000Z',
    sources: ['sonar'],
  },
});
const addr = (n: string) => `0x${n.repeat(40)}`;

describe('Shadow Mode — diffShadow (Comparison View + Discrepancy Report)', () => {
  it('classifies each band into the cutover change (the canonical semantics)', () => {
    expect(changeFromBand('missing')).toBe('promotion'); // holdings without access → newly eligible
    expect(changeFromBand('stale')).toBe('demotion'); // access without holdings → the confront set
    expect(changeFromBand('ok')).toBe('no_change');
  });

  it('builds the per-member view + the aggregate over the audit decisions', () => {
    const report = diffShadow([
      rec({ band: 'ok', holds_role: true, qualifies: true, wallet: addr('1') }), // correctly has → no_change
      rec({ band: 'stale', holds_role: true, qualifies: false, wallet: addr('2') }), // has, doesn't qualify → demotion
      rec({ band: 'missing', holds_role: false, qualifies: true, wallet: addr('3') }), // qualifies, no role → promotion
      rec({ band: 'ok', holds_role: false, qualifies: false, wallet: addr('4') }), // correctly without → no_change
    ]);
    expect(report.aggregate.total).toBe(4);
    expect(report.aggregate.promotions).toBe(1);
    expect(report.aggregate.demotions).toBe(1);
    expect(report.aggregate.no_change).toBe(2);
    expect(report.aggregate.band_distribution).toEqual({ stale: 1, missing: 1, ok: 2 });
    expect(() => DiscrepancyReportSchema.parse(report)).not.toThrow(); // a valid Discrepancy Report
  });

  it('is READ-ONLY — it never mutates the input (Shadow Mode touches no Discord role)', () => {
    const records = [rec({ band: 'stale', holds_role: true, qualifies: false, wallet: addr('5') })];
    const before = JSON.stringify(records);
    diffShadow(records);
    expect(JSON.stringify(records)).toBe(before);
  });

  it('preserves input order — a stable Comparison View', () => {
    const report = diffShadow([
      rec({ band: 'missing', holds_role: false, qualifies: true, wallet: addr('6') }),
      rec({ band: 'stale', holds_role: true, qualifies: false, wallet: addr('7') }),
    ]);
    expect(report.members.map((m) => m.change)).toEqual(['promotion', 'demotion']);
  });

  it('empty audit → an empty report at rest (no members, zero everywhere)', () => {
    const report = diffShadow([]);
    expect(report.aggregate).toEqual({ total: 0, promotions: 0, demotions: 0, no_change: 0, band_distribution: { stale: 0, missing: 0, ok: 0 } });
  });
});
