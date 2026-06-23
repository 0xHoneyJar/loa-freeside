/**
 * Snapshot signer double — emits a deterministic non-crypto signature. (T1.2)
 * For unit tests that exercise snapshot plumbing without real ed25519. The gate's
 * own tests use the REAL `Ed25519SnapshotSigner` so signature verification is
 * genuinely exercised.
 */
import type { SnapshotSigner } from "../ports/snapshot.port.js";
import type { VerificationSnapshot, SignedSnapshot } from "../domain/snapshot.js";
import { jcsHash } from "../lib/jcs.js";

export class MockSnapshotSigner implements SnapshotSigner {
  readonly publicKey = "mock-public-key";

  sign(snapshot: VerificationSnapshot): SignedSnapshot {
    // A content-bound but non-cryptographic "signature" (hash of the bytes).
    return {
      snapshot,
      alg: "ed25519",
      signature: `mock:${jcsHash(snapshot)}`,
      public_key: this.publicKey,
    };
  }
}
