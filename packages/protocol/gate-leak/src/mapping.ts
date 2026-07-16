import {
  type CanonicalEncodingError,
  DIGEST_DOMAINS as COLLECTION_DIGEST_DOMAINS,
  type DigestComputationError,
  VersionedDigest,
  digestVersioned,
} from "@freeside/collection-protocol";
import { Data, Effect, type ParseResult, Schema } from "effect";
import {
  GATE_LEAK_CHURN_POLICY_V1,
} from "./capabilities.js";
import { GATE_LEAK_DIGEST_DOMAINS, GateRuleV1 } from "./gate-rule.js";
import {
  CommunityRef,
  DiscordSnowflake,
  GATE_CONFIG_RATIFY_PERMISSION,
  IsoTimestamp,
  NonNegativeInt,
  OperatorPermission,
  PRIVACY_APPROVE_GATE_AUDIT_PERMISSION,
  SchemaVersion,
  SubjectRef,
} from "./scalars.js";
import { RoleIdSet } from "./work-keys.js";

/**
 * `gate_mapping.v1` — the Shadow-Audit-owned versioned aggregate keyed by
 * community, guild, and logical collection. Each version is immutable and
 * carries ratifier identity, provenance, effective/revoked times, and a
 * configuration digest. Writes use optimistic concurrency and append audit
 * events. Inferred mappings are a SEPARATE hypothesis type: a ratified
 * version structurally cannot carry `inferred` provenance, so readiness can
 * never be satisfied by inference.
 *
 * Aggregate invariant: AT MOST ONE ACTIVE (non-revoked) version. History is
 * immutable and append-only; a new distinct ratification while a version is
 * active refuses with `ActiveMappingExistsError` and requires an explicit
 * revoke before relink. Idempotent replay of the recorded command is the one
 * permitted re-submission.
 */

const NonEmptyString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

const hasDomain = (value: VersionedDigest, domain: string): boolean =>
  value.algorithm === "sha-256" && value.major_version === 1 && value.domain === domain;

const CollectionIdDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, COLLECTION_DIGEST_DOMAINS.identity) ||
      "collection_id must use the collection.identity v1 digest domain",
  ),
);
const DeploymentSetDigestField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.deployment_set) ||
      "deployment_set_digest must use the gate-leak.deployment-set v1 digest domain",
  ),
);
const MappingVersionIdField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_version) ||
      "mapping_version_id must use the gate-leak.mapping-version v1 digest domain",
  ),
);
const MappingConfigDigestField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_config) ||
      "config_digest must use the gate-leak.mapping-config v1 digest domain",
  ),
);
const MappingCommandDigestField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_command) ||
      "command_digest must use the gate-leak.mapping-command v1 digest domain",
  ),
);
const IntegrationEvidenceDigestField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.integration_evidence) ||
      "integration evidence_digest must use the gate-leak.integration-evidence v1 digest domain",
  ),
);

/** Ratified provenance. `inferred` is deliberately unrepresentable here. */
export const RatifiedMappingProvenance = Schema.Literal(
  "operator_confirmed",
  "integration_evidence",
).annotations({ identifier: "RatifiedMappingProvenance" });
export type RatifiedMappingProvenance = Schema.Schema.Type<
  typeof RatifiedMappingProvenance
>;

/**
 * Before identity rows are revealable, a new mapping needs independent
 * integration evidence — in the gate-leak.integration-evidence v1 digest
 * domain, naming its producing authority and bound to the EXACT mapping
 * configuration digest it evidences — OR a distinct second privacy approver.
 * `pending` mappings may show only non-identifying setup state.
 */
const IntegrationEvidenceReveal = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("integration_evidence"),
  evidence_digest: IntegrationEvidenceDigestField,
  bound_config_digest: MappingConfigDigestField,
  authority: NonEmptyString,
  observed_at: IsoTimestamp,
});
const SecondApproverReveal = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("second_approver"),
  approver_subject: SubjectRef,
  approver_permission: Schema.Literal(PRIVACY_APPROVE_GATE_AUDIT_PERMISSION),
  approved_at: IsoTimestamp,
});
const PendingReveal = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("pending"),
});

export const IdentityRevealBasis = Schema.Union(
  IntegrationEvidenceReveal,
  SecondApproverReveal,
  PendingReveal,
).annotations({ identifier: "IdentityRevealBasis" });
export type IdentityRevealBasis = Schema.Schema.Type<typeof IdentityRevealBasis>;

/**
 * Exact ratify-command material persisted with a mapping version so the
 * command digest can be recomputed independently of the denormalized fields.
 * Binding this material's digest into `mapping_version_id` closes the graft
 * where a caller replaces `command_digest` alone and then "replays" a changed
 * command under the same immutable version identity.
 */
