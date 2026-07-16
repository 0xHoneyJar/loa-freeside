import {
  type CanonicalEncodingError,
  CollectionWorkKeyMaterial,
  DIGEST_DOMAINS as COLLECTION_DIGEST_DOMAINS,
  type DigestComputationError,
  DuplicateCanonicalSetMemberError,
  VersionIdentifier,
  VersionedDigest,
  digestVersioned,
  sortCanonicalSet,
} from "@freeside/collection-protocol";
import { Data, Effect, type ParseResult, Schema } from "effect";
import { GATE_LEAK_DIGEST_DOMAINS } from "./gate-rule.js";
import {
  CommunityRef,
  DiscordSnowflake,
  NonNegativeInt,
  SchemaVersion,
} from "./scalars.js";

/**
 * Canonical work-key inputs, one schema per capability (SDD 6.3):
 *
 *   capability ID and version + normalized scope class and scope identity
 *   + privacy class + source identity + sorted deployment IDs
 *   + server-derived evidence boundary + finality policy version
 *   + readiness policy version + adapter version
 *
 * Shareability is structural, not conventional:
 * - global (public-chain) inputs have NO fields that could carry a user,
 *   community, guild, email, or order identity — excess properties are decode
 *   errors, so tenant identity cannot enter a shared key;
 * - community-scoped inputs REQUIRE community/guild/configuration identity, so
 *   restricted work can never join a public or different-tenant item merely
 *   because the deployment set matches.
 *
 * Digests are computed over the keyed JCS object (RFC 8785), so scope values
 * are field-separated: no concatenation of community and guild strings can
 * collide across boundaries.
 */

const NonEmptyString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

const isStrictlySortedUnique = <Value>(
  values: ReadonlyArray<Value>,
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    const left = key(previous);
    const right = key(current);
    if (left >= right) return false;
  }
  return true;
};

const hasDomain = (value: VersionedDigest, domain: string): boolean =>
  value.algorithm === "sha-256" && value.major_version === 1 && value.domain === domain;

const DeploymentSetDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.deployment_set) ||
      "deployment_set_digest must use the gate-leak.deployment-set v1 digest domain",
  ),
);

const SubjectCohortDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.subject_cohort) ||
      "subject_set_digest must use the gate-leak.subject-cohort v1 digest domain",
  ),
);

const MappingVersionId = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_version) ||
      "mapping_version_id must use the gate-leak.mapping-version v1 digest domain",
  ),
);

const ComputeInputDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.compute_input) ||
      "compute_input_digest must use the gate-leak.compute-input v1 digest domain",
  ),
);

/** Sorted, non-empty set of mapped Discord role IDs. */
export const RoleIdSet = Schema.Array(DiscordSnowflake).pipe(
  Schema.filter((roles) => roles.length > 0 || "role_ids must be non-empty"),
  Schema.filter(
    (roles) =>
      isStrictlySortedUnique(roles, (role) => role) ||
      "role_ids are a sorted unique set",
  ),
).annotations({ identifier: "RoleIdSet" });
export type RoleIdSet = Schema.Schema.Type<typeof RoleIdSet>;

/**
 * An empty selected deployment set is never a valid Gate Leak input: an empty
 * universal quantification would make every wallet vacuously proven, so every
 * digest and classification path refuses it with this tagged error.
 */
export class EmptyDeploymentSelectionError extends Data.TaggedError(
  "EmptyDeploymentSelectionError",
)<{
  readonly reason_code: "empty_deployment_selection";
}> {}

export class InvalidDeploymentSetMemberError extends Data.TaggedError(
  "InvalidDeploymentSetMemberError",
)<{
  readonly reason: string;
}> {}

/**
 * Validate a logical selected-deployment set: non-empty, every member a
 * CR-001 `collection.deployment` v1 digest, no duplicates. Order is NOT
 * required here — canonicalization (not the caller) fixes the order.
 */
export const validateSelectedDeploymentSet = (
  deploymentIds: ReadonlyArray<VersionedDigest>,
): Effect.Effect<
  ReadonlyArray<VersionedDigest>,
  EmptyDeploymentSelectionError | InvalidDeploymentSetMemberError
