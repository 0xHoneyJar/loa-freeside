/**
 * Auth gates for the federation gateway.
 *
 * Two distinct auth surfaces, both pure (no side effects, no shared state):
 *
 *  1. **Operator gate** — `isAuthorizedOperator(c)`. Checks
 *     `Authorization: Bearer ${OPERATOR_API_KEY}`. Used by
 *     `/internal/federation.json` to enumerate `visibility: internal`
 *     tenants. One key per gateway.
 *
 *  2. **Tenant access gate** — `checkAccess(c, tenant)`. Runs BEFORE the
 *     proxy forwards a request. Per-tenant key via env var
 *     `TENANT_{SLUG_UPPER}_API_KEY` (dashes in the slug become
 *     underscores). The four `tenant.access` modes:
 *
 *       - `open`       → always allowed (codex, public free tenants)
 *       - `allowlist`  → bearer must match the per-tenant secret
 *       - `api-key`    → bearer must match the per-tenant secret
 *       - `x402`       → returns 402; payment-proof verification lands in Phase 6
 *
 * `allowlist` and `api-key` are the same logic in v1 (single bearer).
 * `allowlist` will diverge into a key-set lookup once partner submissions
 * land — at which point the env-var pattern extends to a JSON-encoded set.
 *
 * Migration to Effect-style gating can happen later without changing the
 * call site contract; the `AccessResult` discriminated union is stable.
 */

import type { Context } from "hono";
import type { Tenant } from "./tenants.js";

const OPERATOR_API_KEY = process.env.OPERATOR_API_KEY;

/** Constant-time-ish bearer extraction. */
function bearer(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
}

/** Per-tenant secret env var: `TENANT_{SLUG_UPPER}_API_KEY` (dashes → underscores). */
function tenantApiKey(slug: string): string | undefined {
  const envName = `TENANT_${slug.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  return process.env[envName];
}

export function isAuthorizedOperator(c: Context): boolean {
  if (!OPERATOR_API_KEY) return false;
  const provided = bearer(c);
  return provided !== undefined && provided === OPERATOR_API_KEY;
}

export type AccessResult =
  | { allowed: true }
  | { allowed: false; reason: string; status: 401 | 402 | 403 };

export function checkAccess(c: Context, tenant: Tenant): AccessResult {
  switch (tenant.access) {
    case "open":
      return { allowed: true };

    case "allowlist":
    case "api-key": {
      const expected = tenantApiKey(tenant.slug);
      if (!expected) {
        // Fail-closed: if the tenant declares api-key access but no key is
        // configured, no caller can pass. This surfaces misconfiguration
        // instead of silently letting requests through.
        return {
          allowed: false,
          reason: "tenant_misconfigured: no api key configured",
          status: 401,
        };
      }
      const provided = bearer(c);
      if (!provided || provided !== expected) {
        return { allowed: false, reason: "unauthorized", status: 401 };
      }
      return { allowed: true };
    }

    case "x402":
      return {
        allowed: false,
        reason: "payment_required: x402 verification lands in Phase 6",
        status: 402,
      };
  }
}
