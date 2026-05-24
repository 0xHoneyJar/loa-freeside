/**
 * @0xhoneyjar/freeside-registry · L1 registry loader + manifest aggregator
 *
 * Reads packages/freeside-registry/registry.yaml and produces the compact
 * federation manifest shape per ADR-007 §D-5.
 *
 * The full HTTP server (with D-8 auth/visibility model) is a follow-up
 * cycle deliverable. This skeleton ships the data shape + loader so the
 * CLI verbs in @0xhoneyjar/freeside-cli can query the registry locally.
 *
 * Reference: decisions/007-loa-freeside-absorption.md §D-5
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Schema } from "effect";

// ─────────────────────────────────────────────────────────────────────────────
// Registry schema (L1)
// ─────────────────────────────────────────────────────────────────────────────

const VisibilityLevel = Schema.Literal("public", "unlisted", "internal");

const ModuleEntry = Schema.Struct({
  git_url: Schema.String,
  beacon_url: Schema.String,
  visibility: VisibilityLevel,
  owner: Schema.String,
  added: Schema.String, // ISO-8601 date
  // GitHub repo-rename status for the `*-api` migration (ADR-008 §D-11.3).
  // Optional: the slug already carries the canonical `*-api` identity; this
  // records whether the underlying GitHub repo has caught up. `list`/`doctor`
  // surface it so operators can see which renames are still pending.
  rename: Schema.optional(Schema.Literal("done", "pending")),
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
// Compact federation manifest shape (per ADR-007 §D-5)
//
// The full beacon detail lives behind freeside.inspectModule(<slug>) MCP tool;
// this compact shape is what /federation.json returns.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompactModuleEntry {
  slug: string;
  one_liner: string;
  is_not: ReadonlyArray<string>;
  visibility: VisibilityLevel;
}

export interface FederationManifest {
  version: number;
  generated_at: string;
  modules: ReadonlyArray<CompactModuleEntry>;
}

/**
 * Build a compact federation manifest from a registry + beacon fetches.
 *
 * This signature is the contract for the HTTP server (follow-up cycle):
 *   server.ts will pass in (registry, beaconFetcher, visibilityFilter)
 *   and return the manifest with proper auth/redaction per D-8.
 *
 * STUB: current implementation returns the structure but expects beacon
 * data to be passed in (no actual fetching). The HTTP server cycle will
 * wire in beacon-resolver.ts from apps/mcp-gateway/.
 */
export const buildCompactManifest = (
  registry: Registry,
  beacons: ReadonlyMap<string, { one_liner: string; is_not: ReadonlyArray<string> }>,
  visibilityFilter: ReadonlyArray<VisibilityLevel> = ["public"],
): FederationManifest => {
  const compact: CompactModuleEntry[] = [];
  for (const [slug, entry] of Object.entries(registry.modules)) {
    if (!visibilityFilter.includes(entry.visibility)) continue;
    const beacon = beacons.get(slug);
    if (!beacon) continue; // module registered but beacon unavailable — skip
    compact.push({
      slug,
      one_liner: beacon.one_liner,
      is_not: beacon.is_not,
      visibility: entry.visibility,
    });
  }
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    modules: compact,
  };
};
