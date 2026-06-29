/**
 * Sprint 2 / S2-T1 — a real `BlockTimeResolver` (the port `date-to-block.ts` left injected + fake-only),
 * via JSON-RPC.
 *
 * `resolveSnapshotBlock` needs "the highest block whose timestamp ≤ a UTC instant" + the chain head. No
 * such adapter exists in the tree — Sprint 1 built the audit against the port but wired only a test fake.
 * This implements it as a binary search over `eth_getBlockByNumber` (~log2(head) RPC calls per audit,
 * deterministic). The `rpcCall` is INJECTABLE so the search ALGORITHM is unit-tested without a live node.
 *
 * ⚠ LIVE CORRECTNESS UNVERIFIED in this build (operator AFK; no live RPC reachable). The binary search is
 * algorithm-tested; the real per-chain RPC URL + a live block-at-date spot-check are a DEPLOY GATE before
 * production — a wrong snapshot block ⇒ a wrong holder set ⇒ a wrong audit (money/ops; do not trust live
 * output until verified).
 */

import type { BlockTimeResolver } from '@freeside/adapters/sonar';

/** A minimal JSON-RPC caller: (method, params) → result. Injectable for tests. */
export type JsonRpcCall = (method: string, params: unknown[]) => Promise<unknown>;

const hexToInt = (hex: unknown): number => {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`RPC: expected a hex quantity, got ${JSON.stringify(hex)}`);
  }
  const n = Number.parseInt(hex, 16);
  if (!Number.isSafeInteger(n)) throw new Error(`RPC: quantity out of safe-integer range: ${hex}`);
  return n;
};

export interface RpcBlockTimeResolverOpts {
  /** the JSON-RPC caller; when omitted, a `fetch` POST to `url` is used. */
  readonly rpcCall?: JsonRpcCall;
  readonly url?: string;
  readonly timeoutMs?: number;
}

export function makeRpcBlockTimeResolver(opts: RpcBlockTimeResolverOpts): BlockTimeResolver {
  const rpcCall = opts.rpcCall ?? defaultRpcCall(opts.url, opts.timeoutMs ?? 15_000);

  const timestampOf = async (block: number): Promise<number> => {
    const b = await rpcCall('eth_getBlockByNumber', ['0x' + block.toString(16), false]);
    if (!b || typeof b !== 'object') throw new Error(`RPC: block ${block} not found`);
    return hexToInt((b as { timestamp?: unknown }).timestamp);
  };
  const headBlock = async (): Promise<number> => hexToInt(await rpcCall('eth_blockNumber', []));

  return {
    headBlock,
    /** Highest block with timestamp ≤ `unixSeconds`. Binary search over [0, head]; block 0 (genesis) is the
     *  floor, so a target before genesis resolves to 0. */
    async blockAtOrBefore(unixSeconds: number): Promise<number> {
      const head = await headBlock();
      let lo = 0;
      let hi = head;
      let ans = 0;
      while (lo <= hi) {
        const mid = lo + ((hi - lo) >> 1);
        const ts = await timestampOf(mid);
        if (ts <= unixSeconds) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    },
  };
}

function defaultRpcCall(url: string | undefined, timeoutMs: number): JsonRpcCall {
  if (!url) {
    throw new Error('makeRpcBlockTimeResolver: a JSON-RPC `url` is required when no `rpcCall` is injected');
  }
  return async (method, params) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(`RPC ${method}: ${j.error.message ?? 'error'}`);
      return j.result;
    } finally {
      clearTimeout(t);
    }
  };
}
