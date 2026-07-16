import { Effect } from "effect";
import type {
  CanonicalEncodingError,
  DigestComputationError,
  VersionedDigest,
} from "@freeside/collection-protocol";
import { digestVersioned } from "@freeside/collection-protocol";
import type {
  AuthorizationScope,
  CandidateSnapshot,
  ResolutionCreateCommand,
} from "./contracts.js";
import { RESOLUTION_DIGEST_DOMAINS } from "./version.js";

export const digestResolutionRequest = (
  command: ResolutionCreateCommand,
  scope: AuthorizationScope,
): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(RESOLUTION_DIGEST_DOMAINS.request, 1, {
    identifier: command.identifier,
    environment: command.environment,
    report_type: command.report_type,
    report_version: command.report_version,
    community_ref: command.community_ref ?? null,
    subject_id: scope.subject_id,
    permission: scope.permission,
  });

export const digestCandidateSnapshot = (
  snapshot: CandidateSnapshot,
): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(RESOLUTION_DIGEST_DOMAINS.candidate_snapshot, 1, snapshot);

export const digestSelection = (
  selectedDeploymentIds: ReadonlyArray<VersionedDigest>,
  selectedCollectionId: VersionedDigest | undefined,
): Effect.Effect<VersionedDigest, CanonicalEncodingError | DigestComputationError> =>
  digestVersioned(RESOLUTION_DIGEST_DOMAINS.selection, 1, {
    selected_deployment_ids: selectedDeploymentIds,
    selected_collection_id: selectedCollectionId ?? null,
  });

export const digestAdmissionDecision = (material: unknown) =>
  digestVersioned(RESOLUTION_DIGEST_DOMAINS.admission_decision, 1, material);

export const digestsEqual = (
  left: VersionedDigest,
  right: VersionedDigest,
): boolean =>
  left.algorithm === right.algorithm &&
  left.domain === right.domain &&
  left.major_version === right.major_version &&
  left.digest === right.digest;
