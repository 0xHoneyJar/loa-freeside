import { describe, it, expect } from 'vitest';
import { makeMemoryStore, type Order } from '@freeside/shadow-audit-protocol';
import { runShadowCycle } from '../shadow-cycle.js';
import type { AuditDeps, AuditRequest, OwnershipSource, RoleSource, WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const R3 = '0x' + '3'.repeat(40);
const X = '0x' + '4'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

const order: Order = {
  community: { name: 'thj', owner_wallet: '0x' + '9'.repeat(40) },
  source: { chain: 'ethereum', contract_address: '0x' + 'a'.repeat(40) },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'],
  mode: 'lead-magnet',
};
const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1',
  community: 'thj',
  captured_at: '2026-06-22T11:00:00.000Z',
  export_method: 'export',
  owner: '0x' + '9'.repeat(40),
  freshness_threshold_seconds: 86_400,
  entries: [
    { discord_user_id: 'u1', wallet: R1, role_ids: ['h'] },
    { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] },
    { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] },
  ],
});
const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n], [X, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]),
};
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles = (s: RoleSnapshot = snapshot()): RoleSource => ({ load: async () => s });
const req = (over: Partial<AuditRequest> = {}): AuditRequest => ({
  order,
  snapshotDate: '2026-06-22',
  isOperatedCommunity: true,
  nowUnixSeconds: NOW,
  includeRecords: false,
  cta: { product: '/shadow-access', conversation: '/talk' },
  ...over,
});
const deps = (over: Partial<AuditDeps> = {}): AuditDeps => ({ ownership, whale, roles: roles(), ...over });

describe('runShadowCycle — the cadence orchestration (read-only)', () => {
  it('runs the audit, derives the Comparison View, and persists a snapshot', async () => {
    const store = makeMemoryStore();
    const res = await runShadowCycle(req(), deps(), store, '2026-06-22T12:00:00.000Z');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.community).toBe('thj');
    expect(res.snapshot.report.aggregate.total).toBeGreaterThan(0);
    expect(await store.latest('thj')).toEqual(res.snapshot); // persisted
  });

  it('refuses cleanly when the audit refuses — touches nothing, persists nothing', async () => {
    const store = makeMemoryStore();
    const res = await runShadowCycle(req({ isOperatedCommunity: false }), deps(), store, '2026-06-22T12:00:00.000Z');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('external-mode');
    expect(await store.latest('thj')).toBeUndefined();
  });
});
