/**
 * FAGAN HIGH-3 — value-semantics CONTRACT between the two ownership read-models
 * (SDD sandwich-line S3-T3, the 6c precondition).
 *
 * The differential (6c) compares the sonar Transfer-replay source against the
 * shadow-mode projection source. This pins that they agree on WHAT a holder
 * balance IS for each token standard — and documents the one place they cannot
 * agree by construction, so 6c's classifier never reports it as a true mismatch.
 *
 * Canonical stream: one ordered list of (block, tokenId, from, to, value?) that
 * we feed to BOTH read-models:
 *   - sonar: reconstructOwnership(TransferEvent[], {standard})  (per-token fold)
 *   - projection: makeOwnershipProjection().apply(OwnershipChange)  (net-amount fold)
 * where the erc721→amount mapping is 1n per token and erc1155→amount is `value`.
 */
import { describe, it, expect } from 'vitest';
import { reconstructOwnership, type TransferEvent } from '@freeside/adapters/sonar';
import { makeOwnershipProjection, type OwnershipChange } from '../projection-ownership-source.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const CHAIN = '1';
const CONTRACT = '0x' + 'd'.repeat(40);

interface Move {
  block: number;
  logIndex: number;
  tokenId: string;
  from: string;
  to: string;
  value?: string; // erc1155 only
}

function toTransferEvents(moves: Move[]): TransferEvent[] {
  return moves.map((m, i) => ({
    blockNumber: m.block,
    logIndex: m.logIndex,
    txHash: `0xtx${i}`,
    from: m.from,
    to: m.to,
    tokenId: m.tokenId,
    ...(m.value !== undefined ? { value: m.value } : {}),
  }));
}

function toChanges(moves: Move[], amountFor: (m: Move) => bigint): OwnershipChange[] {
  return moves.map((m, i) => ({
    chain: CHAIN,
    contract: CONTRACT,
    block: m.block,
    timestamp: new Date(m.block * 1000).toISOString(),
    tx: `0xtx${i}`,
    logIndex: m.logIndex,
    from: m.from === ZERO ? null : m.from,
    to: m.to === ZERO ? null : m.to,
    amount: amountFor(m),
  }));
}

function projectionBalances(changes: OwnershipChange[], block: number): Map<string, bigint> {
  const p = makeOwnershipProjection();
  for (const c of changes) p.apply(c);
  return p.balancesAt(CHAIN, CONTRACT, block);
}

function sorted(m: Map<string, bigint>): [string, bigint][] {
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe('erc721 value semantics agree (count of tokens owned)', () => {
  const moves: Move[] = [
    { block: 1, logIndex: 0, tokenId: '1', from: ZERO, to: A }, // mint 1 → A
    { block: 1, logIndex: 1, tokenId: '2', from: ZERO, to: A }, // mint 2 → A
    { block: 2, logIndex: 0, tokenId: '1', from: A, to: B }, // A sells 1 → B
    { block: 3, logIndex: 0, tokenId: '3', from: ZERO, to: B }, // mint 3 → B
  ];
  it('sonar reconstruction == projection (amount=1 per token)', () => {
    const { balances: sonar } = reconstructOwnership(toTransferEvents(moves), { standard: 'erc721', snapshotBlock: 3, headBlock: 100, confirmations: 12, paginationComplete: true });
    const proj = projectionBalances(toChanges(moves, () => 1n), 3);
    expect(sorted(proj)).toEqual(sorted(sonar));
    // A holds token 2 (1); B holds tokens 1+3 (2).
    expect(sonar.get(A)).toBe(1n);
    expect(sonar.get(B)).toBe(2n);
  });
});

describe('erc1155 value semantics agree (sum of values across tokenIds)', () => {
  const moves: Move[] = [
    { block: 1, logIndex: 0, tokenId: '1', from: ZERO, to: A, value: '10' },
    { block: 1, logIndex: 1, tokenId: '2', from: ZERO, to: A, value: '5' },
    { block: 2, logIndex: 0, tokenId: '1', from: A, to: B, value: '4' }, // partial
  ];
  it('sonar reconstruction == projection (amount=value)', () => {
    const { balances: sonar } = reconstructOwnership(toTransferEvents(moves), { standard: 'erc1155', snapshotBlock: 2, headBlock: 100, confirmations: 12, paginationComplete: true });
    const proj = projectionBalances(toChanges(moves, (m) => BigInt(m.value ?? '0')), 2);
    expect(sorted(proj)).toEqual(sorted(sonar));
    // A: 10+5-4 = 11; B: 4.
    expect(sonar.get(A)).toBe(11n);
    expect(sonar.get(B)).toBe(4n);
  });
});

describe('DOCUMENTED divergence: per-token (sonar) vs net-amount (projection)', () => {
  // A transfer FROM a non-owner of a specific tokenId that stays net-nonnegative:
  // sonar (per-token) REFUSES; the projection (net) does NOT. 6c must classify
  // this as a stream-integrity divergence, NOT a holder-set mismatch.
  const moves: Move[] = [
    { block: 1, logIndex: 0, tokenId: '1', from: ZERO, to: A }, // A owns token 1
    { block: 2, logIndex: 0, tokenId: '9', from: A, to: B }, // A "sends" token 9 it never owned
  ];
  it('sonar refuses; projection accepts (net stays ≥ 0) — the classifier boundary', () => {
    expect(() => reconstructOwnership(toTransferEvents(moves), { standard: 'erc721', snapshotBlock: 2, headBlock: 100, confirmations: 12, paginationComplete: true })).toThrow();
    // projection: A = +1 -1 = 0 (deleted), B = +1 → no throw, B holds 1
    const proj = projectionBalances(toChanges(moves, () => 1n), 2);
    expect(proj.get(B)).toBe(1n);
    expect(proj.has(A)).toBe(false);
  });
});
