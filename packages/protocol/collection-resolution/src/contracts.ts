import { Effect, Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import {
  CapabilityRegistryVersion,
  CollectionCandidate,
  DuplicateCanonicalSetMemberError,
  VersionedDigest,
  decodeCapabilityRegistryVersion,
  decodeCollectionCandidate,
  sortCanonicalSet,
} from "@freeside/collection-protocol";
import {
  COLLECTION_RESOLUTION_SCHEMA_VERSION,
  RESOLUTION_TTL_MS,
} from "./version.js";
import { ContractIntegrityError } from "./errors.js";

const SchemaVersion = Schema.Literal(COLLECTION_RESOLUTION_SCHEMA_VERSION);
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/),
).annotations({ identifier: "IsoTimestamp" });
const IdempotencyKey = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "IdempotencyKey",
});
const ResolutionId = NonEmptyString.pipe(Schema.maxLength(128)).annotations({
  identifier: "ResolutionId",
});
const SubjectId = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "SubjectId",
});
const CommunityRef = NonEmptyString.pipe(Schema.maxLength(256)).annotations({
  identifier: "CommunityRef",
});

const strictOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const digestKey = (value: VersionedDigest): string =>
  `${value.domain}:${value.major_version}:${value.digest}`;

const keyCompare = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const isStrictlySortedUnique = <Value>(
  values: ReadonlyArray<Value>,
  key: (value: Value) => string,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    if (keyCompare(key(previous), key(current)) >= 0) return false;
  }
  return true;
};

export const AuthorizationScope = Schema.Struct({
  schema_version: SchemaVersion,
  subject_id: SubjectId,
  community_ref: Schema.optionalWith(CommunityRef, { exact: true }),
  permission: Schema.Literal("report:create"),
}).annotations({ identifier: "AuthorizationScope" });
export type AuthorizationScope = Schema.Schema.Type<typeof AuthorizationScope>;

export const ResolutionEnvironment = Schema.Literal("mainnet").annotations({
  identifier: "ResolutionEnvironment",
});
export type ResolutionEnvironment = Schema.Schema.Type<typeof ResolutionEnvironment>;

