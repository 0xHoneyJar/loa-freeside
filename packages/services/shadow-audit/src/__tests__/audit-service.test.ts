import { describe, it, expect } from 'vitest';
import { AuditOutputSchema, type Order } from '@freeside/shadow-audit-protocol';
import {
  runAudit,
  type AuditDeps,
  type AuditRequest,
  type Balances,
  type OwnershipSource,
  type RoleSource,
  type WhaleSource,
} from '../audit-service.js';
import type { SourceResolver } from '../collection-union.js';
import type { RoleSnapshot } from '../role-snapshot.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40); // role-holder who sold → stale
const R3 = '0x' + '3'.repeat(40);
const X = '0x' + '4'.repeat(40); // qualified@snapshot, sold by now, no role
const Y = '0x' + '5'.repeat(40); // newly eligible, no role
const NOW = Math.floor(Date.UTC(2026, 5, 22, 12, 0, 0) / 1000);

const order: Order = {
  community: { name: 'thj', owner_wallet: '0x' + '9'.repeat(40) },
  // Chain ids are NUMERIC (S5-T3) — the registry key + the sonar query scope.
  source: { chain: '1', contract_address: '0x' + 'a'.repeat(40) },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'],
  mode: 'lead-magnet',
};

/** The default collection has ONE declared deployment — the pre-S5 shape, still supported. */
const oneSource: SourceResolver = () => [
  { chain: order.source.chain, contract: order.source.contract_address },
];

function snapshot(): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    // The gate this export is for — MUST be the collection the order names, else the audit refuses (S5-T1).
    collection: { chain: order.source.chain, contract: order.source.contract_address },
    captured_at: '2026-06-22T11:00:00.000Z',
    export_method: 'export',
    owner: '0x' + '9'.repeat(40),
    freshness_threshold_seconds: 86_400,
    entries: [
      { discord_user_id: 'u1', wallet: R1, role_ids: ['h'] },
      { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] },
      { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] },
      { discord_user_id: 'u4', role_ids: ['h'] }, // unmatched (no wallet)
    ],
  };
}

const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () =>
    new Map([
      [R1, 1n],
      [R2, 1n],
      [R3, 1n],
      [X, 1n],
    ]),
  currentBalances: async () =>
    new Map([
      [R1, 1n],
      [R3, 1n],
      [Y, 1n],
    ]),
};
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles = (s: RoleSnapshot | undefined = snapshot()): RoleSource => ({ load: async () => s });

function req(over: Partial<AuditRequest> = {}): AuditRequest {
  return {
    order,
    snapshotDate: '2026-06-22',
    isOperatedCommunity: true,
    nowUnixSeconds: NOW,
    includeRecords: false,
    cta: { product: '/shadow-access', conversation: '/talk' },
    ...over,
  };
}
function deps(over: Partial<AuditDeps> = {}): AuditDeps {
  return { ownership, whale, roles: roles(), sources: oneSource, ...over };
}

