import { describe, it, expect, vi, afterEach } from 'vitest';
import { SonarClient, defaultTransferPageFetcher, type TransferPageFetcher } from '../sonar-client.js';
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

describe('defaultTransferPageFetcher — live belt-gateway wire-mapping (regression for the schema-assumption 400)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The live Transfer row shape (verified 2026-06-23): id=`<txHash>_<logIndex>`,
  // blockNumber as a STRING, `transactionHash` (not txHash), no logIndex/value.
  const liveRow = (id: string, blockNumber: string, from: string, to: string, tokenId: string) => ({
    id,
    blockNumber,
    transactionHash: id.slice(0, id.lastIndexOf('_')),
    from,
    to,
    tokenId,
  });

  it('maps the LIVE shape → TransferEvent (derives logIndex from id, renames transactionHash, coerces string blockNumber) and queries only real fields', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          Transfer: [
            liveRow('0xaaa_80', '4928204', '0x' + 'b'.repeat(40), A, '7241'),
            liveRow('0xbbb_0', '12689978', ZERO_ADDRESS, A, '2839'),
          ],
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await defaultTransferPageFetcher({
      endpoint: 'https://belt-gateway.test/v1/graphql',
      collection: 'HoneyJar3',
      lteBlock: 99_999_999,
      limit: 1000,
      offset: 0,
      timeoutMs: 5000,
    });

    // the query must target the REAL live schema, not the phantom fields that 400'd
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(sent.query).toContain('$lte: numeric!');
    expect(sent.query).toContain('transactionHash');
    expect(sent.query).not.toMatch(/\blogIndex\b/);
    expect(sent.query).not.toMatch(/\bvalue\b/);
    expect(sent.query).not.toMatch(/\btxHash\b/);

    expect(out).toEqual([
      { blockNumber: 4928204, logIndex: 80, txHash: '0xaaa', from: '0x' + 'b'.repeat(40), to: A, tokenId: '7241' },
      { blockNumber: 12689978, logIndex: 0, txHash: '0xbbb', from: ZERO_ADDRESS, to: A, tokenId: '2839' },
    ]);
  });

  it('refuses loudly (throws) when a row id cannot yield a logIndex — schema drift must not silently mis-map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { Transfer: [{ id: 'no-suffix', blockNumber: '1', transactionHash: '0x1', from: A, to: B, tokenId: '1' }] },
        }),
      })),
    );
    await expect(
      defaultTransferPageFetcher({ endpoint: 'x', collection: 'c', lteBlock: 1, limit: 1, offset: 0, timeoutMs: 5000 }),
    ).rejects.toBeTruthy();
  });

  // The Number() trap (FAGAN review): an id suffix that is a hex address parses to a
  // huge integer that passes Number.isInteger — it MUST be refused, not silently
  // mis-derived. crayons writes `${txHash}_crayons_factory_${address}` ids today.
  it.each([
    ['address suffix (crayons_factory)', '0xabc_crayons_factory_0x' + 'd'.repeat(40)],
    ['empty suffix', '0xabc_'],
    ['scientific suffix', '0xabc_1e3'],
  ])('refuses an id with a non-decimal logIndex suffix: %s', async (_label, id) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { Transfer: [{ id, blockNumber: '1', transactionHash: '0xabc', from: A, to: B, tokenId: '1' }] } }),
      })),
    );
    await expect(
      defaultTransferPageFetcher({ endpoint: 'x', collection: 'c', lteBlock: 1, limit: 1, offset: 0, timeoutMs: 5000 }),
    ).rejects.toBeTruthy();
  });
});
