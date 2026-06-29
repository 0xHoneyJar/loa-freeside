import { describe, it, expect } from 'vitest';
import { type Order } from '@freeside/shadow-audit-protocol';
import { runAudit, type AuditRequest, type OwnershipSource, type RoleSource, type WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';

/**
 * KEYSTONE GATE (the designed gate, CORROBORATE not self-evidence) — `arrakis-wedge-migration-delta-cbox.1`.
 *
 * The migration-delta Comparison View (`diffShadow`) was built-but-UNCONSUMED; runAudit now consumes it into
 * `output.comparison`. This gate proves the consumption is LOAD-BEARING, not decorative:
 *   1. CORROBORATE — the comparison's demotions/promotions agree with the INDEPENDENTLY-computed aggregate
 *      cohorts (stale_access / newly_eligible). Two paths, one truth.
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
  source: 'discord:guild:1', community: 'thj', captured_at: '2026-06-22T11:00:00.000Z', export_method: 'export',
  owner: A('9', 9), freshness_threshold_seconds: 86_400,
  entries: [...roleStale, ...roleOk].map((wallet, i) => ({ discord_user_id: `u${i}`, wallet, role_ids: ['h'] })),
});
const roles: RoleSource = { load: async () => snapshot() };
const whale: WhaleSource = { concentration: async () => 0.3 };
const order: Order = {
  community: { name: 'thj', owner_wallet: A('9', 9) },
  source: { chain: 'ethereum', contract_address: CONTRACT },
  gating_rule: { kind: 'nft-balance', threshold: 1 },
  products: ['audit'], mode: 'lead-magnet',
};
const req = (): AuditRequest => ({
  order, snapshotDate: '2026-06-22', isOperatedCommunity: true, nowUnixSeconds: NOW, includeRecords: true,
  cta: { product: '/shadow-access', conversation: '/talk' },
});

describe('KEYSTONE: the audit consumes diffShadow into output.comparison (the migration delta)', () => {
  it('CORROBORATE: comparison demotions/promotions agree with the independent aggregate cohorts', async () => {
    const r = await runAudit(req(), { ownership: makeOwnership(), whale, roles });
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
    // CORROBORATION: the comparison (from records) and the aggregate (from cohorts) are computed by DIFFERENT
    // paths and must agree — demotions == stale_access, promotions == newly_eligible.
    expect(aggregate.stale_access).toEqual({ kind: 'exact', value: 6 });
    expect(aggregate.newly_eligible).toEqual({ kind: 'exact', value: 6 });
    expect(comparison.aggregate.demotions).toBe((aggregate.stale_access as { value: number }).value);
    expect(comparison.aggregate.promotions).toBe((aggregate.newly_eligible as { value: number }).value);
  });

  it('METHODOLOGY: the output carries the rule + snapshot so the delta is settle-able vs the incumbent', async () => {
    const r = await runAudit(req(), { ownership: makeOwnership(), whale, roles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.methodology).toEqual({
      rule_id: 'nft-balance:1',
      snapshot_block: SNAP_BLOCK,
      sources: ['sonar', 'role-snapshot'],
    });
  });

  it('TEETH: one stale holder re-acquiring MOVES the delta (the comparison tracks real decisions)', async () => {
    // roleStale[0] now holds 1 → it flips stale→ok: demotions 6→5, no_change 6→7.
    const r = await runAudit(req(), { ownership: makeOwnership([roleStale[0]!]), whale, roles });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.output.comparison) return;
    expect(r.output.comparison.aggregate.demotions).toBe(5);
    expect(r.output.comparison.aggregate.no_change).toBe(7);
    expect(r.output.comparison.aggregate.promotions).toBe(6); // unchanged
  });

  it('AUTHED-ONLY + CONTRACT-PARITY: an anon audit carries no per-member delta AND a byte-stable response shape', async () => {
    const r = await runAudit({ ...req(), includeRecords: false }, { ownership: makeOwnership(), whale, roles });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.records).toBeUndefined();
    expect(r.output.comparison).toBeUndefined(); // no wallets leak to anon
    expect(r.output.methodology).toBeUndefined(); // the methodology travels WITH the authed delta, not the anon response
    // CONTRACT-PARITY GUARD: the anon response keys must stay byte-stable — freeside-dashboard strict-decodes
    // GET /v1/audit with onExcessProperty:error, so any NEW top-level field silently breaks the integration.
    expect(Object.keys(r.output).sort()).toEqual(['aggregate', 'cta', 'inputs_hash', 'mode', 'run_id']);
  });
});
