/** Snapshot signer: sign/verify roundtrip + tamper/forgery rejection. (T1.6 AC) */
import { describe, it, expect } from "vitest";
import { Ed25519SnapshotSigner, verifySnapshotSignature } from "../snapshot-signer.live.js";
import type { SignedSnapshot } from "../../domain/snapshot.js";
import { makeSnapshot } from "./_fixtures.js";

describe("Ed25519SnapshotSigner", () => {
  it("signs and verifies a roundtrip", () => {
    const signer = Ed25519SnapshotSigner.generate();
    const signed = signer.sign(makeSnapshot({ claim_id: "c1", domain: "money/x", earned_tier: "settled" }));
    expect(signed.alg).toBe("ed25519");
    expect(signed.public_key).toBe(signer.publicKey);
    expect(verifySnapshotSignature(signed).ok).toBe(true);
  });

  it("rejects a tampered snapshot (forged earned_tier) — the forgery teeth", () => {
    const signer = Ed25519SnapshotSigner.generate();
    const signed = signer.sign(makeSnapshot({ claim_id: "c1", domain: "money/x", earned_tier: "claimed" }));
    // Attacker keeps the signature but rewrites earned_tier to settled.
    const forged: SignedSnapshot = {
      ...signed,
      snapshot: { ...signed.snapshot, earned_tier: "settled" },
    };
    expect(verifySnapshotSignature(forged).ok).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const a = Ed25519SnapshotSigner.generate();
    const b = Ed25519SnapshotSigner.generate();
    const snapshot = makeSnapshot({ claim_id: "c1", domain: "money/x", earned_tier: "settled" });
    const signedByA = a.sign(snapshot);
    // Same snapshot bytes, but claim B's public key with A's signature.
    const mismatched: SignedSnapshot = { ...signedByA, public_key: b.publicKey };
    expect(verifySnapshotSignature(mismatched).ok).toBe(false);
  });

  it("never throws on malformed input (fail-closed)", () => {
    const broken = {
      snapshot: makeSnapshot({ claim_id: "c1", domain: "money/x", earned_tier: "settled" }),
      alg: "ed25519" as const,
      signature: "not-base64-valid-sig",
      public_key: "garbage",
    };
    expect(verifySnapshotSignature(broken).ok).toBe(false);
  });
});
