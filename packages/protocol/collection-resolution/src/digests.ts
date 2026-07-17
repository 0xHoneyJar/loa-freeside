import { Effect, ParseResult } from "effect";
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

const compareKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const candidateKey = (candidate: CandidateSnapshot["candidates"][number]): string =>
  [
    candidate.identity.collection_id.algorithm,
    candidate.identity.collection_id.domain,
    String(candidate.identity.collection_id.major_version),
    candidate.identity.collection_id.digest,
  ].join(":");

const networkProbeKey = (
  probe: CandidateSnapshot["diagnostics"]["searched"][number],
): string => `${probe.network_namespace}:${probe.network_reference}`;

/**
 * Candidate snapshots carry mathematical sets over the wire. Normalize their
 * presentation order before hashing so probe scheduling and ranking order do
 * not create false identity or freshness drift. Caller-owned arrays are never
 * mutated.
 */
export const canonicalCandidateSnapshotMaterial = (
  snapshot: CandidateSnapshot,
): CandidateSnapshot => ({
  ...snapshot,
  candidates: [...snapshot.candidates].sort((left, right) =>
    compareKeys(candidateKey(left), candidateKey(right)),
  ),
  diagnostics: {
    ...snapshot.diagnostics,
    searched: [...snapshot.diagnostics.searched].sort((left, right) =>
      compareKeys(networkProbeKey(left), networkProbeKey(right)),
    ),
    timed_out: [...snapshot.diagnostics.timed_out].sort((left, right) =>
      compareKeys(networkProbeKey(left), networkProbeKey(right)),
    ),
    unavailable: [...snapshot.diagnostics.unavailable].sort((left, right) =>
      compareKeys(networkProbeKey(left), networkProbeKey(right)),
    ),
  },
});

export const digestResolutionRequest = (
  command: ResolutionCreateCommand,
  scope: AuthorizationScope,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
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
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  digestVersioned(
    RESOLUTION_DIGEST_DOMAINS.candidate_snapshot,
    1,
    canonicalCandidateSnapshotMaterial(snapshot),
  );

export const digestSelection = (
  selectedDeploymentIds: ReadonlyArray<VersionedDigest>,
  selectedCollectionId: VersionedDigest | undefined,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
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
