/** Verdict semantics: PENDING ≠ INSUFFICIENT, verdict→tier map. (T1.1 AC) */
import { describe, it, expect } from "vitest";
import { verdictToEarnedTier, type Verdict } from "../claim.js";

describe("Verdict → earned tier", () => {
  it("HELD settles; FALSIFIED and INSUFFICIENT abstain", () => {
    expect(verdictToEarnedTier("HELD")).toBe("settled");
    expect(verdictToEarnedTier("FALSIFIED")).toBe("abstained");
    expect(verdictToEarnedTier("INSUFFICIENT")).toBe("abstained");
  });

  it("keeps PENDING distinct from INSUFFICIENT (the named AC)", () => {
    // Different members...
    const pending: Verdict = "PENDING";
    const insufficient: Verdict = "INSUFFICIENT";
    expect(pending).not.toBe(insufficient);
    // ...mapping to DIFFERENT tiers — pending is a claim (can proceed in FREE),
    // insufficient is an abstention (cannot). Collapsing them would be a bug.
    expect(verdictToEarnedTier("PENDING")).toBe("claimed");
    expect(verdictToEarnedTier("PENDING")).not.toBe(verdictToEarnedTier("INSUFFICIENT"));
  });
});
