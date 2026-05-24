/**
 * @0xhoneyjar/freeside-registry · the building-AWARENESS catalog
 *
 * The freeside federation's primary purpose is discoverability: any Loa agent
 * (or the operator), in any project, points at this catalog to learn what
 * buildings exist, what each is, and how to reach it (API · MCP · CLI) — then
 * wires it in as a first-class tool. Like the constructs network, for the
 * freeside building network.
 *
 * `buildCatalog` joins the registry (what's registered) with resolved beacons
 * (what each building declares) into one awareness shape. It is decoupled from
 * @0xhoneyjar/beacon-schema: callers pass a plain `BuildingBeaconSummary` map
 * (the cli extracts it from validated BeaconV3 docs), so the registry stays a
 * leaf with no schema dependency — mirrors `buildCompactManifest`.
 *
 * Catalog (what EXISTS) is distinct from the gateway's /federation.json
 * (what's CALLABLE now). A building joins the routing manifest only once its
 * beacon declares an `mcp` block and it's deployed as a tenant.
 */

import type { Registry, VisibilityLevel } from "./registry.js";

/** The beacon-derived facts the catalog surfaces per building. */
export interface BuildingBeaconSummary {
  readonly one_liner: string;
  readonly scope: ReadonlyArray<string>;
  readonly is_not: ReadonlyArray<string>;
  readonly capabilities: ReadonlyArray<string>;
  /** cycle_state.status — candidate | active | mature | sunset | legacy */
  readonly status: string;
  /** beacon declares an mcp transport block (callable over MCP). */
  readonly has_mcp: boolean;
}

/** One building's awareness card: registry facts + (when resolved) beacon facts. */
export interface CatalogBuilding {
  readonly slug: string;
  readonly visibility: VisibilityLevel;
  readonly git_url: string;
  readonly beacon_url: string;
  readonly rename?: "done" | "pending";
  /** true when the beacon was resolved + valid; false when unreachable/invalid. */
  readonly reachable: boolean;
  readonly one_liner?: string;
  readonly scope?: ReadonlyArray<string>;
  readonly is_not?: ReadonlyArray<string>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly status?: string;
  readonly has_mcp?: boolean;
}

export interface BuildingCatalog {
  readonly version: number;
  readonly generated_at: string;
  readonly building_count: number;
  readonly buildings: ReadonlyArray<CatalogBuilding>;
}

/**
 * Build the awareness catalog. `beacons` maps registry slug → beacon summary;
 * a slug absent from the map is surfaced as `reachable: false` (registered but
 * its beacon isn't deployed/valid yet) rather than dropped — the operator
 * needs to see "exists but not yet broadcasting".
 */
export const buildCatalog = (
  registry: Registry,
  beacons: ReadonlyMap<string, BuildingBeaconSummary>,
  visibilityFilter: ReadonlyArray<VisibilityLevel> = ["public"],
  now: Date = new Date(),
): BuildingCatalog => {
  const buildings: CatalogBuilding[] = [];
  for (const [slug, entry] of Object.entries(registry.modules)) {
    if (!visibilityFilter.includes(entry.visibility)) continue;
    const summary = beacons.get(slug);
    const base: CatalogBuilding = {
      slug,
      visibility: entry.visibility,
      git_url: entry.git_url,
      beacon_url: entry.beacon_url,
      rename: entry.rename,
      reachable: summary !== undefined,
    };
    buildings.push(
      summary
        ? {
            ...base,
            one_liner: summary.one_liner,
            scope: summary.scope,
            is_not: summary.is_not,
            capabilities: summary.capabilities,
            status: summary.status,
            has_mcp: summary.has_mcp,
          }
        : base,
    );
  }
  return {
    version: 1,
    generated_at: now.toISOString(),
    building_count: buildings.length,
    buildings,
  };
};
