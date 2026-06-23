/**
 * SyncGate — the unbypassable, fail-closed teeth. (T1.5 AC + G-2)
 *
 * Integration over the real classifier, store, ed25519 signer, and trail. These
 * are the counter-examples the substrate exists to pass.
 */
import { describe, it, expect } from "vitest";
import { SyncGate } from "../gate.live.js";
import { GlobClassifier } from "../classifier.live.js";
import { InMemorySnapshotStore } from "../snapshot-store.live.js";
import { Ed25519SnapshotSigner } from "../snapshot-signer.live.js";
import { MockTrail } from "../../mock/trail.mock.js";
import type { SignedSnapshot } from "../../domain/snapshot.js";
import type { Tier } from "../../domain/tier.js";
import { makeSnapshot } from "./_fixtures.js";

function build(trustedKeyOverride?: string) {
  const store = new InMemorySnapshotStore();
  const trail = new MockTrail();
  const signer = Ed25519SnapshotSigner.generate();
  let now = 1500;
  const gate = new SyncGate({
    classifier: new GlobClassifier(),
    store,
    trail,
    trustedVerifierPublicKey: trustedKeyOverride ?? signer.publicKey,
    now: () => now,
  });
  return {
    gate,
    trail,
    signer,
    putSettled(claimId: string, domain: string, earned: Tier, opts?: { prepared_at?: number; ttl?: number; verdict?: "HELD" | "PENDING" }) {
      const snap = makeSnapshot({
        claim_id: claimId,
        domain,
        earned_tier: earned,
        verdict: opts?.verdict ?? "HELD",
        prepared_at: opts?.prepared_at,
        ttl: opts?.ttl,
      });
      store.put(signer.sign(snap));
    },
    putRaw(signed: SignedSnapshot) {
      store.put(signed);
    },
    signSnapshot(claimId: string, domain: string, earned: Tier) {
      return signer.sign(makeSnapshot({ claim_id: claimId, domain, earned_tier: earned }));
    },
    setNow(v: number) {
      now = v;
    },
  };
}

describe("SyncGate", () => {
  it("proceeds when a must-settle domain has a settled snapshot", () => {
    const h = build();
    h.putSettled("c1", "money/transfer", "settled");
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    expect(d.proceed).toBe(true);
    expect(d.stamp.tier).toBe("settled");
  });

  it("BLOCKS a must-settle domain when the claim is only `claimed` (the named AC)", () => {
    const h = build();
    h.putSettled("c1", "money/transfer", "claimed", { verdict: "PENDING" });
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/claimed < required settled/);
  });

  it("does NOT force settlement in a FEEDBACK_LOOP domain (claimed-ok)", () => {
    const h = build();
    // No snapshot at all — taste still proceeds.
    const d = h.gate.checkSync({ domain: "taste/vibe", claim: { id: "c1" } });
    expect(d.proceed).toBe(true);
    expect(d.reason).toMatch(/FEEDBACK_LOOP/);
  });

  it("abstains (never settles) when the snapshot/instrument is missing", () => {
    const h = build();
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "missing" } });
    expect(d.proceed).toBe(false);
    expect(d.stamp.tier).toBe("abstained");
    expect(d.reason).toMatch(/missing evidence/);
  });

  it("abstains on a snapshot signed by an untrusted key (threat A-6)", () => {
    const h = build("some-other-trusted-key-base64");
    h.putSettled("c1", "money/transfer", "settled"); // signed by the real signer, not trusted
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/untrusted signer key/);
  });

  it("abstains on an expired snapshot (SKP-005a TTL)", () => {
    const h = build();
    h.putSettled("c1", "money/transfer", "settled", { prepared_at: 1000, ttl: 100 });
    h.setNow(2000); // 2000 > 1000 + 100
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/expired/);
  });

  it("abstains on a forged snapshot (signature does not cover the rewritten tier)", () => {
    const h = build();
    const signed = h.signSnapshot("c1", "money/transfer", "claimed");
    const forged: SignedSnapshot = {
      ...signed,
      snapshot: { ...signed.snapshot, earned_tier: "settled" }, // attacker rewrites the bit
    };
    h.putRaw(forged);
    const d = h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    expect(d.proceed).toBe(false);
    expect(d.reason).toMatch(/signature invalid/);
  });

  it("requires `pinned` for VERIFY_THEN_PROCEED domains", () => {
    const h = build();
    h.putSettled("c1", "schema/migration", "claimed", { verdict: "PENDING" });
    expect(h.gate.checkSync({ domain: "schema/migration", claim: { id: "c1" } }).proceed).toBe(false);
    h.putSettled("c2", "schema/migration", "pinned");
    expect(h.gate.checkSync({ domain: "schema/migration", claim: { id: "c2" } }).proceed).toBe(true);
  });

  it("appends every decision to the trail with the right shape", () => {
    const h = build();
    h.putSettled("c1", "money/transfer", "claimed", { verdict: "PENDING" });
    h.gate.checkSync({ domain: "money/transfer", claim: { id: "c1" } });
    const entries = h.trail.readAll();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.proceed).toBe(false);
    expect(e.required).toBe("settled");
    expect(e.earned).toBe("claimed");
    expect(e.level).toBe("WARN");
    expect(e.domain).toBe("money/transfer");
    expect(e.claim_id).toBe("c1");
  });

  it("checkSync returns synchronously (not a Promise)", () => {
    const h = build();
    const result = h.gate.checkSync({ domain: "taste/x", claim: { id: "c1" } });
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as { then?: unknown }).then).toBeUndefined();
  });
});
