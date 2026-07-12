/**
 * LIVE end-to-end proof — the test the audit never had. Sprint 1 was "build
 * complete, unit-verified" yet 400'd on first live contact, because every other
 * test injects a mock fetcher; only this one drives the REAL defaultTransferPageFetcher
 * against the live belt-gateway. It closes the unit-green-but-deployed-untrue gap.
 *
 * Gated by SONAR_LIVE (the default `vitest run` SKIPS it → CI stays hermetic; the
 * mock unit tests remain the deterministic "pinned fixture" half). Run via
 * `pnpm -C packages/adapters run test:live` (sets SONAR_LIVE=1).
 *
 * The expectation is the FRAMEWORK anchor pinned independently in
 * grimoires/loa/context/audit-live-anchor.mjs (code-independent of this adapter):
 *   ownershipAtBlock(Honeycomb, 887577) = { 0xc8c5…b9eb -> 1 }  (the only Transfer ≤ 887577)
 * If this passes while the framework anchor fails, that is drift — the oracle requires both.
 *
 * "Two routes, one truth": the multi-holder block is cross-checked against an
 * INDEPENDENT aggregate route — the fold's total token count must equal
 * mints − burns from a separate Transfer_aggregate query. A reconstruction that
 * silently dropped a page would disagree and fail here, not just `> 0`.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SonarClient } from '../sonar-client.js';

const LIVE = !!process.env.SONAR_LIVE;
const ENDPOINT = process.env.BELT_GATEWAY ||
  'https://belt-gateway-production.up.railway.app/v1/graphql';

// The pinned deployed-truth anchor (verified live 2026-06-24).
const COLLECTION = 'Honeycomb';
const CHAIN_ID = 80094;
const ANCHOR_BLOCK = 887_577;
const ANCHOR_HOLDER = '0xc8c5406008f4f8168cccfbef513f5238915db9eb';
const COMPARE_BLOCK = 1_000_000; // 175 Honeycomb transfers ≤ here (single page) — a real, tractable turnover window
const HEAD_BLOCK = 2_000_000;    // > compare + confirmations → both snapshots are final
const ZERO = '0x0000000000000000000000000000000000000000';
const K_ANON = 5;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPORT_PATH = resolve(repoRoot, 'grimoires/loa/reports/shadow-audit-honeycomb-887577.json');

/** Independent aggregate route — does NOT use the adapter's fetcher/fold. */
async function transferCount(where: Record<string, unknown>): Promise<number> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query($w: Transfer_bool_exp!){ Transfer_aggregate(where:$w){ aggregate{ count } } }`,
      variables: { w: where },
    }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(`aggregate route errored: ${JSON.stringify(body.errors).slice(0, 160)}`);
  return body.data.Transfer_aggregate.aggregate.count as number;
}

describe.skipIf(!LIVE)('SonarClient — LIVE deployed-truth reconstruction (real wire, not a mock)', () => {
  const client = new SonarClient({ endpoint: ENDPOINT });

  it('reconstructs ownershipAtBlock(Honeycomb, 887577) === the framework anchor { 0xc8c5…b9eb -> 1 }', async () => {
    const snap = await client.ownershipAtBlock({
      collection: COLLECTION, snapshotBlock: ANCHOR_BLOCK, standard: 'erc721', headBlock: HEAD_BLOCK,
    });
    // Exactly one holder, owning exactly one token — the lone mint ≤ 887577.
    expect(snap.balances.size).toBe(1);
    expect(snap.balances.get(ANCHOR_HOLDER)).toBe(1n);
  }, 60_000);

  it('cross-checks the multi-holder block via an INDEPENDENT route (Σ balances === mints − burns) and emits the report', async () => {
    const head = await client.ownershipAtBlock({
      collection: COLLECTION, snapshotBlock: COMPARE_BLOCK, standard: 'erc721', headBlock: HEAD_BLOCK,
    });
    const snap = await client.ownershipAtBlock({
      collection: COLLECTION, snapshotBlock: ANCHOR_BLOCK, standard: 'erc721', headBlock: HEAD_BLOCK,
    });

    // ── Route 2 (independent of the fold): tokens outstanding = mints − burns. ──
    const mints = await transferCount({ collection: { _eq: COLLECTION }, from: { _eq: ZERO }, blockNumber: { _lte: COMPARE_BLOCK } });
    const burns = await transferCount({ collection: { _eq: COLLECTION }, to: { _eq: ZERO }, blockNumber: { _lte: COMPARE_BLOCK } });
    const tokensRoute2 = mints - burns;
    const tokensRoute1 = [...head.balances.values()].reduce((a, b) => a + b, 0n);
    // The fold's total token count MUST equal the independent aggregate. A dropped
    // page or a fold bug disagrees here — not a vacuous `> 0`.
    expect(tokensRoute1).toBe(BigInt(tokensRoute2));

    // ── Turnover + concentration (real on-chain signal). ──
    const exited: string[] = [];
    const retained: string[] = [];
    for (const a of snap.balances.keys()) (head.balances.has(a) ? retained : exited).push(a);
    const newlyEligible = [...head.balances.keys()].filter((a) => !snap.balances.has(a));
    const sortedBal = [...head.balances.values()].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    const share = (n: number) =>
      tokensRoute1 === 0n ? 0 : Math.round(Number((sortedBal.slice(0, n).reduce((a, b) => a + b, 0n) * 1000n) / tokensRoute1)) / 10;

    const inputs = { chain_id: CHAIN_ID, collection: COLLECTION, snapshot_block: ANCHOR_BLOCK, rule: { kind: 'nft-balance', threshold: 1 } };
    const inputs_hash = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');

    const cohort = (label: string, n: number) => (n < K_ANON ? `${label}: <${K_ANON} (suppressed)` : `${label}: ${n}`);

    // The honest internal-look report. NO role snapshot is wired, so the stale-role
    // intersection is NOT computed (it must never be fabricated — PRD FR-4 / R-6);
    // the on-chain turnover half is real, the stale half is an explicit gap.
    const report = {
      kind: 'shadow-access-audit',
      mode: 'on-chain-only', // dogfood-full requires a fresh Discord role snapshot (not wired)
      generated_by: 'packages/adapters/sonar live reconstruction (real defaultTransferPageFetcher)',
      collection: COLLECTION,
      chain_id: CHAIN_ID,
      snapshot_block: ANCHOR_BLOCK,
      compare_block: COMPARE_BLOCK,
      head_block: HEAD_BLOCK,
      inputs_hash,
      provenance: {
        endpoint: ENDPOINT,
        source: 'belt-gateway-production (sonar)',
        framework_anchor: `ownershipAtBlock(${COLLECTION},${ANCHOR_BLOCK})={${ANCHOR_HOLDER}:1}`,
        standard: 'erc721',
        reconstruction_cross_check: `passed (Σbalances=${tokensRoute1} === mints−burns=${tokensRoute2})`,
      },
      aggregate: {
        holders_at_snapshot: snap.balances.size,
        holders_at_compare: head.balances.size,
        tokens_outstanding_at_compare: Number(tokensRoute1),
        exited_count: exited.length,
        retained_count: retained.length,
        newly_eligible_count: newlyEligible.length,
        holder_turnover_pct: snap.balances.size === 0 ? null : Math.round((exited.length / snap.balances.size) * 1000) / 10,
        whale_concentration: { top1_pct: share(1), top5_pct: share(5) },
      },
      k_anonymity: {
        k: K_ANON,
        note: 'cohorts below k are suppressed in any ANONYMOUS render (FR-6/AC-7); this internal report keeps exact counts but flags them',
        small_cohorts: [cohort('holders_at_snapshot', snap.balances.size), cohort('exited', exited.length)].filter((s) => s.includes('suppressed')),
      },
      stale_access: {
        computed: false,
        reason: 'no fresh Discord role snapshot wired — stale-role intersection NOT fabricated (PRD FR-4)',
        next_step: 'wire a dogfood role export to compute sold-but-still-roled (the confront number)',
      },
      caveats: [
        'on-chain turnover only; the "stale role" half requires a role snapshot (the magnet\'s actual pain).',
        'confirm-by-construction: this dogfood report cannot validate the demand premise — only the §8 interview can.',
      ],
    };

    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

    // the report must be REAL: a real snapshot, a real holder set, honest mode, cross-checked
    expect(report.aggregate.holders_at_snapshot).toBe(1);
    expect(report.aggregate.holders_at_compare).toBeGreaterThan(0);
    expect(report.aggregate.tokens_outstanding_at_compare).toBe(Number(tokensRoute2));
    expect(report.inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.stale_access.computed).toBe(false);
  }, 120_000);
});
