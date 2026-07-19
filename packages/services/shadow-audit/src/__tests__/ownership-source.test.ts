/**
 * Sprint 2 / S2-T4 — the chain-reconstruction adapters, exercised with INJECTED fakes (no live network).
 * The binary-search ALGORITHM + the assembly are proven here; the LIVE correctness (real RPC + belt-gateway
 * + registry values) is a deploy gate, not a unit-suite concern (the #306 discipline).
 */
import { describe, it, expect } from 'vitest';
import { makeRpcBlockTimeResolver, type JsonRpcCall } from '../block-time-resolver.js';
import { buildCollectionIndex, makeSonarOwnershipSource, registryFromMap } from '../ownership-source.js';
import type { Balances } from '../audit-service.js';

const C = '0x' + 'a'.repeat(40);
const W1 = '0x' + '1'.repeat(40);

// ── BlockTimeResolver: the binary search over a fake chain ──

/** A fake chain: block N has timestamp `base + N*12` (12s blocks); head = `headBlock`. */
const fakeChain = (headBlock: number, base = 1_000_000): JsonRpcCall => async (method, params) => {
  if (method === 'eth_blockNumber') return '0x' + headBlock.toString(16);
  if (method === 'eth_getBlockByNumber') {
    const n = Number.parseInt(String(params[0]), 16);
    return { timestamp: '0x' + (base + n * 12).toString(16) };
  }
  throw new Error(`unexpected RPC ${method}`);
};

describe('makeRpcBlockTimeResolver — block-at-or-before via binary search', () => {
  it('finds the highest block with timestamp <= the target', async () => {
    const r = makeRpcBlockTimeResolver({ rpcCall: fakeChain(1000) });
    // block N ts = 1_000_000 + 12N; target exactly on block 500's ts → 500
    expect(await r.blockAtOrBefore(1_000_000 + 12 * 500)).toBe(500);
    // target between block 500 and 501 → 500 (the highest <=)
    expect(await r.blockAtOrBefore(1_000_000 + 12 * 500 + 5)).toBe(500);
    // target before genesis ts → -1 (NO block ≤ target; the caller must refuse, not serve block 0). FAGAN HIGH-1
    expect(await r.blockAtOrBefore(0)).toBe(-1);
    // target exactly at genesis ts → STILL -1 (S5-T2): the search is over [1, head], so block 0 is never
    // probed (drpc 408s on genesis and only on genesis) and never returned. Refusing is the right answer —
    // genesis holds no reconstructable ownership. Full coverage in block-time-resolver.test.ts.
    expect(await r.blockAtOrBefore(1_000_000)).toBe(-1);
    // target after head → head
    expect(await r.blockAtOrBefore(10_000_000)).toBe(1000);
  });
  it('reports the head', async () => {
    expect(await makeRpcBlockTimeResolver({ rpcCall: fakeChain(42) }).headBlock()).toBe(42);
  });
  it('rejects a non-hex RPC quantity (loud, never a silent NaN)', async () => {
    const bad: JsonRpcCall = async () => 'not-hex';
    await expect(makeRpcBlockTimeResolver({ rpcCall: bad }).headBlock()).rejects.toThrow(/hex quantity/);
  });
});

// ── OwnershipSource: assembly over fakes ──

const fakeResolver = (head: number) => ({
  headBlock: async () => head,
  blockAtOrBefore: async () => head - 100, // a deterministic snapshot block for the test
});

/** A fake sonar core: returns a fixed balance map for the requested collection. */
const fakeSonar = (balances: Balances) => ({
  ownershipAtBlock: async () => ({ standard: 'erc721' as const, balances } as never),
});

describe('makeSonarOwnershipSource — assembly', () => {
  const registry = registryFromMap({ ['80094/' + C]: { collection: 'honeycomb', standard: 'erc721' } });

  it('resolves a snapshot block via the resolver for a registered collection', async () => {
    const own = makeSonarOwnershipSource({
      sonar: fakeSonar(new Map()),
      resolverFor: () => fakeResolver(900),
      registry,
    });
    expect(await own.resolveSnapshotBlock({ chain: '80094', contract: C, snapshotDate: '2026-06-01' })).toBe(800); // 900-100
  });

  it('balancesAt returns the reconstructed holder map', async () => {
    const bal = new Map([[W1, 2n]]);
    const own = makeSonarOwnershipSource({ sonar: fakeSonar(bal), resolverFor: () => fakeResolver(900), registry });
    expect(await own.balancesAt({ chain: '80094', contract: C, snapshotBlock: 500 })).toBe(bal);
  });

  it('REFUSES a before-genesis snapshot date (resolver returns -1), never reconstructs at block 0 (FAGAN HIGH-1)', async () => {
    const beforeGenesis = { headBlock: async () => 900, blockAtOrBefore: async () => -1 };
    const own = makeSonarOwnershipSource({ sonar: fakeSonar(new Map()), resolverFor: () => beforeGenesis, registry });
    await expect(own.resolveSnapshotBlock({ chain: '80094', contract: C, snapshotDate: '2000-01-01' })).rejects.toThrow(/before chain .* genesis/);
  });

  it('REFUSES an unregistered collection (never reconstructs an unknown one)', async () => {
    const own = makeSonarOwnershipSource({ sonar: fakeSonar(new Map()), resolverFor: () => fakeResolver(900), registry });
    await expect(own.resolveSnapshotBlock({ chain: '1', contract: '0xdead', snapshotDate: '2026-06-01' })).rejects.toThrow(/no collection registry entry/);
  });

  it('registryFromMap is case-insensitive on the contract', async () => {
    const reg = registryFromMap({ ['80094/' + C.toUpperCase()]: { collection: 'x', standard: 'erc721' } });
    expect(reg({ chain: '80094', contract: C.toLowerCase() })?.collection).toBe('x');
  });
});

describe('buildCollectionIndex — explicit collection identity', () => {
  it('does not union unrelated deployments that share a belt-gateway query id', () => {
    const index = buildCollectionIndex({
      '1/0xaaa': { collection: 'reused-query-id', standard: 'erc721', union: 'world-a:collection' },
      '80094/0xbbb': { collection: 'reused-query-id', standard: 'erc721', union: 'world-b:collection' },
    });

    expect(index.sources({ chain: '1', contract: '0xaaa' })).toEqual([{ chain: '1', contract: '0xaaa' }]);
    expect(index.sources({ chain: '80094', contract: '0xbbb' })).toEqual([
      { chain: '80094', contract: '0xbbb' },
    ]);
  });

  it('unions deployments only when the explicit union key matches', () => {
    const index = buildCollectionIndex({
      '1/0xaaa': { collection: 'honeycomb', standard: 'erc721', union: 'thj:honeycomb' },
      '80094/0xbbb': { collection: 'honeycomb', standard: 'erc721', union: 'thj:honeycomb' },
    });

    expect(index.sources({ chain: '1', contract: '0xaaa' })).toEqual([
      { chain: '1', contract: '0xaaa' },
      { chain: '80094', contract: '0xbbb' },
    ]);
  });

  it('fails at boot when an entry omits the explicit union key', () => {
    expect(() =>
      buildCollectionIndex({
        '1/0xaaa': { collection: 'ambiguous', standard: 'erc721' } as never,
      }),
    ).toThrow(/no explicit union key/);
  });
});
