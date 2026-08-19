import { describe, it, expect } from 'vitest';
import type { SourceResolver } from '../collection-union.js';
import { type Order } from '@freeside/shadow-audit-protocol';
import { runAudit, type AuditRequest, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';

/**
 * KEYSTONE GATE (the designed gate) — `arrakis-wedge-migration-delta-cbox.1`.
 *
 * The migration-delta Comparison View (`diffShadow`) was built-but-UNCONSUMED; runAudit now consumes it into
 * `output.comparison`. This gate proves the consumption is LOAD-BEARING, not decorative:
 *   1. WIRING CROSS-CHECK — the comparison's demotions/promotions agree with the aggregate cohort filter
 *      (stale_access / newly_eligible). NOT independent corroboration: both sides share qualifies(curBal), so this
 *      catches band-MAPPING drift, not a shared-input bug. True ground-truth = settle vs the incumbent's live grants (open).
 *   2. METHODOLOGY — the output carries the rule + snapshot the delta was computed under, so a buyer can settle
 *      it against the incumbent's enforced policy (SAATY's risk: the delta must not be a Freeside-vs-Freeside
 *      methodology artifact).
 *   3. TEETH — a single decision change (one stale holder re-acquires) MOVES the delta; the comparison is
 *      derived from the real decisions, not hardcoded.
 */

const A = (tag: string, i: number): string => '0x' + `${tag}${i}`.padStart(40, '0');
const CONTRACT = '0x' + 'a'.repeat(40);
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);
const SNAP_BLOCK = 18_000_000;

const roleStale = [1, 2, 3, 4, 5, 6].map((i) => A('a', i)); // hold the role, current balance 0 → DEMOTION (stale)
const roleOk = [1, 2, 3, 4, 5, 6].map((i) => A('b', i)); //    hold the role, current balance 1 → NO_CHANGE (ok)
const newlyElig = [1, 2, 3, 4, 5, 6].map((i) => A('c', i)); //  no role, current balance 1   → PROMOTION (missing)

/** ownership where roleOk + newlyElig hold 1, roleStale hold 0 (absent). snapshot == current (no sold_lapsed). */
const makeOwnership = (extraHolders: string[] = []): OwnershipSource => {
  const bal = new Map<string, bigint>([...roleOk, ...newlyElig, ...extraHolders].map((w) => [w, 1n] as const));
  return {
    resolveSnapshotBlock: async () => SNAP_BLOCK,
    balancesAt: async () => bal,
    currentBalances: async () => bal,
  };
};

const snapshot = (): RoleSnapshot => ({
  source: 'discord:guild:1', community: 'thj', collection: { chain: '1', contract: CONTRACT },
  captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: A('9', 9), freshness_threshold_seconds: 86_400,
  entries: [...roleStale, ...roleOk].map((wallet, i) => ({ discord_user_id: `u${i}`, wallet, role_ids: ['h'] })),
});
const roles: RoleSource = { load: async () => snapshot() };
// S5-T3: this suite audits a collection with ONE declared deployment (a union of one) — its intent is
// unchanged. The multi-source cases live in audit-service.test.ts / access-risk.test.ts.
const sources: SourceResolver = () => [{ chain: "1", contract: CONTRACT }];
const whale: WhaleSource = { concentration: async () => 0.3 };
const order: Order = {
  community: { name: 'thj', owner_wallet: A('9', 9) },
  source: { chain: '1', contract_address: CONTRACT },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'], mode: 'lead-magnet',
};
const req = (): AuditRequest => ({
  order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: true,
  cta: { product: '/shadow-access', conversation: '/talk' },
});

