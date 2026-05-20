/**
 * `loa freeside inspect <slug>` — show the validated BeaconV3 for a building,
 * fetched through the live federation manifest (cycle-049 FR-4, G-3).
 *
 * Flow (SDD §4.1):
 *   loadRegistry()                       confirm the slug is registered
 *   GET {gateway}/internal/freeside.json confirm it is live + visible in the
 *     (operator-gated)                   manifest (the "against live data" bar)
 *   loadBeacon(entry)                    resolve the full beacon — the manifest
 *                                        is a compact index, loadBeacon the detail
 *   require kind === "v3"                decodeBeaconV3 validation (in loadBeacon)
 *   → the validated BeaconV3
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 */

import {
  loadRegistry,
  loadBeacon,
  type FreesideManifest,
} from "@freeside/freeside-registry";
import type { BeaconV3 } from "@freeside/beacon-schema";

const DEFAULT_GATEWAY_ORIGIN = "http://localhost:3000";

export interface InspectOptions {
  /**
   * Override the manifest source. Default: an operator-gated HTTP GET against
   * `FREESIDE_GATEWAY_ORIGIN`. The FR-6 E2E harness injects an in-process
   * fetcher pointed at the Hono `app` (SDD §7.2) — no listening socket.
   */
  readonly fetchManifest?: () => Promise<FreesideManifest>;
}

/** Default manifest fetcher — operator-gated HTTP GET to the live gateway. */
const httpManifestFetcher = async (): Promise<FreesideManifest> => {
  const origin = process.env.FREESIDE_GATEWAY_ORIGIN ?? DEFAULT_GATEWAY_ORIGIN;
  const key = process.env.OPERATOR_API_KEY;
  if (!key) {
    throw new Error(
      "OPERATOR_API_KEY is not set — required to fetch the operator-gated /internal/freeside.json",
    );
  }
  const res = await fetch(`${origin}/internal/freeside.json`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${origin}/internal/freeside.json returned HTTP ${res.status}`,
    );
  }
  return (await res.json()) as FreesideManifest;
};

/**
 * Inspect a building's beacon. Resolves to the validated `BeaconV3` —
 * `bin/freeside-cli.ts` pretty-prints it; the E2E harness asserts on it.
 * Throws (→ CLI exit 1) on: unregistered slug, slug absent from the live
 * manifest, or a beacon that is not clean V3.
 */
export const inspectModule = async (
  slug: string,
  opts: InspectOptions = {},
): Promise<BeaconV3> => {
  // 1. Confirm the slug is registered.
  const registry = loadRegistry();
  const entry = registry.modules[slug];
  if (!entry) {
    throw new Error(
      `Module '${slug}' not found in registry. Run 'freeside-cli list' to see registered modules.`,
    );
  }

  // 2. Confirm it is live + visible in the federation manifest.
  const manifest = await (opts.fetchManifest ?? httpManifestFetcher)();
  if (!manifest.modules.some((m) => m.slug === slug)) {
    throw new Error(
      `Module '${slug}' is registered but absent from the live /internal/freeside.json manifest ` +
        `(not visible at the manifest's scope, or its beacon failed to aggregate).`,
    );
  }

  // 3. Resolve + validate the full beacon (the manifest is a compact index).
  const result = loadBeacon(entry);
  if (result.kind === "error") {
    throw new Error(`Beacon for '${slug}' could not be loaded: ${result.error}`);
  }
  if (result.kind === "legacy") {
    throw new Error(
      `Beacon for '${slug}' is BeaconV2 (legacy) — migrate to V3 before inspecting.`,
    );
  }
  // kind === "v3" — decodeBeaconV3 already validated it inside loadBeacon.
  return result.beacon;
};
