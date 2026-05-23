/**
 * @freeside/beacon-schema · V3 — the building-identity beacon
 *
 * A V3 beacon declares what a BUILDING is (ADR-008 §D-11), not how to reach
 * an MCP tenant. Identity + boundaries + composition lead; transport is
 * OPTIONAL. This is the "identity-first" shape (operator-ratified 2026-05-23):
 *
 *   IDENTITY (top-level)
 *   - slug            (the building's canonical `*-api` identity)
 *   - publisher       (org/author)
 *   - is              (definitive scope statement)
 *   - is_not          (anti-scope; min 2 entries; discipline-forcing)
 *   - composes_with   (sibling references with Honeycomb Tag@version+hash)
 *   - acvp_invariants (verifiability discipline per ACVP doctrine)
 *   - sealed_schemas  (hash-verified schema references)
 *   - capabilities    (high-level method/capability names)
 *   - cycle_state     (honest maturity signal)
 *
 *   TRANSPORT (optional — present once the building deploys a callable surface)
 *   - mcp             (the BeaconV2 McpBlock — "MCP counts as api", §D-11.1)
 *   - cli             (a building MAY ship a CLI)
 *
 * V3 is NOT a structural superset of V2: V2 (schema_version "2") is the
 * MCP-tenant self-declaration consumed by the gateway; V3 (schema_version
 * "3") is the building-identity beacon consumed by the registry/doctor. They
 * are distinct contracts that share the McpBlock for the transport sub-shape.
 *
 * VALIDATION PATH (honest status, 2026-05-23): V3 has NO build-pipeline
 * validator yet — `bin/build-beacon-json.ts` validates V2 only. The V3
 * building beacon is exercised by these unit tests and, once it lands, by
 * `freeside-cli doctor` (T2a). Until T2a, V3 beacons are authored-but-not-
 * pipeline-enforced; `doctor` is the intended enforcement point (it must also
 * recompute composes_with tag hashes + reconcile registry `rename: done`
 * against actual repo existence — see registry.yaml + tests/fixtures notes).
 */

import { Schema, Effect, Cause } from "effect";
import { McpBlock, CliBlock } from "./beacon-v2.js";

// ─────────────────────────────────────────────────────────────────────────────
// `is` — definitive scope statement
// ─────────────────────────────────────────────────────────────────────────────

const IsField = Schema.Struct({
  one_liner: Schema.String.pipe(
    Schema.maxLength(120, {
      message: () => "is.one_liner must be ≤120 chars (single sentence)",
    }),
  ).annotations({
    description: "Single-sentence building identity statement (≤120 chars)",
  }),
  scope: Schema.Array(
    Schema.String.pipe(Schema.maxLength(100)),
  ).pipe(
    Schema.minItems(2, {
      message: () => "is.scope requires ≥2 entries (forces module to articulate boundaries)",
    }),
    Schema.maxItems(7, {
      message: () => "is.scope capped at 7 entries (forces module to pick the load-bearing ones)",
    }),
  ).annotations({
    description: "Scope bullets — what the building DOES (2-7 entries, each ≤100 chars)",
  }),
}).annotations({
  identifier: "Is",
  description: "Definitive scope (per ADR-007 §D-4 + Appendix A.1)",
});

// ─────────────────────────────────────────────────────────────────────────────
// `is_not` — anti-scope (the discipline-forcing field)
// ─────────────────────────────────────────────────────────────────────────────

const IsNotEntry = Schema.String.pipe(
  Schema.filter(
    (s) => /^(Does NOT|Will NOT|Refuses to) /.test(s),
    {
      message: () =>
        'is_not entries MUST start with "Does NOT", "Will NOT", or "Refuses to" — articulates explicit anti-scope',
    },
  ),
).annotations({
  description: 'Anti-scope statement (e.g., "Does NOT manage credentials")',
});

const IsNotField = Schema.Array(IsNotEntry).pipe(
  Schema.minItems(2, {
    message: () =>
      "is_not requires ≥2 entries (forces module to articulate ≥2 boundaries it refuses)",
  }),
).annotations({
  identifier: "IsNot",
  description: "Anti-scope (per ADR-007 §D-4 + Appendix A.1)",
});

