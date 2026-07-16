import { describe, expect, it } from "vitest";
import {
  decodeCandidateSnapshot,
  decodeConfirmedResolutionRecord,
  decodeOrderResolutionBinding,
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
});
