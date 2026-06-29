import { describe, it, expect } from 'vitest';
import { type Order } from '@freeside/shadow-audit-protocol';
import { runAudit, type AuditRequest, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';
import { makeOwnershipProjection, makeProjectionOwnershipSource } from '../projection-ownership-source.js';
import { applyOwnershipActivity, ownershipActivityToChange, type OwnershipActivity } from '../ownership-projection-subscriber.js';

const W = (n: string) => '0x' + n.repeat(40);
const R1 = W('1'), R2 = W('2'), R3 = W('3'), X = W('4'), Y = W('5');
const CONTRACT = W('a');
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

/** a signed nft.activity.recorded.v1 event (EVM, chain_id 1 = ethereum); verb inferred from from/to. */
const evt = (o: { from: string | null; to: string | null; block: number; ts: string; value?: string }): OwnershipActivity => ({
  verb: o.from === null ? 'mint' : o.to === null ? 'burn' : 'transfer',
  from: o.from, to: o.to, value: o.value ?? '1', timestamp: o.ts,
  metadata: { chain: 'evm', chain_id: 1, contract: CONTRACT, block_number: o.block },
});

// the same ownership picture as the projection test, but delivered as the SIGNED EVENT STREAM:
const ACTIVITIES: OwnershipActivity[] = [
  evt({ from: null, to: R1, block: 100, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: R2, block: 200, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: R3, block: 300, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: null, to: X, block: 1000, ts: '2026-06-20T00:00:00Z' }),
  evt({ from: R2, to: null, block: 1100, ts: '2026-06-25T00:00:00Z' }), // R2 sells (burn)
  evt({ from: X, to: null, block: 1200, ts: '2026-06-25T00:00:00Z' }),  // X sells
  evt({ from: null, to: Y, block: 1300, ts: '2026-06-25T00:00:00Z' }),  // Y mints in
];
const fedViaSubscriber = () => {
  const p = makeOwnershipProjection();
  for (const a of ACTIVITIES) applyOwnershipActivity(p, a); // ← the subscriber handler feeds the spine
  return p;
};

describe('ownershipActivityToChange — the signed event → OwnershipChange mapping (STANDS)', () => {
  it('maps mint (from=null), transfer, and burn (to=null) with chain_id → chain name', () => {
    expect(ownershipActivityToChange(evt({ from: null, to: R1, block: 5, ts: '2026-06-20T00:00:00Z' })))
      .toMatchObject({ chain: 'ethereum', contract: CONTRACT, block: 5, from: null, to: R1, amount: 1n });
    expect(ownershipActivityToChange(evt({ from: R1, to: null, block: 6, ts: '2026-06-20T00:00:00Z' })))
      .toMatchObject({ from: R1, to: null, amount: 1n });
  });

  it('skips non-EVM activity (SVM is a follow-on) — never corrupts the projection', () => {
    const svm: OwnershipActivity = { verb: 'mint', from: null, to: R1, value: '1', timestamp: '2026-06-20T00:00:00Z', metadata: { chain: 'svm' } };
    expect(ownershipActivityToChange(svm)).toBeNull();
  });
});

// --- the raw-sonar picture the subscriber-fed projection must reproduce ---
const order: Order = { community: { name: 'thj', owner_wallet: W('9') }, source: { chain: 'ethereum', contract_address: CONTRACT }, gating_rule: { kind: 'nft-balance', threshold: 1 }, products: ['audit'], mode: 'lead-magnet' };
const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1', community: 'thj', captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: W('9'), freshness_threshold_seconds: 86_400,
  entries: [{ discord_user_id: 'u1', wallet: R1, role_ids: ['h'] }, { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] }, { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] }],
});
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles: RoleSource = { load: async () => snapshot() };
const req: AuditRequest = { order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: false, cta: { product: '/shadow-access', conversation: '/talk' } };
const rawSonar: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]),
};

describe('event → handler → projection → audit, END TO END (BEARS-LOAD)', () => {
  it('the audit reading a SUBSCRIBER-FED projection is byte-identical to reading raw sonar', async () => {
    const fromEvents = await runAudit(req, { ownership: makeProjectionOwnershipSource(fedViaSubscriber()), whale, roles });
    const fromRaw = await runAudit(req, { ownership: rawSonar, whale, roles });
    // the signed nft.activity.recorded.v1 stream, folded by the handler+projection, reconstructs the EXACT
    // ownership the audit reads from raw sonar today. The full keystone: event flows in, the spine projects,
    // the audit reads the spine — and gets the identical verdict.
    expect(fromEvents).toEqual(fromRaw);
  });
});