// ─────────────────────────────────────────────────────────────────────────────
// `composes_with` — sibling references with fully-qualified Tag ABI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fully-qualified Tag reference per ADR-007 Appendix A.2.
 * Format: <TagName>@<semver>+<sha256-prefix>
 * Eliminates name-equality false-positives flagged by flatline SKP-004.
 *
 * Examples:
 *   "SonarPort@2.1.0+a3f2c891d4"
 *   "StoragePort@1.0.0+b8e4f7d2c1"
 */
const TagReference = Schema.String.pipe(
  Schema.pattern(
    /^[A-Z][A-Za-z0-9]*@\d+\.\d+\.\d+\+[a-f0-9]{8,16}$/,
    {
      message: () =>
        "composes_with.<sibling>.tag must be fully qualified: TagName@semver+hash (e.g., SonarPort@2.1.0+a3f2c891d4)",
    },
  ),
).annotations({
  description: "Honeycomb Tag reference with version + schema_hash (Appendix A.2)",
});

const ComposesWithEntry = Schema.Struct({
  role: Schema.String.pipe(Schema.maxLength(200)).annotations({
    description: "What role this sibling plays in the composition (≤200 chars)",
  }),
  tag: TagReference,
  required: Schema.optionalWith(Schema.Boolean, { default: () => true }),
});

const ComposesWith = Schema.Record({
  key: Schema.String.pipe(
    Schema.pattern(/^[a-z][a-z0-9-]*$/, {
      message: () =>
        "composes_with keys must be lowercase-kebab building slugs (e.g., sonar-api)",
    }),
  ),
  value: ComposesWithEntry,
}).annotations({
  identifier: "ComposesWith",
  description: "Sibling building composition declarations (per ADR-007 §D-4)",
});

// ─────────────────────────────────────────────────────────────────────────────
// `acvp_invariants` — verifiability discipline (per ACVP doctrine)
// ─────────────────────────────────────────────────────────────────────────────

const AcvpInvariantId = Schema.Literal(
  "hash_chain",
  "event_completeness",
  "schema_enforcement",
  "state_machine_totality",
  "idempotency",
  "monotonicity",
  "audit_replay",
).annotations({
  description: "Known ACVP invariant IDs per agentic-cryptographically-verifiable-protocol doctrine",
});

const AcvpInvariant = Schema.Struct({
  id: AcvpInvariantId,
  scope: Schema.String.pipe(Schema.maxLength(200)).annotations({
    description: "What part of the building this invariant binds",
  }),
  proof_artifact: Schema.String.pipe(Schema.maxLength(500)).annotations({
    description:
      "Relative path (from module root) to test/proof binding the invariant",
  }),
  private: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
    description: "If true, invariant omitted from public federation manifest (per D-8)",
  }),
});

const AcvpInvariants = Schema.Array(AcvpInvariant).annotations({
  identifier: "AcvpInvariants",
  description: "ACVP invariant declarations (per ADR-007 §D-4 + Appendix A.1)",
});

// ─────────────────────────────────────────────────────────────────────────────
// `sealed_schemas` — hash-verified schema references
// ─────────────────────────────────────────────────────────────────────────────

const SealedSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.maxLength(500)).annotations({
    description: "Relative path to schema file in module's packages/protocol/",
  }),
  hash: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]{64}$/, {
      message: () =>
        "sealed_schemas.hash must be sha256 of canonical-JSON of the schema (64 hex chars)",
    }),
  ).annotations({
    description: "sha256 of canonical-JSON of the schema (recomputed by validator)",
  }),
  consumers: Schema.Array(Schema.String.pipe(Schema.maxLength(100))).annotations({
    description: "Buildings/clients that depend on this schema's stability",
  }),
});

const SealedSchemas = Schema.Array(SealedSchema).annotations({
  identifier: "SealedSchemas",
  description: "Sealed schema references (per ADR-007 §D-4 + Appendix A.1)",
});

// ─────────────────────────────────────────────────────────────────────────────
// `cycle_state` — honest maturity signal
// ─────────────────────────────────────────────────────────────────────────────

const CycleStateStatus = Schema.Literal(
  "candidate",
  "active",
  "mature",
  "sunset",
  "legacy",
).annotations({
  description:
    "Maturity signal: candidate (new) → active (production) → mature (stable) → sunset (deprecating) | legacy (V2 broadcast during V3 migration window)",
});

const IsoDate = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/, {
    message: () => "ISO-8601 date required (YYYY-MM-DD)",
  }),
);

