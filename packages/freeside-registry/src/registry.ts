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

// ─────────────────────────────────────────────────────────────────────────────
// ADR-012 Phase 0 · cadence-ledger cycle
// The declared health contract + liveness expectation record.
// Reference: decisions/012-unify-cluster-liveness.md §Decision-1, sdd.md §4.
// ─────────────────────────────────────────────────────────────────────────────

const AuthClass = Schema.Literal("none", "static-key");

/** ISO-8601 date, e.g. "2026-07-05" */
const IsoDate = Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/));

/** duration/cadence literal: "15m", "6h", "1d" */
const Duration = Schema.String.pipe(Schema.pattern(/^[1-9][0-9]*(m|h|d)$/));

/** kebab-case slug — the stable half of the <cell>/<ref> expectation identity */
const RefSlug = Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9-]{0,63}$/));

// The declared health contract — field-for-field what loa-cli/lib/probe.mjs
// already reads (ADR-012 §Decision-1), plus NFR-5 provenance (inert to probe.mjs).
// deployment_url is required IN-BLOCK: probe.mjs short-circuits to 'scaffold'
// without it, which would silently un-probe a declared cell. It must equal the
// entry-level deployment_url (filter on ModuleEntry below).
const ServiceBlock = Schema.Struct({
  deployment_url: Schema.String,
  health_path: Schema.String.pipe(Schema.pattern(/^\//)),
  expected_status: Schema.Number.pipe(Schema.int(), Schema.between(100, 599)),
  auth_class: AuthClass,
  expected_body_marker: Schema.optional(Schema.String),
  // ── provenance (NFR-5): hand-typed values cite where/when they were probed ──
  probed_at: IsoDate,
  probe_source: Schema.Literal("adr-012-appendix", "live-probe"),
});

// ── expectations[] · discriminated union on probe_kind ──────────────────────
// gh-workflow is DELIBERATELY absent: premature use fails the union decode
// (prd.md FR-3) — the gate is the type system, not a bespoke check.

const ExpectationCommon = {
  ref: RefSlug,
  cadence: Duration,
  owner: Schema.String.pipe(Schema.minLength(1)),
};

const HttpExpectation = Schema.Struct({
  probe_kind: Schema.Literal("http"),
  ...ExpectationCommon,
  // absent target ⇒ consumers probe the cell's own `service` block (documented
  // consumer semantic; dispatch lands in loa-cli NEXT cycle)
  target: Schema.optional(Schema.Struct({ url: Schema.String })),
  expect: Schema.optional(
    Schema.Struct({
      status: Schema.optional(
        Schema.Number.pipe(Schema.int(), Schema.between(100, 599)),
      ),
      body_marker: Schema.optional(Schema.String),
    }),
  ),
});

// Generic lag-between-two-numeric-fields over a GraphQL row set (never
// sonar-hardcoded): lag = row[minuend] − row[subtrahend], keyed by row[key],
// healthy iff lag < thresholds[row[key]] for every declared key.
const GraphqlLagExpectation = Schema.Struct({
  probe_kind: Schema.Literal("graphql-lag"),
  ...ExpectationCommon,
  target: Schema.Struct({
    endpoint: Schema.String, // declared DATA — deployment ids rotate (blue-green)
    query: Schema.String,
    rows_path: Schema.String, // dot-path to the row array, e.g. "data.chain_metadata"
    key: Schema.String, // per-row identity field, e.g. "chain_id"
    minuend: Schema.String, // e.g. "block_height"
    subtrahend: Schema.String, // e.g. "latest_processed_block"
  }),
  expect: Schema.Struct({
    thresholds: Schema.Record({ key: Schema.String, value: Schema.Number }).pipe(
      Schema.filter(
        (t) =>
          Object.keys(t).length > 0 ||
          "graphql-lag expect.thresholds must declare at least one key",
      ),
    ),
  }),
});

// Absence-of-expected: freshest event older than max_age ⇒ stale (consumer
// semantic, next cycle). The staleness-against-declared-cadence primitive.
const EventMaxAgeExpectation = Schema.Struct({
  probe_kind: Schema.Literal("event-max-age"),
  ...ExpectationCommon,
  target: Schema.Struct({
    endpoint: Schema.String,
    query: Schema.String,
    timestamp_path: Schema.String, // dot-path to the freshest ISO timestamp
  }),
  expect: Schema.Struct({ max_age: Duration }),
});

const Expectation = Schema.Union(
  HttpExpectation,
  GraphqlLagExpectation,
  EventMaxAgeExpectation,
);

const Expectations = Schema.Array(Expectation).pipe(
  Schema.filter((xs) => {
    const refs = xs.map((x) => x.ref);
    return (
      new Set(refs).size === refs.length ||
      "expectations[].ref must be unique within a cell"
    );
  }),
);

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
  // ── ADR-012 Phase 0 (cadence-ledger): both blocks additive + optional —
  // absence is valid forever (derive-don't-type, G-4).
  service: Schema.optional(ServiceBlock).annotations({
    description:
      "ADR-012 §D-1 declared health contract, read by loa-cli/lib/probe.mjs. " +
      "Absent ⇒ lifecycle derives from absence (derive-don't-type).",
  }),
  expectations: Schema.optional(Expectations).annotations({
    description:
      "Cadence ledger: declared liveness expectations (staleness-against-declared-cadence). " +
      "Identity = <cell-slug>/<ref>. Consumers dispatch on probe_kind (loa-cli, next cycle).",
  }),
}).pipe(
  // Kills the two-fields-drift hazard the in-block deployment_url creates.
  // A service block REQUIRES a present-and-equal entry-level deployment_url:
  // a declared-probeable service on a null-URL entry would split-brain the
  // registry (entry says not-built, probe.mjs probes it live) — the exact
  // contradiction derive-from-absence (D-7) forbids. Blockless cells of any
  // URL state decode unchanged (review C-1 / DISS-001).
  Schema.filter(
    (e) =>
      !e.service ||
      (e.deployment_url != null &&
        e.service.deployment_url === e.deployment_url) ||
      "a service block requires the entry-level deployment_url to be present and equal",
  ),
  // A target-less http expectation means "probe this cell's own service block"
  // (HttpExpectation comment above) — so it REQUIRES that block to exist, or
  // the declaration is undischargeable by any consumer (Bridgebuilder CL-410-001).
  Schema.filter(
    (e) =>
      !e.expectations ||
      e.expectations.every(
        (x) => x.probe_kind !== "http" || x.target != null || e.service != null,
      ) ||
      "a target-less http expectation requires the cell to declare a service block",
  ),
);

const Registry = Schema.Struct({
  version: Schema.Number,
  modules: Schema.Record({ key: Schema.String, value: ModuleEntry }),
});

export type Registry = Schema.Schema.Type<typeof Registry>;
export type ModuleEntry = Schema.Schema.Type<typeof ModuleEntry>;
export type VisibilityLevel = Schema.Schema.Type<typeof VisibilityLevel>;
export type ServiceBlock = Schema.Schema.Type<typeof ServiceBlock>;
export type Expectation = Schema.Schema.Type<typeof Expectation>;
export type HttpExpectation = Schema.Schema.Type<typeof HttpExpectation>;
export type GraphqlLagExpectation = Schema.Schema.Type<typeof GraphqlLagExpectation>;
export type EventMaxAgeExpectation = Schema.Schema.Type<typeof EventMaxAgeExpectation>;

// Internal export for schema-level tests (fixture tests must assert against the
// SHARED production schema, never a test-local copy — fixture-tautology guard).
export const _schemas = { ModuleEntry, ServiceBlock, Expectation, Expectations } as const;

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
