/**
 * credentials-resolver.ts — request-time upstream credential resolution (Cycle C v0.3 P3)
 *
 * Per SDD §3.5: when the gateway forwards a request to an upstream that
 * declares `auth.kind != "none"`, this resolver:
 *
 *   1. Reads `process.env[ref.key]` AT REQUEST TIME (not boot · enables
 *      Railway secret rotation without gateway restart).
 *   2. Returns a discriminated union the proxy uses to either inject the
 *      header on the upstream fetch or fail-closed with 401.
 *
 * Failure modes (all fail-closed):
 *   - tenant.authKind == "none" + missing header/ref      → no-op (resolved)
 *   - tenant.authKind != "none" + no header/ref declared  → 401
 *   - referenced env var missing or empty                  → 401
 *   - credentials_ref.type unsupported in v0.3             → 401 with explicit reason
 *
 * v0.3 supports `railway-secret` and `env-var` (functionally identical —
 * both resolve via process.env). `sops` and `doppler` are reserved at the
 * schema level but explicitly fail here so misconfigured beacons surface
 * clearly rather than silently misbehaving.
 *
 * Trust boundary: the resolved credential VALUE never leaves this function
 * except as the second tuple element returned to the proxy. Logs surface
 * KEY NAMES and PRESENCE booleans only — never values. The proxy is
 * responsible for setting the header and not echoing it back.
 */

import type { ResolvedTenant } from "./beacon-resolver.js";

/**
 * Discriminated result. The proxy switches on `resolved` and either calls
 * `headers.set(header, value)` or returns a 401 with `reason` echoed back.
 */
export type CredentialResolution =
  | { resolved: true; header: string; value: string }
  | { resolved: false; reason: string };

/**
 * Resolve the upstream credential for a request based on the tenant's
 * resolved beacon. Pure function — no side effects, safe to call once
 * per request without rate-limiting concerns.
 */
export function resolveUpstreamCredential(
  tenant: ResolvedTenant,
): CredentialResolution {
  // No-auth upstreams (codex) → resolver is a no-op. Returning resolved=true
  // with empty header lets the proxy unconditionally check `if (cred.header)`
  // before calling headers.set(), avoiding a special case in the hot path.
  if (tenant.authKind === "none") {
    return { resolved: true, header: "", value: "" };
  }

  // Tenant declares auth but lacks the wiring to actually forward creds.
  // For beacon-derived resolutions this means the construct's beacon was
  // accepted by the schema (kind:none ↔ kind:api-key refine rule) but the
  // tenant landed in fallback territory. For curator-derived resolutions
  // it means tenants.ts has no credentials_ref by design (v0.3 forwarding
  // is beacon-only).
  if (!tenant.authHeader || !tenant.credentialsRef) {
    return {
      resolved: false,
      reason: `tenant_misconfigured: ${tenant.slug} declares auth:${tenant.authKind} but missing header or credentials_ref (broadcast a beacon with auth.header + auth.credentials_ref to enable forwarding)`,
    };
  }

  const ref = tenant.credentialsRef;

  // v0.3 supports env-backed resolution only. Both `railway-secret` and
  // `env-var` resolve via process.env — the distinction is documentation
  // (which secrets store the operator MEANT) not behavior. Sprint 4 may
  // diverge if Railway grows a richer API surface.
  if (ref.type === "railway-secret" || ref.type === "env-var") {
    const value = process.env[ref.key];
    if (!value) {
      return {
        resolved: false,
        reason: `tenant_misconfigured: ${tenant.slug} credential not set (process.env.${ref.key} missing)`,
      };
    }
    return { resolved: true, header: tenant.authHeader, value };
  }

  // sops / doppler reserved for v0.4. Fail with explicit reason so the
  // operator sees exactly which type needs upgrading rather than a generic
  // "not implemented" surface.
  return {
    resolved: false,
    reason: `tenant_misconfigured: ${tenant.slug} credentials_ref.type "${ref.type}" not supported in v0.3 (use railway-secret or env-var)`,
  };
}
