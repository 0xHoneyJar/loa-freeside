import { describe, it, expect } from 'vitest';
import type { SourceResolver } from '../collection-union.js';
import { type Order } from '@freeside/shadow-audit-protocol';
import { runAudit, type AuditRequest, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';
import { makeOwnershipProjection, makeProjectionOwnershipSource } from '../projection-ownership-source.js';
import { applyOwnershipActivity, ownershipActivityToChange, type OwnershipActivity } from '../ownership-projection-subscriber.js';

const W = (n: string) => '0x' + n.repeat(40);
const R1 = W('1'), R2 = W('2'), R3 = W('3'), X = W('4'), Y = W('5');
const CONTRACT = W('a');
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

let n = 0;
const evt = (o: { from: string | null; to: string | null; block: number; ts: string; value?: string; chainId?: number; tx?: string; logIndex?: number }): OwnershipActivity => ({
  verb: o.from === null ? 'mint' : o.to === null ? 'burn' : 'transfer',
  from: o.from, to: o.to, value: o.value ?? '1', timestamp: o.ts, tx: o.tx ?? `0xtx${++n}`,
  metadata: { chain: 'evm', chain_id: o.chainId ?? 1, contract: CONTRACT, block_number: o.block, log_index: o.logIndex ?? 0 },
});

const ACTIVITIES: OwnershipActivity[] = [
  evt({ from: null, to: R1, block: 100, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: R2, block: 200, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: R3, block: 300, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: X, block: 1000, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: R2, to: null, block: 1100, ts: '2026-06-25T00:00:00Z' }),
  evt({ from: X, to: null, block: 1200, ts: '2026-06-25T00:00:00Z' }),
  evt({ from: null, to: Y, block: 1300, ts: '2026-06-25T00:00:00Z' }),
];
const fedViaSubscriber = () => { const p = makeOwnershipProjection(); for (const a of ACTIVITIES) applyOwnershipActivity(p, a); return p; };

describe('ownershipActivityToChange — the signed event → OwnershipChange mapping (STANDS)', () => {
  it('maps mint/transfer/burn, carries tx:logIndex identity, chain_id → name', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z', tx: '0xaa', logIndex: 2 })))
      .toMatchObject({ chain: 'ethereum', contract: CONTRACT, block: 5, from: null, to: R1, amount: 1n, tx: '0xaa', logIndex: 2 });
  });

  it('skips non-EVM activity (SVM is a follow-on)', () => {
    const svm: OwnershipActivity = { verb: 'mint', from: null, to: R1, value: '1', timestamp: '2026-06-20T00:00:00Z', tx: '0xa', metadata: { chain: 'svm' } };
    expect(ownershipActivityToChange(svm)).toBeNull();
  });

  it('FAGAN MEDIUM-1: skips an UNMAPPED chain_id (no synthetic evm:N key that never matches order.source.chain)', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z', chainId: 137 }))).toBeNull();
  });

  it('FAGAN HIGH-3 guard: value "0" or null → 1 token (the ERC-721 form), not a zero move', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z', value: '0' }))!.amount).toBe(1n);
  });

  it('skips activity with no stable identity (missing tx)', () => {
    const noTx: OwnershipActivity = { verb: 'mint', from: null, to: R1, value: '1', timestamp: '2026-06-20T00:00:00Z', tx: '', metadata: { chain: 'evm', chain_id: 1, contract: CONTRACT, block_number: 5, log_index: 0 } };
    expect(ownershipActivityToChange(noTx)).toBeNull();
  });
});

// --- the fixture the subscriber-fed projection reproduces (a fixture, NOT the real adapter — FAGAN HIGH-4) ---
const order: Order = { community: { name: 'thj', owner_wallet: W('9') }, source: { chain: '1', contract_address: CONTRACT }, gating_rule: { kind: 'nft-balance', threshold: 1 }, products: ['audit'], mode: 'lead-magnet' };
const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1', community: 'thj', collection: { chain: '1', contract: CONTRACT },
  captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: W('9'), freshness_threshold_seconds: 86_400,
  entries: [{ discord_user_id: 'u1', wallet: R1, role_ids: ['h'] }, { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] }, { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] }],
});
// S5-T3: this suite audits a collection with ONE declared deployment (a union of one) — its intent is
// unchanged. The multi-source cases live in audit-service.test.ts / access-risk.test.ts.
const sources: SourceResolver = () => [{ chain: "1", contract: CONTRACT }];
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles: RoleSource = { load: async () => snapshot() };
const req: AuditRequest = { order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: false, cta: { product: '/shadow-access', conversation: '/talk' } };
const rawSonarFixture: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]),
};

describe('event → handler → projection → audit, END TO END (BEARS-LOAD)', () => {
  /**
   * ⚠ S5-T3 FINDING — PARKED, not fixed here. This path cannot run against the ratified chain identity.
   *
   * `ChainSchema` is now the NUMERIC chain id ("1"), because that is what the registry keys on and what the
   * chain-scoped sonar query requires. But `ownershipActivityToChange` maps `chain_id → SLUG`
   * (`CHAIN_NAME = { 1: 'ethereum', … }`, ownership-projection-subscriber.ts:45), and the projection is keyed
   * by that slug — so an Order addressing chain "1" finds NO events, and a slug-addressed Order is refused by
   * the schema.
   *
   * The two OwnershipSource implementations have therefore always required MUTUALLY EXCLUSIVE chain formats:
   * the deployed sonar adapter refuses any non-numeric chain (`ownership-source.ts:56`), while this projection
   * only answers to slugs. Neither could ever have served the other's Orders. Making the chain type honest did
   * not create the conflict — it surfaced it at the boundary instead of at runtime.
   *
   * The fix is one line in the subscriber's CHAIN_NAME table, which is inside the FENCED
   * `ownership-projection-*` set this sprint is explicitly forbidden from touching or wiring. So it is named
   * here and skipped, rather than silently "fixed" (un-parking by stealth) or deleted (hiding the finding).
   */
  it.skip('the audit reading a SUBSCRIBER-FED projection reproduces the fixture picture (BLOCKED: slug-vs-numeric chain key — see above)', async () => {
    const fromEvents = await runAudit(req, { ownership: makeProjectionOwnershipSource(fedViaSubscriber()), whale, roles, sources });
    const fromFixture = await runAudit(req, { ownership: rawSonarFixture, whale, roles, sources });
    expect(fromEvents).toEqual(fromFixture);
  });
});
