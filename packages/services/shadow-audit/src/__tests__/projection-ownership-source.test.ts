import { describe, it, expect } from 'vitest';
import { type Order } from '@freeside/shadow-audit-protocol';
import {
  runAudit,
  type AuditDeps,
  type AuditRequest,
  type OwnershipSource,
  type RoleSource,
  type WhaleSource,
} from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';
import { makeOwnershipProjection, makeProjectionOwnershipSource, type OwnershipChange } from '../projection-ownership-source.js';

const W = (n: string) => '0x' + n.repeat(40);
const R1 = W('1'), R2 = W('2'), R3 = W('3'), X = W('4'), Y = W('5');
const CHAIN = 'ethereum';
const CONTRACT = W('a');
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

// The `ownership.changed` event stream (signed nft.activity.recorded.v1 in production) that reproduces the
// exact ownership picture the audit needs: at snapshot (block 1000) R1/R2/R3/X hold; by now R2+X sold, Y bought.
const CHANGES: OwnershipChange[] = [
  { chain: CHAIN, contract: CONTRACT, block: 100, timestamp: '2026-06-20T00:00:00Z', from: null, to: R1, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 200, timestamp: '2026-06-20T00:00:00Z', from: null, to: R2, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 300, timestamp: '2026-06-20T00:00:00Z', from: null, to: R3, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 1000, timestamp: '2026-06-20T00:00:00Z', from: null, to: X, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 1100, timestamp: '2026-06-25T00:00:00Z', from: R2, to: null, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 1200, timestamp: '2026-06-25T00:00:00Z', from: X, to: null, amount: 1n },
  { chain: CHAIN, contract: CONTRACT, block: 1300, timestamp: '2026-06-25T00:00:00Z', from: null, to: Y, amount: 1n },
];
const fed = () => {
  const p = makeOwnershipProjection();
  for (const c of CHANGES) p.apply(c);
  return p;
};
const sortMap = (m: Map<string, bigint>) => [...m.entries()].sort();

describe('OwnershipProjection — the L2 spine read-model (STANDS)', () => {
  it('folds events into balancesAt(snapshotBlock) — who held at the snapshot', () => {
    const p = fed();
    const snap = p.resolveSnapshotBlock(CHAIN, CONTRACT, '2026-06-22');
    expect(snap).toBe(1000); // highest block whose timestamp is at/before the date
    expect(sortMap(p.balancesAt(CHAIN, CONTRACT, snap))).toEqual(sortMap(new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]])));
  });

  it('currentBalances reflects later transfers — R2/X sold, Y acquired', () => {
    expect(sortMap(fed().currentBalances(CHAIN, CONTRACT))).toEqual(sortMap(new Map([[R1, 1n], [R3, 1n], [Y, 1n]])));
  });

  it('is IDEMPOTENT on at-least-once re-delivery — a duplicate event is not double-counted', () => {
    const p = fed();
    p.apply(CHANGES[0]!); // re-deliver the R1 mint (NATS at-least-once)
    p.apply(CHANGES[0]!);
    expect(p.currentBalances(CHAIN, CONTRACT).get(R1)).toBe(1n); // still 1, not 3 — the keystone law
  });

  it('a collection with no events answers empty, never throws', () => {
    expect(fed().currentBalances('ethereum', W('f')).size).toBe(0);
    expect(fed().resolveSnapshotBlock('ethereum', W('f'), '2026-06-22')).toBe(0);
  });
});

// --- the audit deps (mirrors audit-service.test.ts) — the hand-rolled raw-sonar ownership the projection must match ---
const order: Order = {
  community: { name: 'thj', owner_wallet: W('9') },
  source: { chain: CHAIN, contract_address: CONTRACT },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'],
  mode: 'lead-magnet',
};
const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1', community: 'thj', captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: W('9'), freshness_threshold_seconds: 86_400,
  entries: [
    { discord_user_id: 'u1', wallet: R1, role_ids: ['h'] },
    { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] },
    { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] },
  ],
});
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles: RoleSource = { load: async () => snapshot() };
const req: AuditRequest = {
  order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: false,
  cta: { product: '/shadow-access', conversation: '/talk' },
};
/** the RAW-sonar ownership (the same picture, hand-rolled — what the audit reads today via makeSonarOwnershipSource). */
const rawSonar: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]),
};

describe('the audit READS THE SPINE — BEARS-LOAD (rung arrakis-audit-reads-member-graph)', () => {
  it('runAudit consumes the event-fed projection and computes the right cohorts FROM the spine', async () => {
    const r = await runAudit(req, { ownership: makeProjectionOwnershipSource(fed()), whale, roles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // every cohort below was derived entirely from the event-fed projection's balances:
    expect(r.output.aggregate.holder_turnover).toBe(0.5); // soldLapsed R2,X (2) / qualified@snap 4
    expect(r.output.aggregate.stale_access_risk_band).toBe('high'); // R2 holds the role but sold → stale access
    expect(r.output.aggregate.whale_concentration).toBe(0.3);
  });

  it('the projection is a FAITHFUL drop-in — the audit is BYTE-IDENTICAL whether it reads the spine or raw sonar', async () => {
    const fromSpine = await runAudit(req, { ownership: makeProjectionOwnershipSource(fed()), whale, roles });
    const fromRaw = await runAudit(req, { ownership: rawSonar, whale, roles });
    // same snapshot block, same balances → same inputs_hash → same run_id → identical output. The spine read-model
    // reproduces raw sonar exactly — so re-aiming the audit at it (the rung) changes WHERE it reads, not WHAT it gets.
    expect(fromSpine).toEqual(fromRaw);
  });
});
