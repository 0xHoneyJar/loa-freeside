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
  it('maps mint/transfer/burn, carries tx:logIndex identity, chain_id → canonical numeric key', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z', tx: '0xaa', logIndex: 2 })))
      .toMatchObject({ chain: '1', contract: CONTRACT, block: 5, from: null, to: R1, amount: 1n, tx: '0xaa', logIndex: 2 });
  });

  it('skips non-EVM activity (SVM is a follow-on)', () => {
    const svm: OwnershipActivity = { verb: 'mint', from: null, to: R1, value: '1', timestamp: '2026-06-20T00:00:00Z', tx: '0xa', metadata: { chain: 'svm' } };
    expect(ownershipActivityToChange(svm)).toBeNull();
  });

  it('accepts any positive numeric chain_id without a slug allowlist drift seam', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z', chainId: 137 })))
      .toMatchObject({ chain: '137' });
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
  it('the audit reading a subscriber-fed numeric-chain projection reproduces the fixture picture', async () => {
    const fromEvents = await runAudit(req, { ownership: makeProjectionOwnershipSource(fedViaSubscriber()), whale, roles, sources });
    const fromFixture = await runAudit(req, { ownership: rawSonarFixture, whale, roles, sources });
    expect(fromEvents).toEqual(fromFixture);
  });
});
