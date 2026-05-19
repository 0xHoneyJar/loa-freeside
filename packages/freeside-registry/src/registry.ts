/**
 * @freeside/freeside-registry · L1 registry loader + manifest aggregator
 *
 * Reads packages/freeside-registry/registry.yaml and aggregates the
 * freeside federation manifest (per ADR-007 §D-5, ADR-008 §D-3 belts).
 *
 * `buildFreesideManifest` is library-only — it takes an injected beacon
 * loader and returns the manifest. The HTTP surface that serves it lives
 * in apps/mcp-gateway (per cycle-049 SDD AD-1: the registry opens no
 * HTTP listener).
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-5
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Schema } from "effect";
import type { BeaconLoader, BeaconLoadResult } from "./beacon-loader.js";

// ─────────────────────────────────────────────────────────────────────────────
// Registry schema (L1)
// ─────────────────────────────────────────────────────────────────────────────

const VisibilityLevel = Schema.Literal("public", "unlisted", "internal");

const ModuleEntry = Schema.Struct({
  git_url: Schema.String,
  beacon_url: Schema.String,
  // Optional (cycle-049 FR-2/AD-4): when present, the beacon-loader reads this
  // registry-package-relative path instead of fetching beacon_url. Used for
  // in-repo fixture beacons (FR-5). The existing remote entries omit it.
  beacon_fixture: Schema.optional(Schema.String),
  visibility: VisibilityLevel,
  owner: Schema.String,
  added: Schema.String, // ISO-8601 date
});

const Registry = Schema.Struct({
  version: Schema.Number,
  modules: Schema.Record({ key: Schema.String, value: ModuleEntry }),
});

export type Registry = Schema.Schema.Type<typeof Registry>;
export type ModuleEntry = Schema.Schema.Type<typeof ModuleEntry>;
export type VisibilityLevel = Schema.Schema.Type<typeof VisibilityLevel>;

// ─────────────────────────────────────────────────────────────────────────────
// Loader — reads packages/freeside-registry/registry.yaml
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = join(__dirname, "..", "registry.yaml");

export const loadRegistry = (path: string = DEFAULT_REGISTRY_PATH): Registry => {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);
  return Schema.decodeUnknownSync(Registry)(parsed);
};

// ─────────────────────────────────────────────────────────────────────────────
// Freeside federation manifest (FR-2, SDD §3.5)
//
// The compact discovery index of freeside-* buildings with their belts +
// capabilities. `produces` omits the JSON-schema path and `consumes` omits
// tag/why — the manifest is an index; `freeside-cli inspect` is the detail
// view that surfaces the full beacon.
// ─────────────────────────────────────────────────────────────────────────────

export interface FreesideModuleEntry {
  slug: string;
  one_liner: string;
  is_not: ReadonlyArray<string>;
  produces: ReadonlyArray<{ belt: string; description: string }>;
  consumes: ReadonlyArray<{ from: string; belt: string }>;
  capabilities: { tools: ReadonlyArray<string> };
  visibility: VisibilityLevel;
}

export interface FreesideManifest {
  version: number; // 2 — shape changed from the skeleton's version: 1
  generated_at: string; // ISO-8601
  scope: "internal"; // names the NFR-3 scope on the wire
  modules: ReadonlyArray<FreesideModuleEntry>;
}

/**
 * Aggregate the freeside federation manifest from a registry + an injected
 * beacon loader.
 *
 * Resilience contract (SDD §6.1): a module whose beacon fails to decode, or
 * a V2-legacy beacon, is SKIPPED with a `console.warn` — never coerced into
 * a partial entry, never crashes the build. A builder-level failure
 * (registry unparseable) surfaces upstream from `loadRegistry`, not here.
 *
 * `beaconLoader` is injected (not imported) so the gateway, the CLI, and the
 * tests can each supply their own resolution strategy.
 */
export const buildFreesideManifest = (
  registry: Registry,
  beaconLoader: BeaconLoader,
  visibilityFilter: ReadonlyArray<VisibilityLevel> = [
    "public",
    "unlisted",
    "internal",
  ],
): FreesideManifest => {
  const modules: FreesideModuleEntry[] = [];
  for (const [slug, entry] of Object.entries(registry.modules)) {
    if (!visibilityFilter.includes(entry.visibility)) continue;

    let result: BeaconLoadResult;
    try {
      result = beaconLoader(entry);
    } catch (err) {
      console.warn(
        `[freeside-registry] ${slug}: beacon loader threw — skipped (${String(err)})`,
      );
      continue;
    }

    if (result.kind === "error") {
      console.warn(
        `[freeside-registry] ${slug}: beacon unavailable — skipped (${result.error})`,
      );
      continue;
    }
    if (result.kind === "legacy") {
      console.warn(
        `[freeside-registry] ${slug}: BeaconV2 (legacy) detected — skipped from the V3 manifest`,
      );
      continue;
    }

    const b = result.beacon;
    modules.push({
      slug,
      one_liner: b.is.one_liner,
      is_not: b.is_not,
      produces: b.produces.map((p) => ({
        belt: p.belt,
        description: p.description,
      })),
      consumes: b.consumes.map((c) => ({ from: c.from, belt: c.belt })),
      capabilities: { tools: b.mcp.tools },
      visibility: entry.visibility,
    });
  }

  return {
    version: 2,
    generated_at: new Date().toISOString(),
    scope: "internal",
    modules,
  };
};
