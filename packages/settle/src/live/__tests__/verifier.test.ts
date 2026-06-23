/** Independent verifier: catches a consistent liar; fail-closed on missing instrument. (T1.4 AC) */
import { describe, it, expect } from "vitest";
import { IndependentVerifier, instrumentKey } from "../verifier.live.js";
import type { SettleInstrument } from "../../ports/settle-instrument.port.js";
import { FixedInstrument, makeEnvelope } from "./_fixtures.js";

function instrumentsWith(...insts: SettleInstrument[]): Map<string, SettleInstrument> {
  const m = new Map<string, SettleInstrument>();
  for (const i of insts) m.set(instrumentKey(i.id, i.sha), i);
  return m;
}

describe("IndependentVerifier", () => {
  it("catches a producer that lies consistently (recompute disagrees) → not settled", async () => {
    // The instrument, re-executed independently, FALSIFIES the claim...
    const instrument = new FixedInstrument("inst", "sha1", {
      verdict: "FALSIFIED",
      measurement: "0",
    });
    const verifier = new IndependentVerifier(instrumentsWith(instrument));

    // ...even though the producer self-reports HELD/settled across the board.
    const envelope = makeEnvelope({
      instrument_id: "inst",
      instrument_sha: "sha1",
      self_reported_verdict: "HELD",
      self_reported_tier: "settled",
    });

    const earned = await verifier.recomputeEarnedTier(envelope);
    expect(earned).toBe("abstained"); // FALSIFIED → abstained, NOT settled
    expect(earned).not.toBe("settled");
  });

  it("settles when the independent re-execution HELDs", async () => {
    const instrument = new FixedInstrument("inst", "sha1", { verdict: "HELD", measurement: "1" });
    const verifier = new IndependentVerifier(instrumentsWith(instrument));
    const envelope = makeEnvelope({ instrument_id: "inst", instrument_sha: "sha1" });
    expect(await verifier.recomputeEarnedTier(envelope)).toBe("settled");
  });

  it("abstains (fail-closed) when the instrument is missing or sha-drifted", async () => {
    const verifier = new IndependentVerifier(instrumentsWith());
    const missing = makeEnvelope({ instrument_id: "inst", instrument_sha: "sha1" });
    expect(await verifier.recomputeEarnedTier(missing)).toBe("abstained");

    // sha drift: instrument exists at sha1, envelope pins sha2 → fail-closed
    const instrument = new FixedInstrument("inst", "sha1", { verdict: "HELD", measurement: "1" });
    const drift = new IndependentVerifier(instrumentsWith(instrument));
    const driftedEnvelope = makeEnvelope({ instrument_id: "inst", instrument_sha: "sha2" });
    expect(await drift.recomputeEarnedTier(driftedEnvelope)).toBe("abstained");
  });
});
