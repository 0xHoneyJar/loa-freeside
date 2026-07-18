import { Effect } from "effect";
import { digestVersioned } from "@freeside/collection-protocol";
import { scopesMatch } from "./contracts.js";
import { canonicalCandidateSnapshotMaterial, digestsEqual } from "./digests.js";
import { SelectionStaleError } from "./errors.js";
import { RESOLUTION_DIGEST_DOMAINS } from "./version.js";
/**
 * Narrow allowlist of truly display-only fields. Everything else on a persisted
 * candidate participates in selection-relevant freshness — UI omission never
 * authorizes ignoring recognition, readiness, identity, or capability semantics.
 * Name, symbol, and image are presentation metadata rather than collection
 * identity: selection is bound to canonical collection/deployment digests, so
 * presentation refreshes do not silently substitute a different collection.
 */
export const DISPLAY_ONLY_CANDIDATE_FIELDS = Object.freeze([
    "ranking_reasons",
    "identity.name",
    "identity.symbol",
    "identity.image",
]);
/**
 * Selection-relevant projection: the complete candidate snapshot minus the
 * explicit display-only allowlist. Prefer the already-canonical complete
 * candidate semantics over a hand-picked subset.
 */
export const selectionRelevantMaterial = (snapshot) => ({
    candidates: canonicalCandidateSnapshotMaterial(snapshot).candidates.map((candidate) => selectionRelevantCandidate(candidate)),
});
const selectionRelevantCandidate = (candidate) => {
    const { ranking_reasons: _rankingReasons, identity, ...rest } = candidate;
    const { name: _name, symbol: _symbol, image: _image, ...identityRest } = identity;
    return {
        ...rest,
        identity: identityRest,
    };
};
export const digestSelectionRelevant = (snapshot) => digestVersioned(RESOLUTION_DIGEST_DOMAINS.selection_relevant, 1, selectionRelevantMaterial(snapshot));
const classifyStaleReason = (previous, current) => {
    const previousFlat = flattenCandidates(previous);
    const currentFlat = flattenCandidates(current);
    if (previousFlat.recognition !== currentFlat.recognition)
        return "recognition_changed";
    if (previousFlat.index_status !== currentFlat.index_status)
        return "index_status_changed";
    if (previousFlat.report_readiness !== currentFlat.report_readiness) {
        return "report_readiness_changed";
    }
    if (previousFlat.metadata_quality !== currentFlat.metadata_quality) {
        return "metadata_quality_changed";
    }
    if (previousFlat.ids !== currentFlat.ids)
        return "deployment_changed";
    if (previousFlat.networks !== currentFlat.networks)
        return "network_changed";
    if (previousFlat.groups !== currentFlat.groups)
        return "grouping_changed";
    if (previousFlat.standards !== currentFlat.standards)
        return "standard_changed";
    if (previousFlat.provenance !== currentFlat.provenance)
        return "provenance_changed";
    if (previousFlat.finality !== currentFlat.finality)
        return "finality_policy_changed";
    if (previousFlat.collection_keys !== currentFlat.collection_keys)
        return "identity_drift";
    return "deployment_changed";
};
const flattenCandidates = (snapshot) => {
    const ids = [];
    const networks = [];
    const groups = [];
    const standards = [];
    const provenance = [];
    const recognition = [];
    const indexStatus = [];
    const reportReadiness = [];
    const metadataQuality = [];
    const finality = [];
    const collectionKeys = [];
    for (const candidate of snapshot.candidates) {
        recognition.push(candidate.recognition);
        indexStatus.push(candidate.index_status);
        reportReadiness.push(candidate.report_readiness);
        metadataQuality.push(candidate.metadata_quality);
        groups.push(`${candidate.identity.collection_id.digest}:${JSON.stringify(candidate.identity.equivalence_basis)}`);
        collectionKeys.push(`${candidate.identity.collection_id.digest}:${candidate.identity.collection_key ?? ""}`);
        standards.push(candidate.token_standard.value);
        for (const deployment of candidate.identity.deployments) {
            ids.push(deployment.deployment_id.digest);
            networks.push(`${deployment.network.network_namespace}:${deployment.network.network_reference}:${deployment.normalized_address}`);
        }
        for (const entry of candidate.provenance) {
            provenance.push(`${entry.source}:${entry.evidence_digest.digest}:${entry.source_reference ?? ""}:${entry.observed_at}`);
        }
        for (const policy of candidate.finality_policies) {
            finality.push(`${policy.network.network_namespace}:${policy.network.network_reference}:${policy.finality_policy_version}`);
        }
    }
    return {
        ids: [...ids].sort().join("|"),
        networks: [...networks].sort().join("|"),
        groups: [...groups].sort().join("|"),
        standards: [...standards].sort().join("|"),
        provenance: [...provenance].sort().join("|"),
        recognition: [...recognition].sort().join("|"),
        index_status: [...indexStatus].sort().join("|"),
        report_readiness: [...reportReadiness].sort().join("|"),
        metadata_quality: [...metadataQuality].sort().join("|"),
        finality: [...finality].sort().join("|"),
        collection_keys: [...collectionKeys].sort().join("|"),
    };
};
export const compareCandidateFreshness = (previous, previousDigest, current, currentDigest) => Effect.all([digestSelectionRelevant(previous), digestSelectionRelevant(current)]).pipe(Effect.map(([previousRelevant, currentRelevant]) => {
    const byteEquivalent = digestsEqual(previousDigest, currentDigest);
    const selectionRelevantEqual = digestsEqual(previousRelevant, currentRelevant);
    return {
        byte_equivalent: byteEquivalent,
        selection_relevant_equal: selectionRelevantEqual,
        previous_digest: previousDigest,
        current_digest: currentDigest,
        previous_relevant_digest: previousRelevant,
        current_relevant_digest: currentRelevant,
        stale_reason: selectionRelevantEqual
            ? null
            : classifyStaleReason(previous, current),
    };
}));
export const assertScopeUnchanged = (previous, current, resolutionId, previousDigest, currentDigest) => {
    if (scopesMatch(previous, current))
        return Effect.succeed(undefined);
    return Effect.fail(new SelectionStaleError({
        resolution_id: resolutionId,
        reason: previous.subject_id !== current.subject_id ? "authorization_changed" : "scope_changed",
        previous_candidate_snapshot_digest: previousDigest,
        current_candidate_snapshot_digest: currentDigest,
    }));
};
