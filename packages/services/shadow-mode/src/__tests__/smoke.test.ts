import { describe, it, expect } from 'vitest';
import { ShadowLedger } from '../shadow-ledger.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { buildAccessAuditReport } from '../access-audit.js';
import { demoEvents } from '../fixtures.js';

describe('e2e smoke: demo fixtures → member graph + report', () => {
  it('ingests the demo events into a coherent graph (alice verified, bob wallet-only)', () => {
    const l = new ShadowLedger(new InMemoryLedgerStore());
    for (const e of demoEvents) expect(l.ingest(e).status).toBe('ingested');

    const g = l.getMemberGraph('demo');
    // alice (merged identity_user) + bob (wallet_only) = 2 subjects
    expect(g.summary.identity_users).toBe(1);
    expect(g.summary.wallet_only).toBe(1);

    const alice = g.subjects.find((s) => s.kind === 'identity_user')!;
    expect(alice.attribution_quality).toBe('verified');
    expect(alice.aliases).toContain('discord:1001');
    expect(alice.aliases).toContain('wallet:berachain:0xaaa0000000000000000000000000000000000001');
    // alice diverges: incumbent role-holder vs freeside role-core (higher)
    const aliceDiv = g.divergences.find((d) => d.subject_id === alice.subject_id)!;
    expect(aliceDiv.kind).toBe('freeside_higher');

    // bob stays unresolved (wallet-only, never verified)
    expect(l.getUnresolved('demo').some((s) => s.kind === 'wallet_only')).toBe(true);

    const report = buildAccessAuditReport('demo', g);
    expect(report.report_kind).toBe('access_audit');
    expect(report.caveats.length).toBeGreaterThanOrEqual(3);
  });

  it('replaying ALL demo events is fully idempotent (AC-1 at e2e scale)', () => {
    const l = new ShadowLedger(new InMemoryLedgerStore());
    for (const e of demoEvents) l.ingest(e);
    const before = l.getMemberGraph('demo');
    for (const e of demoEvents) expect(l.ingest(e).status).toBe('duplicate');
    const after = l.getMemberGraph('demo');
    expect(after.summary).toEqual(before.summary);
  });
});
