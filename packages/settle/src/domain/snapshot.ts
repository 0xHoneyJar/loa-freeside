/**
 * VerificationSnapshot — the async/sync bridge. (T1.6)
 *
 * The load-bearing flatline correction (SKP-001a): a SYNCHRONOUS gate cannot run
 * an instrument's async I/O inline. Resolution = split the seam in two:
 *
 *   (a) async EVIDENCE-PREP  — BEFORE the action: run the instrument, have the
 *       independent verifier recompute `earned_tier`, freeze it into an immutable
 *       VerificationSnapshot, and SIGN it. (This is register-before-probe.)
 *   (b) sync ENFORCEMENT     — `gate.checkSync` reads the precomputed snapshot,
 *       verifies the signature synchronously, and decides. No I/O at the seam.
 *
 * The signature + a trusted-key check is what makes a snapshot un-forgeable: only
 * the independent verifier's key can mint a `settled` snapshot (threat A-6).
 */

import type { Tier } from "./tier.js";
import type { Verdict } from "./claim.js";

export const SNAPSHOT_SCHEMA = "settle.snapshot.v1" as const;

/** The immutable, signable evidence record. `earned_tier` is the INDEPENDENT
 * recompute, never the producer's self-report. */
export interface VerificationSnapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly claim_id: string;
  readonly domain: string;
  readonly bar_sha: string;
  readonly instrument_id: string;
  readonly instrument_sha: string;
  /** Independently recomputed verdict (not the producer's). */
  readonly verdict: Verdict;
  /** Independently recomputed tier (not the producer's). */
  readonly earned_tier: Tier;
  /** Logical prep time (integer ppm/epoch units); injected, no Date.now in pure code. */
  readonly prepared_at: number;
  /** Validity window in the same units; the gate rejects a snapshot read after
   * `prepared_at + ttl` (SKP-005a: a settled claim is valid through a TTL, not forever). */
  readonly ttl: number;
}

/** A snapshot plus its detached ed25519 signature and the signer's public key. */
export interface SignedSnapshot {
  readonly snapshot: VerificationSnapshot;
  readonly alg: "ed25519";
  /** base64 signature over the JCS-canonical bytes of `snapshot`. */
  readonly signature: string;
  /** base64 SPKI-DER ed25519 public key of the signer. */
  readonly public_key: string;
}
