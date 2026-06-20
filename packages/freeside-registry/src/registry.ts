/**
 * @freeside/freeside-registry · L1 registry loader + manifest aggregator
 *
 * Reads packages/freeside-registry/registry.yaml and produces the compact
 * federation manifest shape per ADR-007 §D-5.
 *
 * The full HTTP server (with D-8 auth/visibility model) is a follow-up
 * cycle deliverable. This skeleton ships the data shape + loader so the
 * CLI verbs in @freeside/freeside-cli can query the registry locally.
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
  // NullOr: in-repo LIBRARY buildings (e.g. events-api) have an in-repo beacon
  // (packages/events/beacon.yaml) and no served URL — beacon_url is `~` (null).
  // Mirrors deployment_url's nullability. Before this, a null beacon_url threw a
  // decode ParseError that broke `freeside-cli doctor` (the live-probe instrument).
  beacon_url: Schema.NullOr(Schema.String),
  visibility: VisibilityLevel,
  owner: Schema.String,
  added: Schema.String, // ISO-8601 date
  // ── OD-1 (sprint-400 T3): fixture-first beacon resolution + operational metadata ──
  // beacon_fixture re-adds the field the shipped dist/beacon-loader.js already
  // reads (entry.beacon_fixture) but the src schema had dropped. The other three
  // are carried by registry.yaml today and were silently stripped on decode.
  beacon_fixture: Schema.optional(Schema.String).annotations({
    description:
      "OD-1: in-repo fixture path (registry-root-relative) resolved by beacon-loader; preferred over remote beacon_url (which 404s for un-deployed cells)",
  }),
  deployment_url: Schema.optional(Schema.NullOr(Schema.String)).annotations({
    description: "Live Railway URL when deployed; null (~) when not-built",
  }),
  runtime_state: Schema.optional(
    Schema.Literal("deployed", "not-built", "scaffolded"),
  ).annotations({
    description:
      "Honest runtime maturity: deployed (HTTP live) | not-built (npm lib only) | scaffolded",
  }),
  notes: Schema.optional(Schema.String),
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