export const GateMappingCommandMaterial = Schema.Struct({
  schema_version: SchemaVersion,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: CollectionIdDigest,
  deployment_set_digest: DeploymentSetDigestField,
  role_ids: RoleIdSet,
  eligibility_rule: GateRuleV1,
  provenance: RatifiedMappingProvenance,
  identity_reveal_basis: IdentityRevealBasis,
  ratifier_subject: SubjectRef,
  ratifier_permissions: Schema.Array(OperatorPermission),
  expected_aggregate_version: NonNegativeInt,
  effective_at: IsoTimestamp,
  idempotency_key: NonEmptyString,
}).annotations({ identifier: "GateMappingCommandMaterial" });
export type GateMappingCommandMaterial = Schema.Schema.Type<
  typeof GateMappingCommandMaterial
>;

const GateMappingVersionFields = {
  schema_version: SchemaVersion,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: CollectionIdDigest,
  deployment_set_digest: DeploymentSetDigestField,
  role_ids: RoleIdSet,
  eligibility_rule: GateRuleV1,
  rule_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.gate_rule) ||
        "rule_digest must use the gate-leak.gate-rule v1 digest domain",
    ),
  ),
  provenance: RatifiedMappingProvenance,
  ratifier_subject: SubjectRef,
  ratifier_permission: Schema.Literal(GATE_CONFIG_RATIFY_PERMISSION),
  identity_reveal_basis: IdentityRevealBasis,
  effective_at: IsoTimestamp,
  revoked_at: Schema.optionalWith(IsoTimestamp, { exact: true }),
  idempotency_key: NonEmptyString,
  config_digest: MappingConfigDigestField,
  /**
   * Versioned digest of the exact ratify command that created this version.
   * Idempotent replay requires the incoming command to recompute to this
   * digest; a reused key with any different field is an idempotency conflict.
   * Cryptographically bound into `mapping_version_id` and recomputed from
   * `command_material` on every strict decode.
   */
  command_digest: MappingCommandDigestField,
  /** Stored command fields required to recompute `command_digest`. */
  command_material: GateMappingCommandMaterial,
};

export const GateMappingVersion = Schema.Struct({
  mapping_version_id: MappingVersionIdField,
  ...GateMappingVersionFields,
}).pipe(
  Schema.filter(
    (version) =>
      version.identity_reveal_basis.kind !== "second_approver" ||
      version.identity_reveal_basis.approver_subject !== version.ratifier_subject ||
      "second approver must be distinct from the ratifier",
  ),
  Schema.filter(
    (version) =>
      version.identity_reveal_basis.kind !== "integration_evidence" ||
      version.identity_reveal_basis.bound_config_digest.digest ===
        version.config_digest.digest ||
      "integration evidence must bind this version's exact config digest",
  ),
).annotations({ identifier: "GateMappingVersion" });
export type GateMappingVersion = Schema.Schema.Type<typeof GateMappingVersion>;

/**
 * An inferred mapping stored as a hypothesis. It has no ratifier, no version
 * ID, and no reveal basis; it is context for the one-question flow only.
 */
export const GateMappingHypothesis = Schema.Struct({
  schema_version: SchemaVersion,
  provenance: Schema.Literal("inferred"),
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: CollectionIdDigest,
  role_ids: RoleIdSet,
  inferred_from: NonEmptyString,
  observed_at: IsoTimestamp,
}).annotations({ identifier: "GateMappingHypothesis" });
export type GateMappingHypothesis = Schema.Schema.Type<typeof GateMappingHypothesis>;

export const GateMappingAuditEvent = Schema.Struct({
  schema_version: SchemaVersion,
  event: Schema.Literal("ratified", "revoked"),
  mapping_version_id: MappingVersionIdField,
  actor_subject: SubjectRef,
  actor_permission: OperatorPermission,
  occurred_at: IsoTimestamp,
  aggregate_version: NonNegativeInt,
  reason: Schema.optionalWith(NonEmptyString, { exact: true }),
}).annotations({ identifier: "GateMappingAuditEvent" });
export type GateMappingAuditEvent = Schema.Schema.Type<typeof GateMappingAuditEvent>;

/**
 * Aggregate envelope fields + scope invariant. Deliberately omits the
 * single-active filter so in-process transitions can emit the typed
 * `MalformedMappingAggregateError` after a successful strict envelope decode
 * instead of collapsing that domain case into a generic `ParseError`.
 */
const GateMappingAggregateEnvelope = Schema.Struct({
  schema_version: SchemaVersion,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: CollectionIdDigest,
  aggregate_version: NonNegativeInt,
  versions: Schema.Array(GateMappingVersion),
  audit: Schema.Array(GateMappingAuditEvent),
}).pipe(
  Schema.filter(
    (aggregate) =>
      aggregate.versions.every(
        (version) =>
          version.community_ref === aggregate.community_ref &&
          version.guild_ref === aggregate.guild_ref &&
          hasDomain(version.collection_id, COLLECTION_DIGEST_DOMAINS.identity) &&
          version.collection_id.digest === aggregate.collection_id.digest,
      ) || "every version must match the aggregate community, guild, and collection",
  ),
);

