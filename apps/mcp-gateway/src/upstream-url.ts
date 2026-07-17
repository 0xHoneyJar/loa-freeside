/**
 * upstream-url.ts — pure resolution of a gateway request path to its tenant's
 * upstream URL, carrying the SSRF origin guard.
 *
 * Kept separate from app.ts (the Hono execution surface) so this
 * security-critical logic is unit-testable in isolation: a pure decision
 * (Construct plane), not I/O (Execution plane). app.ts imports it; the proxy
 * handler checks the result and fails closed on an escape.
 */
import type { Tenant } from "./tenants.js";

/** Result of resolving an upstream URL — fails CLOSED on an origin escape (SSRF guard). */
export type UpstreamUrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Build the upstream URL from a gateway request, stripping the `/{slug}` prefix.
 *
 * SSRF guard (fail-closed): the request path is caller-controlled. A
 * protocol-relative component such as `/{slug}//evil.com/x` slices to
 * `//evil.com/x`, which `new URL(path, upstream)` resolves to a DIFFERENT
 * origin (`https://evil.com/x`) — turning the gateway into an open proxy that
 * forwards the caller (and, for a credentialed tenant, the upstream key) to an
 * attacker host. We resolve, then assert the result's origin equals the
 * tenant's own upstream origin — the same host-allowlist discipline the
 * Network Firewall already applies (see
 * packages/adapters/agent/byok-provider-endpoints.ts). Any origin escape is
 * rejected, never forwarded.
 *
 * Note: dot-segment traversal (`/{slug}/../../x`) is NOT an escape — `new URL`
 * normalizes it within the upstream origin, so it passes the guard and forwards
 * to a normalized on-origin path. Only an origin change is rejected.
 *
 * The check compares `.origin` (scheme+host+port), which is path-independent, so
 * it stays sound regardless of whether `tenant.upstream` is origin-only (the
 * UpstreamUrlSchema intent) or ever carried a base path — a base path would be
 * stripped by resolution (pre-existing behavior), never used to bypass the guard.
 */
export function buildUpstreamUrl(tenant: Tenant, gatewayUrl: URL): UpstreamUrlResult {
  const prefix = `/${tenant.slug}`;
  const path = gatewayUrl.pathname.startsWith(prefix)
    ? gatewayUrl.pathname.slice(prefix.length) || "/"
    : gatewayUrl.pathname;
  const upstream = new URL(tenant.upstream);
  const resolved = new URL(path + gatewayUrl.search, upstream);
  if (resolved.origin !== upstream.origin) {
    return {
      ok: false,
      reason: `resolved origin ${resolved.origin} does not match tenant upstream origin ${upstream.origin}`,
    };
  }
  return { ok: true, url: resolved.toString() };
}
