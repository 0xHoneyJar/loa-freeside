/**
 * tenant-policy.ts — the gateway-owned A-axis POLICY for BEACON federation.
 *
 * Membership comes from the registry (registry-membership.ts); THIS module
 * decides how the gateway *treats* each member: routing slug, access gate,
 * gateway-visibility (discovery scope on the manifests), and operational status.
 *
 * The keystone (per the converged architecture): gateway-visibility is NEVER
 * derived from the registry's `visibility`. They are a homonym across two
 * bounded contexts — `score-api` is registry-`public` yet gateway-`internal`.
 * So a registry member is **fail-closed to internal** until the gateway grants
 * it an explicit policy here. Deriving membership from the registry can never,
 * by construction, leak a cell into the public federation manifest.
 *
 * Pure data + lookup — no I/O. Not yet wired into the live TENANTS (that join is
 * the deploy-touching follow-on); adding this module does not change gateway
 * behavior.
 */

import type { Tenant } from "./tenants.js";

/** The A-axis the gateway owns for one tenant. */
export type GatewayPolicy = {
  /** Gateway routing slug — appears in URLs as /{slug}/…. MAY differ from the
   *  registry key (the gateway routes `score`; the registry key is `score-api`). */
  slug: string;
  /** Gateway access gate — orthogonal to the upstream's own `auth`. */
  access: "open" | "allowlist" | "api-key" | "x402";
  /** Discovery scope on the federation manifests (gateway-owned, NOT registry). */
  visibility: "public" | "internal" | "unlisted";
  /** `paused` → 503 without dropping the tenant from the manifest. */
  status: "live" | "paused";
  /** Registry rows carry no name/description; the gateway owns display names. */
  name: string;
  description: string;
};

/**
 * Explicit gateway policy for registry-derived members, keyed by **registry
 * slug**. A member listed here is the gateway granting it a route + a treatment.
 * Anything not listed is fail-closed (see policyForMember).
 *
 * `score-api` → routed as `score`, gateway-`internal`, api-key. This is the
 * homonym in action: registry-`public`, gateway-`internal`, deliberately.
 */
export const REGISTRY_TENANT_POLICY: Record<string, GatewayPolicy> = {
  "score-api": {
    slug: "score",
    access: "api-key",
    visibility: "internal",
    status: "live",
    name: "Score Mibera",
    description:
      "Factor metadata + behavioral signals from score-api. Zone digests, top movers, narrative shape. Internal — gated by API key for known callers.",
  },
};

/** Fail-closed default A-axis (the keystone): an unknown registry member is
 *  internal + api-key, routed by its own registry slug. Never public. */
const FAIL_CLOSED = {
  access: "api-key",
  visibility: "internal",
  status: "live",
} as const satisfies Pick<GatewayPolicy, "access" | "visibility" | "status">;

/** Resolve the gateway policy for a registry-derived member. Explicit grant wins;
 *  otherwise fail-closed to internal/api-key (routed by the registry slug). */
export function policyForMember(registrySlug: string): GatewayPolicy {
  const granted = REGISTRY_TENANT_POLICY[registrySlug];
  if (granted) return granted;
  return {
    slug: registrySlug,
    ...FAIL_CLOSED,
    name: registrySlug,
    description: `Registry-derived cell "${registrySlug}" — no explicit gateway policy; fail-closed to internal.`,
  };
}

/**
 * Gateway-NATIVE tenants — served by the gateway but with **no registry row**
 * (they are `construct-X` MCPs, not `freeside-X` buildings). The gateway owns
 * their full existence; they are not derived from registry membership.
 *
 * `codex` is the canonical case: the Mibera lore MCP. This is the same row that
 * lived in RAW_TENANTS, lifted here intact.
 */
export const GATEWAY_NATIVE_TENANTS: ReadonlyArray<Tenant> = [
  {
    slug: "codex",
    name: "Mibera Codex",
    description:
      "Anti-hallucination lookup MCP for Mibera lore — zones, archetypes, factors, grails, miberas. Read by narrative bots and operator harnesses.",
    publisher: "0xHoneyJar",
    upstream: "https://codex-mcp-production.up.railway.app",
    auth: "none",
    documentation: "https://codex.0xhoneyjar.xyz",
    status: "live",
    visibility: "public",
    access: "open",
    capabilities: ["tools"],
    pricing: { model: "free", description: "free as in libre — read-only canon" },
    owner: { handle: "0xHoneyJar", contact: "https://github.com/0xHoneyJar" },
  },
];