export const GateMappingAggregate = GateMappingAggregateEnvelope.pipe(
  Schema.filter(
    (aggregate) =>
      aggregate.versions.filter((version) => version.revoked_at === undefined).length <=
        1 || "a gate-mapping aggregate must never contain multiple active versions",
  ),
).annotations({ identifier: "GateMappingAggregate" });
export type GateMappingAggregate = Schema.Schema.Type<typeof GateMappingAggregate>;

/* ------------------------------------------------------------------------ */
/* Typed transition errors                                                   */
/* ------------------------------------------------------------------------ */

export class UnauthorizedRatifierError extends Data.TaggedError(
  "UnauthorizedRatifierError",
)<{
  readonly reason_code: "gate_config_ratify_required";
  readonly subject: string;
}> {}

export class MappingVersionConflictError extends Data.TaggedError(
  "MappingVersionConflictError",
)<{
  readonly expected_aggregate_version: number;
  readonly current_aggregate_version: number;
  /** The current mapping is returned for review; never overwritten. */
  readonly current_active_version_id: string | undefined;
}> {}

/**
 * A NEW distinct ratification arrived while a version is still active. The
 * caller must explicitly revoke the active version and relink; the aggregate
 * never accumulates a second active version and never replaces one silently.
 */
export class ActiveMappingExistsError extends Data.TaggedError(
  "ActiveMappingExistsError",
)<{
  readonly active_mapping_version_id: string;
  readonly required_action: "revoke_then_relink";
}> {}

/** The stored aggregate violates the single-active invariant (or worse). */
export class MalformedMappingAggregateError extends Data.TaggedError(
  "MalformedMappingAggregateError",
)<{
  readonly reason_code: "gate_mapping_malformed";
  readonly reason: string;
}> {}

/** A version's recomputed digests do not match its stored digests. */
export class MappingIntegrityError extends Data.TaggedError("MappingIntegrityError")<{
  readonly reason_code: "mapping_integrity_violation";
  readonly mapping_version_id: string;
  readonly mismatches: ReadonlyArray<
    | "config_digest"
    | "rule_digest"
    | "command_digest"
    | "mapping_version_id"
    | "integration_evidence_binding"
    | "command_material"
  >;
}> {}

export class IntegrationEvidenceMismatchError extends Data.TaggedError(
  "IntegrationEvidenceMismatchError",
)<{
  readonly reason: string;
}> {}

export class MappingChurnLimitError extends Data.TaggedError("MappingChurnLimitError")<{
  readonly reason_code: "mapping_churn_limit_exceeded";
  readonly limit: number;
  readonly window_hours: 24;
}> {}

export class SecondApproverInvalidError extends Data.TaggedError(
  "SecondApproverInvalidError",
)<{
  readonly reason: string;
}> {}

export class MappingVersionNotFoundError extends Data.TaggedError(
  "MappingVersionNotFoundError",
)<{
  readonly mapping_version_id: string;
}> {}

export class MappingAlreadyRevokedError extends Data.TaggedError(
  "MappingAlreadyRevokedError",
)<{
  readonly mapping_version_id: string;
}> {}

export class MappingScopeMismatchError extends Data.TaggedError(
  "MappingScopeMismatchError",
)<{
  readonly reason: string;
}> {}

/**
 * The same idempotency key was reused with a command that is not byte/
 * canonically equivalent to the recorded command. The stored mapping is never
 * overwritten and the transition never returns success.
 */
export class IdempotencyConflictError extends Data.TaggedError(
  "IdempotencyConflictError",
)<{
  readonly idempotency_key: string;
  readonly stored_mapping_version_id: string;
  readonly stored_command_digest: string;
  readonly submitted_command_digest: string;
}> {}

/* ------------------------------------------------------------------------ */
/* Config / version digests and integrity verification                       */
/* ------------------------------------------------------------------------ */

export interface GateMappingConfigMaterial {
  readonly community_ref: string;
  readonly guild_ref: string;
  readonly collection_id: VersionedDigest;
  readonly deployment_set_digest: VersionedDigest;
  readonly role_ids: ReadonlyArray<string>;
  readonly eligibility_rule: GateRuleV1;
}

/**
 * The exact configuration digest a mapping version commits to. Exported so
 * integration-evidence producers can bind the digest BEFORE ratification and
 * verifiers can recompute it independently.
 */
export const computeGateMappingConfigDigest = (
  material: GateMappingConfigMaterial,
): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(GATE_LEAK_DIGEST_DOMAINS.mapping_config, 1, {
    community_ref: material.community_ref,
    guild_ref: material.guild_ref,
    collection_id: material.collection_id,
    deployment_set_digest: material.deployment_set_digest,
    role_ids: material.role_ids,
    eligibility_rule: material.eligibility_rule,
  });

