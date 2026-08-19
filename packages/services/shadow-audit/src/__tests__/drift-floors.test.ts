/**
 * S5-T4 — the two provable drift floors.
 *
 * Grounded on the LIVE board (2026-07-12). thj has ~0% discord→wallet coverage, so the audit cannot name
 * WHICH members are stale — but distinct members need distinct wallets, so the counts alone bound the drift.
 *
 * These tests hold three lines, and the last two are the ones that matter:
 *   1. the floors reproduce the real board exactly;
 *   2. when a floor's identity assumption is VIOLATED, the payload SAYS SO — the number is wrong, and the
 *      output tells the reader which way it is wrong (both floors err ALARMIST, never safe);
 *   3. a floor never back-computes a k-anon-suppressed holder count.
 */

import { describe, it, expect } from 'vitest';
import {
  DriftReportSchema,
  STALE_FLOOR_ASSUMPTION,
  UNDERGRANT_FLOOR_ASSUMPTION,
  type Order,
} from '@freeside/shadow-audit-protocol';
import { computeDrift } from '../drift-floors.js';
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

const K = 5;

// ══ 1. THE LIVE BOARD ═══════════════════════════════════════════════════════════════════════════════
// Every row below is real, measured on 2026-07-12. The dominant drift is UNDER-GRANTING (>=3,350 holders
// qualify but hold no role), not stale access — the product framing had it backwards for this community.

describe('the floors reproduce the live thj board (2026-07-12)', () => {
  const board = (roleMembers: number, ...perSource: Array<[string, number]>) =>
    computeDrift({
      roleMembers,
      perSource: perSource.map(([chain, holders]) => ({ chain, holders })),
      k: K,
    });

  it('Honeycomb — 515 role members · eth 2,280 · bera 1,813 → undergrant >=1,765, stale 0', () => {
    const d = board(515, ['ethereum', 2280], ['berachain', 1813]);
    expect(d.undergrant_floor!.value).toBe(1765); // MAX(2280) − 515
    expect(d.stale_floor!.value).toBe(0); //          515 − SUM(4093) < 0
    // The HEADLINE is the side-by-side, and it is what a reader must be able to read off the payload.
    expect(d.role_members).toEqual({ kind: 'exact', value: 515 });
    expect(d.per_source_holders).toEqual([
      { chain: 'ethereum', holders: { kind: 'exact', value: 2280 } },
      { chain: 'berachain', holders: { kind: 'exact', value: 1813 } },
    ]);
    expect(d.access_basis).toBe('counts-only'); // zero identity data was used
    expect(DriftReportSchema.safeParse(d).success).toBe(true);
  });

  it('HoneyJar1 — 244 · eth 782 · bera 213 → undergrant >=538', () => {
    expect(board(244, ['ethereum', 782], ['berachain', 213]).undergrant_floor!.value).toBe(538);
  });

  it('HoneyJar2 — 174 · eth 9 · arb 544 · bera 189 → undergrant >=370', () => {
    const d = board(174, ['ethereum', 9], ['arbitrum', 544], ['berachain', 189]);
    expect(d.undergrant_floor!.value).toBe(370);
    expect(d.stale_floor!.value).toBe(0);
  });

  it('HoneyJar3 — 244 · bera 157 · eth <5 → stale >=83 (the one row with REAL stale drift)', () => {
    // eth holds 4 — below k, so its count is SUPPRESSED. The floor is derived from the widest total
    // consistent with that bucket (157 + 4), which lands on exactly the board's >=83.
    const d = board(244, ['berachain', 157], ['ethereum', 4]);
    expect(d.stale_floor!.value).toBe(83);
    expect(d.undergrant_floor!.value).toBe(0);
    expect(d.per_source_holders[1]!.holders).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(d.floors_from_public_bound).toBe(true);
    expect(DriftReportSchema.safeParse(d).success).toBe(true);
  });

  it('HoneyJar4 — 190 · eth <5 · op 499 · bera 152 → undergrant >=309', () => {
    expect(board(190, ['ethereum', 4], ['optimism', 499], ['berachain', 152]).undergrant_floor!.value).toBe(309);
  });

  it('HoneyJar5 — 182 · base 467 · bera 193 → undergrant >=285', () => {
    expect(board(182, ['base', 467], ['berachain', 193]).undergrant_floor!.value).toBe(285);
  });

  it('HoneyJar6 — 41 · eth 124 · bera 98 → undergrant >=83', () => {
    expect(board(41, ['ethereum', 124], ['berachain', 98]).undergrant_floor!.value).toBe(83);
  });
});

// ══ 1b. A SUB-K ROLE SET SUPPRESSES THE FLOORS — it does NOT refuse the audit ════════════════════════

