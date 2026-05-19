/**
 * @freeside/beacon-schema · V3 — boundary-declaration discipline
 *
 * Extends BeaconV2 with the four boundary fields documented in
 * decisions/007-loa-freeside-absorption.md §D-4 and Appendix A:
 *
 *   - is              (definitive scope statement)
 *   - is_not          (anti-scope; min 2 entries; discipline-forcing)
 *   - composes_with   (sibling module references with Honeycomb Tag@version+hash)
 *   - acvp_invariants (verifiability discipline per ACVP doctrine)
 *
 * Plus:
 *   - sealed_schemas  (hash-verified schema references)
 *   - cycle_state     (honest maturity signal)
 *
 * V2 → V3 migration window: V3 validator accepts V2 broadcasts as
 * cycle_state.status: legacy during the migration window. Once migrated
 * to V3, downgrade is forbidden (status field is one-way).
 */

import { Schema } from "effect";
import { BeaconV2Schema } from "./beacon-v2.js";

// ─────────────────────────────────────────────────────────────────────────────
// `is` — definitive scope statement
// ─────────────────────────────────────────────────────────────────────────────

const IsField = Schema.Struct({
  one_liner: Schema.String.pipe(
    Schema.maxLength(120, {
      message: () => "is.one_liner must be ≤120 chars (single sentence)",
    }),
  ).annotations({
    description: "Single-sentence module identity statement (≤120 chars)",
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
    description: "Scope bullets — what the module DOES (2-7 entries, each ≤100 chars)",
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
        "composes_with keys must be lowercase-kebab module slugs (e.g., freeside-sonar)",
    }),
  ),
  value: ComposesWithEntry,
}).annotations({
  identifier: "ComposesWith",
  description: "Sibling module composition declarations (per ADR-007 §D-4)",
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
    description: "What part of the module this invariant binds",
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
    description: "Modules/clients that depend on this schema's stability",
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
// BeaconV3 — V2 ∪ {is, is_not, composes_with, acvp_invariants, sealed_schemas, cycle_state}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BeaconV3 — extends BeaconV2 with the six boundary-declaration fields.
 *
 * Effect.Schema composition: structurally extends BeaconV2 by intersecting
 * its struct with a V3-specific struct carrying the new required fields.
 *
 * For YAML broadcasts that explicitly declare `schema_version: "3"`, this
 * is the canonical validator. V2 broadcasts (no V3 fields) MUST be tagged
 * by the registry as `cycle_state.status: legacy` for the migration window.
 */
export const BeaconV3Schema = Schema.extend(
  BeaconV2Schema,
  Schema.Struct({
    is: IsField,
    is_not: IsNotField,
    composes_with: Schema.optionalWith(ComposesWith, { default: () => ({}) }),
    acvp_invariants: Schema.optionalWith(AcvpInvariants, { default: () => [] }),
    sealed_schemas: Schema.optionalWith(SealedSchemas, { default: () => [] }),
    cycle_state: CycleState,
  }),
).annotations({
  identifier: "BeaconV3",
  description:
    "BeaconV3 — V2 base + 6 boundary-declaration fields (ADR-007 §D-4, Appendix A.1)",
});

export type BeaconV3 = Schema.Schema.Type<typeof BeaconV3Schema>;

export const decodeBeaconV3 = Schema.decode(BeaconV3Schema);
export const encodeBeaconV3 = Schema.encode(BeaconV3Schema);
