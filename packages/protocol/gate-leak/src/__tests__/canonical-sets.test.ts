import { describe, expect, it } from "vitest";
import { digestVersioned, type VersionedDigest } from "@freeside/collection-protocol";
import { Effect, Schema } from "effect";
import {
  AuthorizationWatermarkSet,
  canonicalAuthorizationWatermarkSet,
  canonicalDeploymentIdSet,
  canonicalRoleIdSet,
  decodeComputeAttemptPins,
  decodeGateLeakComputeInput,
  decodeGateLeakDisclosureKey,
  digestDeploymentSet,
  digestGateLeakComputeInput,
  digestGateLeakDisclosureKey,
  type GateLeakDisclosureLedgerKey,
} from "../index.js";
import {
  expectEffectFailureTag,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const deploymentId = (digest: string): VersionedDigest => ({
  algorithm: "sha-256",
  domain: "collection.deployment",
  major_version: 1,
  digest,
});

const depA = deploymentId("1".repeat(64));
const depB = deploymentId("2".repeat(64));
const depC = deploymentId("3".repeat(64));

describe("logical sets canonicalize before digesting and strict-decode sorted unique", () => {
  it("deployment sets: every permutation of the same logical set digests identically", () => {
    const permutations: ReadonlyArray<ReadonlyArray<VersionedDigest>> = [
      [depA, depB, depC],
      [depC, depB, depA],
      [depB, depA, depC],
    ];
    const digests = permutations.map(
      (permutation) => expectEffectSuccess(digestDeploymentSet(permutation)).digest,
    );
    expect(new Set(digests).size).toBe(1);
    // The canonical order itself is stable and sorted.
    const canonical = expectEffectSuccess(canonicalDeploymentIdSet([depC, depA, depB]));
    expect(canonical.map((entry) => entry.digest)).toStrictEqual([
      depA.digest,
      depB.digest,
      depC.digest,
    ]);
  });

  it("deployment sets: duplicates refuse; the empty set refuses; wrong-domain members refuse", () => {
    expectEffectFailureTag(
      digestDeploymentSet([depA, depA]),
      "InvalidDeploymentSetMemberError",
    );
    const empty = expectEffectFailureTag(
      digestDeploymentSet([]),
      "EmptyDeploymentSelectionError",
    );
    expect(empty).toMatchObject({ reason_code: "empty_deployment_selection" });
    expectEffectFailureTag(
      digestDeploymentSet([{ ...depA, domain: "collection.identity" }]),
      "InvalidDeploymentSetMemberError",
    );
  });

  it("role IDs: canonicalization sorts any permutation to one form; duplicates refuse", () => {
    const sorted = expectEffectSuccess(
      canonicalRoleIdSet(["300000000000000003", "300000000000000001", "300000000000000002"]),
    );
    expect(sorted).toStrictEqual([
      "300000000000000001",
      "300000000000000002",
      "300000000000000003",
    ]);
    expectEffectFailureTag(
      canonicalRoleIdSet(["300000000000000001", "300000000000000001"]),
      "DuplicateCanonicalSetMemberError",
    );
  });

  it("disclosure-ledger keys: permutations of the role dimension produce IDENTICAL keys after canonicalization", () => {
    const ruleDigest = expectEffectSuccess(
      Effect.orDie(digestVersioned("gate-leak.gate-rule", 1, { probe: "rule" })),
    );
    const collectionId: VersionedDigest = {
      algorithm: "sha-256",
      domain: "collection.identity",
      major_version: 1,
      digest: "4".repeat(64),
    };
    const keyFor = (roleIds: ReadonlyArray<string>): GateLeakDisclosureLedgerKey => ({
      schema_version: 1,
      community_ref: "acme-club",
      guild_ref: "200000000000000002",
      collection_id: collectionId,
      role_ids: expectEffectSuccess(canonicalRoleIdSet(roleIds)),
      rule_digest: ruleDigest,
      disclosure_policy_version: "gate-leak-disclosure.v1",
      epoch_index: 3,
    });
    const forward = expectEffectSuccess(
      digestGateLeakDisclosureKey(keyFor(["300000000000000002", "300000000000000003"])),
    );
    const reversed = expectEffectSuccess(
      digestGateLeakDisclosureKey(keyFor(["300000000000000003", "300000000000000002"])),
    );
    expect(reversed.digest).toBe(forward.digest);
  });

  it("disclosure-ledger keys: an unsorted or duplicated role dimension refuses — the privacy ledger cannot fragment", () => {
    expectEffectFailureTag(
      decodeGateLeakDisclosureKey(
        readFixture("malformed/disclosure-key-unsorted-roles.invalid.json"),
      ),
      "ParseError",
    );
    const decoded = expectEffectSuccess(
      decodeGateLeakDisclosureKey({
        schema_version: 1,
        community_ref: "acme-club",
        guild_ref: "200000000000000002",
        collection_id: {
          algorithm: "sha-256",
          domain: "collection.identity",
          major_version: 1,
          digest: "4".repeat(64),
        },
        role_ids: ["300000000000000002", "300000000000000003"],
        rule_digest: expectEffectSuccess(
          Effect.orDie(digestVersioned("gate-leak.gate-rule", 1, { probe: "rule" })),
        ),
        disclosure_policy_version: "gate-leak-disclosure.v1",
        epoch_index: 3,
      }),
    );
    // In-process permutation (bypassing decode) refuses at digest time.
    const permuted = { ...decoded, role_ids: decoded.role_ids.toReversed() };
    expectEffectFailureTag(
      digestGateLeakDisclosureKey(permuted as typeof decoded),
      "ParseError",
    );
    const [firstRole] = decoded.role_ids;
    if (firstRole === undefined) throw new Error("expected a role id");
    const duplicated = { ...decoded, role_ids: [firstRole, firstRole] };
    expectEffectFailureTag(
      digestGateLeakDisclosureKey(duplicated as typeof decoded),
      "ParseError",
    );
  });
});

describe("authorization watermark sets are canonical sorted unique", () => {
  const mark = (
    authority: string,
    epoch: number,
    sequence: string,
  ): {
    readonly schema_version: 1;
    readonly authority: string;
    readonly epoch: number;
    readonly sequence: string;
  } => ({ schema_version: 1, authority, epoch, sequence });

  it("permutations canonicalize to one sorted form; duplicates refuse", () => {
    const a = mark("alpha", 1, "10");
    const b = mark("beta", 2, "20");
    const c = mark("gamma", 3, "30");
    const forward = expectEffectSuccess(canonicalAuthorizationWatermarkSet([c, a, b]));
    const reversed = expectEffectSuccess(canonicalAuthorizationWatermarkSet([a, c, b]));
    expect(forward).toStrictEqual(reversed);
    expect(forward.map((entry) => entry.authority)).toStrictEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expectEffectFailureTag(
      canonicalAuthorizationWatermarkSet([a, a]),
      "DuplicateCanonicalSetMemberError",
    );
  });

  it("wire/decode rejects unsorted and duplicated watermark sets", () => {
    const unsorted = [
      mark("beta", 1, "1"),
      mark("alpha", 1, "1"),
    ];
    expectEffectFailureTag(
      Schema.decodeUnknown(AuthorizationWatermarkSet, {
        errors: "all",
        onExcessProperty: "error",
      })(unsorted),
      "ParseError",
    );
    expectEffectFailureTag(
      Schema.decodeUnknown(AuthorizationWatermarkSet, {
        errors: "all",
        onExcessProperty: "error",
      })([mark("alpha", 1, "1"), mark("alpha", 1, "1")]),
      "ParseError",
    );
  });

  it("compute-input digest revalidates: in-process unsorted watermarks refuse rather than fragment keys", () => {
    const pins = expectEffectSuccess(
      decodeComputeAttemptPins({
        schema_version: 1,
        mapping_version_id: {
          algorithm: "sha-256",
          domain: "gate-leak.mapping-version",
          major_version: 1,
          digest: "1".repeat(64),
        },
        consent_policy_version: "community-gate-audit.v1",
        identity_tombstone_watermark: "1200",
        gateway_epoch: 3,
        gateway_sequence: "4200",
        capability_registry: {
          registry_epoch: "0f0e0d0c-0b0a-4908-8706-050403020100",
          registry_sequence: "77",
        },
        authorization_watermarks: expectEffectSuccess(
          canonicalAuthorizationWatermarkSet([
            mark("membership", 1, "10"),
            mark("ops", 2, "5"),
          ]),
        ),
      }),
    );
    const input = {
      schema_version: 1 as const,
      report_type: "gate_leak" as const,
      report_version: "v1" as const,
      collection_id: {
        algorithm: "sha-256" as const,
        domain: "collection.identity",
        major_version: 1 as const,
        digest: "2".repeat(64),
      },
      deployment_set_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.deployment-set",
        major_version: 1 as const,
        digest: "3".repeat(64),
      },
      collection_identity_evidence_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.evidence",
        major_version: 1 as const,
        digest: "4".repeat(64),
      },
      ownership_evidence_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.evidence",
        major_version: 1 as const,
        digest: "5".repeat(64),
      },
      mapping_version_id: pins.mapping_version_id,
      rule_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.gate-rule",
        major_version: 1 as const,
        digest: "6".repeat(64),
      },
      discord_snapshot_id: "snap",
      discord_evidence_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.evidence",
        major_version: 1 as const,
        digest: "7".repeat(64),
      },
      link_snapshot_id: "link",
      identity_evidence_digest: {
        algorithm: "sha-256" as const,
        domain: "gate-leak.evidence",
        major_version: 1 as const,
        digest: "8".repeat(64),
      },
      cohort: {
        schema_version: 1 as const,
        subject_set_digest: {
          algorithm: "sha-256" as const,
          domain: "gate-leak.subject-cohort",
          major_version: 1 as const,
          digest: "9".repeat(64),
        },
        cardinality: 10,
        inclusion_rule_version: "cohort-inclusion.v1",
        source_role_snapshot_id: "snap",
        limit_policy_version: "subject-cohort-limit.v1",
      },
      pins,
      readiness_policy_version: "gate-leak-readiness.v1",
      coverage_policy_version: "gate-leak-coverage.v1" as const,
      disclosure_policy_version: "gate-leak-disclosure.v1" as const,
      consent_policy_version: "community-gate-audit.v1",
      as_of_interval: { start: "2026-07-16T00:00:00Z", end: "2026-07-16T00:01:00Z" },
    };
    const decoded = expectEffectSuccess(decodeGateLeakComputeInput(input));
    const digestA = expectEffectSuccess(digestGateLeakComputeInput(decoded)).digest;
    // Equivalent pin set via constructor canonicalization yields the same digest.
    const permutedPins = expectEffectSuccess(
      decodeComputeAttemptPins({
        ...pins,
        authorization_watermarks: expectEffectSuccess(
          canonicalAuthorizationWatermarkSet([
            mark("ops", 2, "5"),
            mark("membership", 1, "10"),
          ]),
        ),
      }),
    );
    const digestB = expectEffectSuccess(
      digestGateLeakComputeInput(
        expectEffectSuccess(decodeGateLeakComputeInput({ ...input, pins: permutedPins })),
      ),
    ).digest;
    expect(digestB).toBe(digestA);

    // In-process unsorted bypass refuses at digest time.
    const unsorted = {
      ...decoded,
      pins: {
        ...decoded.pins,
        authorization_watermarks: [
          mark("ops", 2, "5"),
          mark("membership", 1, "10"),
        ] as typeof decoded.pins.authorization_watermarks,
      },
    };
    expectEffectFailureTag(digestGateLeakComputeInput(unsorted), "ParseError");
  });
});
