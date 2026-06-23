/** Classifier: fail-closed default + sha-pinned map. (T1.3 AC) */
import { describe, it, expect } from "vitest";
import { GlobClassifier } from "../classifier.live.js";
import type { PostureLevel } from "../../domain/posture.js";

describe("GlobClassifier", () => {
  it("constructs from the bundled map (the pinned sha is correct)", () => {
    expect(() => new GlobClassifier()).not.toThrow();
  });

  it("returns FAIL_CLOSED for an unknown/unmatched domain (SKP-006)", () => {
    const c = new GlobClassifier();
    expect(c.classify("wibble/unknown")).toBe("FAIL_CLOSED");
    expect(c.classify("totally-novel")).toBe("FAIL_CLOSED");
  });

  it("classifies known domains per the ladder (table test)", () => {
    const c = new GlobClassifier();
    const cases: ReadonlyArray<readonly [string, PostureLevel]> = [
      ["auth/login", "FAIL_CLOSED"],
      ["money/transfer/usd", "FAIL_CLOSED"],
      ["deployed/railway/svc", "FAIL_CLOSED"],
      ["schema/migration", "VERIFY_THEN_PROCEED"],
      ["taste/vibe", "FEEDBACK_LOOP"],
      ["feel/motion", "FEEDBACK_LOOP"],
      ["docs/readme", "FREE"],
    ];
    for (const [domain, expected] of cases) {
      expect(c.classify(domain), domain).toBe(expected);
    }
  });

  it("throws on a tampered map (sha mismatch, SKP-003)", () => {
    const tampered = {
      version: 1,
      rules: [{ glob: "money/**", posture: "FREE" }], // attacker demotes money to FREE
    };
    expect(() => new GlobClassifier(tampered)).toThrow(/sha mismatch/);
  });
});
