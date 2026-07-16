/**
 * @freeside/collection-report-gates · manifest shape (schema_version 1)
 *
 * Sealed Effect Schema for the collection-report release-gate manifest
 * (CR-019, sprint.md §6). The manifest is the canonical, exhaustive,
 * machine-readable release input; the sprint plan's tier tables and
 * checkpoint diagrams are labeled human summaries validated against it.
 *
 * Shape-level guarantees (semantic rules live in validate.ts):
 *   - every task/gate reference is one explicit canonical ID (no ranges)
 *   - every evidence item carries a validity policy — a missing validity
 *     policy is schema-invalid
 *   - static validity is exactly `valid_until: superseded`; dynamic
 *     validity requires a renewal owner
 *   - gate state is one of pending | pass | no_go | blocked | expired
 */

import { Schema, Effect, type ParseResult } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { TASK_ID_PATTERN, GATE_ID_PATTERN, ROLE_PATTERN } from "./ids.js";

// ─────────────────────────────────────────────────────────────────────────────
// Scalars
// ─────────────────────────────────────────────────────────────────────────────

export const TaskId = Schema.String.pipe(
  Schema.pattern(TASK_ID_PATTERN, {
    message: () =>
      "task references must be one explicit canonical ID (CR-NNN, CR-NNNX, or ACCEPT-<REPO>); ranges and implicit suffixed IDs are forbidden",
  }),
).annotations({ identifier: "TaskId" });

export const GateId = Schema.String.pipe(
  Schema.pattern(GATE_ID_PATTERN, {
    message: () => "gate IDs must match the ratified gate grammar (e.g. G-1, G0, G1B-3, G2A, G3-PUBLIC)",
  }),
).annotations({ identifier: "GateId" });

export const Role = Schema.String.pipe(
  Schema.pattern(ROLE_PATTERN, {
    message: () => "owner roles are kebab-case role names (e.g. ordering-maintainer), never person names",
  }),
).annotations({ identifier: "Role" });

/** ISO-8601 UTC timestamp, kept as a validated string for determinism. */
const ISO_TIMESTAMP_PATTERN =
  /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

const isRealUtcTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const date = new Date(instant);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
};

export const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(ISO_TIMESTAMP_PATTERN, {
    message: () => "timestamps must be ISO-8601 UTC (e.g. 2026-07-16T00:00:00Z)",
  }),
  Schema.filter(
    (value) => isRealUtcTimestamp(value) || "timestamps must identify a real UTC instant",
  ),
).annotations({ identifier: "IsoTimestamp" });

export const GateState = Schema.Literal(
  "pending",
  "pass",
  "no_go",
  "blocked",
  "expired",
).annotations({ identifier: "GateState" });
export type GateStateT = typeof GateState.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Evidence validity — CR-019: "A missing validity policy is invalid."
// ─────────────────────────────────────────────────────────────────────────────

/** Static contract/schema fixtures: valid until superseded by a newer contract version. */
const ValiditySuperseded = Schema.Struct({
  valid_until: Schema.Literal("superseded"),
}).annotations({ identifier: "ValiditySuperseded" });

/**
 * Dynamic evidence (security, privacy, external-policy, load, operational):
 * a ratified maximum age plus renewal owner. Before evidence is recorded,
 * `valid_until` is absent. Recording the evidence must add an absolute expiry
 * no later than recorded_at + max_age_days.
 */
const ValidityExpiring = Schema.Struct({
  max_age_days: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  renewal_owner: Role,
  valid_until: Schema.optionalWith(IsoTimestamp, { exact: true }),
}).annotations({ identifier: "ValidityExpiring" });

export const Validity = Schema.Union(ValiditySuperseded, ValidityExpiring).annotations({
  identifier: "Validity",
});
export type ValidityT = typeof Validity.Type;

export const STATIC_EVIDENCE_KINDS = ["contract_fixture", "schema_fixture"] as const;
export const DYNAMIC_EVIDENCE_KINDS = [
  "security",
  "privacy",
  "external_policy",
  "load",
  "operational",
] as const;

export const EvidenceKind = Schema.Literal(
  ...STATIC_EVIDENCE_KINDS,
  ...DYNAMIC_EVIDENCE_KINDS,
).annotations({ identifier: "EvidenceKind" });
export type EvidenceKindT = typeof EvidenceKind.Type;