> => {
  if (deploymentIds.length === 0) {
    return Effect.fail(
      new EmptyDeploymentSelectionError({ reason_code: "empty_deployment_selection" }),
    );
  }
  const seen = new Set<string>();
  for (const deploymentId of deploymentIds) {
    if (!hasDomain(deploymentId, COLLECTION_DIGEST_DOMAINS.deployment)) {
      return Effect.fail(
        new InvalidDeploymentSetMemberError({
          reason: `deployment ids must use the ${COLLECTION_DIGEST_DOMAINS.deployment} v1 digest domain`,
        }),
      );
    }
    if (seen.has(deploymentId.digest)) {
      return Effect.fail(
        new InvalidDeploymentSetMemberError({
          reason: `duplicate deployment id in selected set: ${deploymentId.digest}`,
        }),
      );
    }
    seen.add(deploymentId.digest);
  }
  return Effect.succeed(deploymentIds);
};

/**
 * Canonical sorted form of a selected deployment set: validated, then sorted
 * bytewise by the canonical encoding of each digest. Equivalent permutations
 * canonicalize identically; duplicates refuse.
 */
export const canonicalDeploymentIdSet = (
  deploymentIds: ReadonlyArray<VersionedDigest>,
): Effect.Effect<
  ReadonlyArray<VersionedDigest>,
  | EmptyDeploymentSelectionError
  | InvalidDeploymentSetMemberError
  | DuplicateCanonicalSetMemberError
  | CanonicalEncodingError
> =>
  validateSelectedDeploymentSet(deploymentIds).pipe(
    Effect.flatMap((validated) =>
      sortCanonicalSet(
        validated.map((deploymentId) => ({
          canonical_key: deploymentId,
          value: deploymentId,
        })),
      ),
    ),
  );

/**
 * Compute a deployment-set digest from CR-001 deployment IDs. The set is
 * CANONICALIZED before digesting: permutations of the same logical set yield
 * the identical digest, duplicates refuse, and the empty set refuses — an
 * empty or fragmented deployment-set key is unrepresentable.
 */
export const digestDeploymentSet = (
  deploymentIds: ReadonlyArray<VersionedDigest>,
): Effect.Effect<
  VersionedDigest,
  | EmptyDeploymentSelectionError
  | InvalidDeploymentSetMemberError
  | DuplicateCanonicalSetMemberError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  canonicalDeploymentIdSet(deploymentIds).pipe(
    Effect.flatMap((canonical) =>
      digestVersioned(GATE_LEAK_DIGEST_DOMAINS.deployment_set, 1, canonical),
    ),
  );

/**
 * Canonical sorted-unique role-ID set from an arbitrarily ordered input.
 * Duplicates refuse (never silently dedupe — a duplicated role in a command
 * is a caller defect, not a normalization case); the sorted result then
 * strict-decodes through `RoleIdSet`.
 */
export const canonicalRoleIdSet = (
  roleIds: ReadonlyArray<string>,
): Effect.Effect<
  RoleIdSet,
  ParseResult.ParseError | DuplicateCanonicalSetMemberError