describe('runAudit — refusals', () => {
  it('refuses an external (non-operated) community', async () => {
    const r = await runAudit(req({ isOperatedCommunity: false }), deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('external-mode');
  });

  it('refuses when there is no role snapshot', async () => {
    const rolesNone: RoleSource = { load: async () => undefined };
    const r = await runAudit(req(), deps({ roles: rolesNone }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('external-mode');
  });

  it('refuses (reconstruction-failed) when ownership throws', async () => {
    const throwing: OwnershipSource = {
      resolveSnapshotBlock: async () => 1000,
      balancesAt: async () => {
        throw new Error('within-reorg-window');
      },
      currentBalances: async () => new Map(),
    };
    const r = await runAudit(req(), deps({ ownership: throwing }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('reconstruction-failed');
  });
});

describe('runAudit — aggregate + k-anonymity', () => {
  it('computes turnover, stale set, risk band; k-anonymizes small cohorts', async () => {
    const r = await runAudit(req(), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.aggregate.holder_turnover).toBe(0.5); // soldLapsed 2 / qualified@snap 4
    expect(r.output.aggregate.stale_access).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(r.output.aggregate.newly_eligible).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(r.output.aggregate.stale_access_risk_band).toBe('high'); // 1/3 role-holders stale
    expect(r.output.aggregate.whale_concentration).toBe(0.3);
    expect(r.output.records).toBeUndefined(); // anonymous
    // 3 of 4 role-holders resolved (75%) — fresh, but BELOW the confident-coverage bar, so the
    // aggregate is labelled directional. Freshness alone no longer buys confidence (486383).
    expect(r.uncertain).toBe(true);
    expect(r.output.aggregate.coverage_uncertain).toBe(true);
    expect(r.unmatchedRoleHolders).toBe(1);
    expect(r.output.run_id).toMatch(/^run_[0-9a-f]{24}$/);
    expect(AuditOutputSchema.safeParse(r.output).success).toBe(true);
  });

  it('emits exact counts when k = 1', async () => {
    const r = await runAudit(req(), deps({ k: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.aggregate.stale_access).toEqual({ kind: 'exact', value: 1 });
    expect(r.output.aggregate.sold_lapsed).toEqual({ kind: 'exact', value: 2 });
    expect(r.output.aggregate.newly_eligible).toEqual({ kind: 'exact', value: 1 });
  });
});

describe('runAudit — records (authed)', () => {
  it('emits per-member bands when records are requested', async () => {
    const r = await runAudit(req({ includeRecords: true }), deps());
    expect(r.ok).toBe(true);
    if (!r.ok || !r.output.records) throw new Error('expected records');
    const byWallet = new Map(r.output.records.map((rec) => [rec.wallet, rec]));
    expect(byWallet.get(R1)?.band).toBe('ok'); // role + qualifies
    expect(byWallet.get(R2)?.band).toBe('stale'); // role, no longer qualifies
    expect(byWallet.get(R3)?.band).toBe('ok');
    expect(byWallet.get(Y)?.band).toBe('missing'); // qualifies, no role
    expect(r.output.records.length).toBe(4);
  });
});

describe('runAudit — determinism (IMP-001)', () => {
  it('produces an identical run_id + output for identical inputs', async () => {
    const a = await runAudit(req(), deps());
    const b = await runAudit(req(), deps());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.output.run_id).toBe(b.output.run_id);
      expect(a.output).toEqual(b.output);
    }
  });

  it('keeps inputs_hash stable across time but makes run_id unique per run (BB-3)', async () => {
    const a = await runAudit(req({ nowUnixSeconds: NOW }), deps());
    const b = await runAudit(req({ nowUnixSeconds: NOW + 60 }), deps());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.output.inputs_hash).toBe(b.output.inputs_hash);
      expect(a.output.run_id).not.toBe(b.output.run_id);
    }
  });
});

describe('runAudit — hardening fixes', () => {
  it('clamps a huge ERC-1155 balance in evidence (MED-2)', async () => {
    const huge: Map<string, bigint> = new Map([[R1, 10n ** 30n]]);
    const ow: OwnershipSource = {
      resolveSnapshotBlock: async () => 1000,
      balancesAt: async () => huge,
      currentBalances: async () => huge,
    };
    const r = await runAudit(req({ includeRecords: true }), deps({ ownership: ow }));
    if (!r.ok || !r.output.records) throw new Error('expected records');
    const rec = r.output.records.find((x) => x.wallet === R1);
    expect(rec?.evidence.balance_at_snapshot).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('coarsens holder_turnover when sold_lapsed is suppressed (BB-4)', async () => {
    const w = (h: string) => '0x' + h.repeat(40);
    const snap: Map<string, bigint> = new Map([[w('1'), 1n], [w('2'), 1n], [w('3'), 1n]]);
    const cur: Map<string, bigint> = new Map([[w('1'), 1n], [w('2'), 1n]]); // 1 of 3 sold
    const ow: OwnershipSource = {
      resolveSnapshotBlock: async () => 1000,
      balancesAt: async () => snap,
      currentBalances: async () => cur,
    };
    const r = await runAudit(req(), deps({ ownership: ow }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.aggregate.sold_lapsed.kind).toBe('bucketed');
      expect(r.output.aggregate.holder_turnover).toBe(0.3); // 1/3 coarsened to the 0.1 grid
    }
  });
});

/**
 * S5-T3 — THE UNION. The bug this suite exists to kill, grounded on live data (2026-07-12):
 *
 *   Honeycomb: 2,280 holders on ethereum · 1,813 on berachain — ONE collection, TWO deployments.
 *
 * `runAudit` reconstructed ONLY the deployment the order named. Addressed via berachain it saw 44% of the
 * holders, and every ethereum holder with a Discord role — holding the collection, right now — came back as
 * STALE ACCESS: "has the role, no longer qualifies". Revoking on that number would have cut off thousands
 * of real holders. Every one of these tests FAILS against the single-source engine.
 */
describe('runAudit — multi-source collections (S5-T3)', () => {
  const ETH = '0x' + 'a'.repeat(40); // the collection on ethereum (chain 1)
  const BERA = '0x' + 'b'.repeat(40); // the SAME collection on berachain (chain 80094)
  // SIX role-holders whose tokens are ALL on ethereum — enough to clear k, so the false cohort the
  // single-source engine produces is an EXACT number rather than a k-anon bucket. (The real Honeycomb
  // number is 2,280; six is the smallest fixture that shows the same shape.)
  const ETH_HOLDERS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((s) => '0x' + s.repeat(20));
  const ETH_ONLY = ETH_HOLDERS[0]!;
  const BERA_ONLY = '0x' + 'c'.repeat(40); // role-holder whose tokens are ALL on berachain

  /** The audit is ADDRESSED via berachain — the request shape is unchanged (chain+contract). */
  const beraOrder: Order = {
    ...order,
    source: { chain: '80094', contract_address: BERA },
  };

  /** Both deployments declared: either one addresses the collection, and both are reconstructed. */
  const bothSources: SourceResolver = () => [
    { chain: '1', contract: ETH },
    { chain: '80094', contract: BERA },
  ];
  /** The pre-S5 view: the collection is ONLY the addressed chain. */
  const beraOnly: SourceResolver = () => [{ chain: '80094', contract: BERA }];

  const bal = (...wallets: string[]): Balances => new Map(wallets.map((w) => [w, 1n]));

  /** Chain-aware ownership: the ETH holders exist only on chain 1, BERA_ONLY only on 80094. */
  const chainAware: OwnershipSource = {
    resolveSnapshotBlock: async ({ chain }) => (chain === '1' ? 19_000_000 : 4_200_000),
    balancesAt: async ({ chain }) => (chain === '1' ? bal(...ETH_HOLDERS) : bal(BERA_ONLY)),
    currentBalances: async ({ chain }) => (chain === '1' ? bal(...ETH_HOLDERS) : bal(BERA_ONLY)),
  };

  const bridgedRoles: RoleSource = {
    load: async () => ({
      ...snapshot(),
      collection: { chain: beraOrder.source.chain, contract: BERA },
      entries: [
        ...ETH_HOLDERS.map((w, i) => ({ discord_user_id: `e${i}`, wallet: w, role_ids: ['h'] })),
        { discord_user_id: 'b1', wallet: BERA_ONLY, role_ids: ['h'] },
      ],
    }),
  };

  const bridgedReq = req({ order: beraOrder, includeRecords: true });

  it('a wallet holding ONLY on ethereum qualifies for an audit addressed via the berachain contract', async () => {
    const r = await runAudit(bridgedReq, {
      ownership: chainAware,
      whale,
      roles: bridgedRoles,
      sources: bothSources,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The whole point: NOBODY is stale. Every role-holder holds the collection — on one chain or the
    // other. Under the single-source engine all six ethereum holders came back STALE.
    expect(r.output.records!.filter((rec) => rec.band === 'stale')).toEqual([]);
    const bands = new Map(r.output.records!.map((rec) => [rec.wallet, rec.band]));
    expect(bands.get(ETH_ONLY)).toBe('ok');
    expect(bands.get(BERA_ONLY)).toBe('ok');
    // Evidence is the balance on the chain the wallet actually holds on — checkable against ONE chain.
    const ethRec = r.output.records!.find((rec) => rec.wallet === ETH_ONLY);
    expect(ethRec?.evidence.balance_at_snapshot).toBe(1);
  });

  it('UNION ≠ single-chain: the same fixture brands all six ethereum holders stale when a source is dropped', async () => {
    const single = await runAudit(bridgedReq, {
      ownership: chainAware,
      whale,
      roles: bridgedRoles,
      sources: beraOnly, // the pre-S5 view of the collection
    });
    const union = await runAudit(bridgedReq, {
      ownership: chainAware,
      whale,
      roles: bridgedRoles,
      sources: bothSources,
    });
    expect(single.ok && union.ok).toBe(true);
    if (!single.ok || !union.ok) return;
    // The delta IS the bug: six FALSE stale-access under single-source, zero under the union.
    expect(single.output.aggregate.stale_access).toEqual({ kind: 'exact', value: 6 });
    expect(single.output.records!.filter((rec) => rec.band === 'stale')).toHaveLength(6);
    expect(union.output.records!.filter((rec) => rec.band === 'stale')).toEqual([]);
    // And the two runs must not be confusable — different source sets, different fingerprints.
    expect(single.output.inputs_hash).not.toBe(union.output.inputs_hash);
  });

  it('inputs_hash separates two source-sets a single-source hash would have COLLIDED', async () => {
    // Both runs are addressed at berachain and read bera at the SAME block. The old hash covered only
    // {chain, contract, snapshot_block} of the addressed source — byte-identical for both. They are
    // different computations over different collections and must never share a run_id.
    const single = await runAudit(bridgedReq, { ownership: chainAware, whale, roles: bridgedRoles, sources: beraOnly });
    const union = await runAudit(bridgedReq, { ownership: chainAware, whale, roles: bridgedRoles, sources: bothSources });
    if (!single.ok || !union.ok) throw new Error('expected both to succeed');
    expect(single.output.inputs_hash).not.toBe(union.output.inputs_hash);
  });

  it('is addressing-INVARIANT: the same collection audited via either chain yields the same fingerprint', async () => {
    const viaBera = await runAudit(req({ order: beraOrder }), {
      ownership: chainAware, whale, roles: bridgedRoles, sources: bothSources,
    });
    const viaEth = await runAudit(
      req({ order: { ...order, source: { chain: '1', contract_address: ETH } } }),
      {
        ownership: chainAware,
        whale,
        // the snapshot is keyed by collection; address via eth and the eth-keyed snapshot is the one loaded
        roles: { load: async () => ({ ...snapshot(), collection: { chain: '1', contract: ETH },
          entries: [
            { discord_user_id: 'u1', wallet: ETH_ONLY, role_ids: ['h'] },
            { discord_user_id: 'u2', wallet: BERA_ONLY, role_ids: ['h'] },
          ] }) },
        sources: bothSources,
      },
    );
    if (!viaBera.ok || !viaEth.ok) throw new Error('expected both to succeed');
    // One collection, one computation — the fingerprint covers the SOURCE SET, not the door used.
    expect(viaBera.output.inputs_hash).toBe(viaEth.output.inputs_hash);
  });

  it('FAIL-CLOSED: ANY unreachable source refuses the whole audit — never a partial union', async () => {
    const ethDown: OwnershipSource = {
      ...chainAware,
      balancesAt: async (args) => {
        if (args.chain === '1') throw new Error('rpc 408 on ethereum');
        return chainAware.balancesAt(args);
      },
    };
    const r = await runAudit(bridgedReq, {
      ownership: ethDown,
      whale,
      roles: bridgedRoles,
      sources: bothSources,
    });
    // A partial union would have served an audit branding every ethereum holder stale. Refuse instead.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('reconstruction-failed');
    expect(r.refusal.retryable).toBe(true);
  });

  it('REFUSES an undeclared contract rather than auditing it as a standalone collection', async () => {
    const r = await runAudit(bridgedReq, {
      ownership: chainAware,
      whale,
      roles: bridgedRoles,
      sources: () => undefined, // not in the registry
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('unindexed-contract');
  });

  it('NAMES the union semantics + every source it read, in the output', async () => {
    const r = await runAudit(bridgedReq, {
      ownership: chainAware, whale, roles: bridgedRoles, sources: bothSources,
    });
    if (!r.ok) throw new Error('expected an audit');
    // The reader is TOLD how the chains were combined — never left to assume.
    expect(r.output.methodology?.union_semantics).toBe('any-source');
    expect(r.output.methodology?.collection_sources).toEqual([
      { chain: '1', contract: ETH, snapshot_block: 19_000_000 },
      { chain: '80094', contract: BERA, snapshot_block: 4_200_000 },
    ]);
    expect(AuditOutputSchema.safeParse(r.output).success).toBe(true);
  });

  it('applies the threshold PER-SOURCE (any-source), never to a cross-chain sum', async () => {
    // 2 tokens on eth + 2 on bera = 4 summed, but only 2 on any ONE chain. Threshold 3 must REFUSE
    // qualification: summing would manufacture access out of holdings that exist on no single chain.
    const split: OwnershipSource = {
      resolveSnapshotBlock: async () => 100,
      balancesAt: async () => new Map([[ETH_ONLY, 2n]]),
      currentBalances: async () => new Map([[ETH_ONLY, 2n]]),
    };
    const r = await runAudit(
      req({
        order: { ...beraOrder, gating_rule: { kind: 'nft-balance', threshold: 3 } },
        includeRecords: true,
      }),
      {
        ownership: split,
        whale,
        roles: { load: async () => ({ ...snapshot(), collection: { chain: '80094', contract: BERA },
          entries: [{ discord_user_id: 'u1', wallet: ETH_ONLY, role_ids: ['h'] }] }) },
        sources: bothSources,
        k: 1,
      },
    );
    if (!r.ok) throw new Error('expected an audit');
    const rec = r.output.records!.find((x) => x.wallet === ETH_ONLY);
    expect(rec?.qualifies).toBe(false); // 2 < 3 on every source; 2+2 is not a holding
    expect(rec?.band).toBe('stale');
  });
});

/**
 * Bug 20260712-486383 — the confidently-wrong audit.
 *
 * LIVE (2026-07-12): the THJ exporter produced a FRESH, contract-valid snapshot of 515 role-holders
 * of which exactly 1 resolved to a wallet. The audit computed every cohort over `roleWallets.size === 1`:
 * `newly_eligible` swallowed essentially the ENTIRE holder set (every holder "has tokens but no role" —
 * because we cannot SEE their role), and `stale_access_risk_band` ran on a denominator of 1. The output
 * was contract-valid, deterministic, and wrong, with no signal that anything was off.
 *
 * The fix: coverage below a documented floor REFUSES; partial coverage is served but LABELLED, and the
 * unmatched count reaches the wire so a reader can bound the error.
 */
describe('runAudit — role coverage (bug 20260712-486383)', () => {
  /** `matchedCount` resolved of `total` role-holders; the matched ones all still qualify on-chain. */
  function coverageSnapshot(matchedCount: number, total: number): RoleSnapshot {
    return {
      ...snapshot(),
      entries: Array.from({ length: total }, (_, i) =>
        i < matchedCount
          ? {
              discord_user_id: `u${i}`,
              wallet: '0x' + (i + 1).toString(16).padStart(40, '0'),
              role_ids: ['h'],
            }
          : { discord_user_id: `u${i}`, role_ids: ['h'] },
      ),
    };
  }

  /** A big current-holder set — the ~1813 real Honeycomb holders, none of them role-matched. */
  function manyHolders(n: number): OwnershipSource {
    const bal = new Map<string, bigint>(
      Array.from({ length: n }, (_, i) => ['0x' + (i + 5000).toString(16).padStart(40, '0'), 1n]),
    );
    return {
      resolveSnapshotBlock: async () => 1000,
      balancesAt: async () => bal,
      currentBalances: async () => bal,
    };
  }

  it('REFUSES the real 1/515 THJ snapshot instead of emitting a confident aggregate', async () => {
    const r = await runAudit(
      req(),
      deps({ roles: roles(coverageSnapshot(1, 515)), ownership: manyHolders(1813) }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('role-coverage-too-low');
    // Names what we cannot see, rather than dressing it up as a number.
    expect(r.refusal.reason).toContain('515');
  });

  it('surfaces coverage + the unmatched count ON THE WIRE when coverage is partial', async () => {
    // 14/20 = 70%: above the floor, below the confident bar. 6 unmatched >= k(5) → exact cohort,
    // so the true ratio may be published (it cannot back-compute a suppressed numerator).
    const r = await runAudit(
      req(),
      deps({ roles: roles(coverageSnapshot(14, 20)), ownership: manyHolders(1813) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.aggregate.coverage_uncertain).toBe(true);
    expect(r.output.aggregate.unmatched_role_holders).toEqual({ kind: 'exact', value: 6 });
    expect(r.output.aggregate.role_coverage).toBe(0.7);
    expect(AuditOutputSchema.safeParse(r.output).success).toBe(true);
  });

  it('SUPPRESSES the coverage ratio when the unmatched cohort is k-anon-suppressed', async () => {
    // 18/20 = 90% (confident) with 2 unmatched < k(5). Publishing the exact ratio alongside a
    // suppressed cohort back-computes the suppressed numerator once the total is known —
    // "rounding is not suppression" (the access-risk.ts / BB-4 lesson).
    const r = await runAudit(
      req(),
      deps({ roles: roles(coverageSnapshot(18, 20)), ownership: manyHolders(1813) }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.aggregate.unmatched_role_holders).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(r.output.aggregate.role_coverage).toBeNull();
    expect(r.output.aggregate.coverage_uncertain).toBe(false); // 90% clears the bar
  });

  it('still serves a CONFIDENT aggregate at full coverage (no false-positive uncertainty)', async () => {
    const r = await runAudit(req(), deps({ roles: roles(coverageSnapshot(20, 20)) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uncertain).toBe(false);
    expect(r.output.aggregate.coverage_uncertain).toBe(false);
    expect(r.output.aggregate.role_coverage).toBe(1);
    expect(r.output.aggregate.unmatched_role_holders).toEqual({ kind: 'bucketed', bucket: '<5' });
  });
});
