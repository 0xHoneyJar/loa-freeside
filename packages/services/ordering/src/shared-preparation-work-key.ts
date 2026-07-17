import { createHash } from "node:crypto";
import {
  digestCollectionWorkKey,
  type CollectionWorkKeyMaterial,
  type CollectionCandidate,
} from "@freeside/collection-protocol";
import { Effect } from "effect";
import {
  PUBLIC_PREP_LIMITS,
  type PublicPreparationWorkKeyMaterial,
  type VersionedDigest,
  assertPublicPrepCapability,
} from "./shared-preparation-types.js";

function digestKey(digest: VersionedDigest): string {
  return `${digest.domain}:${digest.major_version}:${digest.digest}`;
}

function sortedDeploymentSetDigest(deploymentIds: readonly VersionedDigest[]): string {
  const keys = deploymentIds.map(digestKey).sort();
  return createHash("sha256").update(keys.join("\n")).digest("hex");
}

function runEffect<A>(effect: Effect.Effect<A, unknown>): A {
  return Effect.runSync(effect);
}

export function buildPublicWorkKeyMaterial(input: {
  capability: string;
  capability_version: string;
  collection_id: VersionedDigest;
  deployment_ids: readonly VersionedDigest[];
  finality_policies: CollectionCandidate["finality_policies"];
  source_identity: PublicPreparationWorkKeyMaterial["source_identity"];
  readiness_policy_version: string;
  adapter_version: string;
  evidence_boundary_kind?: PublicPreparationWorkKeyMaterial["evidence_boundary_kind"];
  evidence_boundary_digest?: string;
}): PublicPreparationWorkKeyMaterial {
  assertPublicPrepCapability(input.capability);
  if (input.deployment_ids.length === 0) {
    throw new Error("deployment_ids must be non-empty");
  }
  if (input.deployment_ids.length > PUBLIC_PREP_LIMITS.maxDeployments) {
    throw new Error(`deployment ceiling ${PUBLIC_PREP_LIMITS.maxDeployments} exceeded`);
  }

  const collectionWorkKey: CollectionWorkKeyMaterial = {
    schema_version: 1,
    capability: input.capability.replace(".v1", ""),
    capability_version: input.capability_version,
    collection_id: input.collection_id,
    deployment_ids: input.deployment_ids,
    finality_policies: input.finality_policies,
  };

  const collectionDigest = runEffect(digestCollectionWorkKey(collectionWorkKey));

  return {
    schema_version: 1,
    capability: input.capability,
    capability_version: input.capability_version,
    collection_id: input.collection_id,
    deployment_ids: input.deployment_ids,
    finality_policies: input.finality_policies,
    scope_class: "deployment",
    scope_digest: collectionDigest.digest,
    privacy_class: "public_chain",
    source_identity: input.source_identity,
    evidence_boundary_kind: input.evidence_boundary_kind ?? "continuous_latest",
    ...(input.evidence_boundary_digest !== undefined
      ? { evidence_boundary_digest: input.evidence_boundary_digest }
      : {}),
    readiness_policy_version: input.readiness_policy_version,
    adapter_version: input.adapter_version,
  };
}

export function digestPublicWorkKey(material: PublicPreparationWorkKeyMaterial): string {
  const canonical = {
    schema_version: material.schema_version,
    capability: material.capability,
    capability_version: material.capability_version,
    collection_id: material.collection_id,
    deployment_ids: material.deployment_ids,
    finality_policies: material.finality_policies,
    scope_class: material.scope_class,
    scope_digest: material.scope_digest,
    privacy_class: material.privacy_class,
    source_identity: material.source_identity,
    evidence_boundary_kind: material.evidence_boundary_kind,
    ...(material.evidence_boundary_digest !== undefined
      ? { evidence_boundary_digest: material.evidence_boundary_digest }
      : {}),
    readiness_policy_version: material.readiness_policy_version,
    adapter_version: material.adapter_version,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function deploymentSetDigest(deploymentIds: readonly VersionedDigest[]): string {
  return sortedDeploymentSetDigest(deploymentIds);
}

export function finalityPolicyVersion(
  finalityPolicies: PublicPreparationWorkKeyMaterial["finality_policies"],
): string {
  return finalityPolicies
    .map((policy) => `${policy.network.network_namespace}:${policy.network.network_reference}:${policy.finality_policy_version}`)
    .sort()
    .join("|");
}