const computeMappingVersionId = (material: {
  readonly config_digest: VersionedDigest;
  readonly command_digest: VersionedDigest;
  readonly effective_at: string;
  readonly idempotency_key: string;
  readonly provenance: RatifiedMappingProvenance;
  readonly ratifier_subject: string;
  readonly identity_reveal_basis: IdentityRevealBasis;
}): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(GATE_LEAK_DIGEST_DOMAINS.mapping_version, 1, material);

const digestsMatch = (left: VersionedDigest, right: VersionedDigest): boolean =>
  left.algorithm === right.algorithm &&
  left.domain === right.domain &&
  left.major_version === right.major_version &&
  left.digest === right.digest;

const sortedRoleIdsEqual = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const identityRevealBasesEqual = (
  left: IdentityRevealBasis,
  right: IdentityRevealBasis,
): boolean => {
  if (left.kind !== right.kind || left.schema_version !== right.schema_version) {
    return false;
  }
  if (left.kind === "pending" && right.kind === "pending") return true;
  if (left.kind === "second_approver" && right.kind === "second_approver") {
    return (
      left.approver_subject === right.approver_subject &&
      left.approver_permission === right.approver_permission &&
      left.approved_at === right.approved_at
    );
  }
  if (left.kind === "integration_evidence" && right.kind === "integration_evidence") {
    return (
      digestsMatch(left.evidence_digest, right.evidence_digest) &&
      digestsMatch(left.bound_config_digest, right.bound_config_digest) &&
      left.authority === right.authority &&
      left.observed_at === right.observed_at
    );
  }
  return false;
};

/**
 * Command material must agree with the denormalized version fields it created.
 * A graft that keeps digests but rewrites only the stored material (or only the
 * denormalized view) is an integrity failure, not a successful rewrite.
 */
const commandMaterialMatchesVersion = (version: GateMappingVersion): boolean => {
  const material = version.command_material;
  return (
    material.schema_version === version.schema_version &&
    material.community_ref === version.community_ref &&
    material.guild_ref === version.guild_ref &&
    digestsMatch(material.collection_id, version.collection_id) &&
    digestsMatch(material.deployment_set_digest, version.deployment_set_digest) &&
    sortedRoleIdsEqual(material.role_ids, version.role_ids) &&
    material.eligibility_rule.kind === version.eligibility_rule.kind &&
    material.eligibility_rule.minimum_balance === version.eligibility_rule.minimum_balance &&
    material.eligibility_rule.deployment_scope === version.eligibility_rule.deployment_scope &&
    material.eligibility_rule.token_scope === version.eligibility_rule.token_scope &&
    material.provenance === version.provenance &&
    material.ratifier_subject === version.ratifier_subject &&
    material.effective_at === version.effective_at &&
    material.idempotency_key === version.idempotency_key &&
    identityRevealBasesEqual(material.identity_reveal_basis, version.identity_reveal_basis)
  );
};

/**
 * Recompute a version's rule digest, config digest, command digest, and
 * mapping version ID from its own fields/material and compare each with the
 * stored value. Tampering role_ids, rule, scope, reveal basis, command
 * material, or grafting a changed command digest while retaining the old
 * mapping_version_id fails here with the exact mismatches named.
 */
export const verifyGateMappingVersionIntegrity = (
  version: GateMappingVersion,
): Effect.Effect<
  GateMappingVersion,
  MappingIntegrityError | CanonicalEncodingError | DigestComputationError
> =>
  Effect.gen(function* () {
    const mismatches: Array<
      | "config_digest"
      | "rule_digest"
      | "command_digest"
      | "mapping_version_id"
      | "integration_evidence_binding"
      | "command_material"
    > = [];
    if (!commandMaterialMatchesVersion(version)) {
      mismatches.push("command_material");
    }
    const ruleDigest = yield* digestVersioned(
      GATE_LEAK_DIGEST_DOMAINS.gate_rule,
      1,
      version.eligibility_rule,
    );
    if (!digestsMatch(ruleDigest, version.rule_digest)) mismatches.push("rule_digest");
    const configDigest = yield* computeGateMappingConfigDigest(version);
    if (!digestsMatch(configDigest, version.config_digest)) {
      mismatches.push("config_digest");
    }
    if (
      version.identity_reveal_basis.kind === "integration_evidence" &&
      !digestsMatch(version.identity_reveal_basis.bound_config_digest, configDigest)
    ) {
      mismatches.push("integration_evidence_binding");
    }
    const commandDigest = yield* computeGateMappingCommandDigest(version.command_material);
    if (!digestsMatch(commandDigest, version.command_digest)) {
      mismatches.push("command_digest");
    }
    const versionId = yield* computeMappingVersionId({
      config_digest: configDigest,
      command_digest: commandDigest,
      effective_at: version.effective_at,
      idempotency_key: version.idempotency_key,
      provenance: version.provenance,
      ratifier_subject: version.ratifier_subject,
      identity_reveal_basis: version.identity_reveal_basis,
    });
    if (!digestsMatch(versionId, version.mapping_version_id)) {
      mismatches.push("mapping_version_id");
    }
    if (mismatches.length > 0) {
      return yield* Effect.fail(
        new MappingIntegrityError({
          reason_code: "mapping_integrity_violation",
          mapping_version_id: version.mapping_version_id.digest,
          mismatches,
        }),
      );
    }
    return version;
  });

