import { describe, it, expect } from 'vitest';
import {
  reconstructOwnership,
  diffQualification,
  type ReconstructOptions,
} from '../reconstruct.js';
import {
  ReconstructionError,
  ZERO_ADDRESS,
  type HolderBalances,
  type TokenStandard,
  type TransferEvent,
} from '../types.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const D = '0x' + 'd'.repeat(40);

function ev(
  blockNumber: number,
  logIndex: number,
  from: string,
  to: string,
  tokenId: string,
  value?: string,
): TransferEvent {
  return { blockNumber, logIndex, txHash: `0xtx${blockNumber}_${logIndex}`, from, to, tokenId, value };
}

function opts(standard: TokenStandard, over: Partial<ReconstructOptions> = {}): ReconstructOptions {
  return {
    standard,
    snapshotBlock: 1000,
    headBlock: 2000,
    confirmations: 12,
    paginationComplete: true,
    ...over,
  };
}

function failCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReconstructionError) return e.code;
    throw e;
  }
  throw new Error('expected a ReconstructionError, none thrown');
}

describe('reconstructOwnership — ERC-721 owner-fold', () => {
  it('folds mints + transfers into the holder set @ snapshot', () => {
    const { balances } = reconstructOwnership(
      [
        ev(100, 0, ZERO_ADDRESS, A, '1'),
        ev(100, 1, ZERO_ADDRESS, B, '2'),
        ev(200, 0, A, C, '1'),
      ],
      opts('erc721'),
    );
    expect(balances.get(C)).toBe(1n);
    expect(balances.get(B)).toBe(1n);
    expect(balances.get(A)).toBeUndefined();
  });

  it('treats a to-zero transfer as a burn', () => {
    const { balances } = reconstructOwnership(
      [ev(100, 0, ZERO_ADDRESS, A, '1'), ev(200, 0, A, ZERO_ADDRESS, '1')],
      opts('erc721'),
    );
    expect(balances.size).toBe(0);
  });

  it('dedups byte-identical rows (paginated overlap) — counted once', () => {
    const dup = ev(100, 0, ZERO_ADDRESS, A, '1');
    const { balances } = reconstructOwnership([dup, { ...dup }], opts('erc721'));
    expect(balances.get(A)).toBe(1n);
  });

  it('refuses a transfer from a non-owner (incomplete/corrupt stream)', () => {
    expect(
      failCode(() =>
        reconstructOwnership(
          [ev(100, 0, ZERO_ADDRESS, A, '1'), ev(200, 0, B, C, '1')],
          opts('erc721'),
        ),
      ),
    ).toBe('inconsistent-721-provenance');
  });
});

describe('reconstructOwnership — ERC-1155 balance semantics', () => {
  it('folds value-weighted mints + partial transfers into per-owner totals', () => {
    const { balances } = reconstructOwnership(
      [
        ev(100, 0, ZERO_ADDRESS, A, '1', '5'),
        ev(100, 1, ZERO_ADDRESS, A, '2', '3'),
        ev(200, 0, A, B, '1', '2'),
      ],
      opts('erc1155'),
    );
    expect(balances.get(A)).toBe(6n); // (5-2) + 3
    expect(balances.get(B)).toBe(2n);
  });

  it('handles a TransferBatch (rows sharing txHash/logIndex, distinct tokenIds)', () => {
    const { balances } = reconstructOwnership(
      [
        { blockNumber: 100, logIndex: 0, txHash: '0xbatch', from: ZERO_ADDRESS, to: A, tokenId: '1', value: '2' },
        { blockNumber: 100, logIndex: 0, txHash: '0xbatch', from: ZERO_ADDRESS, to: A, tokenId: '2', value: '4' },
      ],
      opts('erc1155'),
    );
    expect(balances.get(A)).toBe(6n);
  });

  it('refuses an erc1155 transfer with no value (cannot reconstruct balance)', () => {
    expect(failCode(() => reconstructOwnership([ev(100, 0, ZERO_ADDRESS, A, '1')], opts('erc1155')))).toBe(
      'missing-erc1155-value',
    );
  });

  it('refuses when a balance would go negative (incomplete stream)', () => {
    expect(
      failCode(() =>
        reconstructOwnership(
          [ev(100, 0, ZERO_ADDRESS, A, '1', '2'), ev(200, 0, A, ZERO_ADDRESS, '1', '5')],
          opts('erc1155'),
        ),
      ),
    ).toBe('negative-balance');
  });
});

describe('reconstructOwnership — validation gates', () => {
  it('refuses an event after the snapshot block', () => {
    expect(failCode(() => reconstructOwnership([ev(100, 0, ZERO_ADDRESS, A, '1')], opts('erc721', { snapshotBlock: 50 })))).toBe(
      'event-after-snapshot',
    );
  });

  it('refuses a snapshot within the reorg window', () => {
    expect(failCode(() => reconstructOwnership([], opts('erc721', { snapshotBlock: 1995, headBlock: 2000, confirmations: 12 })))).toBe(
      'within-reorg-window',
    );
  });

  it('accepts a snapshot exactly at the finality boundary (head - confirmations)', () => {
    const { balances } = reconstructOwnership([], opts('erc721', { snapshotBlock: 1988, headBlock: 2000, confirmations: 12 }));
    expect(balances.size).toBe(0);
  });

  it('refuses an incomplete (capped) pagination stream', () => {
    expect(failCode(() => reconstructOwnership([], opts('erc721', { paginationComplete: false })))).toBe(
      'incomplete-pagination',
    );
  });
});

describe('diffQualification', () => {
  it('classifies sold-lapsed / newly-eligible / retained by threshold', () => {
    const snap: HolderBalances = new Map([
      [A, 2n],
      [B, 1n],
      [C, 5n],
    ]);
    const head: HolderBalances = new Map([
      [A, 0n],
      [B, 1n],
      [D, 3n],
    ]);
    const diff = diffQualification(snap, head, 1n);
    expect(diff.soldLapsed).toEqual([A, C]); // qualified@snap, not@head
    expect(diff.newlyEligible).toEqual([D]); // not@snap, qualified@head
    expect(diff.retained).toEqual([B]);
  });
});
