import { describe, it, expect } from 'vitest';
import { RiskBandSchema } from '@freeside/shadow-audit-protocol';
import { ShadowLedger } from '../shadow-ledger.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { buildAccessAuditReport } from '../access-audit.js';
import { demoEvents } from '../fixtures.js';

function ledgerWithDemo(): ShadowLedger {
  const l = new ShadowLedger(new InMemoryLedgerStore());
  for (const e of demoEvents) l.ingest(e);
  return l;
}

describe('AC-6 access-audit report', () => {
  it('emits summary counts + mandatory caveats, shaped to the shadow-audit vocab', () => {
    const l = ledgerWithDemo();
    const report = buildAccessAuditReport('demo', l.getMemberGraph('demo'));
    expect(report.report_kind).toBe('access_audit');
    expect(report.caveats.length).toBeGreaterThanOrEqual(3);
    expect(report.caveats.join(' ')).toMatch(/read-only/i);
    // reuses the sealed shadow-audit RiskBand vocabulary
    expect(() => RiskBandSchema.parse((report.summary as Record<string, unknown>).stale_access_risk_band)).not.toThrow();
    expect((report.summary as Record<string, unknown>).total_subjects).toBeGreaterThan(0);
  });
});

describe('AC-8 first-consumer binding: audit aggregate derivable from ledger projections', () => {
  it('derives a shadow-audit-style aggregate (turnover / stale) from the member graph', () => {
    const l = ledgerWithDemo();
    const graph = l.getMemberGraph('demo');

    // The existing Access Audit aggregate can be computed from ledger projections.
    const verified = graph.subjects.filter((s) => s.attribution_quality === 'verified').length;
    const walletOnly = graph.summary.wallet_only;
    const staleAccess = graph.divergences.filter((d) => d.kind === 'incumbent_higher').length;
    const newlyEligible = graph.divergences.filter((d) => d.kind === 'freeside_higher').length;

    const aggregate = {
      holder_turnover: graph.summary.total_subjects > 0 ? walletOnly / graph.summary.total_subjects : 0,
      stale_access: staleAccess,
      newly_eligible: newlyEligible,
      verified_members: verified,
    };

    // alice merged (verified) + bob wallet-only; alice has a freeside_higher divergence.
    expect(aggregate.verified_members).toBe(1);
    expect(aggregate.newly_eligible).toBe(1);
    expect(aggregate.holder_turnover).toBeGreaterThan(0);
    expect(aggregate.holder_turnover).toBeLessThanOrEqual(1);
  });
});