const strictOptions = { errors: "all", onExcessProperty: "error" } as const;
const decodeVersionStruct = Schema.decodeUnknown(GateMappingVersion, strictOptions);
const decodeAggregateEnvelopeStruct = Schema.decodeUnknown(
  GateMappingAggregateEnvelope,
  strictOptions,
);
const decodeAggregateStruct = Schema.decodeUnknown(GateMappingAggregate, strictOptions);

/** Strict decode PLUS digest-integrity verification (CR-001 decoder style). */
export const decodeGateMappingVersion = (
  input: unknown,
): Effect.Effect<
  GateMappingVersion,
  | ParseResult.ParseError
  | MappingIntegrityError
  | CanonicalEncodingError
  | DigestComputationError
> => decodeVersionStruct(input).pipe(Effect.flatMap(verifyGateMappingVersionIntegrity));

/**
 * Strict decode of the aggregate: structural invariants (scope match, at most
 * one active version) plus digest-integrity verification of EVERY version.
 */
export const decodeGateMappingAggregate = (
  input: unknown,
): Effect.Effect<
  GateMappingAggregate,
  | ParseResult.ParseError
  | MappingIntegrityError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  decodeAggregateStruct(input).pipe(
    Effect.flatMap((aggregate) =>
      Effect.forEach(aggregate.versions, verifyGateMappingVersionIntegrity).pipe(
        Effect.as(aggregate),
      ),
    ),
  );

export const decodeGateMappingHypothesis = Schema.decodeUnknown(
  GateMappingHypothesis,
  strictOptions,
);

/* ------------------------------------------------------------------------ */
/* Commands and pure transitions                                             */
/* ------------------------------------------------------------------------ */

export const RatifyGateMappingCommand = GateMappingCommandMaterial.annotations({
  identifier: "RatifyGateMappingCommand",
});
export type RatifyGateMappingCommand = GateMappingCommandMaterial;

export const decodeRatifyGateMappingCommand = Schema.decodeUnknown(
  RatifyGateMappingCommand,
  strictOptions,
);

/**
 * Versioned digest over every semantically relevant ratify-command field
 * (scope, roles, rule, provenance, reveal basis, authority, CAS expectation,
 * effective time, and idempotency key). Permissions are sorted before digest
 * so equivalent permission permutations collide on one command identity.
 */
export const computeGateMappingCommandDigest = (
  command: GateMappingCommandMaterial,
): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(GATE_LEAK_DIGEST_DOMAINS.mapping_command, 1, {
    schema_version: command.schema_version,
    community_ref: command.community_ref,
    guild_ref: command.guild_ref,
    collection_id: command.collection_id,
    deployment_set_digest: command.deployment_set_digest,
    role_ids: command.role_ids,
    eligibility_rule: command.eligibility_rule,
    provenance: command.provenance,
    identity_reveal_basis: command.identity_reveal_basis,
    ratifier_subject: command.ratifier_subject,
    ratifier_permissions: command.ratifier_permissions.toSorted((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }),
    expected_aggregate_version: command.expected_aggregate_version,
    effective_at: command.effective_at,
    idempotency_key: command.idempotency_key,
  });

const activeVersionsOf = (
  aggregate: GateMappingAggregate,
): ReadonlyArray<GateMappingVersion> =>
  aggregate.versions.filter((version) => version.revoked_at === undefined);

const hoursBetween = (earlier: string, later: string): number =>
  (Date.parse(later) - Date.parse(earlier)) / 3_600_000;

export interface RatifyGateMappingResult {
  readonly aggregate: GateMappingAggregate;
  readonly version: GateMappingVersion;
  /** True when the idempotency key matched an existing version. */
  readonly idempotent_replay: boolean;
}

/**
 * Strict-decode + integrity-verify the complete stored aggregate envelope
 * before any transition branch. Malformed `schema_version`,
 * `aggregate_version`, audit records, excess keys, grafted envelope fields,
 * and invalid optional/null states fail closed as `ParseError` here — before
 * replay, CAS, ratify, or revoke. Grafted command digests, materials, version
 * IDs (`mapping_version_id` / active mapping version identity), roles, config
 * fields, or reveal evidence on an in-process JS object fail with
 * `MappingIntegrityError` — exactly as persisted decode would. Multiple
 * active versions fail with `MalformedMappingAggregateError` AFTER envelope
 * decode (never collapsed into a generic parse error), matching readiness's
 * `gate_mapping_malformed`. Public transitions must consume only the returned
 * verified aggregate — never the raw caller object.
 */