export const Evidence = Schema.Struct({
  id: Schema.String.pipe(
    Schema.pattern(/^EV-[A-Za-z0-9][A-Za-z0-9-]*$/, {
      message: () => "evidence IDs must be EV-<kebab-or-alnum> (stable, referenceable fixture/evidence IDs)",
    }),
  ),
  description: Schema.String,
  kind: EvidenceKind,
  /** The canonical tasks whose verification produces this evidence. */
  produced_by: Schema.Array(TaskId).pipe(Schema.minItems(1)),
  validity: Validity,
  /** Set only when the evidence has actually been produced and accepted. */
  recorded_at: Schema.optional(IsoTimestamp),
}).annotations({ identifier: "Evidence" });
export type EvidenceT = typeof Evidence.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Tasks — the canonical CR inventory (explicit IDs only)
// ─────────────────────────────────────────────────────────────────────────────

export const Task = Schema.Struct({
  id: TaskId,
  title: Schema.String,
  kind: Schema.Literal("cr", "acceptance"),
  repository: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, {
      message: () => "repository must be org/name",
    }),
  ),
  primary_owner: Role,
  participant_owners: Schema.optionalWith(Schema.Array(Role), {
    default: () => [],
  }),
  depends_on: Schema.optionalWith(Schema.Array(TaskId), { default: () => [] }),
}).annotations({ identifier: "Task" });
export type TaskT = typeof Task.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────────────

export const NoGoConsequence = Schema.Struct({
  /** Tiers that become impossible when this gate is no_go. */
  closes_tiers: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  /** Tiers that MUST remain reachable when this gate is no_go. */
  preserves_tiers: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
}).annotations({ identifier: "NoGoConsequence" });

export const Gate = Schema.Struct({
  id: GateId,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  /** The single role that approves this gate. */
  owner: Role,
  participant_owners: Schema.optionalWith(Schema.Array(Role), {
    default: () => [],
  }),
  /** Canonical task evidence (sprint.md §4 gate-evidence table) — explicit IDs. */
  requires_tasks: Schema.Array(TaskId),
  evidence: Schema.Array(Evidence).pipe(Schema.minItems(1)),
  depends_on_gates: Schema.optionalWith(Schema.Array(GateId), {
    default: () => [],
  }),
  state: GateState,
  /** Human label for what this gate blocks (sprint.md §4). Informational. */
  blocks: Schema.optional(Schema.String),
  /** Present only on gates with go/no-go semantics (G-1). */
  on_no_go: Schema.optional(NoGoConsequence),
}).annotations({ identifier: "Gate" });
export type GateT = typeof Gate.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Tiers — exhaustive transitive closure + labeled human summary
// ─────────────────────────────────────────────────────────────────────────────

export const TierSummary = Schema.Struct({
  /** Where the human summary row lives (e.g. "sprint.md §4 tier table"). */
  source: Schema.String,
  gates: Schema.Array(GateId),
  tasks: Schema.Array(TaskId),
}).annotations({ identifier: "TierSummary" });

export const Tier = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^T\d+$/)),
  title: Schema.String,
  requires_gates: Schema.Array(GateId).pipe(Schema.minItems(1)),
  /**
   * Direct tier requirements from the ratified release row. The validator
   * combines these cumulatively with gate evidence and expands dependencies.
   */
  entry_tasks: Schema.Array(TaskId).pipe(Schema.minItems(1)),
  /**
   * The exhaustive transitive closure of tasks required to release this
   * tier (cumulative over lower tiers). validate.ts recomputes and rejects
   * drift — this list can never silently under-claim.
   */
  tasks: Schema.Array(TaskId).pipe(Schema.minItems(1)),
  /** ACCEPT-* boundary-acceptance tasks covering every repo in the closure. */
  acceptance: Schema.Array(TaskId),
  /** The labeled human summary row this tier mirrors (summaries only). */
  summary: TierSummary,
}).annotations({ identifier: "Tier" });
export type TierT = typeof Tier.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoints — scheduling summaries validated against the DAG
// ─────────────────────────────────────────────────────────────────────────────

export const Checkpoint = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^C\d+$/)),
  title: Schema.String,
  source: Schema.String,
  /**
   * Serial spine as ordered stages; each stage lists explicit task IDs.
   * Every task in stage n+1 must transitively depend on at least one task
   * in stage n, and no earlier-stage task may depend on a later-stage task.
   */
  serial_spine: Schema.Array(Schema.Array(TaskId).pipe(Schema.minItems(1))).pipe(
    Schema.minItems(1),
  ),
  unlocks: Schema.optionalWith(Schema.Array(TaskId), { default: () => [] }),
}).annotations({ identifier: "Checkpoint" });
export type CheckpointT = typeof Checkpoint.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────

