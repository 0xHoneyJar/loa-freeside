import { describe, it, expect } from 'vitest';
import { SonarClient, type TransferPageFetcher } from '../sonar-client.js';
import { ReconstructionError, ZERO_ADDRESS, type TransferEvent } from '../types.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

/**
 * Injected fetcher that pages over a fixed row set — faithful to the real
 * GraphQL query: filters `blockNumber <= lteBlock` server-side, then slices.
 */
function pagesFetcher(rows: TransferEvent[]): TransferPageFetcher {
  return async ({ lteBlock, offset, limit }) =>
    rows.filter((r) => r.blockNumber <= lteBlock).slice(offset, offset + limit);
}

describe('SonarClient.ownershipAtBlock', () => {
  it('pages until the cursor is exhausted, then reconstructs', async () => {
    const rows: TransferEvent[] = [
      { blockNumber: 100, logIndex: 0, txHash: '0x1', from: ZERO_ADDRESS, to: A, tokenId: '1' },
      { blockNumber: 100, logIndex: 1, txHash: '0x2', from: ZERO_ADDRESS, to: B, tokenId: '2' },
    ];
    const client = new SonarClient({ pageSize: 1, maxPages: 10, confirmations: 12 }, pagesFetcher(rows));
    const { balances } = await client.ownershipAtBlock({
      collection: 'honeyjar',
      snapshotBlock: 1000,
      standard: 'erc721',
      headBlock: 5000,
    });
    expect(balances.get(A)).toBe(1n);
    expect(balances.get(B)).toBe(1n);
  });

  it('refuses when the pagination cap is hit before the cursor is exhausted', async () => {
    // Every page returns a full page, so the loop never sees a short page.
    const everFull: TransferPageFetcher = async ({ limit }) =>
      Array.from({ length: limit }, (_unused, i) => ({
        blockNumber: 100,
        logIndex: i,
        txHash: `0x${i}`,
        from: ZERO_ADDRESS,
        to: A,
        tokenId: String(i),
      }));
    const client = new SonarClient({ pageSize: 2, maxPages: 2, confirmations: 12 }, everFull);
    await expect(
      client.ownershipAtBlock({ collection: 'x', snapshotBlock: 1000, standard: 'erc721', headBlock: 5000 }),
    ).rejects.toBeInstanceOf(ReconstructionError);
  });
});

describe('SonarClient.holderDiff', () => {
  it('diffs qualification between snapshot and compare blocks', async () => {
    // Snapshot block <= 1000 sees the mint; compare block <= 2000 sees the burn.
    const rows: TransferEvent[] = [
      { blockNumber: 100, logIndex: 0, txHash: '0x1', from: ZERO_ADDRESS, to: A, tokenId: '1' },
      { blockNumber: 1500, logIndex: 0, txHash: '0x2', from: A, to: ZERO_ADDRESS, tokenId: '1' },
    ];
    const client = new SonarClient({ pageSize: 100, maxPages: 10, confirmations: 12 }, pagesFetcher(rows));
    const diff = await client.holderDiff({
      collection: 'honeyjar',
      snapshotBlock: 1000,
      compareBlock: 2000,
      standard: 'erc721',
      threshold: 1n,
      headBlock: 5000,
    });
    expect(diff.soldLapsed).toEqual([A]); // held at snapshot, burned by compare block
    expect(diff.newlyEligible).toEqual([]);
  });
});