const verifyStoredMappingAggregate = (
  aggregate: GateMappingAggregate,
): Effect.Effect<
  GateMappingAggregate,
  | ParseResult.ParseError
  | MappingIntegrityError
  | MalformedMappingAggregateError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeAggregateEnvelopeStruct(aggregate);
    if (activeVersionsOf(decoded).length > 1) {
      return yield* Effect.fail(
        new MalformedMappingAggregateError({
          reason_code: "gate_mapping_malformed",
          reason: "aggregate holds multiple active versions; refuse all transitions",
        }),
      );
    }
    const versions = yield* Effect.forEach(
      decoded.versions,
      verifyGateMappingVersionIntegrity,
    );
    return { ...decoded, versions };
  });

/**
 * Pure ratification transition. Persistence executes it inside one
 * transaction with the optimistic-concurrency compare-and-swap.
 *
 * Single-active invariant: idempotent replay of a recorded command is
 * permitted, but a NEW distinct ratification while any version is active
 * refuses with `ActiveMappingExistsError` — explicit revoke-then-relink is
 * the only path to a replacement mapping.
 *
 * Integrity-first: the stored aggregate is strict-decoded and every version's
 * digests are recomputed BEFORE idempotency lookup or any other branch.
 * Replay never compares against a raw stored `command_digest` field and never
 * returns an unverified in-memory version object.
 */
export const ratifyGateMapping = (
  aggregate: GateMappingAggregate,
  command: RatifyGateMappingCommand,
): Effect.Effect<
  RatifyGateMappingResult,
  | UnauthorizedRatifierError
  | MappingVersionConflictError
  | ActiveMappingExistsError
  | MalformedMappingAggregateError
  | MappingIntegrityError
  | MappingChurnLimitError
  | SecondApproverInvalidError
  | IntegrationEvidenceMismatchError
  | MappingScopeMismatchError
  | IdempotencyConflictError
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  Effect.gen(function* () {
    const verifiedAggregate = yield* verifyStoredMappingAggregate(aggregate);

    if (
      command.community_ref !== verifiedAggregate.community_ref ||
      command.guild_ref !== verifiedAggregate.guild_ref ||
      command.collection_id.digest !== verifiedAggregate.collection_id.digest
    ) {
      return yield* Effect.fail(
        new MappingScopeMismatchError({
          reason:
            "ratify command community, guild, and collection must match the aggregate scope",
        }),
      );
    }

    if (!command.ratifier_permissions.includes(GATE_CONFIG_RATIFY_PERMISSION)) {
      return yield* Effect.fail(
        new UnauthorizedRatifierError({
          reason_code: "gate_config_ratify_required",
          subject: command.ratifier_subject,
        }),
      );
    }

    const actives = activeVersionsOf(verifiedAggregate);
    if (actives.length > 1) {
      return yield* Effect.fail(
        new MalformedMappingAggregateError({
          reason_code: "gate_mapping_malformed",
          reason: "aggregate holds multiple active versions; refuse all transitions",
        }),
      );
    }

    const commandDigest = yield* computeGateMappingCommandDigest(command);
    const replay = verifiedAggregate.versions.find(
      (version) => version.idempotency_key === command.idempotency_key,
    );
    if (replay !== undefined) {
      // Recompute from verified command_material — never trust a denormalized
      // stored command_digest field for replay or conflict decisions.
      const storedCommandDigest = yield* computeGateMappingCommandDigest(
        replay.command_material,
      );
      if (!digestsMatch(storedCommandDigest, commandDigest)) {
        return yield* Effect.fail(
          new IdempotencyConflictError({
            idempotency_key: command.idempotency_key,
            stored_mapping_version_id: replay.mapping_version_id.digest,
            stored_command_digest: storedCommandDigest.digest,
            submitted_command_digest: commandDigest.digest,
          }),
        );
      }
      return {
        aggregate: verifiedAggregate,
        version: replay,
        idempotent_replay: true,
      };
    }

    if (command.expected_aggregate_version !== verifiedAggregate.aggregate_version) {
      return yield* Effect.fail(
        new MappingVersionConflictError({
          expected_aggregate_version: command.expected_aggregate_version,
          current_aggregate_version: verifiedAggregate.aggregate_version,
          current_active_version_id: actives[0]?.mapping_version_id.digest,
        }),
      );
    }

    const active = actives[0];
    if (active !== undefined) {
      return yield* Effect.fail(
        new ActiveMappingExistsError({
          active_mapping_version_id: active.mapping_version_id.digest,
          required_action: "revoke_then_relink",
        }),
      );
    }

    if (command.identity_reveal_basis.kind === "second_approver") {
      if (command.identity_reveal_basis.approver_subject === command.ratifier_subject) {
        return yield* Effect.fail(
          new SecondApproverInvalidError({
            reason: "second approver must be a distinct subject from the ratifier",
          }),
        );
      }
      if (
        command.identity_reveal_basis.approver_permission !==
        PRIVACY_APPROVE_GATE_AUDIT_PERMISSION
      ) {
        return yield* Effect.fail(
          new SecondApproverInvalidError({
            reason: `second approver must hold ${PRIVACY_APPROVE_GATE_AUDIT_PERMISSION}`,
          }),
        );
      }
    }

    const recentVersions = verifiedAggregate.versions.filter(
      (version) => hoursBetween(version.effective_at, command.effective_at) < 24,
    );
    if (
      recentVersions.length >=
      GATE_LEAK_CHURN_POLICY_V1.max_new_mapping_versions_per_community_per_24h
    ) {
      return yield* Effect.fail(
        new MappingChurnLimitError({
          reason_code: "mapping_churn_limit_exceeded",
          limit: GATE_LEAK_CHURN_POLICY_V1.max_new_mapping_versions_per_community_per_24h,
          window_hours: 24,
        }),
      );
    }

    const configDigest = yield* computeGateMappingConfigDigest(command);
    if (
      command.identity_reveal_basis.kind === "integration_evidence" &&
      !digestsMatch(command.identity_reveal_basis.bound_config_digest, configDigest)
    ) {
      return yield* Effect.fail(
        new IntegrationEvidenceMismatchError({
          reason:
            "integration evidence binds a different mapping configuration digest than this command ratifies",
        }),
      );
    }
    const ruleDigest = yield* digestVersioned(
      GATE_LEAK_DIGEST_DOMAINS.gate_rule,
      1,
      command.eligibility_rule,
    );
    const mappingVersionId = yield* computeMappingVersionId({
      config_digest: configDigest,
      command_digest: commandDigest,
      effective_at: command.effective_at,
      idempotency_key: command.idempotency_key,
      provenance: command.provenance,
      ratifier_subject: command.ratifier_subject,
      identity_reveal_basis: command.identity_reveal_basis,
    });
    const version: GateMappingVersion = {
      mapping_version_id: mappingVersionId,
      schema_version: 1,
      community_ref: command.community_ref,
      guild_ref: command.guild_ref,
      collection_id: command.collection_id,
      deployment_set_digest: command.deployment_set_digest,
      role_ids: command.role_ids,
      eligibility_rule: command.eligibility_rule,
      rule_digest: ruleDigest,
      provenance: command.provenance,
      ratifier_subject: command.ratifier_subject,
      ratifier_permission: GATE_CONFIG_RATIFY_PERMISSION,
      identity_reveal_basis: command.identity_reveal_basis,
      effective_at: command.effective_at,
      idempotency_key: command.idempotency_key,
      config_digest: configDigest,
      command_digest: commandDigest,
      command_material: command,
    };
    const auditEvent: GateMappingAuditEvent = {
      schema_version: 1,
      event: "ratified",
      mapping_version_id: mappingVersionId,
      actor_subject: command.ratifier_subject,
      actor_permission: GATE_CONFIG_RATIFY_PERMISSION,
      occurred_at: command.effective_at,
      aggregate_version: verifiedAggregate.aggregate_version + 1,
    };
    const next: GateMappingAggregate = {
      ...verifiedAggregate,
      aggregate_version: verifiedAggregate.aggregate_version + 1,
      versions: [...verifiedAggregate.versions, version],
      audit: [...verifiedAggregate.audit, auditEvent],
    };
    return { aggregate: next, version, idempotent_replay: false };
  });

