/**
 * Gate.checkSync is SYNCHRONOUS — not a Promise. (T1.2 AC, SKP-001a)
 *
 * Enforced two ways:
 *  - compile time: `NotPromise<ReturnType<...>>` collapses to `never` (and fails
 *    `tsc`) the instant `checkSync` is given a Promise return type;
 *  - run time: the returned value is not a Promise and has no `.then`.
 */
import { describe, it, expect } from "vitest";
import type { Gate, GateDecision } from "../gate.port.js";
import { MockGate } from "../../mock/gate.mock.js";
import { makeTetlockForecast } from "../../domain/tier.js";

// --- compile-time assertion -------------------------------------------------
type NotPromise<T> = T extends Promise<unknown> ? never : T;
// If checkSync ever returns a Promise, the right-hand type becomes `never` and
// this assignment stops compiling.
type _CheckSyncIsSync = NotPromise<ReturnType<Gate["checkSync"]>>;
const _assertSync: _CheckSyncIsSync = {
  proceed: true,
  reason: "ok",
  stamp: {
    tier: "settled",
    provenance: { by: "t", at_ppm: 0, instrument_id: "i", instrument_sha: "s" },
    confidence: makeTetlockForecast(0),
    verify_ref: "r",
  },
} satisfies GateDecision;

describe("Gate.checkSync is synchronous", () => {
  it("returns a value, not a Promise (run-time)", () => {
    void _assertSync; // keep the compile-time const referenced
    const gate: Gate = new MockGate(() => _assertSync);
    const result = gate.checkSync({ domain: "money/x", claim: { id: "c1" } });
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { then?: unknown }).then).toBeUndefined();
    expect(result.proceed).toBe(true);
  });
});
