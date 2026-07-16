import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  CapabilityRegistryVersion,
  CollectionCandidate,
  DIGEST_DOMAINS,
  DigestDomain,
  VersionedDigest,
  advanceCapabilityRegistryVersion,
  canonicalize,
  compareCapabilityRegistryVersions,
  decodeCapabilityRegistryBaseline,
  decodeCapabilityRegistryVersion,
  decodeCollectionCacheKeyMaterial,
  decodeCollectionCandidate,
  decodeCollectionDeploymentRef,
  decodeCollectionEvidenceReference,
  decodeCollectionIdentity,
  decodeCollectionReportInput,
  decodeCollectionWorkKeyMaterial,
  decodeNetworkRef,
  digestCollectionCacheKey,
  digestCollectionCandidate,
  digestCollectionEvidence,
  digestCollectionReportInput,
  digestCollectionWorkKey,
  digestVersioned,
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
  sortCanonicalSet,
} from "../index.js";
import {
  candidateFixtureNames,
  expectEffectFailure,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const DigestVector = Schema.Struct({
  name: Schema.String,
  domain: DigestDomain,
  value: Schema.Unknown,
  expected_preimage_utf8: Schema.String,
  expected_digest: VersionedDigest,
});
const decodeDigestVectors = Schema.decodeUnknown(Schema.Array(DigestVector), {
  errors: "all",
  onExcessProperty: "error",
});
const decodeRegistryVersions = Schema.decodeUnknown(
  Schema.Array(CapabilityRegistryVersion),
  { errors: "all", onExcessProperty: "error" },
);

describe("CR-001 producer fixtures", () => {
  for (const fixtureName of candidateFixtureNames) {
    it(`strict-decodes ${fixtureName}`, () => {
      const candidate = expectEffectSuccess(
        decodeCollectionCandidate(readFixture(fixtureName)),
      );
      expect(candidate.schema_version).toBe(1);
    });
  }

  it("publishes explicit cross-VM equivalence and an extensible unknown standard", () => {
    const candidate = expectEffectSuccess(
      decodeCollectionCandidate(
        readFixture("multiple-deployments-unknown-standard.valid.json"),
      ),
    );
    expect(candidate.identity.deployments).toHaveLength(2);
    expect(candidate.identity.equivalence_basis.kind).toBe("registry");
    expect(candidate.token_standard.value).toBe("unknown");
  });

  it("rejects committed malformed deployment and network identities", () => {
    for (const fixtureName of [
      "malformed/address-only.invalid.json",
      "malformed/evm-normalization.invalid.json",
      "malformed/solana-normalization.invalid.json",
      "malformed/excess-property.invalid.json",
    ]) {
      expectEffectFailure(
        decodeCollectionDeploymentRef(readFixture(fixtureName)),
      );
    }
    expectEffectFailure(
      decodeNetworkRef(readFixture("malformed/numeric-chain-only.invalid.json")),
    );
  });

  it("rejects missing equivalence and explicit null where absence is required", () => {
    expectEffectFailure(
      decodeCollectionIdentity(
        readFixture("malformed/missing-equivalence-basis.invalid.json"),
      ),
    );
    expectEffectFailure(
      decodeCollectionIdentity(readFixture("malformed/explicit-null.invalid.json")),
    );
  });

  it("rejects a well-shaped deployment with a non-matching digest", () => {
    const candidate = expectEffectSuccess(
      decodeCollectionCandidate(readFixture("evm-candidate.valid.json")),
    );
    const deployment = candidate.identity.deployments[0];
    expect(deployment).toBeDefined();
    if (deployment === undefined) return;
    expectEffectFailure(
      decodeCollectionDeploymentRef({
        ...deployment,
        deployment_id: {
          ...deployment.deployment_id,
          digest: "0".repeat(64),
        },
      }),
    );
  });
});

describe("VM-specific identity", () => {
  it("compares EVM addresses case-insensitively while retaining display form", () => {
    const mixed = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
      }),
    );
    const lower = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
      }),
    );
    expect(mixed.address).toBe("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01");
    expect(mixed.normalized_address).toBe(lower.normalized_address);
    expect(mixed.deployment_id).toEqual(lower.deployment_id);
  });

  it("keeps Solana key comparison case-sensitive", () => {
    const upper = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "solana",
          network_reference: "mainnet-beta",
        },
        address: "So11111111111111111111111111111111111111112",
      }),
    );
    const lower = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "solana",
          network_reference: "mainnet-beta",
        },
        address: "so11111111111111111111111111111111111111112",
      }),
    );
    expect(upper.normalized_address).not.toBe(lower.normalized_address);
    expect(upper.deployment_id).not.toEqual(lower.deployment_id);
  });

  it("keeps logical collection identity stable across display metadata enrichment", () => {
    const candidate = expectEffectSuccess(
      decodeCollectionCandidate(readFixture("evm-candidate.valid.json")),
    );
    const enriched = expectEffectSuccess(
      makeCollectionIdentity({
        schema_version: candidate.identity.schema_version,
        collection_key: "renamed-alias",
        name: "A newly enriched display name",
        symbol: "NEW",
        image: "https://images.example.test/new.png",
        deployments: candidate.identity.deployments,
        equivalence_basis: candidate.identity.equivalence_basis,
      }),
    );
    expect(enriched.collection_id).toEqual(candidate.identity.collection_id);
  });

  it("keeps logical collection identity stable across EVM display casing", () => {
    const candidate = expectEffectSuccess(
      decodeCollectionCandidate(readFixture("evm-candidate.valid.json")),
    );
    const deployment = candidate.identity.deployments[0];
    expect(deployment).toBeDefined();
    if (deployment === undefined || deployment.network.network_namespace !== "eip155") {
      return;
    }

    const recasedDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: deployment.schema_version,
        network: deployment.network,
        address: deployment.address.toUpperCase().replace("0X", "0x"),
      }),
    );
    const recasedIdentity = expectEffectSuccess(
      makeCollectionIdentity({
        schema_version: candidate.identity.schema_version,
        deployments: [recasedDeployment],
        equivalence_basis: candidate.identity.equivalence_basis,
      }),
    );

    expect(recasedDeployment.deployment_id).toEqual(deployment.deployment_id);
    expect(recasedIdentity.collection_id).toEqual(candidate.identity.collection_id);
  });
});

