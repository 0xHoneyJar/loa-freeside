import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { decodeCollectionCandidate } from "@freeside/collection-protocol";
import { Effect } from "effect";
import {
  buildPublicWorkKeyMaterial,
  digestPublicWorkKey,
} from "../shared-preparation-work-key.js";
import type {
  PublicPreparationWorkKeyMaterial,
  ReadinessEvidenceEnvelope,
  VersionedDigest,
} from "../shared-preparation-types.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/collection/fixtures",
);

function runEffect<A>(effect: Effect.Effect<A, unknown>): A {
  return Effect.runSync(effect);
}

export function loadEvmFixtureCandidate() {
  const raw = JSON.parse(readFileSync(join(fixtureDir, "evm-candidate.valid.json"), "utf8"));
  return runEffect(decodeCollectionCandidate(raw));
}

export function fixturePublicWorkKey(input?: {
  capability?: "collection_identity.v1" | "ownership_index.v1";
  communityScopeDigest?: string;
}): PublicPreparationWorkKeyMaterial {
  const candidate = loadEvmFixtureCandidate();
  const deploymentIds = candidate.identity.deployments.map((d) => d.deployment_id);
  return buildPublicWorkKeyMaterial({
    capability: input?.capability ?? "ownership_index.v1",
    capability_version: "v1",
    collection_id: candidate.identity.collection_id,
    deployment_ids: deploymentIds,
    finality_policies: candidate.finality_policies,
    source_identity: {
      schema_version: 1,
      producer: "sonar-api.fixture",
      upstream_evidence_source: "sonar.public-capability.v1",
    },
    readiness_policy_version: "gate-leak-public-prep.v1",
    adapter_version: "sonar-kitchen.v1",
  });
}

export function fixtureCommunityScopeDigest(communityRef: string): string {
  return createHash("sha256").update(`community:${communityRef}`).digest("hex");
}

export function fixtureReadinessEvidence(deploymentIds: readonly VersionedDigest[]): ReadinessEvidenceEnvelope {
  const digest = (domain: string, seed: string): VersionedDigest => ({
    algorithm: "sha-256",
    domain,
    major_version: 1,
    digest: createHash("sha256").update(seed).digest("hex"),
  });
  return {
    schema_version: 1,
    producer: "sonar-api.fixture",
    schema: "collection.public-evidence.v1",
    adapter: "sonar-kitchen.v1",
    readiness_policy_version: "gate-leak-public-prep.v1",
    privacy_scope: "public_chain",
    deployment_coverage: [...deploymentIds],
    observation_window: {
      observed_at: "2026-07-17T21:00:00.000Z",
      as_of: "2026-07-17T21:00:00.000Z",
    },
    freshness: {
      qualified: true,
      max_age_ms: 60_000,
    },
    source_digest: digest("collection.evidence-source", "fixture-source"),
    evidence_digest: digest("collection.evidence", "fixture-evidence"),
  };
}

export function fixtureWorkKeyDigest(key: PublicPreparationWorkKeyMaterial): string {
  return digestPublicWorkKey(key);
}
