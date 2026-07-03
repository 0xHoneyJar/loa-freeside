/**
 * Live edges for the distiller (SDD §3, §11.5 IMP-006). These are the two
 * INJECTED boundaries `ground()` takes — kept thin and out of the tested core.
 *   - `liveBeltRead`  : belt-gateway TrackedHolder GraphQL (distinct collections)
 *   - `liveEthCall`   : per-chain JSON-RPC eth_call (8s timeout + 1 retry;
 *                       failure → null → the distiller degrades to `unknown`)
 */

import type { BeltCollection, EthCall, BeltRead } from './distiller.js';

// Verified against the live belt-gateway schema 2026-07-03 (GraphQL introspection):
// endpoint is `/v1/graphql`, the table is `TrackedHolder` (Hasura capital-T
// singular) with fields { address, chainId, collectionKey, contract, id,
// tokenCount }. (The earlier `/graphql` + `trackedHolders` guess 404'd / 400'd —
// caught by the live E2E, not the hermetic fixture.)
const DEFAULT_BELT_URL = 'https://belt-gateway-production.up.railway.app/v1/graphql';
const RPC_TIMEOUT_MS = 8_000;

const TRACKED_COLLECTIONS_QUERY = `
  query TrackedCollections {
    TrackedHolder(distinct_on: collectionKey) {
      collectionKey
      chainId
      contract
    }
  }`;

/** Fetch the distinct belt-tracked collections (collection_key + chain + contract). */
export function liveBeltRead(beltUrl: string = DEFAULT_BELT_URL, fetchImpl: typeof fetch = fetch): BeltRead {
  return async (): Promise<BeltCollection[]> => {
    const res = await fetchImpl(beltUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: TRACKED_COLLECTIONS_QUERY }),
    });
    if (!res.ok) throw new Error(`belt-gateway ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { data?: { TrackedHolder?: BeltCollection[] }; errors?: unknown };
    if (json.errors) throw new Error(`belt-gateway GraphQL errors: ${JSON.stringify(json.errors)}`);
    return (json.data?.TrackedHolder ?? []).map((h) => ({
      collectionKey: String(h.collectionKey),
      chainId: String(h.chainId),
      contract: String(h.contract),
    }));
  };
}

/**
 * Per-chain JSON-RPC eth_call. `rpcUrls` maps chain id → endpoint. A missing
 * chain, a timeout, or a transport error returns null (→ standard `unknown`,
 * never a crash — CI-deterministic per IMP-006). One retry on failure.
 */
export function liveEthCall(rpcUrls: Record<string, string>, fetchImpl: typeof fetch = fetch): EthCall {
  return async (chainId, to, data): Promise<string | null> => {
    const url = rpcUrls[chainId];
    if (!url) return null;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] });
    const attempt = async (): Promise<string | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { result?: string; error?: unknown };
        if (json.error || typeof json.result !== 'string') return null; // a revert is an error → unknown
        return json.result;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    const first = await attempt();
    if (first !== null) return first;
    return attempt(); // one retry
  };
}