describe('a sub-k role set suppresses the FLOORS, never the audit', () => {
  it('buckets role_members and NULLS both floors — the derived half is what is unsafe, not the answer', () => {
    // 3 members < k(5). Publishing a floor here hands the bucket straight back: R = stale_floor + SUM(holders).
    const d = computeDrift({
      roleMembers: 3,
      perSource: [{ chain: 'berachain', holders: 200 }],
      k: K,
    });
    expect(d.role_members).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(d.stale_floor).toBeNull();
    expect(d.undergrant_floor).toBeNull();
    expect(d.floors_from_public_bound).toBe(false); // nothing bound-derived to flag
    // …and the SIDE-BY-SIDE survives: the measured half needs no assumption and leaks nothing.
    expect(d.per_source_holders).toEqual([{ chain: 'berachain', holders: { kind: 'exact', value: 200 } }]);
    expect(DriftReportSchema.safeParse(d).success).toBe(true);
  });

  it('produces the SAME payload for every sub-k role size — else the floors would be an oracle for R', () => {
    const shape = (roleMembers: number) =>
      computeDrift({ roleMembers, perSource: [{ chain: 'berachain', holders: 200 }], k: K });
    for (const r of [1, 2, 3, 4]) expect(shape(r)).toEqual(shape(1));
  });
});

// ══ 2. K-ANONYMITY — a floor must not back-compute a suppressed cohort ═══════════════════════════════

describe('k-anon: the floors are derived from the PUBLISHED counts, never the true ones', () => {
  it('does NOT reveal a suppressed holder count through the floor it feeds', () => {
    // HoneyJar3's shape, but ethereum holds TWO. The TRUE stale floor is 244 − (157+2) = 85.
    // Publishing 85 alongside role_members=244 and bera=157 says "ethereum holds 2" out loud — the exact
    // cohort the `<5` bucket exists to hide. Suppressing the FLOOR instead would be fiction (a reader just
    // recomputes it). So the floor is derived from the WIDEST total consistent with the bucket: 157 + (k−1).
    const d = computeDrift({
      roleMembers: 244,
      perSource: [
        { chain: 'berachain', holders: 157 },
        { chain: 'ethereum', holders: 2 },
      ],
      k: K,
    });
    expect(d.stale_floor!.value).toBe(83); // NOT 85 — 85 would disclose eth = 2
    expect(d.stale_floor!.value).not.toBe(85);
    expect(d.floors_from_public_bound).toBe(true);
    // ...and the same published payload is produced whether ethereum holds 1, 2, 3 or 4 — that is what
    // "suppressed" has to mean. If any of these differed, the floor would be an oracle for the bucket.
    for (const hidden of [1, 2, 3, 4]) {
      const alt = computeDrift({
        roleMembers: 244,
        perSource: [
          { chain: 'berachain', holders: 157 },
          { chain: 'ethereum', holders: hidden },
        ],
        k: K,
      });
      expect(alt).toEqual(d);
    }
  });

  it('stays conservative: the published floor never EXCEEDS the floor the true counts would give', () => {
    // The bound understates (it assumes the hidden chains hold as much as they possibly could), so the
    // published number is always <= the true floor. It errs quiet, not loud — the right direction for a
    // number that will be shown to a community about its own members.
    const published = computeDrift({
      roleMembers: 244,
      perSource: [{ chain: 'berachain', holders: 157 }, { chain: 'ethereum', holders: 1 }],
      k: K,
    }).stale_floor!.value;
    const trueFloor = Math.max(0, 244 - (157 + 1));
    expect(published).toBeLessThanOrEqual(trueFloor);
    expect(published).toBe(83);
    expect(trueFloor).toBe(86);
  });

  it('flags floors as bound-derived ONLY when a cohort was actually suppressed', () => {
    const clean = computeDrift({
      roleMembers: 515,
      perSource: [{ chain: 'ethereum', holders: 2280 }, { chain: 'berachain', holders: 1813 }],
      k: K,
    });
    expect(clean.floors_from_public_bound).toBe(false);
  });
});

// ══ 3. THE AUDIT PATH — the floors on the wire, and what happens when their assumptions BREAK ════════

const CONTRACT = '0x' + 'a'.repeat(40);
const NOW = Math.floor(Date.UTC(2026, 6, 12, 12, 0, 0) / 1000);
const w = (n: number): string => '0x' + n.toString(16).padStart(40, '0');

const order: Order = {
  community: { name: 'thj', owner_wallet: '0x' + '9'.repeat(40) },
  source: { chain: '1', contract_address: CONTRACT },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'],
  mode: 'lead-magnet',
};
const oneSource: SourceResolver = () => [{ chain: '1', contract: CONTRACT }];
const whale: WhaleSource = { concentration: async () => 0.1 };

/** A snapshot of `members`, each mapped to the wallet given. Two members with the SAME wallet is the
 *  shared-wallet case; a member whose second wallet is invisible to the export is the multi-wallet case. */
