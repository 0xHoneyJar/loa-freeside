/**
 * IndependentVerifier — earned_tier from un-forgeable evidence. (T1.4, SKP-006)
 *
 * IMPORT BOUNDARY (the trust root): this module imports ONLY from `../domain/*`
 * and `../ports/*`. It MUST NOT import any producer / writer / quality module.
 * `__tests__/verifier-import-boundary.test.ts` fails (CI + local `vitest run`) if
 * that boundary is crossed.
 *
 * It recomputes the tier by RE-EXECUTING the named instrument against the same
 * claim + bar the producer used, then maps the recomputed verdict to a tier. The
 * producer's `self_reported_verdict` / `self_reported_tier` are never read — a
 * producer that lies consistently across summary and sub-fields is still caught,
 * because the instrument measures the world, not the producer's words.
 */

import type { Verifier } from "../ports/verifier.port.js";
import type { SettleInstrument } from "../ports/settle-instrument.port.js";
import type { Tier } from "../domain/tier.js";
import type { VerdictEnvelope } from "../domain/claim.js";
import { verdictToEarnedTier } from "../domain/claim.js";

/** Stable lookup key for an instrument version pin (id@sha). */
export function instrumentKey(id: string, sha: string): string {
  return `${id}@${sha}`;
}

export class IndependentVerifier implements Verifier {
  constructor(private readonly instruments: ReadonlyMap<string, SettleInstrument>) {}

  async recomputeEarnedTier(envelope: VerdictEnvelope): Promise<Tier> {
    const key = instrumentKey(envelope.instrument_id, envelope.instrument_sha);
    const instrument = this.instruments.get(key);
    if (!instrument) {
      // Missing instrument or sha drift → fail-closed. Absence of proof ≠ proof.
      return "abstained";
    }
    const result = await instrument.settle(envelope.claim, envelope.bar);
    // earned_tier from the RECOMPUTED verdict only; self_reported_* are ignored.
    return verdictToEarnedTier(result.verdict);
  }
}
