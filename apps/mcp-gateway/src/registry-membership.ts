/**
 * registry-membership.ts — derive the gateway's federation MEMBERSHIP from the
 * freeside registry (BEACON federation, first cut).
 *
 * Per grimoires/loa/context/beacon-federation-architecture.md (the-weaver +
 * EVANS, converged): `federation.json` is a JOIN, not a projection.
 *
 *   registry owns → MEMBERSHIP (which cells exist + upstream + source-visibility + lifecycle)
 *   gateway  owns → POLICY     (access, gateway-visibility, status — see tenant-policy.ts)
 *   cell     owns → its beacon (capabilities/auth/pricing — overlaid by beacon-resolver.ts)
 *
 * This module owns ONLY the membership half. It is PURE (no I/O): `deriveMembers`
 * takes an already-parsed registry-modules map and returns the deployed,
 * reachable members. Boot-time wiring (reading registry.yaml via
 * @freeside/freeside-registry's loadRegistry) is a separate, deploy-touching step
 * — kept out of here so the derivation logic stays unit-testable without the
 * loader, the workspace dep, or the filesystem.
 */

/**
 * The subset of a registry module entry this derivation reads. Structurally a
 * subset of @freeside/freeside-registry's `ModuleEntry` — so the parsed registry
 * can be passed straight in once the loader is wired.
 *
 * loa:shortcut: local view type; unify with @freeside/freeside-registry's
 *   ModuleEntry when that workspace dep is added to the gateway (the boot-wiring
 *   step). Upgrade trigger: the loadRegistry() boot wiring lands.
 */
export type RegistryModuleView = {
  visibility: "public" | "internal" | "unlisted";
  beacon_url: string | null;
  deployment_url?: string | null;
  runtime_state?: "deployed" | "not-built" | "scaffolded";
};

/** One registry-derived federation member. The gateway joins this with its own
 *  policy (tenant-policy.ts) to produce a Tenant row. */
export type RegistryMember = {
  /** The registry key — also the gateway routing slug. */
  slug: string;
  /** Upstream origin (https, no trailing slash) — the cell's deployment_url. */
  upstream: string;
  /** The registry's *source* visibility. NOTE: this is NOT gateway-visibility.
   *  The gateway never derives its discovery-scope from this (the homonym
   *  keystone — score is registry-public yet gateway-internal). Carried for
   *  provenance/diagnostics only. */
  sourceVisibility: "public" | "internal" | "unlisted";
  /** The cell's own beacon pointer (may be null for in-repo library cells). */
  beaconUrl: string | null;
};

/** Strip a single trailing slash so upstreams satisfy the gateway's
 *  UpstreamUrlSchema (`https://…` with no trailing slash). */
function normalizeUpstream(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Derive federation members from a parsed registry-modules map.
 *
 * Membership rule (first cut): a cell is a member iff it is **deployed** AND has
 * a reachable `https://` upstream. `not-built` / `scaffolded` cells and cells
 * with a null/`~` deployment_url are excluded — the gateway federates running
 * services, not declarations of intent.
 *
 * Pure + deterministic: sorts by slug so the manifest order is stable.
 */
export function deriveMembers(
  modules: Record<string, RegistryModuleView>,
): RegistryMember[] {
  const members: RegistryMember[] = [];
  for (const [slug, entry] of Object.entries(modules)) {
    if (entry.runtime_state !== "deployed") continue;
    const upstream = entry.deployment_url;
    if (!upstream || !/^https:\/\//.test(upstream)) continue;
    members.push({
      slug,
      upstream: normalizeUpstream(upstream),
      sourceVisibility: entry.visibility,
      beaconUrl: entry.beacon_url,
    });
  }
  members.sort((a, b) => a.slug.localeCompare(b.slug));
  return members;
}