describe("RFC 8785, NFC, collection rules, and versioned digests", () => {
  it("matches every committed digest preimage and SHA-256 vector", () => {
    const vectors = expectEffectSuccess(
      decodeDigestVectors(readFixture("digest-vectors.valid.json")),
    );
    for (const vector of vectors) {
      const preimage = expectEffectSuccess(
        canonicalize({
          domain: vector.domain,
          major_version: 1,
          value: vector.value,
        }),
      );
      const digest = expectEffectSuccess(
        digestVersioned(vector.domain, 1, vector.value),
      );
      expect(preimage, vector.name).toBe(vector.expected_preimage_utf8);
      expect(digest, vector.name).toEqual(vector.expected_digest);
    }
  });

  it("preserves ordered arrays and byte-sorts explicitly keyed sets", () => {
    const orderedA = expectEffectSuccess(
      digestVersioned("fixture.ordered", 1, { values: [1, 2] }),
    );
    const orderedB = expectEffectSuccess(
      digestVersioned("fixture.ordered", 1, { values: [2, 1] }),
    );
    expect(orderedA).not.toEqual(orderedB);

    const sorted = expectEffectSuccess(
      sortCanonicalSet([
        { canonical_key: "solana:mainnet-beta", value: "solana" },
        { canonical_key: "eip155:137", value: "polygon" },
        { canonical_key: "eip155:1", value: "ethereum" },
      ]),
    );
    expect(sorted).toEqual(["ethereum", "polygon", "solana"]);
  });

  it("uses the RFC 8785 ECMAScript number serialization form", () => {
    const canonical = expectEffectSuccess(
      canonicalize({
        numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27, -0],
      }),
    );
    expect(canonical).toBe(
      "{\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}",
    );
  });

  it("rejects duplicate set keys, undefined, and lone surrogates with typed failures", () => {
    expectEffectFailure(
      sortCanonicalSet([
        { canonical_key: "eip155:1", value: "first" },
        { canonical_key: "eip155:1", value: "second" },
      ]),
    );
    expectEffectFailure(canonicalize({ absent_must_be_omitted: undefined }));
    expectEffectFailure(canonicalize({ bad_unicode: "\ud800" }));
    expectEffectFailure(canonicalize(new Date("2026-07-16T00:00:00Z")));
  });

  it("rejects malformed digest domains and major versions through Effect", () => {
    expectEffectFailure(digestVersioned("INVALID DOMAIN", 1, { value: true }));
    expectEffectFailure(digestVersioned("fixture.valid", 0, { value: true }));
    expectEffectFailure(digestVersioned("fixture.valid", 1.5, { value: true }));
    expectEffectFailure(digestVersioned("fixture.valid", "1", { value: true }));
  });
});