function snapshotOf(wallets: Array<string | undefined>): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    collection: { chain: '1', contract: CONTRACT },
    captured_at: '2026-07-12T11:00:00.000Z',
    export_method: 'export',
    owner: '0x' + '9'.repeat(40),
    freshness_threshold_seconds: 86_400,
    entries: wallets.map((wallet, i) => ({
      discord_user_id: `u${i}`,
      ...(wallet ? { wallet } : {}),
      role_ids: ['h'],
    })),
  };
}

function holders(...wallets: string[]): OwnershipSource {
  const bal: Balances = new Map(wallets.map((x) => [x, 1n] as const));
  return {
    resolveSnapshotBlock: async () => 1000,
    balancesAt: async () => bal,
    currentBalances: async () => bal,
  };
}

function req(over: Partial<AuditRequest> = {}): AuditRequest {
  return {
    order,
    snapshotDate: '2026-07-12',
    isOperatedCommunity: true,
    nowUnixSeconds: NOW,
    includeRecords: true,
    cta: { product: '/shadow-access', conversation: '/talk' },
    ...over,
  };
}
function deps(snap: RoleSnapshot, ownership: OwnershipSource, over: Partial<AuditDeps> = {}): AuditDeps {
  const roles: RoleSource = { load: async () => snap };
  return { ownership, whale, roles, sources: oneSource, ...over };
}

