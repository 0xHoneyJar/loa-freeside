import { describe, expect, it } from "vitest";
import { decodeCollectionCandidate } from "../index.js";
import {
  candidateFixtureNames,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

describe("Dashboard consumer fixture contract", () => {
  it("Dashboard decodes the shared committed candidate fixtures", () => {
    const candidates = candidateFixtureNames.map((fixtureName) =>
      expectEffectSuccess(decodeCollectionCandidate(readFixture(fixtureName))),
    );
    expect(candidates.map((candidate) => candidate.identity.deployments.length)).toEqual([
      1,
      1,
      2,
    ]);
  });
});
