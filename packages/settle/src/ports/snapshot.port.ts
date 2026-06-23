/**
 * Snapshot ports — signer + store. (T1.2 / T1.6)
 *
 * SnapshotSigner mints SignedSnapshots during evidence-prep (async-adjacent, but
 * signing itself is sync). SnapshotStore hands them to the gate SYNCHRONOUSLY —
 * `getSync` is the method the sync gate depends on; absence of an entry is a
 * legitimate (fail-closed) outcome, not an error.
 */

import type { VerificationSnapshot, SignedSnapshot } from "../domain/snapshot.js";

export interface SnapshotSigner {
  /** Sign a snapshot over its JCS-canonical bytes. */
  sign(snapshot: VerificationSnapshot): SignedSnapshot;
  /** This signer's public key (base64 SPKI-DER ed25519), for trust config. */
  readonly publicKey: string;
}

export interface SnapshotVerification {
  readonly ok: boolean;
  readonly reason: string;
}

export interface SnapshotStore {
  /** Persist a signed snapshot, keyed by `snapshot.claim_id`. */
  put(signed: SignedSnapshot): void;
  /** SYNCHRONOUS read for the gate. Returns null when no snapshot exists. */
  getSync(claimId: string): SignedSnapshot | null;
}
