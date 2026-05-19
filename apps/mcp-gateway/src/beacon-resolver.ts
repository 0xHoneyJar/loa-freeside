/**
 * beacon-resolver.ts — merge tenant registry policy with upstream broadcast (Cycle C v0.3 P3)
 *
 * Per [[gateway-as-registry]] doctrine:
 *   - A-axis (registry policy · curator-owned · stable) lives in tenants.ts
 *     and ALWAYS wins. Slug, upstream, visibility, access, status — these
 *     describe how the GATEWAY treats the tenant. The upstream cannot
 *     self-grant promotion to a different access tier.
 *   - B-axis (upstream broadcast · upstream-owned · dynamic) comes from the
 *     beacon when available. Auth declaration, capabilities, pricing,
 *     publisher, documentation — these describe what the UPSTREAM offers.
 *     The construct broadcasts; the registry transcribes.
 *
 * Cycle C ships the broadcast layer. Cycle D federation index v2 consumes
 * `ResolvedTenant` directly (per docs-dx-sdd §11). Sprint 4 demotes the
 * B-axis fields in tenants.ts to fallback-only.
 *
 * Behavior:
 *   - Beacon present + fresh/stale  → mergeFromBeacon (B-axis from beacon)
 *   - Beacon absent                  → mergeFromTenant (B-axis from curator)
 *   - First fallback per slug per boot logs a deprecation warning so
 *     operators see which constructs still need beacon authoring.
 *
 * Note on name/description: BeaconV2Schema does NOT include name or
 * description fields — those live in tenants.ts as the registry's own
 * naming. The federation index renders them; the upstream doesn't get to
 * rename itself in the registry's UI.
 */

import { BEACON_CACHE } from "./beacon-cache.js";
import type { Tenant } from "./tenants.js";
import type { BeaconV2 } from "@0xhoneyjar/beacon-schema";

// ────── types ──────

/** Auth kinds the resolver surfaces · superset of tenants.ts AuthKind to
 * accommodate beacon's `oauth` reservation. */
export type ResolvedAuthKind = "none" | "api-key" | "jwt" | "oauth";

/** Source of the B-axis fields in this resolution. Drives /status.json. */
export type BeaconSource = "fresh" | "stale" | "fallback";

/**
 * Merged tenant view used by the proxy handler + /status.json. A-axis from
 * tenants.ts (always); B-axis from beacon when present, curator otherwise.
 */
export type ResolvedTenant = {
  // ── A-axis · registry policy · always from tenants.ts ──
  slug: string;
  upstream: string;
  visibility: "public" | "internal" | "unlisted";
  access: "open" | "allowlist" | "api-key" | "x402";
  status: "live" | "paused";

  // ── A-axis (registry display) · always from tenants.ts ──
  // Beacon does not carry name/description · those are registry-owned.
  name: string;
  description: string;

  // ── B-axis · from beacon when available, curator fallback otherwise ──
  publisher: string;
  authKind: ResolvedAuthKind;
  authHeader?: string;
  credentialsRef?: { type: string; key: string };
  capabilities: ReadonlyArray<string>;
  pricing?: { model: string; unitUsd?: number; description: string };
  documentation?: string;

  // ── metadata · for /status.json + deprecation log ──
  beaconSource: BeaconSource;
  beaconAgeSec: number | null;
};

// ────── once-per-boot deprecation logger ──────

/** Slugs that have already had a fallback warning logged this boot. */
const FALLBACK_LOGGED: Set<string> = new Set();

/** Test seam · clears the logged-set so tests can re-trigger the warning. */
export function _resetFallbackLog(): void {
  FALLBACK_LOGGED.clear();
}

// ────── public resolver ──────

/**
 * Resolve a tenant for serving. Caller passes the curator row (from
 * findTenant/TENANTS); resolver overlays the beacon when available.
 *
 * The resolver NEVER throws — fallback is always available. Validation
 * failures in the cache layer are already filtered before BEACON_CACHE
 * insert, so anything here is structurally valid.
 */
export function resolveTenant(tenant: Tenant): ResolvedTenant {
  const cached = BEACON_CACHE.get(tenant.slug);
  if (cached) {
    const ageMs = Date.now() - cached.fetchedAt;
    return mergeFromBeacon(tenant, cached.beacon, cached.source, ageMs);
  }

  // Fallback path · log once per slug per boot so noise doesn't dominate logs
  if (!FALLBACK_LOGGED.has(tenant.slug)) {
    console.warn(
      `[beacon-resolver] ${tenant.slug}: using tenants.ts curator fallback ` +
        `(no beacon broadcast available). Author beacon.yaml + serve ` +
        `/.well-known/beacon.json to enable v0.3 broadcast.`,
    );
    FALLBACK_LOGGED.add(tenant.slug);
  }
  return mergeFromTenant(tenant);
}

// ────── merge helpers ──────

function mergeFromBeacon(
  tenant: Tenant,
  beacon: BeaconV2,
  source: "fresh" | "stale",
  ageMs: number,
): ResolvedTenant {
  return {
    // A-axis · registry policy
    slug: tenant.slug,
    upstream: tenant.upstream,
    visibility: tenant.visibility,
    access: tenant.access,
    status: tenant.status,
    // A-axis · registry display (beacon doesn't carry these)
    name: tenant.name,
    description: tenant.description,
    // B-axis · from beacon
    publisher: beacon.mcp.publisher,
    authKind: beacon.mcp.auth.kind,
    authHeader: beacon.mcp.auth.header,
    credentialsRef: beacon.mcp.auth.credentials_ref,
    capabilities: beacon.mcp.capabilities,
    pricing: beacon.mcp.pricing,
    documentation: beacon.mcp.documentation ?? tenant.documentation,
    // metadata
    beaconSource: source,
    beaconAgeSec: Math.round(ageMs / 1000),
  };
}

function mergeFromTenant(tenant: Tenant): ResolvedTenant {
  return {
    // A-axis · registry policy
    slug: tenant.slug,
    upstream: tenant.upstream,
    visibility: tenant.visibility,
    access: tenant.access,
    status: tenant.status,
    // A-axis · registry display
    name: tenant.name,
    description: tenant.description,
    // B-axis · from curator (transitional — sprint 4 demotes these)
    publisher: tenant.publisher,
    authKind: tenant.auth,
    authHeader: tenant.authHeader,
    // tenants.ts has no credentials_ref · the gateway can't forward
    // upstream creds without a beacon. This is intentional: v0.3 wires
    // forwarding behind beacon-broadcast only. Sprint 4 cutover relies on
    // beacons being present for any tenant that needs cred forwarding.
    credentialsRef: undefined,
    capabilities: tenant.capabilities,
    pricing: tenant.pricing,
    documentation: tenant.documentation,
    // metadata
    beaconSource: "fallback",
    beaconAgeSec: null,
  };
}
