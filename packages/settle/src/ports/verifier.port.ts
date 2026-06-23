/**
 * Verifier port — independent earned_tier recompute. (T1.2, SKP-006)
 *
 * THE trust root. An implementation MUST NOT import any producer / writer code
 * path (no `quality.py` twin, no module that produced the envelope). It earns the
 * tier from un-forgeable evidence ONLY: re-execute the named instrument, or verify
 * the audit hash-chain. It NEVER reads `envelope.self_reported_tier` to decide.
 *
 * `live/__tests__/verifier-import-boundary.test.ts` fails (CI + local) if a
 * verifier implementation imports anything outside the allowed surface.
 */

import type { Tier } from "../domain/tier.js";
import type { VerdictEnvelope } from "../domain/claim.js";

export interface Verifier {
  /**
   * Recompute the earned tier from un-forgeable evidence. Async (re-exec / chain
   * verification is I/O). Runs during EVIDENCE-PREP, before the gate — its result
   * is frozen into a signed VerificationSnapshot the sync gate later reads.
   * Missing instrument / unverifiable evidence → `abstained` (fail-closed).
   */
  recomputeEarnedTier(envelope: VerdictEnvelope): Promise<Tier>;
}
