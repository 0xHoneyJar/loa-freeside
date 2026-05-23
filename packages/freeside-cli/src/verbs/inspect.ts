/**
 * `loa freeside inspect <slug>` — fetch, validate, and show a building's beacon.
 *
 * Resolves the slug in the L1 registry, fetches its beacon_url, validates the
 * payload against BeaconV3, and returns the parsed beacon (or an explicit
 * unreachable/invalid status with the registry entry). Auth gating for
 * `unlisted`/`internal` visibility (ADR-007 §D-8) is a follow-up; public-only.
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 *            decisions/008-freeside-as-factory.md §D-11
 */

import { loadRegistry, type Registry } from "@freeside/freeside-registry";
import { validateBeaconV3, type BeaconV3 } from "@freeside/beacon-schema";
import { makeHttpFetcher, type BeaconFetcher } from "./doctor.js";

export interface InspectOutput {
  readonly slug: string;
  readonly beacon_url: string;
  readonly visibility: string;
  readonly status: "valid" | "invalid" | "unreachable";
  readonly beacon?: BeaconV3;
  readonly error?: string;
}

export interface InspectDeps {
  readonly registry?: Registry;
  readonly fetchBeacon?: BeaconFetcher;
  readonly timeoutMs?: number;
}

export const inspectModule = async (
  slug: string,
  deps: InspectDeps = {},
): Promise<InspectOutput> => {
  const registry = deps.registry ?? loadRegistry();
  const entry = registry.modules[slug];
  if (!entry) {
    throw new Error(
      `Building '${slug}' not found in registry. Run 'freeside-cli list' to see registered buildings.`,
    );
  }

  const fetchBeacon = deps.fetchBeacon ?? makeHttpFetcher(deps.timeoutMs ?? 5000);
  const base = {
    slug,
    beacon_url: entry.beacon_url,
    visibility: entry.visibility,
  };

  const raw = await fetchBeacon(entry.beacon_url);
  if (raw === null || raw === undefined) {
    return { ...base, status: "unreachable" };
  }

  const result = validateBeaconV3(raw);
  if (!result.ok || !result.beacon) {
    return { ...base, status: "invalid", error: result.error };
  }
  return { ...base, status: "valid", beacon: result.beacon };
};
