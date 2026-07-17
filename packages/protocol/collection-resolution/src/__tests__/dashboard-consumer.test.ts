import { describe, expect, it } from "vitest";
import {
  decodeCandidateSnapshot,
  decodeConfirmedResolutionRecord,
  decodeOrderResolutionBinding,
  decodeResolutionConfirmCommand,
  decodeResolutionPublicProjection,
  toPublicProjection,
} from "../index.js";
import {
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

describe("Dashboard consumer fixture contract", () => {
  it("Dashboard decodes shared resolution and order-binding fixtures", () => {
    const snapshot = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const record = expectEffectSuccess(
      decodeConfirmedResolutionRecord(readFixture("confirmed-resolution.valid.json")),
    );
    const binding = expectEffectSuccess(
      decodeOrderResolutionBinding(readFixture("order-binding.valid.json")),
    );
    expect(snapshot.candidates).toHaveLength(1);
    expect(record.resolution_id).toBe(binding.resolution_id);
    expect(binding.candidate_snapshot_digest.digest).toBe(
      record.candidate_snapshot_digest.digest,
    );
  });

  it("round-trips the server snapshot digest from projection into confirm", () => {
    const record = expectEffectSuccess(
      decodeConfirmedResolutionRecord(readFixture("confirmed-resolution.valid.json")),
    );
    const projection = expectEffectSuccess(
      decodeResolutionPublicProjection(toPublicProjection(record)),
    );
    const fixtureCommand = expectEffectSuccess(
      decodeResolutionConfirmCommand(readFixture("confirm-command.valid.json")),
    );
    const clientCommand = expectEffectSuccess(
      decodeResolutionConfirmCommand({
        ...fixtureCommand,
        candidate_snapshot_digest: projection.candidate_snapshot_digest,
      }),
    );

    expect(clientCommand.candidate_snapshot_digest).toEqual(
      record.candidate_snapshot_digest,
    );
    expect(projection).not.toHaveProperty("requester_subject");
    expect(projection).not.toHaveProperty("authorization_scope");
    expect(projection).not.toHaveProperty("original_request");
    expect(projection).not.toHaveProperty("request_digest");
    expect(projection).not.toHaveProperty("candidate_snapshot");
  });
});