export const RevokeGateMappingCommand = Schema.Struct({
  schema_version: SchemaVersion,
  mapping_version_id: MappingVersionIdField,
  revoker_subject: SubjectRef,
  revoker_permissions: Schema.Array(OperatorPermission),
  expected_aggregate_version: NonNegativeInt,
  revoked_at: IsoTimestamp,
  reason: NonEmptyString,
}).annotations({ identifier: "RevokeGateMappingCommand" });
export type RevokeGateMappingCommand = Schema.Schema.Type<
  typeof RevokeGateMappingCommand
>;

export const decodeRevokeGateMappingCommand = Schema.decodeUnknown(
  RevokeGateMappingCommand,
  strictOptions,
);

export interface RevokeGateMappingResult {
  readonly aggregate: GateMappingAggregate;
  readonly version: GateMappingVersion;
  /**
   * Directive for pending orders pinned to the revoked version: Needs
   * attention with `gate_mapping_revoked`; the operator must explicitly
   * relink. A replacement is never selected silently.
   */
  readonly pending_order_directive: "needs_attention:gate_mapping_revoked";
}

export const revokeGateMappingVersion = (
  aggregate: GateMappingAggregate,
  command: RevokeGateMappingCommand,
): Effect.Effect<
  RevokeGateMappingResult,
  | UnauthorizedRatifierError
  | MappingVersionConflictError
  | MappingVersionNotFoundError
  | MappingAlreadyRevokedError
  | MalformedMappingAggregateError
  | MappingIntegrityError
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  Effect.gen(function* () {
    const verifiedAggregate = yield* verifyStoredMappingAggregate(aggregate);

    if (!command.revoker_permissions.includes(GATE_CONFIG_RATIFY_PERMISSION)) {
      return yield* Effect.fail(
        new UnauthorizedRatifierError({
          reason_code: "gate_config_ratify_required",
          subject: command.revoker_subject,
        }),
      );
    }
    if (command.expected_aggregate_version !== verifiedAggregate.aggregate_version) {
      return yield* Effect.fail(
        new MappingVersionConflictError({
          expected_aggregate_version: command.expected_aggregate_version,
          current_aggregate_version: verifiedAggregate.aggregate_version,
          current_active_version_id:
            activeVersionsOf(verifiedAggregate)[0]?.mapping_version_id.digest,
        }),
      );
    }
    const index = verifiedAggregate.versions.findIndex(
      (version) =>
        version.mapping_version_id.digest === command.mapping_version_id.digest,
    );
    const existing = index >= 0 ? verifiedAggregate.versions[index] : undefined;
    if (existing === undefined) {
      return yield* Effect.fail(
        new MappingVersionNotFoundError({
          mapping_version_id: command.mapping_version_id.digest,
        }),
      );
    }
    if (existing.revoked_at !== undefined) {
      return yield* Effect.fail(
        new MappingAlreadyRevokedError({
          mapping_version_id: command.mapping_version_id.digest,
        }),
      );
    }

    const revoked: GateMappingVersion = { ...existing, revoked_at: command.revoked_at };
    const auditEvent: GateMappingAuditEvent = {
      schema_version: 1,
      event: "revoked",
      mapping_version_id: existing.mapping_version_id,
      actor_subject: command.revoker_subject,
      actor_permission: GATE_CONFIG_RATIFY_PERMISSION,
      occurred_at: command.revoked_at,
      aggregate_version: verifiedAggregate.aggregate_version + 1,
      reason: command.reason,
    };
    const versions = verifiedAggregate.versions.map((version, versionIndex) =>
      versionIndex === index ? revoked : version,
    );
    const next: GateMappingAggregate = {
      ...verifiedAggregate,
      aggregate_version: verifiedAggregate.aggregate_version + 1,
      versions,
      audit: [...verifiedAggregate.audit, auditEvent],
    };
    return {
      aggregate: next,
      version: revoked,
      pending_order_directive: "needs_attention:gate_mapping_revoked" as const,
    };
  });