describe('runAudit — the drift report reaches the wire', () => {
  it('emits the side-by-side + both floors with the authed delta, and the schema accepts it', async () => {
    // 6 members, 6 wallets, 8 on-chain holders → undergrant floor 2, stale floor 0.
    const snap = snapshotOf([1, 2, 3, 4, 5, 6].map(w));
    const r = await runAudit(req(), deps(snap, holders(...[1, 2, 3, 4, 5, 6, 7, 8].map(w))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.output.drift!;
    expect(d.role_members).toEqual({ kind: 'exact', value: 6 });
    expect(d.per_source_holders).toEqual([{ chain: '1', holders: { kind: 'exact', value: 8 } }]);
    expect(d.undergrant_floor!.value).toBe(2);
    expect(d.stale_floor!.value).toBe(0);
    expect(DriftReportSchema.safeParse(d).success).toBe(true);
  });

  it('still SERVES the audit for a sub-k role set — only the floors are withheld', async () => {
    // 4 members < k(5). The audit's own cohorts already k-anonymize themselves and reported role sets this
    // size correctly long before the drift report existed. Refusing the whole audit to protect ONE optional
    // derived field would be a behaviour regression far larger than the field. Suppress the field; serve the
    // answer.
    const r = await runAudit(req(), deps(snapshotOf([1, 2, 3, 4].map(w)), holders(...[1, 2, 3].map(w))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.records).toBeDefined(); // the audit is intact
    const d = r.output.drift!;
    expect(d.role_members).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(d.stale_floor).toBeNull();
    expect(d.undergrant_floor).toBeNull();
  });
});

/**
 * THE LOAD-BEARING TESTS. The floors are NOT symmetrically safe, and the SUM/MAX slack argument does NOT
 * save them when their IDENTITY assumption is violated — under violation each floor OVERSTATES. A number
 * that is wrong in the alarmist direction, presented as a fact about PEOPLE, is the confidently-wrong shape
 * this service exists to prevent. So the contract's job is not to be right here — it is to SAY SO.
 */
describe('assumption violations — the floor is wrong, and the payload says which way', () => {
  it('SHARED WALLETS make stale_floor OVERSTATE — and the emitted claim names exactly that', async () => {
    // 6 members, but u4 and u5 share ONE wallet → 5 distinct wallets, all holding. NOBODY is stale.
    const shared = w(5);
    const snap = snapshotOf([w(1), w(2), w(3), w(4), shared, shared]);
    const r = await runAudit(req(), deps(snap, holders(w(1), w(2), w(3), w(4), shared)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.output.drift!;

    // The floor says >=1 member has stale access. The TRUTH is zero — every member holds. It OVERSTATES,
    // by exactly the number of members the chain cannot tell apart.
    expect(d.role_members).toEqual({ kind: 'exact', value: 6 });
    expect(d.per_source_holders[0]!.holders).toEqual({ kind: 'exact', value: 5 });
    expect(d.stale_floor!.value).toBe(1);
    expect(r.output.records!.filter((rec) => rec.band === 'stale')).toEqual([]); // ...and truly, none

    // THE POINT: the payload carries the assumption it just violated, and the direction of the error.
    expect(d.stale_floor!.assumption).toBe(STALE_FLOOR_ASSUMPTION);
    expect(d.stale_floor!.assumption).toContain('no two role members');
    expect(d.stale_floor!.breaks_when).toContain('share');
    expect(d.stale_floor!.direction_if_violated).toBe('overstates');
    // It bounds WALLETS, not people — one person with ten wallets is ten holders.
    expect(d.stale_floor!.bounds).toBe('wallets');
    expect(d.disclosure).toContain('WALLETS, never a number of PEOPLE');
  });

  it('MULTI-WALLET members make undergrant_floor OVERSTATE — and the emitted claim names exactly that', async () => {
    // 5 members, each holding through TWO wallets (the export only knows one of each) → 10 on-chain
    // holders. Every holder IS a member: the true undergrant count is ZERO.
    const snap = snapshotOf([1, 2, 3, 4, 5].map(w));
    const second = [11, 12, 13, 14, 15].map(w); // each member's second wallet — invisible to the export
    const r = await runAudit(req(), deps(snap, holders(...[1, 2, 3, 4, 5].map(w), ...second)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.output.drift!;

    // The floor says >=5 qualifying wallets hold no role. The TRUTH is zero — they are the same five people.
    // This is the FRAGILE floor (multi-wallet is common in crypto) AND the headline number (thj: >=3,350).
    expect(d.role_members).toEqual({ kind: 'exact', value: 5 });
    expect(d.per_source_holders[0]!.holders).toEqual({ kind: 'exact', value: 10 });
    expect(d.undergrant_floor!.value).toBe(5);

    expect(d.undergrant_floor!.assumption).toBe(UNDERGRANT_FLOOR_ASSUMPTION);
    expect(d.undergrant_floor!.assumption).toContain('at most one wallet');
    expect(d.undergrant_floor!.breaks_when).toContain('several wallets');
    expect(d.undergrant_floor!.direction_if_violated).toBe('overstates');
    expect(d.undergrant_floor!.bounds).toBe('wallets');
  });
});

/**
 * A COVERAGE REFUSAL MUST STILL CARRY THE DRIFT — found by the first live settle probe (2026-07-13).
 *
 * S5 built the drift board precisely so a community with NO wallet map could see its drift. But
 * `role-coverage-too-low` refused the whole audit BEFORE the board was computed — so thj, at ~0% wallet
 * coverage, got a refusal and nothing else. The audit was refusing to show the one report it had built
 * for exactly that community. The board needs no wallets; the refusal is about the wallet-derived
 * cohorts. Those are different questions, and only one of them is unanswerable.
 */
describe('runAudit — the coverage refusal carries the drift board', () => {
  it('refuses the aggregate at 1/515 coverage but STILL returns the counts-only drift', async () => {
    const C = '0x' + 'c'.repeat(40);
    const order: Order = {
      community: { name: 'thj', owner_wallet: '0x' + '9'.repeat(40) },
      source: { chain: '80094', contract_address: C },
      gating_rule: { kind: 'nft-balance', threshold: 1 },
      products: ['audit'],
      mode: 'lead-magnet',
    };
    // The real shape: 515 role-holders, ONE resolvable wallet.
    const snap: RoleSnapshot = {
      source: 'discord:guild:1',
      community: 'thj',
      collection: { chain: '80094', contract: C },
      captured_at: '2026-07-01T00:00:00.000Z',
      export_method: 'export',
      owner: '0x' + '9'.repeat(40),
      freshness_threshold_seconds: 86_400_000,
      entries: Array.from({ length: 515 }, (_, i) =>
        i === 0
          ? { discord_user_id: 'u0', wallet: '0x' + '1'.repeat(40), role_ids: ['h'] }
          : { discord_user_id: `u${i}`, role_ids: ['h'] },
      ),
    };
    const holders: Balances = new Map(
      Array.from({ length: 1813 }, (_, i) => ['0x' + (i + 1000).toString(16).padStart(40, '0'), 1n]),
    );
    const r = await runAudit(
      {
        order,
        snapshotDate: '2026-06-01',
        isOperatedCommunity: true,
        nowUnixSeconds: Math.floor(Date.UTC(2026, 6, 2) / 1000),
        includeRecords: false,
        cta: { product: '/p', conversation: '/c' },
      },
      {
        ownership: {
          resolveSnapshotBlock: async () => 1000,
          balancesAt: async () => holders,
          currentBalances: async () => holders,
        },
        whale: { concentration: async () => 0.4 },
        roles: { load: async () => snap },
        sources: () => [{ chain: '80094', contract: C }],
      },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.code).toBe('role-coverage-too-low');
    // THE POINT: the community still sees its drift. Refusing this was refusing the whole cycle's payoff.
    expect(r.drift).toBeDefined();
    expect(r.drift!.access_basis).toBe('counts-only');
    expect(r.drift!.role_members).toEqual({ kind: 'exact', value: 515 });
    expect(r.drift!.per_source_holders[0]!.holders).toEqual({ kind: 'exact', value: 1813 });
  });
});