export const ResolutionCreateCommand = Schema.Struct({
  schema_version: SchemaVersion,
  identifier: NonEmptyString,
  environment: ResolutionEnvironment,
  report_type: NonEmptyString,
  report_version: NonEmptyString,
  community_ref: Schema.optionalWith(CommunityRef, { exact: true }),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ResolutionCreateCommand" });
export type ResolutionCreateCommand = Schema.Schema.Type<typeof ResolutionCreateCommand>;

/**
 * Immutable original create-request material persisted for re-probe.
 * Excludes the create idempotency key — that is create-session scoped only.
 * Refresh always rebinds to this material; a supplied request must match it
 * byte-for-byte/canonically.
 */
export const ResolutionRequestMaterial = Schema.Struct({
  schema_version: SchemaVersion,
  identifier: NonEmptyString,
  environment: ResolutionEnvironment,
  report_type: NonEmptyString,
  report_version: NonEmptyString,
  community_ref: Schema.optionalWith(CommunityRef, { exact: true }),
}).annotations({ identifier: "ResolutionRequestMaterial" });
export type ResolutionRequestMaterial = Schema.Schema.Type<typeof ResolutionRequestMaterial>;

const NetworkProbeRef = Schema.Struct({
  schema_version: SchemaVersion,
  network_namespace: Schema.Literal("eip155", "solana"),
  network_reference: NonEmptyString,
}).annotations({ identifier: "NetworkProbeRef" });

export const ResolutionDiagnostics = Schema.Struct({
  schema_version: SchemaVersion,
  searched: Schema.Array(NetworkProbeRef),
  timed_out: Schema.Array(NetworkProbeRef),
  unavailable: Schema.Array(NetworkProbeRef),
}).annotations({ identifier: "ResolutionDiagnostics" });
export type ResolutionDiagnostics = Schema.Schema.Type<typeof ResolutionDiagnostics>;

const DeploymentIdSet = Schema.Array(VersionedDigest).pipe(
  Schema.filter((items) => items.length > 0 || "selected_deployment_ids must be non-empty"),
  Schema.filter(
    (items) =>
      isStrictlySortedUnique(items, digestKey) ||
      "selected_deployment_ids are a sorted set keyed by versioned digest",
  ),
);

export const ResolutionConfirmCommand = Schema.Struct({
  schema_version: SchemaVersion,
  candidate_snapshot_digest: VersionedDigest,
  selected_deployment_ids: DeploymentIdSet,
  expected_confirmation_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ResolutionConfirmCommand" });
export type ResolutionConfirmCommand = Schema.Schema.Type<typeof ResolutionConfirmCommand>;

export const ResolutionRefreshCommand = Schema.Struct({
  schema_version: SchemaVersion,
  expected_confirmation_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ResolutionRefreshCommand" });
export type ResolutionRefreshCommand = Schema.Schema.Type<typeof ResolutionRefreshCommand>;

/**
 * Order admission binding. Raw candidate metadata is intentionally absent —
 * clients may not graft deployments, digests, or display fields onto order truth.
 */
export const OrderResolutionBinding = Schema.Struct({
  schema_version: SchemaVersion,
  resolution_id: ResolutionId,
  candidate_snapshot_digest: VersionedDigest,
  community_ref: Schema.optionalWith(CommunityRef, { exact: true }),
}).annotations({ identifier: "OrderResolutionBinding" });
export type OrderResolutionBinding = Schema.Schema.Type<typeof OrderResolutionBinding>;

export const CandidateSnapshot = Schema.Struct({
  schema_version: SchemaVersion,
  candidates: Schema.Array(CollectionCandidate),
  diagnostics: ResolutionDiagnostics,
}).annotations({ identifier: "CandidateSnapshot" });
export type CandidateSnapshot = Schema.Schema.Type<typeof CandidateSnapshot>;

export const ConfirmedResolutionRecord = Schema.Struct({
  schema_version: SchemaVersion,
  resolution_id: ResolutionId,
  requester_subject: SubjectId,
  authorization_scope: AuthorizationScope,
  /**
   * Complete strict canonical create-request material required to re-probe.
   * Bound mutually with request_digest, authorization_scope, and capability
   * requirements — refresh cannot retarget a different collection identity.
   */
  original_request: ResolutionRequestMaterial,
  request_digest: VersionedDigest,
  capability_snapshot_version: CapabilityRegistryVersion,
  candidate_snapshot: CandidateSnapshot,
  candidate_snapshot_digest: VersionedDigest,
  selected_deployment_ids: Schema.optionalWith(DeploymentIdSet, { exact: true }),
  selected_collection_id: Schema.optionalWith(VersionedDigest, { exact: true }),
  confirmation_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  confirmed_at: Schema.optionalWith(IsoTimestamp, { exact: true }),
  expires_at: IsoTimestamp,
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
}).annotations({ identifier: "ConfirmedResolutionRecord" });
export type ConfirmedResolutionRecord = Schema.Schema.Type<typeof ConfirmedResolutionRecord>;

export const ResolutionPublicProjection = Schema.Struct({
  schema_version: SchemaVersion,
  resolution_id: ResolutionId,
  candidate_snapshot_digest: VersionedDigest,
  capability_snapshot_version: CapabilityRegistryVersion,
  candidates: Schema.Array(CollectionCandidate),
  diagnostics: ResolutionDiagnostics,
  confirmation_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  selected_deployment_ids: Schema.optionalWith(DeploymentIdSet, { exact: true }),
  selected_collection_id: Schema.optionalWith(VersionedDigest, { exact: true }),
  confirmed_at: Schema.optionalWith(IsoTimestamp, { exact: true }),
  expires_at: IsoTimestamp,
  selection_stale: Schema.optionalWith(Schema.Literal(true), { exact: true }),
}).annotations({ identifier: "ResolutionPublicProjection" });
export type ResolutionPublicProjection = Schema.Schema.Type<
  typeof ResolutionPublicProjection
>;

export const CapabilityHealthState = Schema.Literal(
  "available",
  "degraded",
  "disabled",
).annotations({ identifier: "CapabilityHealthState" });
export type CapabilityHealthState = Schema.Schema.Type<typeof CapabilityHealthState>;

export const CapabilityOperation = Schema.Literal(
  "recognize",
  "prepare",
  "read_evidence",
).annotations({ identifier: "CapabilityOperation" });
export type CapabilityOperation = Schema.Schema.Type<typeof CapabilityOperation>;

/**
 * Exact local capability view consulted at admission. Every field participates
 * in compatibility; UI omission never authorizes ignoring a field.
 * Views are a strict unique set keyed by (deployment_id, operation).
 */
export const LocalCapabilityDeploymentView = Schema.Struct({
  schema_version: SchemaVersion,
  deployment_id: VersionedDigest,
  network_namespace: Schema.Literal("eip155", "solana"),
  network_reference: NonEmptyString,
  normalized_address: NonEmptyString,
  operation: CapabilityOperation,
  health: CapabilityHealthState,
  supported_standards: Schema.Array(NonEmptyString),
  finality_policy_version: NonEmptyString,
  equivalence_revoked: Schema.Boolean,
  authorization_valid: Schema.Boolean,
  identity_digest: VersionedDigest,
}).annotations({ identifier: "LocalCapabilityDeploymentView" });
export type LocalCapabilityDeploymentView = Schema.Schema.Type<
  typeof LocalCapabilityDeploymentView
>;

const capabilityViewCanonicalKey = (view: LocalCapabilityDeploymentView) => ({
  deployment_id: view.deployment_id,
  operation: view.operation,
});

export const capabilityViewSetKey = (view: LocalCapabilityDeploymentView): string =>
  `${digestKey(view.deployment_id)}:${view.operation}`;

export const LocalCapabilitySnapshot = Schema.Struct({
  schema_version: SchemaVersion,
  registry_version: CapabilityRegistryVersion,
  views: Schema.Array(LocalCapabilityDeploymentView),
  receipt_age_ms: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  staleness_ceiling_ms: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
}).annotations({ identifier: "LocalCapabilitySnapshot" });
export type LocalCapabilitySnapshot = Schema.Schema.Type<typeof LocalCapabilitySnapshot>;

export const AdmissionDecision = Schema.Struct({
  schema_version: SchemaVersion,
  resolution_id: ResolutionId,
  candidate_snapshot_digest: VersionedDigest,
  selected_deployment_ids: DeploymentIdSet,
  selected_collection_id: Schema.optionalWith(VersionedDigest, { exact: true }),
  admitted_registry_version: CapabilityRegistryVersion,
  compatibility_digest: VersionedDigest,
  decision: Schema.Literal("admit", "selection_stale", "capability_view_stale", "refuse"),
}).annotations({ identifier: "AdmissionDecision" });
export type AdmissionDecision = Schema.Schema.Type<typeof AdmissionDecision>;

const decodeCreateStruct = Schema.decodeUnknown(ResolutionCreateCommand, strictOptions);
const decodeConfirmStruct = Schema.decodeUnknown(ResolutionConfirmCommand, strictOptions);
const decodeRefreshStruct = Schema.decodeUnknown(ResolutionRefreshCommand, strictOptions);
const decodeRequestMaterialStruct = Schema.decodeUnknown(ResolutionRequestMaterial, strictOptions);
const decodeOrderBindingStruct = Schema.decodeUnknown(OrderResolutionBinding, strictOptions);
const decodeCandidateSnapshotStruct = Schema.decodeUnknown(CandidateSnapshot, strictOptions);
const decodeRecordStruct = Schema.decodeUnknown(ConfirmedResolutionRecord, strictOptions);
const decodeProjectionStruct = Schema.decodeUnknown(ResolutionPublicProjection, strictOptions);
const decodeLocalCapabilityStruct = Schema.decodeUnknown(LocalCapabilitySnapshot, strictOptions);
const decodeAdmissionDecisionStruct = Schema.decodeUnknown(AdmissionDecision, strictOptions);
const decodeAuthorizationScopeStruct = Schema.decodeUnknown(AuthorizationScope, strictOptions);

export const decodeResolutionCreateCommand = decodeCreateStruct;
export const decodeResolutionConfirmCommand = decodeConfirmStruct;
export const decodeResolutionRefreshCommand = decodeRefreshStruct;
export const decodeResolutionRequestMaterial = decodeRequestMaterialStruct;
export const decodeOrderResolutionBinding = decodeOrderBindingStruct;

/**
 * CollectionCandidate's schema pins shape; its decoder additionally verifies
 * deployment_id and collection_id against their canonical digest material.
 * Every candidate-bearing boundary composes that one owning decoder.
 */
const decodeCandidateList = (candidates: ReadonlyArray<CollectionCandidate>) =>
  Effect.forEach(candidates, decodeCollectionCandidate);

export const decodeCandidateSnapshot = (input: unknown) =>
  decodeCandidateSnapshotStruct(input).pipe(
    Effect.flatMap((snapshot) =>
      decodeCandidateList(snapshot.candidates).pipe(
        Effect.map((candidates) => ({ ...snapshot, candidates })),
      ),
    ),
  );
export const decodeConfirmedResolutionRecord = (input: unknown) =>
  decodeRecordStruct(input).pipe(
    Effect.flatMap((record) =>
      decodeCandidateSnapshot(record.candidate_snapshot).pipe(
        Effect.map((candidateSnapshot) => ({
          ...record,
          candidate_snapshot: candidateSnapshot,
        })),
      ),
    ),
  );
export const decodeResolutionPublicProjection = (input: unknown) =>
  decodeProjectionStruct(input).pipe(
    Effect.flatMap((projection) =>
      decodeCandidateList(projection.candidates).pipe(
        Effect.map((candidates) => ({ ...projection, candidates })),
      ),
    ),
  );
/**
 * Strict-decode a local capability snapshot and canonicalize `views` as a
 * unique sorted set keyed by (deployment_id, operation). Identical duplicates
 * and contradictory duplicates both fail closed — never first-match.
 */
export const decodeLocalCapabilitySnapshot = (input: unknown) =>
  decodeLocalCapabilityStruct(input).pipe(
    Effect.flatMap((snapshot) =>
      sortCanonicalSet(
        snapshot.views.map((view) => ({
          canonical_key: capabilityViewCanonicalKey(view),
          value: view,
        })),
      ).pipe(
        Effect.mapError((error) => {
          if (error instanceof DuplicateCanonicalSetMemberError) {
            return new ContractIntegrityError({
              contract: "LocalCapabilitySnapshot",
              reason: `capability views must be unique by (deployment_id, operation); duplicate key ${error.canonical_key}`,
            });
          }
          return new ContractIntegrityError({
            contract: "LocalCapabilitySnapshot",
            reason: `capability view canonicalization failed: ${error.reason}`,
          });
        }),
        Effect.map((views) => ({
          ...snapshot,
          views,
        })),
      ),
    ),
  );
export const decodeAdmissionDecision = decodeAdmissionDecisionStruct;
export const decodeAuthorizationScope = decodeAuthorizationScopeStruct;

export const toPublicProjection = (
  record: ConfirmedResolutionRecord,
  options?: { readonly selection_stale?: true },
): ResolutionPublicProjection => ({
  schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
  resolution_id: record.resolution_id,
  candidate_snapshot_digest: record.candidate_snapshot_digest,
  capability_snapshot_version: record.capability_snapshot_version,
  candidates: record.candidate_snapshot.candidates,
  diagnostics: record.candidate_snapshot.diagnostics,
  confirmation_version: record.confirmation_version,
  expires_at: record.expires_at,
  ...(record.selected_deployment_ids !== undefined
    ? { selected_deployment_ids: record.selected_deployment_ids }
    : {}),
  ...(record.selected_collection_id !== undefined
    ? { selected_collection_id: record.selected_collection_id }
    : {}),
  ...(record.confirmed_at !== undefined ? { confirmed_at: record.confirmed_at } : {}),
  ...(options?.selection_stale === true ? { selection_stale: true as const } : {}),
});

export const expiresAtFrom = (nowMs: number, ttlMs: number = RESOLUTION_TTL_MS): string =>
  new Date(nowMs + ttlMs).toISOString();

export const assertNoRawCandidateOrderFields = (
  input: Readonly<Record<string, unknown>>,
): Effect.Effect<void, ContractIntegrityError> => {
  const forbidden = [
    "candidates",
    "candidate_snapshot",
    "selected_deployment_ids",
    "deployments",
    "identity",
    "token_standard",
    "provenance",
  ] as const;
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return Effect.fail(
        new ContractIntegrityError({
          contract: "OrderResolutionBinding",
          reason: `raw client field '${key}' is never order truth`,
        }),
      );
    }
  }
  return Effect.succeed(undefined);
};

export const scopesMatch = (
  left: AuthorizationScope,
  right: AuthorizationScope,
): boolean =>
  left.subject_id === right.subject_id &&
  left.community_ref === right.community_ref &&
  left.permission === right.permission;

export const requestMaterialFromCreate = (
  command: ResolutionCreateCommand,
): ResolutionRequestMaterial => ({
  schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
  identifier: command.identifier,
  environment: command.environment,
  report_type: command.report_type,
  report_version: command.report_version,
  ...(command.community_ref !== undefined ? { community_ref: command.community_ref } : {}),
});

export const requestMaterialsEqual = (
  left: ResolutionRequestMaterial,
  right: ResolutionRequestMaterial,
): boolean =>
  left.schema_version === right.schema_version &&
  left.identifier === right.identifier &&
  left.environment === right.environment &&
  left.report_type === right.report_type &&
  left.report_version === right.report_version &&
  left.community_ref === right.community_ref;

export { digestKey, isStrictlySortedUnique, decodeCapabilityRegistryVersion };