describe("capability registry wire version", () => {
  it("strict-decodes decimal-string edge fixtures", () => {
    const versions = expectEffectSuccess(
      decodeRegistryVersions(readFixture("registry-versions.valid.json")),
    );
    expect(versions).toHaveLength(5);
    expect(versions[3]?.registry_sequence).toBe("18446744073709551615");
  });

  it("compares sequence 10 as numerically newer than 9", () => {
    const epoch = "11111111-1111-4111-8111-111111111111";
    const relation = expectEffectSuccess(
      compareCapabilityRegistryVersions(
        { registry_epoch: epoch, registry_sequence: "9" },
        { registry_epoch: epoch, registry_sequence: "10" },
      ),
    );
    expect(relation).toBe("older");
  });

  it("requires a verified zero-sequence baseline before an epoch reset", () => {
    const current = {
      registry_epoch: "11111111-1111-4111-8111-111111111111",
      registry_sequence: "10",
    };
    const candidate = {
      registry_epoch: "22222222-2222-4222-8222-222222222222",
      registry_sequence: "0",
    };
    expectEffectFailure(advanceCapabilityRegistryVersion(current, candidate));

    const baselineDigest = expectEffectSuccess(
      digestVersioned("capability.registry-baseline", 1, {
        previous_registry_epoch: current.registry_epoch,
        version: candidate,
      }),
    );
    const baseline = expectEffectSuccess(
      decodeCapabilityRegistryBaseline({
        schema_version: 1,
        previous_registry_epoch: current.registry_epoch,
        version: candidate,
        baseline_digest: baselineDigest,
      }),
    );
    expect(
      expectEffectSuccess(
        advanceCapabilityRegistryVersion(current, candidate, baseline),
      ),
    ).toBe("epoch_reset");
  });

  it("rejects lexical, numeric, and overflow sequence representations", () => {
    for (const fixtureName of [
      "malformed/registry-leading-zero.invalid.json",
      "malformed/registry-numeric-sequence.invalid.json",
      "malformed/registry-overflow.invalid.json",
    ]) {
      expectEffectFailure(
        decodeCapabilityRegistryVersion(readFixture(fixtureName)),
      );
    }
    expectEffectFailure(
      decodeCapabilityRegistryVersion({
        registry_epoch: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        registry_sequence: "1",
      }),
    );
  });

  it("keeps malformed public-helper inputs in the Effect error channel", () => {
    const epoch = "11111111-1111-4111-8111-111111111111";
    const valid = { registry_epoch: epoch, registry_sequence: "10" };
    const malformed = { registry_epoch: epoch, registry_sequence: "not-a-number" };

    expectEffectFailure(compareCapabilityRegistryVersions(malformed, valid));
    expectEffectFailure(advanceCapabilityRegistryVersion(valid, malformed));
    expectEffectFailure(
      advanceCapabilityRegistryVersion(
        valid,
        {
          registry_epoch: "22222222-2222-4222-8222-222222222222",
          registry_sequence: "0",
        },
        {
          schema_version: 1,
          previous_registry_epoch: epoch,
          version: {
            registry_epoch: "22222222-2222-4222-8222-222222222222",
            registry_sequence: "0",
          },
          baseline_digest: {
            algorithm: "sha-256",
            domain: "capability.registry-baseline",
            major_version: 1,
            digest: "not-a-digest",
          },
        },
      ),
    );
  });
});

