/**
 * `loa freeside catalog` — the building-AWARENESS surface.
 *
 * The discovery verb: it reads the registry, resolves each building's beacon
 * (best-effort), and emits the catalog an agent (or operator) reads to learn
 * what freeside buildings EXIST and how to wire each in as a first-class tool.
 *
 *   --format json  → machine catalog (the /buildings.json shape)
 *   --format md    → the FREESIDE.md building-network map (human + agent)
 *
 * Distinct from `doctor` (health audit) and from the gateway's
 * /federation.json (MCP routing — what's callable now). Catalog = what EXISTS.
 *
 * Renderers live in ./catalog-render (dependency-free); re-exported here.
 *
 * Reference: decisions/008-freeside-as-factory.md §D-3 (the DAG) + §D-11
 */

import {
  loadRegistry,
  buildCatalog,
  type Registry,
  type BuildingBeaconSummary,
  type BuildingCatalog,
  type VisibilityLevel,
} from "@freeside/freeside-registry";
import { validateBeaconV3 } from "@freeside/beacon-schema";
import { makeHttpFetcher, type BeaconFetcher } from "./doctor.js";

export { renderCatalogMarkdown, renderCatalogJson } from "./catalog-render.js";

export interface CatalogDeps {
  readonly registry?: Registry;
  readonly fetchBeacon?: BeaconFetcher;
  readonly visibility?: ReadonlyArray<VisibilityLevel>;
  readonly now?: Date;
  readonly timeoutMs?: number;
}

const summarize = (beacon: {
  is: { one_liner: string; scope: ReadonlyArray<string> };
  is_not: ReadonlyArray<string>;
  capabilities: ReadonlyArray<string>;
  cycle_state: { status: string };
  mcp?: unknown;
}): BuildingBeaconSummary => ({
  one_liner: beacon.is.one_liner,
  scope: beacon.is.scope,
  is_not: beacon.is_not,
  capabilities: beacon.capabilities,
  status: beacon.cycle_state.status,
  has_mcp: beacon.mcp !== undefined,
});

export const catalog = async (deps: CatalogDeps = {}): Promise<BuildingCatalog> => {
  const registry = deps.registry ?? loadRegistry();
  const fetchBeacon = deps.fetchBeacon ?? makeHttpFetcher(deps.timeoutMs ?? 5000);

  const beacons = new Map<string, BuildingBeaconSummary>();
  for (const [slug, entry] of Object.entries(registry.modules)) {
    const raw = await fetchBeacon(entry.beacon_url);
    if (raw === null || raw === undefined) continue;
    const result = validateBeaconV3(raw);
    if (result.ok && result.beacon) beacons.set(slug, summarize(result.beacon));
  }

  return buildCatalog(registry, beacons, deps.visibility ?? ["public"], deps.now);
};