export const FeatureFlag = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9_]*$/)),
  description: Schema.String,
  /** Every listed gate must be `pass` before the flag may be enabled. */
  controlled_by_gates: Schema.Array(GateId).pipe(Schema.minItems(1)),
  /** The release tier this flag ships (informational cross-reference). */
  tier: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
}).annotations({ identifier: "FeatureFlag" });
export type FeatureFlagT = typeof FeatureFlag.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Manifest root
// ─────────────────────────────────────────────────────────────────────────────

export const SourceProvenance = Schema.Struct({
  /** Coordinator task-manifest this inventory was generated from. */
  task_manifest_path: Schema.String,
  task_manifest_digest: Schema.String.pipe(
    Schema.pattern(/^sha256:[a-f0-9]{64}$/, {
      message: () => "task_manifest_digest must be sha256:<64 hex>",
    }),
  ),
  simstim: Schema.optional(Schema.String),
  sprint_plan_path: Schema.String,
  sprint_plan_version: Schema.String,
}).annotations({ identifier: "SourceProvenance" });

export const ManifestApproval = Schema.Struct({
  owner: Role,
  manifest_digest: Schema.String.pipe(
    Schema.pattern(/^sha256:[a-f0-9]{64}$/),
  ),
  key_id: Schema.String.pipe(
    Schema.pattern(/^ed25519:[a-f0-9]{64}$/),
  ),
  signature: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9_-]{86}$/),
  ),
  signed_at: IsoTimestamp,
}).annotations({ identifier: "ManifestApproval" });
export type ManifestApprovalT = typeof ManifestApproval.Type;

export const ApprovalAuthority = Schema.Struct({
  owner: Role,
  key_id: Schema.String.pipe(
    Schema.pattern(/^ed25519:[a-f0-9]{64}$/),
  ),
  public_key: Schema.String.pipe(
    Schema.pattern(/^[A-Za-z0-9_-]{43}$/),
  ),
}).annotations({ identifier: "ApprovalAuthority" });
export type ApprovalAuthorityT = typeof ApprovalAuthority.Type;

export const ApprovalKeyring = Schema.Struct({
  schema_version: Schema.Literal(1),
  authorities: Schema.Array(ApprovalAuthority).pipe(
    Schema.minItems(1),
    Schema.filter(
      (authorities) =>
        new Set(authorities.map((authority) => authority.owner)).size ===
          authorities.length ||
        "approval keyring owners must be unique",
    ),
    Schema.filter(
      (authorities) =>
        new Set(authorities.map((authority) => authority.key_id)).size ===
          authorities.length ||
        "approval keyring key IDs must be unique",
    ),
  ),
}).annotations({ identifier: "ApprovalKeyring" });
export type ApprovalKeyringT = typeof ApprovalKeyring.Type;

export const GateManifest = Schema.Struct({
  schema_version: Schema.Literal(1),
  manifest_id: Schema.String,
  manifest_version: Schema.String.pipe(
    Schema.pattern(/^\d+\.\d+\.\d+$/, {
      message: () => "manifest_version must be semver",
    }),
  ),
  cycle: Schema.String,
  /**
   * Honest approval state of this document itself. CR-019: "the manifest
   * becomes the mechanical gate input after owner approval."
   */
  status: Schema.Literal("pending_owner_approval", "owner_approved"),
  /** Deterministic evaluation instant — expiry is judged against this, never wall clock. */
  evaluated_at: IsoTimestamp,
  source: SourceProvenance,
  approvals: Schema.Array(ManifestApproval),
  tasks: Schema.Array(Task).pipe(Schema.minItems(1)),
  gates: Schema.Array(Gate).pipe(Schema.minItems(1)),
  tiers: Schema.Array(Tier).pipe(Schema.minItems(1)),
  checkpoints: Schema.optionalWith(Schema.Array(Checkpoint), {
    default: () => [],
  }),
  flags: Schema.Array(FeatureFlag),
}).annotations({ identifier: "GateManifest" });
export type GateManifestT = typeof GateManifest.Type;

// ─────────────────────────────────────────────────────────────────────────────
// Decode helpers (beacon-schema convention)
// ─────────────────────────────────────────────────────────────────────────────

const strictDecodeOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export const decodeGateManifest = (
  input: unknown,
): Effect.Effect<GateManifestT, ParseResult.ParseError> =>
  Schema.decodeUnknown(GateManifest, strictDecodeOptions)(input);

export const decodeGateManifestSync = (input: unknown): GateManifestT =>
  Schema.decodeUnknownSync(GateManifest, strictDecodeOptions)(input);

export const decodeGateManifestEither = Schema.decodeUnknownEither(
  GateManifest,
  strictDecodeOptions,
);

export const decodeApprovalKeyringSync = (
  input: unknown,
): ApprovalKeyringT =>
  Schema.decodeUnknownSync(ApprovalKeyring, strictDecodeOptions)(input);