> => {
  const seen = new Set<string>();
  for (const roleId of roleIds) {
    if (seen.has(roleId)) {
      return Effect.fail(
        new DuplicateCanonicalSetMemberError({ canonical_key: JSON.stringify(roleId) }),
      );
    }
    seen.add(roleId);
  }
  const sorted = roleIds.toSorted((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return Schema.decodeUnknown(RoleIdSet, {
    errors: "all",
    onExcessProperty: "error",
  })(sorted);
};

/* ------------------------------------------------------------------------ */
/* Evidence boundaries (server-derived; never caller-controlled)             */
/* ------------------------------------------------------------------------ */

export const ContinuousLatestBoundary = Schema.Struct({
  kind: Schema.Literal("continuous_latest"),
}).annotations({ identifier: "ContinuousLatestBoundary" });

export const MappingVersionBoundary = Schema.Struct({
  kind: Schema.Literal("immutable_mapping_version"),
  mapping_version_id: MappingVersionId,
}).annotations({ identifier: "MappingVersionBoundary" });

/**
 * Acquisition demand: keyed BEFORE any remote call from capture policy,
 * authorization epoch, and an Ordering-assigned generation. Equivalent orders
 * join it; callers cannot supply the generation or a snapshot ID.
 */
export const AcquisitionBoundary = Schema.Struct({
  kind: Schema.Literal("acquisition"),
  capture_policy_version: VersionIdentifier,
  authorization_epoch: NonNegativeInt,
  acquisition_generation: NonNegativeInt,
}).annotations({ identifier: "AcquisitionBoundary" });

/** Consumption of one producer-issued immutable snapshot. */
export const ExactSnapshotBoundary = Schema.Struct({
  kind: Schema.Literal("exact_snapshot"),
  snapshot_id: NonEmptyString,
}).annotations({ identifier: "ExactSnapshotBoundary" });

export const SnapshotEvidenceBoundary = Schema.Union(
  AcquisitionBoundary,
  ExactSnapshotBoundary,
).annotations({ identifier: "SnapshotEvidenceBoundary" });
export type SnapshotEvidenceBoundary = Schema.Schema.Type<
  typeof SnapshotEvidenceBoundary
>;

/* ------------------------------------------------------------------------ */
/* Per-capability work-key inputs                                            */
/* ------------------------------------------------------------------------ */

const GlobalKeyCommon = {
  schema_version: SchemaVersion,
  privacy_class: Schema.Literal("public_chain"),
  source_identity: NonEmptyString,
  readiness_policy_version: VersionIdentifier,
  adapter_version: VersionIdentifier,
};

const RestrictedKeyCommon = {
  schema_version: SchemaVersion,
  privacy_class: Schema.Literal("restricted_community"),
  source_identity: NonEmptyString,
  readiness_policy_version: VersionIdentifier,
  adapter_version: VersionIdentifier,
};

const collectionMaterialMatches =
  (capability: string) =>
  (input: { readonly collection: CollectionWorkKeyMaterial }): boolean | string =>
    `${input.collection.capability}.${input.collection.capability_version}` ===
      capability ||
    `embedded collection work-key material must declare capability ${capability}`;

/**
 * Global public capability keys reuse CR-001's `CollectionWorkKeyMaterial`
 * verbatim (capability, capability version, collection_id, sorted deployment
 * IDs, finality policies) rather than restating identity semantics.
 */
export const CollectionIdentityWorkKeyInput = Schema.Struct({
  ...GlobalKeyCommon,
  capability: Schema.Literal("collection_identity.v1"),
  scope_class: Schema.Literal("global_deployment_set"),
  collection: CollectionWorkKeyMaterial,
  evidence_boundary: ContinuousLatestBoundary,
}).pipe(Schema.filter(collectionMaterialMatches("collection_identity.v1"))).annotations({
  identifier: "CollectionIdentityWorkKeyInput",
});
export type CollectionIdentityWorkKeyInput = Schema.Schema.Type<
  typeof CollectionIdentityWorkKeyInput
>;

export const OwnershipIndexWorkKeyInput = Schema.Struct({
  ...GlobalKeyCommon,
  capability: Schema.Literal("ownership_index.v1"),
  scope_class: Schema.Literal("global_deployment_set"),
  collection: CollectionWorkKeyMaterial,
  evidence_boundary: ContinuousLatestBoundary,
}).pipe(Schema.filter(collectionMaterialMatches("ownership_index.v1"))).annotations({
  identifier: "OwnershipIndexWorkKeyInput",
});
export type OwnershipIndexWorkKeyInput = Schema.Schema.Type<
  typeof OwnershipIndexWorkKeyInput
>;

export const GateMappingWorkKeyInput = Schema.Struct({
  ...RestrictedKeyCommon,
  capability: Schema.Literal("gate_mapping.v1"),
  scope_class: Schema.Literal("community_guild"),
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, COLLECTION_DIGEST_DOMAINS.identity) ||
        "collection_id must use the collection.identity v1 digest domain",
    ),
  ),
  deployment_set_digest: DeploymentSetDigest,
  evidence_boundary: MappingVersionBoundary,
}).annotations({ identifier: "GateMappingWorkKeyInput" });
export type GateMappingWorkKeyInput = Schema.Schema.Type<typeof GateMappingWorkKeyInput>;

const MappingConfigDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_config) ||
      "mapping_config_digest must use the gate-leak.mapping-config v1 digest domain",
  ),
);

/**
 * SDD 6.3: Discord role snapshots include the community, guild, AND ratified
 * configuration identities in their scope digest. Both the acquisition demand
 * and the exact-snapshot consumption key bind the immutable ratified mapping
 * version and its configuration digest, so a snapshot captured under one
 * ratified configuration can never be joined by work for another.
 */
