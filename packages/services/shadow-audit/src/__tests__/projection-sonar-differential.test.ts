import { describe, it, expect } from 'vitest';
import { reconstructOwnership, ZERO_ADDRESS, type TransferEvent } from '@freeside/adapters/sonar';
import { makeOwnershipProjection, type OwnershipChange } from '../projection-ownership-source.js';

/**
 * THE DIFFERENTIAL TEST — FAGAN HIGH-4, the open keystone proof.
 *
 * The keystone claim is "the audit reading the L2 spine == the audit reconstructing from raw sonar." The earlier
 * suites proved only that the projection reproduces a HAND-ROLLED fixture authored from the SAME mental model as
 * the projection (a fixture tautology — green measures self-consistency, not correctness). This suite is the real
 * proof: it runs the REAL `@freeside/adapters/sonar` `reconstructOwnership` fold (the production Transfer-replay,
 * `fold721`) and the projection fold over the SAME Transfer stream, through two INDEPENDENT code paths, and
 * asserts they agree. If the projection ever diverges from sonar on a valid stream, this fails.
 *
 * It also PINS the known model boundary instead of hiding it: the projection is a balance-COUNT model; sonar's
 * `fold721` is a per-tokenId OWNER model. They are provably equal on any VALID erc721 stream (each Transfer moves
 * one token from its current owner, so per-holder `received − sent` == `# tokenIds currently owned`), and DIVERGE
 * only on provenance-breaking streams that sonar REFUSES — the last test documents exactly that gap.
 */

const CHAIN = 'ethereum';
const CONTRACT = '0x' + 'a'.repeat(40);
const ADDR = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const CONFIRMATIONS = 5;

/** map a raw sonar Transfer → the projection's OwnershipChange (erc721: each Transfer moves exactly one token). */
const toChange = (e: TransferEvent): OwnershipChange => ({
  chain: CHAIN,
  contract: CONTRACT,
  block: e.blockNumber,
  timestamp: '2026-06-20T00:00:00Z',
  tx: e.txHash,
  logIndex: e.logIndex,
  from: e.from === ZERO_ADDRESS ? null : e.from,
  to: e.to === ZERO_ADDRESS ? null : e.to,
  amount: 1n,
});

