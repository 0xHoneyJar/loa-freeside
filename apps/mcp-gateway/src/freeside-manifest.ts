/**
 * apps/mcp-gateway · freeside building-manifest delegate (cycle-049 FR-3).
 *
 * AD-1: `@freeside/freeside-registry` owns the manifest-builder library;
 * the gateway owns the HTTP surface. This module is the thin gateway-side
 * delegate — it loads the registry and calls the registry's aggregator.
 *
 * Distinct from the MCP-tenant federation manifest in app.ts (SDD §3.6):
 * different registry, different schema, different route.
 */

import {
  loadRegistry,
  buildFreesideManifest,
  loadBeacon,
  type FreesideManifest,
} from "@freeside/freeside-registry";

/**
 * Build the freeside building manifest served at `GET /internal/freeside.json`.
 *
 * Throws ONLY on a builder-level failure (`registry.yaml` unparseable) — the
 * route handler maps that to `500 manifest_build_failed`. A single building's
 * bad beacon does NOT throw: `buildFreesideManifest` skips it with a
 * `console.warn` (SDD §6.1 skip-not-crash).
 */
export function buildFreesideJson(): FreesideManifest {
  return buildFreesideManifest(loadRegistry(), loadBeacon);
}