describe('KEYSTONE: the audit consumes diffShadow into output.comparison (the migration delta)', () => {
  it('WIRING CROSS-CHECK: the band→change mapping agrees with the direct cohort filter', async () => {
    const r = await runAudit(req(), { ownership: makeOwnership(), whale, roles, sources });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { comparison, aggregate } = r.output;
    expect(comparison).toBeDefined();
    if (!comparison) return;
    // the delta itself
    expect(comparison.aggregate.total).toBe(18);
    expect(comparison.aggregate.demotions).toBe(6); // stale role-holders
    expect(comparison.aggregate.promotions).toBe(6); // newly eligible
    expect(comparison.aggregate.no_change).toBe(6);
    expect(comparison.aggregate.band_distribution).toEqual({ stale: 6, missing: 6, ok: 6 });
    // NOT independent corroboration (FAGAN HIGH-2): the comparison (band→change) and the aggregate (cohort filter)
    // both derive from the SAME qualifies(curBal)+roleWallets — a shared-input bug corrupts both equally. What
    // this DOES catch is band-MAPPING drift (e.g. changeFromBand mapping stale→promotion). Compare exact-vs-exact
    // ONLY when the aggregate cohort is itself exact (≥ k); below k it buckets (see the k-anon divergence test).
    if (aggregate.stale_access.kind === 'exact') expect(comparison.aggregate.demotions).toBe(aggregate.stale_access.value);
    if (aggregate.newly_eligible.kind === 'exact') expect(comparison.aggregate.promotions).toBe(aggregate.newly_eligible.value);
  });

  it('METHODOLOGY: the output carries the settle-context — rule + incumbent-snapshot time + evidence anchor', async () => {
    const r = await runAudit(req(), { ownership: makeOwnership(), whale, roles, sources });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.methodology).toEqual({
      rule_id: 'nft-balance:1',
      role_snapshot_at: '2026-06-22T11:00:00.000Z',
      evidence_block: SNAP_BLOCK,
      sources: ['sonar', 'role-snapshot'],
      // S5-T3: the settle-context now also names HOW the collection's deployments were combined, and
      // exactly which ones were read — a reader can re-derive the run instead of trusting it.
      union_semantics: 'any-source',
      collection_sources: [{ chain: '1', contract: CONTRACT, snapshot_block: SNAP_BLOCK }],
    });
  });

  it('HIGH-1: the delta settles against CURRENT balances, not evidence_block (the snapshot)', async () => {
    const sold = A('d', 1); // qualified AT the snapshot, sold SINCE
    const kept = A('d', 2); // qualified at both
    const ownership: OwnershipSource = {
      resolveSnapshotBlock: async () => SNAP_BLOCK,
      balancesAt: async () => new Map([[sold, 1n], [kept, 1n]]), // snapshot: BOTH qualify
      currentBalances: async () => new Map([[kept, 1n]]), //          NOW: `sold` holds 0
    };
    const rolesSold: RoleSource = {
      load: async () => ({
        source: 'discord:guild:1', community: 'thj', collection: { chain: '1', contract: CONTRACT },
  captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
        owner: A('9', 9), freshness_threshold_seconds: 86_400,
        entries: [{ discord_user_id: 'u1', wallet: sold, role_ids: ['h'] }, { discord_user_id: 'u2', wallet: kept, role_ids: ['h'] }],
      }),
    };
    const r = await runAudit(req(), { ownership, whale, roles: rolesSold, sources });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.output.comparison) return;
    // `sold` is DEMOTED — it no longer qualifies NOW. If the delta settled at evidence_block (where `sold` still
    // qualified), demotions would be 0. So the delta is current-basis; evidence_block is only the evidence anchor.
    expect(r.output.comparison.aggregate.demotions).toBe(1);
    expect(r.output.comparison.aggregate.no_change).toBe(1);
    expect(r.output.comparison.members.find((m) => m.wallet === sold.toLowerCase())).toMatchObject({ band: 'stale', change: 'demotion' });
    expect(r.output.methodology!.evidence_block).toBe(SNAP_BLOCK);
  });

  it('MEDIUM-2: below k-anon the aggregate BUCKETS while the authed comparison stays exact (divergent by design)', async () => {
    const twoStale = [A('a', 1), A('a', 2)]; // < k=5
    const ownership: OwnershipSource = {
      resolveSnapshotBlock: async () => SNAP_BLOCK,
      balancesAt: async () => new Map(),
      currentBalances: async () => new Map(), // both hold 0 now → stale/demotion
    };
    const rolesSmall: RoleSource = {
      load: async () => ({
        source: 'discord:guild:1', community: 'thj', collection: { chain: '1', contract: CONTRACT },
  captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
        owner: A('9', 9), freshness_threshold_seconds: 86_400,
        entries: twoStale.map((wallet, i) => ({ discord_user_id: `u${i}`, wallet, role_ids: ['h'] })),
      }),
    };
    const r = await runAudit(req(), { ownership, whale, roles: rolesSmall, sources });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.output.comparison) return;
    expect(r.output.aggregate.stale_access.kind).toBe('bucketed'); // suppressed (< k)
    expect(r.output.comparison.aggregate.demotions).toBe(2); // …the authed per-member delta stays exact
  });

  it('TEETH: one stale holder re-acquiring MOVES the delta (the comparison tracks real decisions)', async () => {
    // roleStale[0] now holds 1 → it flips stale→ok: demotions 6→5, no_change 6→7.
    const r = await runAudit(req(), { ownership: makeOwnership([roleStale[0]!]), whale, roles, sources });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.output.comparison) return;
    expect(r.output.comparison.aggregate.demotions).toBe(5);
    expect(r.output.comparison.aggregate.no_change).toBe(7);
    expect(r.output.comparison.aggregate.promotions).toBe(6); // unchanged
  });

  it('AUTHED-ONLY + CONTRACT-PARITY: an anon audit carries no per-member delta AND a byte-stable response shape', async () => {
    const r = await runAudit({ ...req(), includeRecords: false }, { ownership: makeOwnership(), whale, roles, sources });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.records).toBeUndefined();
    expect(r.output.comparison).toBeUndefined(); // no wallets leak to anon
    expect(r.output.methodology).toBeUndefined(); // the methodology travels WITH the authed delta, not the anon response
    // CONTRACT-PARITY GUARD: the anon response keys must stay byte-stable — freeside-dashboard strict-decodes
    // GET /v1/audit with onExcessProperty:error, so any NEW top-level field silently breaks the integration.
    expect(Object.keys(r.output).sort()).toEqual([
      'aggregate',
      'cta',
      'inputs_hash',
      'mode',
      'protocol_version',
      'run_id',
    ]);
  });
});
