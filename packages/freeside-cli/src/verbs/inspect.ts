/**
 * `loa freeside inspect <slug>` — show full beacon for a module.
 *
 * Fetches the module's beacon from its registered beacon_url and pretty-prints
 * the BeaconV3 (or V2 legacy) content. Auth gating for `unlisted`/`internal`
 * visibility per ADR-007 §D-8 ships in a follow-up cycle (currently
 * public-only).
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-6
 * STUB: network fetch + full V3 validation deferred to follow-up cycle.
 */

import { loadRegistry } from "@freeside/freeside-registry";

export interface InspectOutput {
  readonly slug: string;
  // null for in-repo library cells (e.g. events-api) — see registry.ts beacon_url NullOr.
  readonly beacon_url: string | null;
  readonly visibility: string;
  readonly note: string;
}

export const inspectModule = (slug: string): InspectOutput => {
  const registry = loadRegistry();
  const entry = registry.modules[slug];
  if (!entry) {
    throw new Error(
      `Module '${slug}' not found in registry. Run 'freeside-cli list' to see registered modules.`,
    );
  }
  return {
    slug,
    beacon_url: entry.beacon_url,
    visibility: entry.visibility,
    note: "STUB: beacon fetch + BeaconV3 validation deferred to follow-up cycle (per ADR-007 §Implementation step 7).",
  };
};
