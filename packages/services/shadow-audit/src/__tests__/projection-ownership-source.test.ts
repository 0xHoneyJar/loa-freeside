import { describe, it, expect } from 'vitest';
import { type Order } from '@freeside/shadow-audit-protocol';
import {
  runAudit,
  type AuditRequest,
  type OwnershipSource,
  type RoleSource,
  type WhaleSource,
} from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';
import { makeOwnershipProjection, makeProjectionOwnershipSource, ProjectionIncompleteError, type OwnershipChange } from '../projection-ownership-source.js';

const W = (n: string) => '0x' + n.repeat(40);
const R1 = W('1'), R2 = W('2'), R3 = W('3'), X = W('4'), Y = W('5');
const CHAIN = 'ethereum';
const CONTRACT = W('a');
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

let logCounter = 0;
const mk = (o: { from: string | null; to: string | null; block: number; ts: string; amount?: bigint; tx?: string; logIndex?: number }): OwnershipChange => ({
  chain: CHAIN, contract: CONTRACT, block: o.block, timestamp: o.ts,
  tx: o.tx ?? `0xtx${++logCounter}`, logIndex: o.logIndex ?? 0,
  from: o.from, to: o.to, amount: o.amount ?? 1n,
});
const CHANGES: OwnershipChange[] = [
  mk({ from: null, to: R1, block: 100, ts: '2026-06-20T00:00:00Z' }),
  mk({ from: null, to: R2, block: 200, ts: '2026-06-20T00:00:00Z' }),
  mk({ from: null, to: R3, block: 300, ts: '2026-06-20T00:00:00Z' }),
  mk({ from: null, to: X, block: 1000, ts: '2026-06-20T00:00:00Z' }),
  mk({ from: R2, to: null, block: 1100, ts: '2026-06-25T00:00:00Z' }),
  mk({ from: X, to: null, block: 1200, ts: '2026-06-25T00:00:00Z' }),
  mk({ from: null, to: Y, block: 1300, ts: '2026-06-25T00:00:00Z' }),
];
const fed = () => { const p = makeOwnershipProjection(); for (const c of CHANGES) p.apply(c); return p; };
const sortMap = (m: Map<string, bigint>) => [...m.entries()].sort();

