/**
 * Sprint 5 / S5-T2 — the resilience of the block-at-date path, which live traffic proved was zero:
 * a single endpoint, called once, with a search that probed genesis. `eth.drpc.org` 408s on block 0 and
 * ONLY on block 0, so every ethereum audit died on one RPC call.
 *
 * Each test here FAILS against the pre-S5 resolver (single endpoint, no retry, search over [0, head]).
 * The fakes are injected — no live network (the #306 discipline).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeRpcBlockTimeResolver } from '../block-time-resolver.js';
import { makeRpcPool, parseRpcUrls, type SingleEndpointCall, type JsonRpcCall } from '../rpc-pool.js';

/** A fake chain: block N has timestamp `base + N*12` (12s blocks); head = `headBlock`. */
const GENESIS_TS = 1_000_000;
const tsOf = (n: number) => GENESIS_TS + n * 12;

const fakeEndpoint =
  (headBlock: number): SingleEndpointCall =>
  async (_url, method, params) => {
    if (method === 'eth_blockNumber') return '0x' + headBlock.toString(16);
    if (method === 'eth_getBlockByNumber') {
      const n = Number.parseInt(String(params[0]), 16);
      return { timestamp: '0x' + tsOf(n).toString(16) };
    }
    throw new Error(`unexpected RPC ${method}`);
  };

/** No real sleeping — the backoff schedule is asserted, not waited on. */
const fakeSleep = () => {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
};

/** An endpoint that answers every block in 0.2s EXCEPT genesis, where it 408s (eth.drpc.org, grounded). */
const genesisHostile = (headBlock: number, probed: number[]): JsonRpcCall => async (method, params) => {
  if (method === 'eth_blockNumber') return '0x' + headBlock.toString(16);
  const n = Number.parseInt(String(params[0]), 16);
  probed.push(n);
  if (n === 0) throw new Error('HTTP 408: Request timeout on the free tier');
  return { timestamp: '0x' + tsOf(n).toString(16) };
};

describe('blockAtOrBefore — genesis is never probed', () => {
  it('REFUSES (-1) a target older than block 1 instead of exploding on the genesis 408', async () => {
    // The only inputs that ever drove the old [0, head] search onto block 0: `hi` shrinks only when a probe
    // is NEWER than the target, so genesis is reached iff target < ts(block 1). Pre-fix, this probed 0 and
    // died with a confusing "HTTP 408" mid-audit; now it never asks, and returns the -1 the caller refuses
    // on. (A target between ts(0) and ts(1) was worse pre-fix: it returned block 0 → an EMPTY snapshot →
    // a plausible WRONG audit. FAGAN HIGH-1.)
    const probed: number[] = [];
    const r = makeRpcBlockTimeResolver({ rpcCall: genesisHostile(5000, probed) });

    expect(await r.blockAtOrBefore(GENESIS_TS)).toBe(-1); // ON genesis's ts — the old code returned 0
    expect(await r.blockAtOrBefore(GENESIS_TS - 3600)).toBe(-1); // before it — the old code threw the 408
    expect(probed).not.toContain(0);
  });

  it('resolves a normal recent target against the same genesis-hostile endpoint', async () => {
    // NOTE: this passed pre-fix too — a realistic (recent) snapshot_date never walked `hi` down to 0, so
    // the genesis 408 was NOT what broke live ethereum audits. Kept as the regression guard for the claim.
    const probed: number[] = [];
    const r = makeRpcBlockTimeResolver({ rpcCall: genesisHostile(5000, probed) });

    expect(await r.blockAtOrBefore(tsOf(3000))).toBe(3000);
    expect(probed).not.toContain(0);
  });

  it('returns the -1 sentinel (never block 0) when the target precedes the lower bound', async () => {
    const r = makeRpcBlockTimeResolver({ rpcCall: async (m, p) => fakeEndpoint(1000)('u', m, p) });
    // before the chain existed → refuse (ownership-source turns -1 into a loud throw; FAGAN HIGH-1)
    expect(await r.blockAtOrBefore(0)).toBe(-1);
    // exactly genesis's timestamp: block 0 is off-limits and block 1 is newer → still -1, never 0
    expect(await r.blockAtOrBefore(GENESIS_TS)).toBe(-1);
    // block 1 is reachable as normal
    expect(await r.blockAtOrBefore(tsOf(1))).toBe(1);
  });

  it('still finds the highest block <= the target, and the head', async () => {
    const r = makeRpcBlockTimeResolver({ rpcCall: async (m, p) => fakeEndpoint(1000)('u', m, p) });
    expect(await r.blockAtOrBefore(tsOf(500))).toBe(500);
    expect(await r.blockAtOrBefore(tsOf(500) + 5)).toBe(500); // between 500 and 501
    expect(await r.blockAtOrBefore(tsOf(99_999))).toBe(1000); // after head → head
    expect(await r.headBlock()).toBe(1000);
  });
});

