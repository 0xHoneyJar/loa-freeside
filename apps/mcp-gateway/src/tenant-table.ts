/**
 * tenant-table.ts — the JOIN (BEACON federation T3).
 *
 * `buildTenants` is the pure heart of the converged architecture: `federation.json` is a JOIN of
 * registry MEMBERSHIP (registry-membership.ts) + gateway POLICY (tenant-policy.ts) + gateway-NATIVE
 * tenants — NOT the hardcoded `RAW_TENANTS` existence list. Each registry member is routed + gated by
 * the gateway's own policy (fail-closed); its B-axis (capabilities/auth/pricing) is a minimal curator
 * fallback here and is overlaid from the cell's served beacon by beacon-resolver.ts at request time.
 *
 * Pure + deterministic (no I/O). Boot-time wiring — feeding `deriveMembers(loadRegistry().modules)` into
 * this join in place of `RAW_TENANTS` — is the deploy-touching follow-on (it adds the
 * @freeside/freeside-registry workspace dep + the Dockerfile builder/runtime stages). This module is the
 * logic that wiring will call; adding it does not change live gateway behavior.
 */

import type { Tenant } from "./tenants.js";
import type { RegistryMember } from "./registry-membership.js";
import { policyForMember } from "./tenant-policy.js";

/**
 * Project one registry member through the gateway's policy into a Tenant row. The A-axis (slug,
 * visibility, access, status, name/description) is the gateway's POLICY (fail-closed for ungranted
 * members — registry-visibility never crosses into gateway-visibility). The B-axis is a minimal
 * first-party fallback; the cell's beacon overlays the real values via beacon-resolver.
 */
function memberToTenant(member: RegistryMember): Tenant {
  const policy = policyForMember(member.slug);
  return {
    // ── A-axis · gateway policy (NOT derived from member.sourceVisibility) ──
    slug: policy.slug,
    name: policy.name,
    description: policy.description,
    upstream: member.upstream,
    status: policy.status,
    visibility: policy.visibility,
    access: policy.access,
    // ── B-axis · curator fallback (beacon-resolver overlays from the served beacon) ──
    publisher: "0xHoneyJar",
    auth: "none",
    capabilities: ["tools"],
  };
}

/**
 * JOIN registry membership + gateway policy + gateway-native tenants → the tenant table.
 *
 * Native tenants (gateway-owned existence, e.g. `codex` — no registry row) come first and are
 * authoritative: if a registry member's policy routes it to a slug a native already owns, the native
 * wins (a building can never shadow a gateway-native MCP). Deterministic order: natives as listed, then
 * registry members in their (already slug-sorted) order.
 */
export function buildTenants(
  members: readonly RegistryMember[],
  natives: readonly Tenant[],
): Tenant[] {
  const bySlug = new Map<string, Tenant>();
  for (const t of natives) bySlug.set(t.slug, t);
  for (const member of members) {
    const t = memberToTenant(member);
    if (!bySlug.has(t.slug)) bySlug.set(t.slug, t); // native wins on slug collision
  }
  return [...bySlug.values()];
}
