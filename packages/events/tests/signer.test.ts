import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LocalEd25519Signer, StaticPubkeyVerifier, _internal } from "../src/signer.js";

const ZERO_SEED = "0".repeat(64);
const ONE_SEED = "1".repeat(64);

describe("LocalEd25519Signer", () => {
  it("signs + verifies a roundtrip via StaticPubkeyVerifier", async () => {
    const signer = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    const verifier = new StaticPubkeyVerifier().add("kid-A", signer.publicKeyBytes());

    const msg = new TextEncoder().encode("the cluster awakens");
    const sig = await signer.sign(msg);

    assert.equal(await verifier.verify("kid-A", msg, sig), true);
  });

  it("verify fails for the wrong kid", async () => {
    const signerA = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    const signerB = await LocalEd25519Signer.fromSeedHex(ONE_SEED, "kid-B");
    const verifier = new StaticPubkeyVerifier()
      .add("kid-A", signerA.publicKeyBytes())
      .add("kid-B", signerB.publicKeyBytes());

    const msg = new TextEncoder().encode("the cluster awakens");
    const sigByA = await signerA.sign(msg);

    // Same message, but the kid is wrong → verify must fail (sig is over A's key, lookup picks B's)
    assert.equal(await verifier.verify("kid-B", msg, sigByA), false);
  });

  it("verify fails for an unknown kid", async () => {
    const signer = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    const verifier = new StaticPubkeyVerifier();

    const sig = await signer.sign(new TextEncoder().encode("x"));
    assert.equal(await verifier.verify("kid-unknown", new TextEncoder().encode("x"), sig), false);
  });

  it("verify fails for a corrupted signature", async () => {
    const signer = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    const verifier = new StaticPubkeyVerifier().add("kid-A", signer.publicKeyBytes());

    const msg = new TextEncoder().encode("payload");
    const sig = await signer.sign(msg);
    // flip a char in the signature
    const corrupted = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
    assert.equal(await verifier.verify("kid-A", msg, corrupted), false);
  });

  it("verify fails when the message changes", async () => {
    const signer = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    const verifier = new StaticPubkeyVerifier().add("kid-A", signer.publicKeyBytes());

    const sig = await signer.sign(new TextEncoder().encode("original"));
    assert.equal(await verifier.verify("kid-A", new TextEncoder().encode("tampered"), sig), false);
  });

  it("rejects non-32-byte seeds", async () => {
    await assert.rejects(() => LocalEd25519Signer.fromSeedHex("ab", "x"));
  });

  it("publicKeyHex is 64 lowercase hex chars", async () => {
    const signer = await LocalEd25519Signer.fromSeedHex(ZERO_SEED, "kid-A");
    assert.match(signer.publicKeyHex(), /^[0-9a-f]{64}$/);
  });
});

describe("base64url roundtrip (internal helpers)", () => {
  it("encodes + decodes arbitrary bytes losslessly", () => {
    for (const seed of [new Uint8Array([0, 1, 2, 250, 251, 252]), new Uint8Array(64).fill(0xff)]) {
      const enc = _internal.bytesToBase64Url(seed);
      const dec = _internal.base64UrlToBytes(enc);
      assert.deepEqual(dec, seed);
      assert.ok(!enc.includes("="), "no padding");
      assert.ok(!enc.includes("+") && !enc.includes("/"), "url-safe alphabet");
    }
  });
});