describe('OwnershipProjection — the L2 spine read-model (STANDS)', () => {
  it('folds events into balancesAt(snapshotBlock), day-INCLUSIVE snapshot resolution', () => {
    const p = fed();
    const snap = p.resolveSnapshotBlock(CHAIN, CONTRACT, '2026-06-22');
    expect(snap).toBe(1000);
    expect(sortMap(p.balancesAt(CHAIN, CONTRACT, snap))).toEqual(sortMap(new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]])));
  });

  it('currentBalances reflects later transfers — R2/X sold, Y acquired', () => {
    expect(sortMap(fed().currentBalances(CHAIN, CONTRACT))).toEqual(sortMap(new Map([[R1, 1n], [R3, 1n], [Y, 1n]])));
  });

  it('FAGAN BLOCKER-2: an event AT the snapshot date counts (day-end-inclusive, not day-start-exclusive)', () => {
    const p = makeOwnershipProjection();
    p.apply(mk({ from: null, to: R1, block: 50, ts: '2026-06-21T00:00:00Z' }));
    p.apply(mk({ from: null, to: R2, block: 60, ts: '2026-06-22T10:00:00Z' })); // ON the snapshot date
    expect(p.resolveSnapshotBlock(CHAIN, CONTRACT, '2026-06-22')).toBe(60); // includes the same-day event
    expect([...p.balancesAt(CHAIN, CONTRACT, 60).keys()].sort()).toEqual([R1, R2].sort());
  });

  it('FAGAN BLOCKER-1: two distinct transfers in one block (same from/to/amount) are BOTH counted, not deduped', () => {
    const p = makeOwnershipProjection();
    p.apply(mk({ from: null, to: R1, block: 10, ts: '2026-06-20T00:00:00Z', amount: 5n })); // R1 holds 5
    // a batch: R1 sells 1 to R2 twice in the same block — distinct tx:logIndex, both must apply.
    p.apply(mk({ from: R1, to: R2, block: 20, ts: '2026-06-20T00:00:00Z', tx: '0xbatch', logIndex: 0 }));
    p.apply(mk({ from: R1, to: R2, block: 20, ts: '2026-06-20T00:00:00Z', tx: '0xbatch', logIndex: 1 }));
    expect(p.currentBalances(CHAIN, CONTRACT).get(R1)).toBe(3n); // 5 - 2, NOT 5 - 1 (the dedup bug would give 4)
    expect(p.currentBalances(CHAIN, CONTRACT).get(R2)).toBe(2n);
  });

  it('FAGAN HIGH-2: holder addresses are lowercased to match the Balances contract', () => {
    const checksummed = '0xABCdef' + 'a'.repeat(34); // mixed case
    const p = makeOwnershipProjection();
    p.apply(mk({ from: null, to: checksummed, block: 10, ts: '2026-06-20T00:00:00Z' }));
    expect(p.currentBalances(CHAIN, CONTRACT).has(checksummed.toLowerCase())).toBe(true);
    expect(p.currentBalances(CHAIN, CONTRACT).has(checksummed)).toBe(false); // not the checksummed form
  });

  it('FAGAN HIGH-1: an incomplete stream (a transfer-from we never saw an in for) REFUSES, not silently-wrong', () => {
    const p = makeOwnershipProjection();
    p.apply(mk({ from: R1, to: R2, block: 10, ts: '2026-06-20T00:00:00Z' })); // R1 never minted → goes negative
    expect(() => p.currentBalances(CHAIN, CONTRACT)).toThrow(ProjectionIncompleteError);
  });

  it('FAGAN MEDIUM-2: a snapshot with no at-or-before event REFUSES, not a silent block-0 audit', () => {
    const p = makeOwnershipProjection();
    p.apply(mk({ from: null, to: R1, block: 10, ts: '2026-06-25T00:00:00Z' })); // only AFTER the snapshot date
    expect(() => p.resolveSnapshotBlock(CHAIN, CONTRACT, '2026-06-22')).toThrow(ProjectionIncompleteError);
  });

  it('is idempotent on at-least-once re-delivery of the SAME event (tx:logIndex)', () => {
    const p = fed();
    p.apply(CHANGES[0]!);
    p.apply(CHANGES[0]!);
    expect(p.currentBalances(CHAIN, CONTRACT).get(R1)).toBe(1n);
  });
});

// --- the audit deps; the rawSonar double is a FIXTURE, not the real adapter (FAGAN HIGH-4) ---
const order: Order = { community: { name: 'thj', owner_wallet: W('9') }, source: { chain: CHAIN, contract_address: CONTRACT }, gating_rule: { kind: 'nft-balance', threshold: 1 }, products: ['audit'], mode: 'lead-magnet' };
const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1', community: 'thj', collection: { chain: CHAIN, contract: CONTRACT },
  captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: W('9'), freshness_threshold_seconds: 86_400,
  entries: [{ discord_user_id: 'u1', wallet: R1, role_ids: ['h'] }, { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] }, { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] }],
});
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles: RoleSource = { load: async () => snapshot() };
const req: AuditRequest = { order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: false, cta: { product: '/shadow-access', conversation: '/talk' } };
/** a HAND-ROLLED fixture (NOT makeSonarOwnershipSource / reconstructOwnership). Equality below proves the
 *  projection reproduces THIS fixture — it does NOT prove parity with the real Transfer-replay path. The real
 *  proof is a differential test against @freeside/adapters/sonar (FAGAN HIGH-4, open). */
const rawSonarFixture: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]),
};

describe('the audit READS THE SPINE — BEARS-LOAD (rung arrakis-audit-reads-member-graph)', () => {
  it('runAudit consumes the projection and computes the right cohorts from the spine', async () => {
    const r = await runAudit(req, { ownership: makeProjectionOwnershipSource(fed()), whale, roles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.aggregate.holder_turnover).toBe(0.5);
    expect(r.output.aggregate.stale_access_risk_band).toBe('high');
    expect(r.output.aggregate.whale_concentration).toBe(0.3);
  });

  it('reproduces the FIXTURE picture (NOT real-sonar parity — the differential test is the open proof, FAGAN HIGH-4)', async () => {
    const fromSpine = await runAudit(req, { ownership: makeProjectionOwnershipSource(fed()), whale, roles });
    const fromFixture = await runAudit(req, { ownership: rawSonarFixture, whale, roles });
    expect(fromSpine).toEqual(fromFixture);
  });
});
