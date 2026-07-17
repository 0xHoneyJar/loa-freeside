import { digestVersioned } from "@freeside/collection-protocol";
import { RESOLUTION_DIGEST_DOMAINS } from "./version.js";
const compareKeys = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const candidateKey = (candidate) => [
    candidate.identity.collection_id.algorithm,
    candidate.identity.collection_id.domain,
    String(candidate.identity.collection_id.major_version),
    candidate.identity.collection_id.digest,
].join(":");
const networkProbeKey = (probe) => `${probe.network_namespace}:${probe.network_reference}`;
/**
 * Candidate snapshots carry mathematical sets over the wire. Normalize their
 * presentation order before hashing so probe scheduling and ranking order do
 * not create false identity or freshness drift. Caller-owned arrays are never
 * mutated.
 */
export const canonicalCandidateSnapshotMaterial = (snapshot) => ({
    ...snapshot,
    candidates: [...snapshot.candidates].sort((left, right) => compareKeys(candidateKey(left), candidateKey(right))),
    diagnostics: {
        ...snapshot.diagnostics,
        searched: [...snapshot.diagnostics.searched].sort((left, right) => compareKeys(networkProbeKey(left), networkProbeKey(right))),
        timed_out: [...snapshot.diagnostics.timed_out].sort((left, right) => compareKeys(networkProbeKey(left), networkProbeKey(right))),
        unavailable: [...snapshot.diagnostics.unavailable].sort((left, right) => compareKeys(networkProbeKey(left), networkProbeKey(right))),
    },
});
export const digestResolutionRequest = (command, scope) => digestVersioned(RESOLUTION_DIGEST_DOMAINS.request, 1, {
    identifier: command.identifier,
    environment: command.environment,
    report_type: command.report_type,
    report_version: command.report_version,
    community_ref: command.community_ref ?? null,
    subject_id: scope.subject_id,
    permission: scope.permission,
});
export const digestCandidateSnapshot = (snapshot) => digestVersioned(RESOLUTION_DIGEST_DOMAINS.candidate_snapshot, 1, canonicalCandidateSnapshotMaterial(snapshot));
export const digestSelection = (selectedDeploymentIds, selectedCollectionId) => digestVersioned(RESOLUTION_DIGEST_DOMAINS.selection, 1, {
    selected_deployment_ids: selectedDeploymentIds,
    selected_collection_id: selectedCollectionId ?? null,
});
export const digestAdmissionDecision = (material) => digestVersioned(RESOLUTION_DIGEST_DOMAINS.admission_decision, 1, material);
export const digestsEqual = (left, right) => left.algorithm === right.algorithm &&
    left.domain === right.domain &&
    left.major_version === right.major_version &&
    left.digest === right.digest;