export const DiscordRoleSnapshotWorkKeyInput = Schema.Struct({
  ...RestrictedKeyCommon,
  capability: Schema.Literal("discord_role_snapshot.v1"),
  scope_class: Schema.Literal("community_guild"),
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  role_ids: RoleIdSet,
  mapping_version_id: MappingVersionId,
  mapping_config_digest: MappingConfigDigest,
  evidence_boundary: SnapshotEvidenceBoundary,
}).annotations({ identifier: "DiscordRoleSnapshotWorkKeyInput" });
export type DiscordRoleSnapshotWorkKeyInput = Schema.Schema.Type<
  typeof DiscordRoleSnapshotWorkKeyInput
>;

/** Server-derived cohort binding: digest, cardinality, rule + source lineage. */
export const SubjectCohortRef = Schema.Struct({
  schema_version: SchemaVersion,
  subject_set_digest: SubjectCohortDigest,
  cardinality: NonNegativeInt,
  inclusion_rule_version: VersionIdentifier,
  source_role_snapshot_id: NonEmptyString,
  limit_policy_version: VersionIdentifier,
}).annotations({ identifier: "SubjectCohortRef" });
export interface SubjectCohortRef extends Schema.Schema.Type<typeof SubjectCohortRef> {}

export const IdentityLinkSnapshotWorkKeyInput = Schema.Struct({
  ...RestrictedKeyCommon,
  capability: Schema.Literal("identity_link_snapshot.v1"),
  scope_class: Schema.Literal("community_subjects"),
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  consent_policy_version: VersionIdentifier,
  cohort: SubjectCohortRef,
  evidence_boundary: SnapshotEvidenceBoundary,
}).annotations({ identifier: "IdentityLinkSnapshotWorkKeyInput" });
export type IdentityLinkSnapshotWorkKeyInput = Schema.Schema.Type<
  typeof IdentityLinkSnapshotWorkKeyInput
>;

const OrderScopedResult = Schema.Struct({
  kind: Schema.Literal("order"),
  order_id: NonEmptyString,
});
const ResultCacheScoped = Schema.Struct({
  kind: Schema.Literal("result_cache"),
});

/** Order-scoped OR result-cacheable by exact input digest; an order ID is structurally absent from the cacheable form. */
export const ComputeResultScope = Schema.Union(
  OrderScopedResult,
  ResultCacheScoped,
).annotations({ identifier: "ComputeResultScope" });
export type ComputeResultScope = Schema.Schema.Type<typeof ComputeResultScope>;

export const GateLeakComputeWorkKeyInput = Schema.Struct({
  ...RestrictedKeyCommon,
  capability: Schema.Literal("gate_leak_compute.v1"),
  scope_class: Schema.Literal("order_result"),
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  result_scope: ComputeResultScope,
  compute_input_digest: ComputeInputDigest,
}).annotations({ identifier: "GateLeakComputeWorkKeyInput" });
export type GateLeakComputeWorkKeyInput = Schema.Schema.Type<
  typeof GateLeakComputeWorkKeyInput
>;

export const GateLeakWorkKeyInput = Schema.Union(
  CollectionIdentityWorkKeyInput,
  OwnershipIndexWorkKeyInput,
  GateMappingWorkKeyInput,
  DiscordRoleSnapshotWorkKeyInput,
  IdentityLinkSnapshotWorkKeyInput,
  GateLeakComputeWorkKeyInput,
).annotations({ identifier: "GateLeakWorkKeyInput" });
export type GateLeakWorkKeyInput = Schema.Schema.Type<typeof GateLeakWorkKeyInput>;

const strictOptions = { errors: "all", onExcessProperty: "error" } as const;

export const decodeGateLeakWorkKeyInput = Schema.decodeUnknown(
  GateLeakWorkKeyInput,
  strictOptions,
);
export const decodeSubjectCohortRef = Schema.decodeUnknown(
  SubjectCohortRef,
  strictOptions,
);

/**
 * Digest a canonical work-key input. The input is re-VALIDATED against the
 * strict schema first, so an in-process value that bypassed decoding (an
 * unsorted or duplicated role set, a smuggled excess property, a wrong-domain
 * digest) refuses instead of minting a fragmented or colliding key.
 */
export const digestGateLeakWorkKey = (
  input: GateLeakWorkKeyInput,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  Schema.validate(GateLeakWorkKeyInput, strictOptions)(input).pipe(
    Effect.flatMap((validated) =>
      digestVersioned(GATE_LEAK_DIGEST_DOMAINS.work_key, 1, validated),
    ),
  );