describe('makeRpcPool — failover + retry', () => {
  it('completes the whole audit path via endpoint #2 when endpoint #1 always fails', async () => {
    const { sleep } = fakeSleep();
    const good = fakeEndpoint(1000);
    const callOne: SingleEndpointCall = async (url, method, params) => {
      if (url === 'https://dead.example') throw new Error('ECONNREFUSED');
      return good(url, method, params);
    };
    const pool = makeRpcPool({
      urls: ['https://dead.example', 'https://good.example'],
      callOne,
      sleep,
      backoffMs: 1,
    });

    // not just one call — the FULL binary search (~10 sequential calls) survives a dead endpoint.
    const r = makeRpcBlockTimeResolver({ rpcCall: pool });
    expect(await r.blockAtOrBefore(tsOf(777))).toBe(777);
  });

  it('recovers from a transient failure on retry (same endpoint)', async () => {
    const { slept, sleep } = fakeSleep();
    let calls = 0;
    const flaky: SingleEndpointCall = async (url, method, params) => {
      if (++calls === 1) throw new Error('HTTP 429');
      return fakeEndpoint(1000)(url, method, params);
    };
    const pool = makeRpcPool({ urls: ['https://flaky.example'], callOne: flaky, sleep, backoffMs: 250 });

    expect(await pool('eth_blockNumber', [])).toBe('0x3e8');
    expect(slept).toEqual([250]); // one backoff, then success
  });

  it('backs off exponentially and fails loudly when every endpoint is exhausted', async () => {
    const { slept, sleep } = fakeSleep();
    const dead: SingleEndpointCall = async () => {
      throw new Error('boom');
    };
    const pool = makeRpcPool({ urls: ['https://a.example', 'https://b.example'], callOne: dead, sleep, backoffMs: 100 });

    await expect(pool('eth_blockNumber', [])).rejects.toThrow(/failed on all 2 endpoint\(s\)/);
    expect(slept).toEqual([100, 200, 100, 200]); // 3 attempts per endpoint, doubling
  });

  it('fails over when a PRUNED endpoint answers `null` for an old block instead of erroring', async () => {
    // grounded: optimism-rpc.publicnode.com returns null for older blocks. A null block is an endpoint
    // failure, not "no such block" — treating it as data would corrupt the search.
    const { sleep } = fakeSleep();
    const callOne: SingleEndpointCall = async (url, method, params) => {
      if (url === 'https://pruned.example' && method === 'eth_getBlockByNumber') return null;
      if (url === 'https://pruned.example') return fakeEndpoint(1000)(url, method, params);
      return fakeEndpoint(1000)(url, method, params);
    };
    const pool = makeRpcPool({
      urls: ['https://pruned.example', 'https://archive.example'],
      callOne,
      sleep,
      backoffMs: 1,
    });

    const r = makeRpcBlockTimeResolver({ rpcCall: pool });
    expect(await r.blockAtOrBefore(tsOf(400))).toBe(400);
  });

  it('sticks to the endpoint that last answered (a dead endpoint is not re-probed 24x)', async () => {
    const { sleep } = fakeSleep();
    const hits = { dead: 0, good: 0 };
    const callOne: SingleEndpointCall = async (url, method, params) => {
      if (url === 'https://dead.example') {
        hits.dead++;
        throw new Error('ECONNREFUSED');
      }
      hits.good++;
      return fakeEndpoint(1000)(url, method, params);
    };
    const pool = makeRpcPool({
      urls: ['https://dead.example', 'https://good.example'],
      callOne,
      sleep,
      backoffMs: 1,
    });

    const r = makeRpcBlockTimeResolver({ rpcCall: pool });
    await r.blockAtOrBefore(tsOf(500)); // ~11 calls (head + binary search)

    expect(hits.dead).toBe(3); // the 3 attempts of the FIRST call only — then the pool moved on
    expect(hits.good).toBeGreaterThan(5);
  });

  it('refuses to build an empty pool', () => {
    expect(() => makeRpcPool({ urls: [] })).toThrow(/at least one JSON-RPC endpoint/);
  });
});

describe('parseRpcUrls — the RPC_URL_<chain> env format', () => {
  it('parses one endpoint, or a comma-separated pool (trimming)', () => {
    expect(parseRpcUrls('https://a.example')).toEqual(['https://a.example']);
    expect(parseRpcUrls(' https://a.example , https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it('returns [] for an empty/whitespace value (the boot check turns that into a fatal)', () => {
    expect(parseRpcUrls('')).toEqual([]);
    expect(parseRpcUrls('  ,  ')).toEqual([]);
  });

  it('THROWS on a malformed endpoint — a typo fails at boot, not at the first audit', () => {
    expect(() => parseRpcUrls('https://ok.example,not-a-url')).toThrow(/not a valid URL/);
    expect(() => parseRpcUrls('ws://ok.example')).toThrow(/must be http\(s\)/);
  });
});

describe('the resolver over a real pool (no injected rpcCall)', () => {
  it('rejects a non-hex RPC quantity (loud, never a silent NaN)', async () => {
    const bad: JsonRpcCall = async () => 'not-hex';
    await expect(makeRpcBlockTimeResolver({ rpcCall: bad }).headBlock()).rejects.toThrow(/hex quantity/);
  });

  it('builds a failover pool from a comma-separated url and survives the first endpoint being down', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://dead.example') throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2a' }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const r = makeRpcBlockTimeResolver({ url: 'https://dead.example,https://good.example' });
      expect(await r.headBlock()).toBe(42);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 20_000);
});
