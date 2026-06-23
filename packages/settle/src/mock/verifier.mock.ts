/** Deterministic Verifier double — recompute is whatever the supplied fn returns. (T1.2) */
import type { Verifier } from "../ports/verifier.port.js";
import type { Tier } from "../domain/tier.js";
import type { VerdictEnvelope } from "../domain/claim.js";

export class MockVerifier implements Verifier {
  constructor(private readonly fn: (envelope: VerdictEnvelope) => Tier) {}

  async recomputeEarnedTier(envelope: VerdictEnvelope): Promise<Tier> {
    return this.fn(envelope);
  }
}
