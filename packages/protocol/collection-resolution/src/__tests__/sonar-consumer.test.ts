import { describe, expect, it } from "vitest";
import {
  decodeCandidateSnapshot,
  decodeResolutionConfirmCommand,
} from "../index.js";
import {
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

describe("Sonar consumer fixture contract", () => {
  it("Sonar-shaped consumers decode candidate snapshots without persistence fields", () => {
    const snapshot = expectEffectSuccess(
      decodeCandidateSnapshot(readFixture("candidate-snapshot.valid.json")),
    );
    const confirm = expectEffectSuccess(
      decodeResolutionConfirmCommand(readFixture("confirm-command.valid.json")),
    );
    expect(snapshot.candidates[0]?.identity.deployments[0]?.deployment_id).toEqual(
      confirm.selected_deployment_ids[0],
    );
    expect(
      Object.prototype.hasOwnProperty.call(snapshot, "requester_subject"),
    ).toBe(false);
  });
});
