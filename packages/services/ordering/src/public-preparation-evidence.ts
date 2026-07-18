import { createHash } from "node:crypto";

import type {
  ReadinessEvidenceEnvelope,
  SharedPreparationWorkRecord,
  VersionedDigest,
} from "./shared-preparation-types.js";

export function buildReadinessEvidenceFromDeployments(input: {
  deploymentIds: readonly VersionedDigest[];
  readinessPolicyVersion: string;
  adapterVersion: string;
  producer?: string;
  observedAt?: string;
}): ReadinessEvidenceEnvelope {
  const digest = (domain: string, seed: string): VersionedDigest => ({
    algorithm: "sha-256",
    domain,
    major_version: 1,
    digest: createHash("sha256").update(seed).digest("hex"),
  });
  const observedAt = input.observedAt ?? new Date().toISOString();
  return {
    schema_version: 1,
    producer: input.producer ?? "sonar-api.fixture",
    schema: "collection.public-evidence.v1",
    adapter: input.adapterVersion,
    readiness_policy_version: input.readinessPolicyVersion,
    privacy_scope: "public_chain",
    deployment_coverage: [...input.deploymentIds],
    observation_window: {
      observed_at: observedAt,
      as_of: observedAt,
    },
    freshness: {
      qualified: true,
      max_age_ms: 60_000,
    },
    source_digest: digest("collection.evidence-source", "prep-source"),
    evidence_digest: digest("collection.evidence", "prep-evidence"),
  };
}

export function aggregateReadinessEvidence(
  work: SharedPreparationWorkRecord,
  deploymentIds: readonly VersionedDigest[],
): ReadinessEvidenceEnvelope {
  return buildReadinessEvidenceFromDeployments({
    deploymentIds,
    readinessPolicyVersion: work.readiness_policy_version,
    adapterVersion: work.adapter_version,
    producer: work.source_identity.producer,
  });
}
