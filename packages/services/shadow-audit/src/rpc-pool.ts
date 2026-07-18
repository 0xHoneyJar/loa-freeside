/**
 * Sprint 5 / S5-T2 — a failover pool with retry+backoff for the JSON-RPC calls the block-time resolver
 * makes. One endpoint per chain, called once with no retry, is not a resilience gap — it is a LIVE OUTAGE
 * we ran in production:
 *
 *   - `eth.drpc.org` answers every block in ~0.2s but returns HTTP 408 on the GENESIS block only. The
 *     resolver's binary search probed block 0, so ethereum ownership had never once reconstructed on this
 *     service. One bad reply, every audit dead, for the life of the deploy.
 *   - `optimism-rpc.publicnode.com` answers `null` for older blocks (pruned) rather than erroring — a
 *     "successful" reply that carries no block.
 *
 * There is no paid key to buy our way out of the free tier, so the POOL is the answer: retry an endpoint
 * with exponential backoff, then fail over to the next. A binary search is ~24 sequential calls, so a
 * known-bad endpoint must not be re-probed on every one of them — the pool sticks to the last endpoint
 * that answered.
 *
 * Verified free/keyless endpoints (probed today under the resolver's real load — genesis + 30-call burst):
 *   1 (ethereum)  https://ethereum-rpc.publicnode.com   (cloudflare-eth.com is REJECTED from Railway egress)
 *   8453 (base)   https://mainnet.base.org
 *   10 (optimism) https://mainnet.optimism.io
 *   42161         https://arbitrum.drpc.org
 *   80094 (bera)  https://berachain.drpc.org
 * They are DEFAULTS FOR DOCUMENTATION ONLY — the endpoint list is env-driven (`RPC_URL_<chain>`).
 */

/** A minimal JSON-RPC caller: (method, params) → result. Injectable for tests. */
export type JsonRpcCall = (method: string, params: unknown[]) => Promise<unknown>;

/** One endpoint, one call. Injectable so the pool's failover/retry is tested without a network. */
export type SingleEndpointCall = (url: string, method: string, params: unknown[]) => Promise<unknown>;

export interface RpcPoolOpts {
  readonly urls: readonly string[];
  /** attempts against ONE endpoint before failing over to the next (default 3). */
  readonly attemptsPerUrl?: number;
  /** first retry backoff, doubled per attempt (default 250ms). */
  readonly backoffMs?: number;
  readonly timeoutMs?: number;
  readonly callOne?: SingleEndpointCall;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Parse `RPC_URL_<chain>` — ONE endpoint, or a comma-separated failover pool ("https://a,https://b").
 * Returns [] for an empty/whitespace value (the caller decides whether that is fatal); THROWS on a
 * malformed entry, so a typo'd endpoint fails at boot rather than at the first audit.
 */
export function parseRpcUrls(raw: string): string[] {
  const urls = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`not a valid URL: "${u}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`JSON-RPC endpoint must be http(s): "${u}"`);
    }
  }
  return urls;
}

/**
 * Strip any URL from a message before it can reach a caller (SECURITY, arrakis-qf5kc).
 *
 * Defense in depth for the pool's own redaction: the pool no longer names endpoints, but a message can
 * still arrive carrying one from BELOW it — `fetch`/undici failures routinely embed the request URL, and
 * so do some providers' error bodies. Ownership-reconstruction refusals echo `e.message` verbatim to the
 * caller (including the ANONYMOUS teaser), so the scrub belongs at that boundary too: one leak is enough,
 * and the failure path is where both of this service's previous disclosures were found.
 *
 * Redacts the whole URL, not just the query: every paid RPC provider puts its API key in the PATH
 * (`alchemy.com/v2/<KEY>`, `infura.io/v3/<KEY>`), and quicknode also puts a token in the subdomain — so a
 * host-only or query-only scrub would still leak the credential.
 */
export function redactEndpoints(message: string): string {
  return message.replace(/\bhttps?:\/\/\S+/gi, '<endpoint>');
}

export function makeRpcPool(opts: RpcPoolOpts): JsonRpcCall {
  const urls = [...opts.urls];
  if (urls.length === 0) throw new Error('makeRpcPool: at least one JSON-RPC endpoint is required');
  const attemptsPerUrl = opts.attemptsPerUrl ?? 3;
  const backoffMs = opts.backoffMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const callOne = opts.callOne ?? fetchRpcCall(opts.timeoutMs ?? 15_000);

  // Sticky preference: start each call at the endpoint that last answered, so a dead endpoint costs its
  // timeout once per audit, not once per binary-search probe.
  let preferred = 0;

  return async (method, params) => {
    const failures: string[] = [];
    for (let hop = 0; hop < urls.length; hop++) {
      const idx = (preferred + hop) % urls.length;
      const url = urls[idx]!;
      for (let attempt = 0; attempt < attemptsPerUrl; attempt++) {
        try {
          const result = await callOne(url, method, params);
          // A pruned endpoint answers `null` for an old block instead of erroring. We only ever probe
          // blocks <= head, so a null block is an ENDPOINT failure — fail over, never mistake it for
          // "this block does not exist" (which would corrupt the search).
          if (method === 'eth_getBlockByNumber' && (result === null || result === undefined)) {
            throw new Error('null block — endpoint is likely pruned');
          }
          preferred = idx;
          return result;
        } catch (e) {
          // NEVER put the endpoint URL in this message (SECURITY, arrakis-qf5kc).
          //
          // This error propagates: ownership reconstruction catches it and builds a typed refusal whose
          // reason echoes `e.message` — and that refusal is returned VERBATIM to the caller, including on
          // the ANONYMOUS public teaser (`/v1/access-risk`). So anything in here is published to an
          // unauthenticated stranger, and an attacker can FORCE it by hammering until the free tiers throttle.
          //
          // RPC_URL_<chain> is operator-controlled, and EVERY paid provider carries its API key IN THE URL
          // (alchemy.com/v2/<KEY>, infura.io/v3/<KEY>, quicknode's <token> — key in the path, and for
          // quicknode in the subdomain too). Naming the endpoint here would therefore be a booby trap: it
          // leaks nothing while the endpoints are keyless, and becomes credential disclosure the moment
          // someone adds a paid key — the most natural next config change.
          //
          // The ordinal is enough to debug a pool ("endpoint 2 of 3 failed") and identifies nothing.
          const safeMessage = redactEndpoints(
            e instanceof Error ? e.message : String(e),
          );
          failures.push(`endpoint ${idx + 1} of ${urls.length}: ${safeMessage}`);
          if (attempt < attemptsPerUrl - 1) await sleep(backoffMs * 2 ** attempt);
        }
      }
    }
    throw new Error(
      redactEndpoints(
        `RPC ${method} failed on all ${urls.length} endpoint(s) — ${failures.join(' | ')}`,
      ),
    );
  };
}

function fetchRpcCall(timeoutMs: number): SingleEndpointCall {
  return async (url, method, params) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? 'error');
      return j.result;
    } finally {
      clearTimeout(t);
    }
  };
}
