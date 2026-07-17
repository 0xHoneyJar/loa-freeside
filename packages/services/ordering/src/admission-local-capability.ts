import type {
  ConfirmedResolutionRecord,
  LocalCapabilitySnapshot,
} from "@freeside/collection-resolution-protocol";
import { digestsEqual } from "@freeside/collection-resolution-protocol";
import type { CollectionCandidate } from "@freeside/collection-protocol";

function findSelectedCandidate(
  record: ConfirmedResolutionRecord,
  selectedDeploymentIds: ConfirmedResolutionRecord["selected_deployment_ids"],
): CollectionCandidate | undefined {
  if (selectedDeploymentIds === undefined) return undefined;
  const selectedDigest = selectedDeploymentIds[0];
  if (selectedDigest === undefined) return undefined;
  return record.candidate_snapshot.candidates.find((candidate) =>
    candidate.identity.deployments.some((deployment) =>
      digestsEqual(deployment.deployment_id, selectedDigest),
    ),
  );
}

/**
 * Minimum local capability view synthesized from a confirmed resolution record.
 * Used at collection-report intake admission until live capability receipts land.
 */
export function buildLocalCapabilityFromRecord(
  record: ConfirmedResolutionRecord,
): LocalCapabilitySnapshot {
  const selected = record.selected_deployment_ids ?? [];
  const candidate = findSelectedCandidate(record, selected);
  const views: LocalCapabilitySnapshot["views"] = [];

  for (const deploymentId of selected) {
    const deployment = candidate?.identity.deployments.find((entry) =>
      digestsEqual(entry.deployment_id, deploymentId),
    );
    if (deployment === undefined || candidate === undefined) continue;
    views.push({
      schema_version: 1,
      deployment_id: deployment.deployment_id,
      network_namespace: deployment.network.network_namespace,
      network_reference: deployment.network.network_reference,
      normalized_address: deployment.normalized_address,
      operation: "prepare",
      health: "available",
      supported_standards: [candidate.token_standard.value],
      finality_policy_version: candidate.finality_policies[0]!.finality_policy_version,
      equivalence_revoked: false,
      authorization_valid: true,
      identity_digest: deployment.deployment_id,
    });
  }

  return {
    schema_version: 1,
    registry_version: record.capability_snapshot_version,
    receipt_age_ms: 1_000,
    staleness_ceiling_ms: 60_000,
    views,
  };
}
