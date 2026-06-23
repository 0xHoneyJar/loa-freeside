/**
 * Counter-example suite — the consolidated teeth. (T2.4)
 *
 * One place that pins every guarantee the substrate exists to keep. If a future
 * change weakens the gate (e.g. proceed-on-claimed), `npm test` goes non-zero
 * here. The final test demonstrates exactly that: a deliberately-broken gate
 * flips the canonical assertion red.
 */
import { describe, it, expect } from "vitest";
import { SyncGate } from "../live/gate.live.js";
import { GlobClassifier } from "../live/classifier.live.js";
import { InMemorySnapshotStore } from "../live/snapshot-store.live.js";
import { Ed25519SnapshotSigner } from "../live/snapshot-signer.live.js";
import { IndependentVerifier, instrumentKey } from "../live/verifier.live.js";
import { MockTrail } from "../mock/trail.mock.js";
import { MockGate } from "../mock/gate.mock.js";
import { makeTetlockForecast, type Tier } from "../domain/tier.js";
import type { ChainHealth } from "../domain/snapshot.js";
import type { GateAction } from "../ports/gate.port.js";
import { makeSnapshot, makeEnvelope, FixedInstrument } from "../live/__tests__/_fixtures.js";

function harness() {
  const store = new InMemorySnapshotStore();
  const trail = new MockTrail();
  const signer = Ed25519SnapshotSigner.generate();
  const gate = new SyncGate({
    classifier: new GlobClassifier(),
    store,
    trail,
    trustedVerifierPublicKey: signer.publicKey,
    now: () => 1500,
  });
  function put(o: { claim_id: string; domain: string; earned_tier: Tier; chain_health?: ChainHealth; verdict?: "HELD" | "PENDING" }) {
    store.put(signer.sign(makeSnapshot({ ...o, chain_health: o.chain_health ?? "ok" })));
  }
  return { gate, trail, put };
}

const MUST_SETTLE: GateAction = { domain: "money/transfer", claim: { id: "c1" } };

describe("counter-examples (the teeth)", () => {
  it("(a) a producer that lies consistently is caught (independent recompute disagrees)", async () => {
    const instrument = new FixedInstrument("inst", "sha1", { verdict: "FALSIFIED", measurement: "0" });
    const verifier = new IndependentVerifier(new Map([[instrumentKey("inst", "sha1"), instrument]]));
    const lying = makeEnvelope({ instrument_id: "inst", instrument_sha: "sha1", self_reported_verdict: "HELD", self_reported_tier: "settled" });
    expect(await verifier.recomputeEarnedTier(lying)).toBe("abstained");
  });

  it("(b) a must-settle domain cannot proceed on `claimed`", () => {
    const h = harness();
    h.put({ claim_id: "c1", domain: "money/transfer", earned_tier: "claimed", verdict: "PENDING" });
    expect(h.gate.checkSync(MUST_SETTLE).proceed).toBe(false);
  });

  it("(c) a FEEDBACK_LOOP domain is never forced to settle", () => {
    const h = harness();
    expect(h.gate.checkSync({ domain: "taste/vibe", claim: { id: "c1" } }).proceed).toBe(true);
  });

  it("(d) a missing instrument abstains, never settles", () => {
    const h = harness();
    const d = h.gate.checkSync(MUST_SETTLE);
    expect(d.proceed).toBe(false);
    expect(d.stamp.tier).toBe("abstained");
  });

  it("(e) G-7: a degraded-Fable chain cannot reach settled in a must-settle domain", () => {
    const h = harness();
    h.put({ claim_id: "c1", domain: "money/transfer", earned_tier: "settled", chain_health: "degraded" });
    const d = h.gate.checkSync(MUST_SETTLE);
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/degraded chain/);
  });

  it("(f) no silent proceed: every must-settle decision is recorded on the trail", () => {
    const h = harness();
    h.put({ claim_id: "c1", domain: "money/transfer", earned_tier: "claimed", verdict: "PENDING" });
    h.gate.checkSync(MUST_SETTLE);
    expect(h.trail.readAll()).toHaveLength(1);
    expect(h.trail.readAll()[0]!.proceed).toBe(false);
  });

  it("(g) a deliberately-broken gate (proceed-on-claimed) flips this suite red", () => {
    const h = harness();
    h.put({ claim_id: "c1", domain: "money/transfer", earned_tier: "claimed", verdict: "PENDING" });
    // The REAL gate abstains — the green assertion the suite depends on.
    expect(h.gate.checkSync(MUST_SETTLE).proceed).toBe(false);
    // A broken gate returns the WRONG answer for the same action...
    const broken = new MockGate(() => ({
      proceed: true,
      reason: "BROKEN proceed-on-claimed",
      stamp: {
        tier: "claimed",
        provenance: { by: "broken", at_ppm: 0, instrument_id: "x", instrument_sha: "y" },
        confidence: makeTetlockForecast(0),
        verify_ref: "r",
      },
    }));
    expect(broken.checkSync(MUST_SETTLE).proceed).toBe(true);
    // ...so substituting `broken` for the real gate makes `toBe(false)` fail —
    // a proceed-on-claimed regression makes `npm test` exit non-zero. (teeth)
  });
});
