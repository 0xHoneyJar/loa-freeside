import { describe, it, expect } from 'vitest';
import { RiskBandSchema } from '@freeside/shadow-audit-protocol';
import { ShadowLedger } from '../shadow-ledger.js';
import { testGrant } from '../auth/append-grant.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { buildAccessAuditReport } from '../access-audit.js';
import { demoEvents } from '../fixtures.js';

async function ledgerWithDemo(): Promise<ShadowLedger> {
  const l = new ShadowLedger(new InMemoryLedgerStore());
  for (const e of demoEvents) await l.ingest(e, testGrant());
  return l;
}

const NOW = '2026-06-26T00:00:00.000Z';

describe('a revoked link is not counted as verified in the report (FAGAN MEDIUM)', () => {
  it('verified_subjects drops to 0 after a revoke downgrades the only identity', async () => {
    const l = new ShadowLedger(new InMemoryLedgerStore());
    await l.ingest({
      event_id: 'w', schema_version: 'shadow.event.v1', community_id: 'demo',
      name: 'identity.wallet.linked.v1', source: 'identity_api', truth_status: 'attested',
      observed_at: NOW, emitted_at: NOW,
      payload: { user_id: 'usr_alice', wallet: { chain: 'berachain', address: '0xAAA' } },
    }, testGrant());
    let report = buildAccessAuditReport('demo', await l.getMemberGraph('demo'));
    expect((report.summary as Record<string, number>).verified_subjects).toBe(1);

    await l.ingest({
      event_id: 'r', schema_version: 'shadow.event.v1', community_id: 'demo',
      name: 'identity.link.revoked.v1', source: 'identity_api', truth_status: 'attested',
      observed_at: NOW, emitted_at: NOW,
      payload: { user_id: 'usr_alice', link_kind: 'wallet' },
    }, testGrant());
    report = buildAccessAuditReport('demo', await l.getMemberGraph('demo'));
    expect((report.summary as Record<string, number>).verified_subjects).toBe(0);
  });
});

describe('AC-6 access-audit report', () => {
  it('emits summary counts + mandatory caveats, shaped to the shadow-audit vocab', async () => {
    const l = await ledgerWithDemo();
    const report = buildAccessAuditReport('demo', await l.getMemberGraph('demo'));
    expect(report.report_kind).toBe('access_audit');
    expect(report.caveats.length).toBeGreaterThanOrEqual(3);
    expect(report.caveats.join(' ')).toMatch(/read-only/i);
    // reuses the sealed shadow-audit RiskBand vocabulary
    expect(() => RiskBandSchema.parse((report.summary as Record<string, unknown>).stale_access_risk_band)).not.toThrow();
    expect((report.summary as Record<string, unknown>).total_subjects).toBeGreaterThan(0);
  });
});

describe('AC-8 first-consumer binding: audit aggregate derivable from ledger projections', () => {
  it('derives a shadow-audit-style aggregate (turnover / stale) from the member graph', async () => {
    const l = await ledgerWithDemo();
    const graph = await l.getMemberGraph('demo');

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