/* ------------------------------------------------------------------------ */
/* Readiness and reveal predicates                                           */
/* ------------------------------------------------------------------------ */

export type MappingReadinessVerdict =
  | { readonly ready: true; readonly version: GateMappingVersion }
  | {
      readonly ready: false;
      readonly reason_code:
        | "gate_mapping_not_ratified"
        | "gate_mapping_revoked"
        | "gate_mapping_malformed";
    };

/**
 * A mapping satisfies readiness only through THE single current (non-revoked)
 * ratified version. An aggregate holding more than one active version is
 * malformed and refuses outright — readiness never chooses an oldest (or any)
 * winner among competing active versions. Hypotheses cannot reach this
 * function: they are a different type.
 */
export const mappingSatisfiesReadiness = (
  aggregate: GateMappingAggregate,
): MappingReadinessVerdict => {
  const actives = activeVersionsOf(aggregate);
  if (actives.length > 1) {
    return { ready: false, reason_code: "gate_mapping_malformed" };
  }
  const active = actives[0];
  if (active !== undefined) return { ready: true, version: active };
  return {
    ready: false,
    reason_code:
      aggregate.versions.length > 0 ? "gate_mapping_revoked" : "gate_mapping_not_ratified",
  };
};

export type IdentityRevealVerdict =
  | { readonly revealable: true }
  | {
      readonly revealable: false;
      readonly reason_code: "identity_reveal_not_authorized";
    };

export const mappingPermitsIdentityReveal = (
  version: GateMappingVersion,
): IdentityRevealVerdict =>
  version.identity_reveal_basis.kind === "pending"
    ? { revealable: false, reason_code: "identity_reveal_not_authorized" }
    : { revealable: true };

/* ------------------------------------------------------------------------ */
/* Order churn (constant's executable form; enforcement site is Ordering)    */
/* ------------------------------------------------------------------------ */

export type OrderChurnVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason_code: "report_churn_limit_exceeded" };

/**
 * Rolling 24-hour distinct-collection Gate Leak order limit per community.
 * `recentDistinctCollectionOrderTimes` are the effective times of prior
 * admitted orders for DISTINCT collections in this community.
 */
export const evaluateGateLeakOrderChurn = (
  recentDistinctCollectionOrderTimes: ReadonlyArray<string>,
  candidateAt: string,
): OrderChurnVerdict => {
  const inWindow = recentDistinctCollectionOrderTimes.filter(
    (time) => hoursBetween(time, candidateAt) < 24,
  );
  return inWindow.length >=
    GATE_LEAK_CHURN_POLICY_V1.max_distinct_collection_orders_per_community_per_24h
    ? { admitted: false, reason_code: "report_churn_limit_exceeded" }
    : { admitted: true };
};
