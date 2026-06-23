/**
 * SettleInstrument port. (T1.2)
 *
 * A pluggable, version-pinned verifier of ONE claim against ONE bar. PURE in the
 * sense that matters: SQL / RPC / exit-code / byte-match / hash-verify only — NO
 * LLM, NO `Date.now`, NO rng. Determinism is what lets the independent verifier
 * re-execute it and get the same answer (SKP-006). The no-LLM invariant is
 * enforced by `live/__tests__/no-llm.test.ts`.
 */

import type { Bar, ClaimInput, Verdict } from "../domain/claim.js";

export interface InstrumentResult {
  readonly verdict: Verdict;
  /** Measured value: a string, or the decimal string of a bigint. Never a float. */
  readonly measurement: string;
}

export interface SettleInstrument {
  readonly id: string;
  /** Version pin (SKP-002): a claim settled by id@sha is NOT settled for id@sha'. */
  readonly sha: string;
  settle(claim: ClaimInput, bar: Bar): Promise<InstrumentResult>;
}
