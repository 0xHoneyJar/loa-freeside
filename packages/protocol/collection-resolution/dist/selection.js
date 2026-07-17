import { Effect } from "effect";
import { digestKey } from "./contracts.js";
import { SelectionRejectedError } from "./errors.js";
const MAX_SELECTED_DEPLOYMENTS = 32;
const deploymentIdOf = (deployment) => digestKey(deployment.deployment_id);
/**
 * A valid selection is exactly one candidate deployment, or a non-empty subset
 * of one explicitly evidenced logical-equivalence group. Cross-candidate
 * composition, address-only identity, and alias guessing are refused.
 */
export const validateSelection = (snapshot, selectedDeploymentIds) => {
    if (selectedDeploymentIds.length === 0) {
        return Effect.fail(new SelectionRejectedError({
            reason: "empty_selection",
            detail: "selection requires at least one deployment id",
        }));
    }
    if (selectedDeploymentIds.length > MAX_SELECTED_DEPLOYMENTS) {
        return Effect.fail(new SelectionRejectedError({
            reason: "ceiling_exceeded",
            detail: `selection exceeds server deployment ceiling of ${MAX_SELECTED_DEPLOYMENTS}`,
        }));
    }
    const selectedKeys = selectedDeploymentIds.map(digestKey);
    const uniqueKeys = new Set(selectedKeys);
    if (uniqueKeys.size !== selectedKeys.length) {
        return Effect.fail(new SelectionRejectedError({
            reason: "cross_candidate_composition",
            detail: "selected deployment ids must be unique",
        }));
    }
    const candidateMatches = [];
    for (let index = 0; index < snapshot.candidates.length; index += 1) {
        const candidate = snapshot.candidates[index];
        if (candidate === undefined)
            continue;
        const deploymentMap = new Map(candidate.identity.deployments.map((deployment) => [
            deploymentIdOf(deployment),
            deployment.deployment_id,
        ]));
        const matchedIds = [];
        for (const key of selectedKeys) {
            const deploymentId = deploymentMap.get(key);
            if (deploymentId !== undefined)
                matchedIds.push(deploymentId);
        }
        if (matchedIds.length > 0) {
            candidateMatches.push({ index, candidate, matchedIds });
        }
    }
    if (candidateMatches.length === 0) {
        return Effect.fail(new SelectionRejectedError({
            reason: "unknown_deployment",
            detail: "every selected deployment id must occur in the persisted candidate snapshot",
        }));
    }
    if (candidateMatches.length > 1) {
        return Effect.fail(new SelectionRejectedError({
            reason: "cross_candidate_composition",
            detail: "selected deployments span unrelated candidates",
        }));
    }
    const match = candidateMatches[0];
    if (match === undefined) {
        return Effect.fail(new SelectionRejectedError({
            reason: "unknown_deployment",
            detail: "selection could not be bound to a candidate",
        }));
    }
    if (match.matchedIds.length !== selectedKeys.length) {
        return Effect.fail(new SelectionRejectedError({
            reason: "unknown_deployment",
            detail: "one or more selected deployment ids are absent from the matched candidate",
        }));
    }
    const basis = match.candidate.identity.equivalence_basis;
    if (basis.kind === "single_deployment") {
        if (match.matchedIds.length !== 1) {
            return Effect.fail(new SelectionRejectedError({
                reason: "mixed_equivalence_groups",
                detail: "single_deployment candidates accept exactly one selected deployment",
            }));
        }
    }
    else {
        // Multi-deployment groups require an explicit assertion digest; metadata
        // similarity / alias guessing cannot authorize composition.
        if (!("assertion_digest" in basis)) {
            return Effect.fail(new SelectionRejectedError({
                reason: "alias_guessing",
                detail: "logical group selection requires explicit equivalence evidence",
            }));
        }
    }
    const sorted = [...match.matchedIds].sort((left, right) => {
        const leftKey = digestKey(left);
        const rightKey = digestKey(right);
        if (leftKey < rightKey)
            return -1;
        if (leftKey > rightKey)
            return 1;
        return 0;
    });
    return Effect.succeed({
        selected_deployment_ids: sorted,
        selected_collection_id: match.candidate.identity.collection_id,
        candidate_index: match.index,
    });
};
/** Refuse address-only or client-invented identity material at the selection boundary. */
export const rejectAddressOnlyIdentity = (input) => {
    if (Object.prototype.hasOwnProperty.call(input, "address") &&
        !Object.prototype.hasOwnProperty.call(input, "selected_deployment_ids")) {
        return Effect.fail(new SelectionRejectedError({
            reason: "address_only_identity",
            detail: "address-only identity is refused; select versioned deployment ids",
        }));
    }
    if (Object.prototype.hasOwnProperty.call(input, "alias")) {
        return Effect.fail(new SelectionRejectedError({
            reason: "alias_guessing",
            detail: "alias guessing cannot authorize selection",
        }));
    }
    return Effect.succeed(undefined);
};
