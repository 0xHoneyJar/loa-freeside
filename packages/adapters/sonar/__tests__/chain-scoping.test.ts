/**
 * REGRESSION (found live 2026-07-12) — sonar collection ids are NOT unique across chains.
 *
 * "Honeycomb" and "HoneyJar1".."HoneyJar6" each exist on BOTH Ethereum (1) and Berachain (80094). The
 * Transfer query originally filtered on `collection` alone, so every chain's rows were merged into ONE
 * ownership replay: the same tokenId was minted once per chain, `reconstructOwnership` hit its invariant
 * ("mint of already-owned tokenId 1"), and the LIVE audit + public teaser returned `reconstruction-failed`
 * against the real thj Honeycomb. `blockNumber._lte` is per-chain too, so the bound was meaningless across
 * a merged set.
 *
 * sonar has always served `Transfer.chainId: Int!` — it was simply never filtered on. These tests pin that
 * the chain reaches the wire query, in the fetcher args AND in the GraphQL itself. If someone drops the
 * filter again, these fail.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SonarClient,
  defaultTransferPageFetcher,
  type TransferPageArgs,
  type TransferPageFetcher,
} from '../sonar-client.js';

const cfg = { pageSize: 100, maxPages: 5, confirmations: 12 };

describe('sonar query is chain-scoped (cross-chain collection-id collision)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes chainId through to the page fetcher', async () => {
    const seen: TransferPageArgs[] = [];
    const spy: TransferPageFetcher = async (args) => {
      seen.push(args);
      return [];
    };
    const client = new SonarClient(cfg, spy);

    await client.ownershipAtBlock({
      collection: 'Honeycomb',
      chainId: 80094,
      snapshotBlock: 1000,
      standard: 'erc721',
      headBlock: 2000,
    });

    expect(seen.length).toBeGreaterThan(0);
    // Without this, the Ethereum "Honeycomb" rows merge in and reconstruction throws.
    expect(seen[0]?.chainId).toBe(80094);
    expect(seen[0]?.collection).toBe('Honeycomb');
  });

  it('holderDiff scopes BOTH reads by the same chainId', async () => {
    const seen: TransferPageArgs[] = [];
    const spy: TransferPageFetcher = async (args) => {
      seen.push(args);
      return [];
    };
    const client = new SonarClient(cfg, spy);

    await client.holderDiff({
      collection: 'Honeycomb',
      chainId: 80094,
      snapshotBlock: 1000,
      compareBlock: 1500,
      standard: 'erc721',
      threshold: 1n,
      headBlock: 2000,
    });

    expect(seen.length).toBe(2); // snapshot read + compare read
    expect(seen.every((a) => a.chainId === 80094)).toBe(true);
  });

  it('the WIRE GraphQL actually filters on chainId (where-clause + variable)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { Transfer: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await defaultTransferPageFetcher({
      endpoint: 'https://belt-gateway.example',
      collection: 'Honeycomb',
      chainId: 80094,
      lteBlock: 1000,
      limit: 10,
      offset: 0,
      timeoutMs: 5000,
    });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> };

    // The filter must be in the where-clause, not merely accepted as an unused arg.
    expect(body.query).toContain('chainId: { _eq: $chain }');
    expect(body.query).toContain('$chain: Int!');
    expect(body.variables.chain).toBe(80094);
    expect(body.variables.c).toBe('Honeycomb');
  });
});