const CycleState = Schema.Struct({
  status: CycleStateStatus,
  since: IsoDate.annotations({
    description: "Date this status entered current value",
  }),
  next_review: IsoDate.annotations({
    description:
      "Date status MUST be re-confirmed (max +180 days from `since` — enforced by doctor)",
  }),
}).annotations({
  identifier: "CycleState",
  description: "Cycle state declaration (per ADR-007 §D-4 + Appendix A.1)",
});

// ─────────────────────────────────────────────────────────────────────────────
// Building identity (top-level) — `slug`, `publisher`, `capabilities`
// ─────────────────────────────────────────────────────────────────────────────

const Slug = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*-api$/, {
    message: () =>
      "slug must be a lowercase-kebab `*-api` identity ending in `-api` (e.g., sonar-api) — ADR-008 §D-11",
  }),
).annotations({
  description: "Building's canonical `*-api` slug — MUST end in `-api` (ADR-008 §D-11)",
});

const Capabilities = Schema.Array(
  Schema.String.pipe(Schema.maxLength(100)),
)
  .pipe(Schema.maxItems(100))
  .annotations({
    description: "High-level capability / method names the building exposes",
  });

// ─────────────────────────────────────────────────────────────────────────────
// BeaconV3 — building identity + boundaries + composition, optional transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BeaconV3Schema — the canonical building-identity beacon (ADR-008 §D-11).
 *
 * Required: identity (slug, publisher, is, is_not, cycle_state). Optional with
 * sensible defaults: composes_with, acvp_invariants, sealed_schemas,
 * capabilities. Optional transport: mcp (the BeaconV2 McpBlock), cli.
 *
 * `mcp` being optional is load-bearing: a building is declarable from the
 * moment it has an identity, before it deploys a callable endpoint. When it
 * does deploy MCP, it adds the block — "MCP counts as api" (§D-11.1).
 *
 * V3 intentionally DROPS V2-only keys (`payment`, `docs`): those are
 * MCP-tenant / marketplace concerns, not building identity. A V2 beacon
 * copied to V3 will silently lose them on decode — migrate deliberately.
 */
export const BeaconV3Schema = Schema.Struct({
  schema_version: Schema.Literal("3").annotations({
    description:
      "Beacon schema version — '3' is the building-identity beacon (ADR-008 §D-11)",
  }),
  slug: Slug,
  publisher: Schema.String.pipe(Schema.maxLength(80)).annotations({
    description: "Org/author publishing this building",
  }),
  is: IsField,
  is_not: IsNotField,
  composes_with: Schema.optionalWith(ComposesWith, { default: () => ({}) }),
  acvp_invariants: Schema.optionalWith(AcvpInvariants, { default: () => [] }),
  sealed_schemas: Schema.optionalWith(SealedSchemas, { default: () => [] }),
  capabilities: Schema.optionalWith(Capabilities, { default: () => [] }),
  cycle_state: CycleState,
  // ── transport (optional) ──────────────────────────────────────────────
  mcp: Schema.optional(McpBlock).annotations({
    description:
      "Optional MCP transport — present once the building deploys a callable endpoint (§D-11.1)",
  }),
  cli: CliBlock,
}).annotations({
  identifier: "BeaconV3",
  description:
    "BeaconV3 — building-identity beacon: identity + boundaries + composition, optional transport (ADR-008 §D-11)",
});

export type BeaconV3 = Schema.Schema.Type<typeof BeaconV3Schema>;

export const decodeBeaconV3 = Schema.decode(BeaconV3Schema);
export const encodeBeaconV3 = Schema.encode(BeaconV3Schema);

/**
 * Validate an UNKNOWN value (e.g., fetched beacon JSON) against BeaconV3.
 * Returns a plain result object so consumers (freeside-cli) get validation
 * without taking their own `effect` dependency. Mirrors the
 * `Effect.runSyncExit(Schema.decodeUnknown(...))` pattern used in the tests.
 */
export interface BeaconV3ValidationResult {
  readonly ok: boolean;
  readonly beacon?: BeaconV3;
  readonly error?: string;
}

export const validateBeaconV3 = (raw: unknown): BeaconV3ValidationResult => {
  const exit = Effect.runSyncExit(Schema.decodeUnknown(BeaconV3Schema)(raw));
  if (exit._tag === "Success") return { ok: true, beacon: exit.value };
  return { ok: false, error: Cause.pretty(exit.cause) };
};