const sortMap = (m: Map<string, bigint>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** run BOTH folds over the same stream @ snapshotBlock and assert they agree. `events` must all be ≤ snapshotBlock
 *  (sonar refuses an event after the snapshot; the projection's own cutoff is verified separately). */
const assertParity = (events: TransferEvent[], snapshotBlock: number) => {
  const headBlock = snapshotBlock + CONFIRMATIONS + 1; // bury the snapshot beyond the reorg window
  const sonar = reconstructOwnership(events, {
    standard: 'erc721',
    snapshotBlock,
    headBlock,
    confirmations: CONFIRMATIONS,
    paginationComplete: true,
  }).balances;
  const p = makeOwnershipProjection();
  for (const e of events) p.apply(toChange(e));
  const proj = p.balancesAt(CHAIN, CONTRACT, snapshotBlock);
  expect(sortMap(proj)).toEqual(sortMap(sonar));
  return sonar;
};

// ---- a deterministic VALID erc721 history generator (seeded LCG — no Math.random, fully reproducible) ----
function buildValidStream(seed: number, steps: number): TransferEvent[] {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (n: number) => Math.floor(rnd() * n) % n;
  const HOLDERS = 6;
  const owner = new Map<string, string>(); // tokenId -> current owner (maintains stream VALIDITY by construction)
  const events: TransferEvent[] = [];
  let block = 100;
  let log = 0;
  let tx = 0;
  let nextToken = 1;
  const emit = (from: string, to: string, tokenId: string) => {
    events.push({ blockNumber: block, logIndex: log++, txHash: '0xtx' + ++tx, from, to, tokenId });
    if (rnd() < 0.4) {
      block += 1 + pick(3); // advance blocks sometimes (multiple events per block exercises within-block folding)
      log = 0;
    }
  };
  for (let i = 0; i < steps; i++) {
    const live = [...owner.keys()];
    const r = rnd();
    if (live.length === 0 || r < 0.45) {
      const tokenId = String(nextToken++);
      const to = ADDR(1 + pick(HOLDERS));
      owner.set(tokenId, to);
      emit(ZERO_ADDRESS, to, tokenId); // MINT
    } else if (r < 0.85) {
      const tokenId = live[pick(live.length)]!;
      const from = owner.get(tokenId)!;
      const to = ADDR(1 + pick(HOLDERS));
      owner.set(tokenId, to);
      emit(from, to, tokenId); // TRANSFER (self-transfers are valid + parity-preserving — allowed)
    } else {
      const tokenId = live[pick(live.length)]!;
      const from = owner.get(tokenId)!;
      owner.delete(tokenId);
      emit(from, ZERO_ADDRESS, tokenId); // BURN
    }
  }
  return events;
}

const maxBlock = (events: TransferEvent[]) => events.reduce((m, e) => (e.blockNumber > m ? e.blockNumber : m), 0);

describe('projection ⇄ sonar DIFFERENTIAL — the real keystone parity proof (FAGAN HIGH-4)', () => {
  it('parity on a hand-built valid stream (mint → transfer → burn), read against the REAL reconstructOwnership', () => {
    const A = ADDR(1);
    const B = ADDR(2);
    const C = ADDR(3);
    const events: TransferEvent[] = [
      { blockNumber: 100, logIndex: 0, txHash: '0x1', from: ZERO_ADDRESS, to: A, tokenId: '1' }, // mint 1 → A
      { blockNumber: 100, logIndex: 1, txHash: '0x2', from: ZERO_ADDRESS, to: A, tokenId: '2' }, // mint 2 → A (same block)
      { blockNumber: 110, logIndex: 0, txHash: '0x3', from: A, to: B, tokenId: '1' }, // A sends 1 → B
      { blockNumber: 120, logIndex: 0, txHash: '0x4', from: ZERO_ADDRESS, to: C, tokenId: '3' }, // mint 3 → C
      { blockNumber: 130, logIndex: 0, txHash: '0x5', from: C, to: ZERO_ADDRESS, tokenId: '3' }, // C burns 3
    ];
    const bal = assertParity(events, 130);
    // sanity: the real fold says A:1 (token 2), B:1 (token 1), C:0 (burned) — and the projection matched it.
    expect(sortMap(bal)).toEqual([[A.toLowerCase(), 1n], [B.toLowerCase(), 1n]]);
  });

  it('parity holds across 40 generated VALID streams (the model-independent property — not one fixture)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const events = buildValidStream(seed, 60);
      if (events.length === 0) continue;
      assertParity(events, maxBlock(events)); // throws (fails the test) on ANY divergence
    }
  });

  it('parity at an INTERMEDIATE snapshot block — sonar(filtered ≤ snap) == projection.balancesAt(snap)', () => {
    const events = buildValidStream(7, 80);
    const blocks = [...new Set(events.map((e) => e.blockNumber))].sort((a, b) => a - b);
    const snap = blocks[Math.floor(blocks.length / 2)]!; // a block partway through the history
    // sonar requires the input to be exactly the Transfers ≤ snapshotBlock; the projection cuts internally.
    const filtered = events.filter((e) => e.blockNumber <= snap);
    const headBlock = snap + CONFIRMATIONS + 1;
    const sonar = reconstructOwnership(filtered, { standard: 'erc721', snapshotBlock: snap, headBlock, confirmations: CONFIRMATIONS, paginationComplete: true }).balances;
    const p = makeOwnershipProjection();
    for (const e of events) p.apply(toChange(e)); // ALL events applied; balancesAt does the cutoff
    expect(sortMap(p.balancesAt(CHAIN, CONTRACT, snap))).toEqual(sortMap(sonar));
  });

  it('parity is order-INDEPENDENT — a shuffled valid stream folds to the same balances on both paths', () => {
    const events = buildValidStream(3, 70);
    const snap = maxBlock(events);
    // shuffle deterministically (a fixed permutation) — both folds sort canonically, so the result must not move.
    const shuffled = events.map((e, i) => ({ e, k: (i * 2654435761) >>> 0 })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const headBlock = snap + CONFIRMATIONS + 1;
    const sonar = reconstructOwnership(shuffled, { standard: 'erc721', snapshotBlock: snap, headBlock, confirmations: CONFIRMATIONS, paginationComplete: true }).balances;
    const p = makeOwnershipProjection();
    for (const e of shuffled) p.apply(toChange(e));
    expect(sortMap(p.balancesAt(CHAIN, CONTRACT, snap))).toEqual(sortMap(sonar));
  });

  it('DOCUMENTED model gap: sonar REFUSES a double-mint (provenance); the count-projection cannot see it', () => {
    const A = ADDR(1);
    const events: TransferEvent[] = [
      { blockNumber: 100, logIndex: 0, txHash: '0xm1', from: ZERO_ADDRESS, to: A, tokenId: '1' },
      { blockNumber: 101, logIndex: 0, txHash: '0xm2', from: ZERO_ADDRESS, to: A, tokenId: '1' }, // mint of already-owned token 1
    ];
    // sonar's per-tokenId fold721 catches the provenance break and REFUSES (never a silently-wrong holder set):
    expect(() =>
      reconstructOwnership(events, { standard: 'erc721', snapshotBlock: 101, headBlock: 200, confirmations: CONFIRMATIONS, paginationComplete: true }),
    ).toThrowError(/already-owned|inconsistent-721-provenance/);
    // the projection has no tokenId axis, so it cannot detect the double-mint — it serves count=2. This is the
    // KNOWN boundary (open item (a) in projection-ownership-source.ts): the projection ≈ sonar ONLY on valid
    // streams. A genesis backfill + the value/standard contract are what keep the live stream valid; until then
    // the count-model is a faithful replica for valid histories and weaker on provenance enforcement.
    const p = makeOwnershipProjection();
    for (const e of events) p.apply(toChange(e));
    expect(p.balancesAt(CHAIN, CONTRACT, 101).get(A.toLowerCase())).toBe(2n);
  });
});
