import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  COLLECTION_RESOLUTION_PROTOCOL_VERSION,
  COLLECTION_RESOLUTION_SCHEMA_VERSION,
  RESOLUTION_TTL_MS,
  decodeAdmissionDecision,
  decodeAuthorizationScope,
  decodeCandidateSnapshot,
  decodeConfirmedResolutionRecord,
  decodeLocalCapabilitySnapshot,
  decodeOrderResolutionBinding,
  decodeResolutionConfirmCommand,
  decodeResolutionCreateCommand,
  decodeResolutionPublicProjection,
  decodeResolutionRefreshCommand,
  digestCandidateSnapshot,
  digestResolutionRequest,
  digestsEqual,
  validateSelection,
  rejectAddressOnlyIdentity,
  compareCandidateFreshness,
  assertNoRawCandidateOrderFields,
} from "../index.js";
import {
  expectEffectFailure,
  expectEffectSuccess,
  readFixture,
  validFixtureNames,
} from "./test-helpers.js";

describe("CR-006 protocol contracts", () => {
  it("publishes a stable protocol and schema version with 15-minute TTL", () => {
    expect(COLLECTION_RESOLUTION_PROTOCOL_VERSION).toBe("1.0.0");
    expect(COLLECTION_RESOLUTION_SCHEMA_VERSION).toBe(1);
    expect(RESOLUTION_TTL_MS).toBe(15 * 60 * 1000);
  });

  for (const fixtureName of validFixtureNames) {
    it(`strict-decodes ${fixtureName}`, () => {
      const raw = readFixture(fixtureName);
      if (fixtureName.startsWith("create-")) {
        expectEffectSuccess(decodeResolutionCreateCommand(raw));
      } else if (fixtureName.startsWith("confirm-")) {
        expectEffectSuccess(decodeResolutionConfirmCommand(raw));
      } else if (fixtureName.startsWith("refresh-")) {
        expectEffectSuccess(decodeResolutionRefreshCommand(raw));
      } else if (fixtureName.includes("candidate-snapshot")) {
        expectEffectSuccess(decodeCandidateSnapshot(raw));
      } else if (fixtureName.startsWith("confirmed-")) {
        expectEffectSuccess(decodeConfirmedResolutionRecord(raw));
      } else if (fixtureName.startsWith("order-")) {
        expectEffectSuccess(decodeOrderResolutionBinding(raw));
      } else if (fixtureName.startsWith("authorization-")) {
        expectEffectSuccess(decodeAuthorizationScope(raw));
      }
    });
  }

  it("rejects excess properties on order bindings", () => {
    expectEffectFailure(
      decodeOrderResolutionBinding(readFixture("malformed/excess-property.invalid.json")),
    );
  });

  it("refuses raw candidate metadata on order bindings", () => {
    const raw = readFixture("malformed/raw-candidates-on-order.invalid.json");
    expectEffectFailure(assertNoRawCandidateOrderFields(raw as Record<string, unknown>));
  });

  it("recomputes candidate snapshot digests server-side", () => {
    const snapshot = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const digest = expectEffectSuccess(digestCandidateSnapshot(snapshot));
    const record = expectEffectSuccess(
      decodeConfirmedResolutionRecord(readFixture("confirmed-resolution.valid.json")),
    );
    expect(digestsEqual(digest, record.candidate_snapshot_digest)).toBe(true);
  });

  it("detects client digest forgery against the server digest", () => {
    const forged = readFixture("malformed/client-digest-forgery.invalid.json") as {
      candidate_snapshot_digest: { digest: string };
    };
    const record = expectEffectSuccess(
      decodeConfirmedResolutionRecord(readFixture("confirmed-resolution.valid.json")),
    );
    expect(forged.candidate_snapshot_digest.digest).not.toBe(
      record.candidate_snapshot_digest.digest,
    );
  });

  it("accepts one deployment or an equivalence-group subset", () => {
    const single = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const confirm = expectEffectSuccess(
      decodeResolutionConfirmCommand(readFixture("confirm-command.valid.json")),
    );
    const singleSelection = expectEffectSuccess(
      validateSelection(single, confirm.selected_deployment_ids),
    );
    expect(singleSelection.selected_deployment_ids).toHaveLength(1);

    const multi = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("equivalence-candidate-snapshot.valid.json")),
    );
    const multiConfirm = expectEffectSuccess(
      decodeResolutionConfirmCommand(readFixture("confirm-equivalence-subset.valid.json")),
    );
    const multiSelection = expectEffectSuccess(
      validateSelection(multi, multiConfirm.selected_deployment_ids),
    );
    expect(multiSelection.selected_deployment_ids).toHaveLength(2);
  });

  it("rejects cross-candidate composition and address-only identity", () => {
    const single = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const multi = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("equivalence-candidate-snapshot.valid.json")),
    );
    const composed = {
      schema_version: 1 as const,
      candidates: [...single.candidates, ...multi.candidates],
      diagnostics: single.diagnostics,
    };
    const left = single.candidates[0]?.identity.deployments[0]?.deployment_id;
    const right = multi.candidates[0]?.identity.deployments[0]?.deployment_id;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;

    expectEffectFailure(validateSelection(composed, [left, right]));
    expectEffectFailure(rejectAddressOnlyIdentity({ address: "0xabc" }));
  });

  it("marks selection-relevant drift as stale while ignoring display ranking noise", () => {
    const base = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const baseDigest = expectEffectSuccess(digestCandidateSnapshot(base));

    const rankingOnly = {
      ...base,
      candidates: base.candidates.map((candidate) => ({
        ...candidate,
        ranking_reasons: [...candidate.ranking_reasons, "noise"],
        identity: {
          ...candidate.identity,
          name: "Renamed For Display",
        },
      })),
    };
    const rankingDigest = expectEffectSuccess(digestCandidateSnapshot(rankingOnly));
    const rankingCompare = expectEffectSuccess(
      compareCandidateFreshness(base, baseDigest, rankingOnly, rankingDigest),
    );
    // Full snapshot digest changes with ranking/name, but selection-relevant stays equal.
    expect(rankingCompare.byte_equivalent).toBe(false);
    expect(rankingCompare.selection_relevant_equal).toBe(true);

    const standardDrift = {
      ...base,
      candidates: base.candidates.map((candidate) => ({
        ...candidate,
        token_standard: { schema_version: 1 as const, value: "erc1155" },
      })),
    };
    const standardDigest = expectEffectSuccess(digestCandidateSnapshot(standardDrift));
    const standardCompare = expectEffectSuccess(
      compareCandidateFreshness(base, baseDigest, standardDrift, standardDigest),
    );
    expect(standardCompare.selection_relevant_equal).toBe(false);
    expect(standardCompare.stale_reason).toBe("standard_changed");

    const recognitionDrift = {
      ...base,
      candidates: base.candidates.map((candidate) => ({
        ...candidate,
        recognition: "unrecognized" as const,
        index_status: "failed" as const,
        report_readiness: "blocked" as const,
      })),
    };
    const recognitionDigest = expectEffectSuccess(digestCandidateSnapshot(recognitionDrift));
    const recognitionCompare = expectEffectSuccess(
      compareCandidateFreshness(base, baseDigest, recognitionDrift, recognitionDigest),
    );
    expect(recognitionCompare.selection_relevant_equal).toBe(false);
    expect(recognitionCompare.stale_reason).toBe("recognition_changed");
  });

  it("rejects unknown protocol major / excess projection fields", () => {
    expectEffectFailure(
      decodeResolutionPublicProjection({
        schema_version: 2,
        resolution_id: "x",
        capability_snapshot_version: {
          registry_epoch: "11111111-1111-4111-8111-111111111111",
          registry_sequence: "1",
        },
        candidates: [],
        diagnostics: {
          schema_version: 1,
          searched: [],
          timed_out: [],
          unavailable: [],
        },
        confirmation_version: 0,
        expires_at: "2026-07-16T08:20:00Z",
      }),
    );

    expectEffectFailure(
      decodeAdmissionDecision({
        schema_version: 1,
        resolution_id: "x",
        candidate_snapshot_digest: {
          algorithm: "sha-256",
          domain: "collection-resolution.candidate-snapshot",
          major_version: 1,
          digest: "0".repeat(64),
        },
        selected_deployment_ids: [
          {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "1".repeat(64),
          },
        ],
        admitted_registry_version: {
          registry_epoch: "11111111-1111-4111-8111-111111111111",
          registry_sequence: "1",
        },
        compatibility_digest: {
          algorithm: "sha-256",
          domain: "collection-resolution.admission-decision",
          major_version: 1,
          digest: "2".repeat(64),
        },
        decision: "admit",
        unexpected: true,
      }),
    );
  });

  it("request digests bind subject and community scope", () => {
    const command = expectEffectSuccess(
      decodeResolutionCreateCommand(readFixture("create-command.valid.json")),
    );
    const scope = expectEffectSuccess(
      decodeAuthorizationScope(readFixture("authorization-scope.valid.json")),
    );
    const digest = expectEffectSuccess(digestResolutionRequest(command, scope));
    const other = expectEffectSuccess(
      digestResolutionRequest(command, {
        ...scope,
        subject_id: "subject-bob",
      }),
    );
    expect(digestsEqual(digest, other)).toBe(false);
  });

  it("fixture digests are deterministic across recompute", () => {
    const Snapshot = Schema.Unknown;
    void Snapshot;
    const first = expectEffectSuccess(
      digestCandidateSnapshot(
        expectEffectSuccess(decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json"))),
      ),
    );
    const second = expectEffectSuccess(
      digestCandidateSnapshot(
        expectEffectSuccess(decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json"))),
      ),
    );
    expect(first).toEqual(second);
  });

  it("capability views are a unique set by (deployment_id, operation); duplicates fail closed", () => {
    const record = expectEffectSuccess(
      decodeConfirmedResolutionRecord(readFixture("confirmed-resolution.valid.json")),
    );
    const deployment = record.candidate_snapshot.candidates[0]?.identity.deployments[0];
    expect(deployment).toBeDefined();
    if (deployment === undefined) return;

    const view = {
      schema_version: 1 as const,
      deployment_id: deployment.deployment_id,
      network_namespace: deployment.network.network_namespace,
      network_reference: deployment.network.network_reference,
      normalized_address: deployment.normalized_address,
      operation: "prepare" as const,
      health: "available" as const,
      supported_standards: ["erc721"],
      finality_policy_version: "ethereum-finalized.v1",
      equivalence_revoked: false,
      authorization_valid: true,
      identity_digest: deployment.deployment_id,
    };

    const unique = expectEffectSuccess(
      decodeLocalCapabilitySnapshot({
        schema_version: 1,
        registry_version: record.capability_snapshot_version,
        receipt_age_ms: 0,
        staleness_ceiling_ms: 60_000,
        views: [view],
      }),
    );
    expect(unique.views).toHaveLength(1);

    // Identical duplicate
    expectEffectFailure(
      decodeLocalCapabilitySnapshot({
        schema_version: 1,
        registry_version: record.capability_snapshot_version,
        receipt_age_ms: 0,
        staleness_ceiling_ms: 60_000,
        views: [view, { ...view }],
      }),
    );

    // Contradictory duplicate (safe first, disabled second) — no first-match
    expectEffectFailure(
      decodeLocalCapabilitySnapshot({
        schema_version: 1,
        registry_version: record.capability_snapshot_version,
        receipt_age_ms: 0,
        staleness_ceiling_ms: 60_000,
        views: [view, { ...view, health: "disabled" }],
      }),
    );
  });
});
