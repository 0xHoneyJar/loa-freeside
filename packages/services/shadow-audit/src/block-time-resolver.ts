/**
 * Sprint 2 / S2-T1 — a real `BlockTimeResolver` (the port `date-to-block.ts` left injected + fake-only),
 * via JSON-RPC.
 *
 * `resolveSnapshotBlock` needs "the highest block whose timestamp ≤ a UTC instant" + the chain head. This
 * implements it as a binary search over `eth_getBlockByNumber` (~log2(head) RPC calls per audit,
 * deterministic). The `rpcCall` is INJECTABLE so the search ALGORITHM is unit-tested without a live node.
 *
 * S5-T2 — the header used to say "LIVE CORRECTNESS UNVERIFIED"; live is what finally read it. The search
 * probed block 0, and `eth.drpc.org` returns HTTP 408 on the genesis block ONLY (every other block answers
 * in 0.2s) — so with no retry and no failover, ethereum ownership had NEVER once reconstructed on this
 * service. Two fixes, both here:
 *   - the search is now over **[1, head]** — genesis is never probed.
 *   - the default caller is a **failover pool** with retry+backoff (rpc-pool.ts), because the free
 *     endpoints each fail in their own way and there is no paid key to escape to.
 * What remains UNVERIFIED in this build: the live-from-Railway probe of the fixed path (the endpoints were
 * verified from a laptop; Railway egress rejects at least one endpoint that passes locally). Until that
 * probe is green, treat live output as unproven (money/ops).
 */

import type { BlockTimeResolver } from '@freeside/adapters/sonar';
import { makeRpcPool, parseRpcUrls, type JsonRpcCall } from './rpc-pool.js';

export type { JsonRpcCall } from './rpc-pool.js';

const hexToInt = (hex: unknown): number => {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`RPC: expected a hex quantity, got ${JSON.stringify(hex)}`);
  }
  const n = Number.parseInt(hex, 16);
  if (!Number.isSafeInteger(n)) throw new Error(`RPC: quantity out of safe-integer range: ${hex}`);
  return n;
};

export interface RpcBlockTimeResolverOpts {
  /** the JSON-RPC caller; when omitted, a failover pool over `url` is used. */
  readonly rpcCall?: JsonRpcCall;
  /** ONE endpoint, or a comma-separated failover pool: "https://a.example,https://b.example". */
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
    /** Highest block with timestamp ≤ `unixSeconds`. Binary search over **[1, head]** — block 0 is NEVER
     *  probed (S5-T2: drpc 408s on genesis and only on genesis; one such call killed every ethereum audit).
     *
     *  Returns **-1** when no block in [1, head] satisfies it — i.e. the target instant is at-or-before
     *  block 1's timestamp (a snapshot_date before the chain effectively existed). The caller MUST treat -1
     *  as "no such block" and REFUSE (ownership-source.ts): silently returning 0 would reconstruct an empty
     *  snapshot and serve a plausible WRONG audit (FAGAN HIGH-1 — the one place the "refuse, never
     *  silent-wrong" invariant leaked). Genesis holds no reconstructable ownership anyway, so excluding it
     *  costs nothing and refusing is the correct answer. */
    async blockAtOrBefore(unixSeconds: number): Promise<number> {
      const head = await headBlock();
      let lo = 1; // never probe genesis
      let hi = head;
      let ans = -1; // sentinel: no block ≤ target found yet
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
  const urls = parseRpcUrls(url);
  if (urls.length === 0) {
    throw new Error('makeRpcBlockTimeResolver: `url` contained no JSON-RPC endpoint');
  }
  return makeRpcPool({ urls, timeoutMs });
}