describe("finality-policy propagation", () => {
  it("binds finality policy into candidates, work, evidence, cache, and report digests", () => {
    const candidate: CollectionCandidate = expectEffectSuccess(
      decodeCollectionCandidate(readFixture("evm-candidate.valid.json")),
    );
    const deploymentIds = candidate.identity.deployments.map(
      (deployment) => deployment.deployment_id,
    );
    const evidenceDigests = candidate.provenance.map(
      (entry) => entry.evidence_digest,
    );
    const work = expectEffectSuccess(
      decodeCollectionWorkKeyMaterial({
        schema_version: 1,
        capability: "ownership_index",
        capability_version: "v1",
        collection_id: candidate.identity.collection_id,
        deployment_ids: deploymentIds,
        finality_policies: candidate.finality_policies,
      }),
    );
    const evidence = expectEffectSuccess(
      decodeCollectionEvidenceReference({
        schema_version: 1,
        evidence_digest: evidenceDigests[0],
        deployment_ids: deploymentIds,
        finality_policies: candidate.finality_policies,
      }),
    );
    const cache = expectEffectSuccess(
      decodeCollectionCacheKeyMaterial({
        schema_version: 1,
        cache_namespace: "collection-recognition",
        deployment_ids: deploymentIds,
        finality_policies: candidate.finality_policies,
      }),
    );
    const report = expectEffectSuccess(
      decodeCollectionReportInput({
        schema_version: 1,
        report_type: "gate-leak",
        report_version: "v1",
        collection_id: candidate.identity.collection_id,
        deployment_ids: deploymentIds,
        finality_policies: candidate.finality_policies,
        evidence_digests: evidenceDigests,
      }),
    );

    const digestSet = [
      expectEffectSuccess(digestCollectionCandidate(candidate)),
      expectEffectSuccess(digestCollectionWorkKey(work)),
      expectEffectSuccess(digestCollectionEvidence(evidence)),
      expectEffectSuccess(digestCollectionCacheKey(cache)),
      expectEffectSuccess(digestCollectionReportInput(report)),
    ];
    expect(digestSet.map((item) => item.domain)).toEqual([
      DIGEST_DOMAINS.candidate,
      DIGEST_DOMAINS.work_key,
      DIGEST_DOMAINS.evidence,
      DIGEST_DOMAINS.cache_key,
      DIGEST_DOMAINS.report_input,
    ]);

    const changedFinality: Array<{
      readonly schema_version: 1;
      readonly network: typeof candidate.finality_policies[number]["network"];
      readonly finality_policy_version: string;
    }> = [];
    for (const binding of candidate.finality_policies) {
      changedFinality.push({
        schema_version: binding.schema_version,
        network: binding.network,
        finality_policy_version: "ethereum-finalized.v2",
      });
    }
    const changedWork = expectEffectSuccess(
      decodeCollectionWorkKeyMaterial({ ...work, finality_policies: changedFinality }),
    );
    const changedCandidate = expectEffectSuccess(
      decodeCollectionCandidate({ ...candidate, finality_policies: changedFinality }),
    );
    expect(expectEffectSuccess(digestCollectionCandidate(changedCandidate))).not.toEqual(
      digestSet[0],
    );
    expect(expectEffectSuccess(digestCollectionWorkKey(changedWork))).not.toEqual(
      digestSet[1],
    );
  });
});
