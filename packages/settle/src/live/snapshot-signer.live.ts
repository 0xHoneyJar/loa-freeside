/**
 * Ed25519SnapshotSigner — signs VerificationSnapshots. (T1.6)
 *
 * ed25519 over the JCS-canonical bytes of the snapshot, using `node:crypto` only
 * (zero deps; threat A-8). Only the verifier holds the private key, so only the
 * verifier can mint a snapshot the gate will trust (the public key is configured
 * into the gate as `trustedVerifierPublicKey`). `verifySnapshotSignature` is the
 * gate-side synchronous check.
 */

import {
  generateKeyPairSync,
  sign,
  verify,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import type { SnapshotSigner, SnapshotVerification } from "../ports/snapshot.port.js";
import type { VerificationSnapshot, SignedSnapshot } from "../domain/snapshot.js";
import { jcsCanonicalize } from "../lib/jcs.js";

function snapshotBytes(snapshot: VerificationSnapshot): Buffer {
  return Buffer.from(jcsCanonicalize(snapshot), "utf8");
}

export class Ed25519SnapshotSigner implements SnapshotSigner {
  /** base64 SPKI-DER of the ed25519 public key. */
  readonly publicKey: string;

  constructor(
    private readonly privateKey: KeyObject,
    publicKeyObject: KeyObject,
  ) {
    this.publicKey = publicKeyObject
      .export({ format: "der", type: "spki" })
      .toString("base64");
  }

  /** Generate a fresh signer (verifier-side key custody is the embedder's job). */
  static generate(): Ed25519SnapshotSigner {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new Ed25519SnapshotSigner(privateKey, publicKey);
  }

  sign(snapshot: VerificationSnapshot): SignedSnapshot {
    // ed25519 → algorithm argument is null.
    const signature = sign(null, snapshotBytes(snapshot), this.privateKey).toString("base64");
    return { snapshot, alg: "ed25519", signature, public_key: this.publicKey };
  }
}

/** Synchronous signature check used by the gate. Never throws — a malformed key
 *  or signature returns `{ ok: false }` (fail-closed). */
export function verifySnapshotSignature(signed: SignedSnapshot): SnapshotVerification {
  try {
    const pub = createPublicKey({
      key: Buffer.from(signed.public_key, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = verify(
      null,
      snapshotBytes(signed.snapshot),
      pub,
      Buffer.from(signed.signature, "base64"),
    );
    return { ok, reason: ok ? "signature valid" : "signature invalid" };
  } catch (e) {
    return { ok: false, reason: `verification error: ${(e as Error).message}` };
  }
}
