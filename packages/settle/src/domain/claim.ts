/**
 * Claim, Bar, Verdict, VerdictEnvelope. (T1.1)
 *
 * A Claim is an assertion under test. A Bar is the success criterion, pinned
 * (sha) BEFORE evidence — editing the bar is a NEW run (sha changes), never a
 * correction (SKP-002a). A Verdict is the instrument's measured outcome. A
 * VerdictEnvelope is what a producer emits: it embeds the inputs (so an
 * independent verifier can re-execute) AND the producer's self-report — which
 * the verifier IGNORES (SKP-006).
 */

import type { Tier } from "./tier.js";

/**
 * Verdict — the instrument's outcome. The four are deliberately distinct:
 * - `PENDING`      — not yet evaluated (a claim, nothing more).
 * - `HELD`         — evidence confirms the claim against the bar.
 * - `FALSIFIED`    — evidence contradicts the claim.
 * - `INSUFFICIENT` — evidence is inadequate; abstain over fabricate.
 *
 * `PENDING` ≠ `INSUFFICIENT`: pending is "no measurement taken"; insufficient is
 * "measurement taken, inconclusive". They map to different tiers (see
 * verdictToEarnedTier) — pending → `claimed` (can proceed in FREE domains),
 * insufficient → `abstained` (cannot). Collapsing them would let a stalled
 * measurement masquerade as a permissive one.
 */
export type Verdict = "HELD" | "FALSIFIED" | "INSUFFICIENT" | "PENDING";

/** The success criterion, pinned by a non-producer authority before the run. */
export interface Bar {
  readonly id: string;
  readonly criterion: string;
  /** Content hash of the criterion; a change here is a new run, not an edit. */
  readonly sha: string;
}

/** The assertion under test, presented at the gate call-site. */
export interface ClaimInput {
  readonly id: string;
  readonly domain: string;
  readonly statement: string;
}

/**
 * What a producer emits. The verifier re-executes the named instrument against
 * `claim` + `bar` and recomputes the tier from the RECOMPUTED verdict — it never
 * reads `self_reported_verdict` / `self_reported_tier` to decide (SKP-006). Those
 * fields exist only so a detector can later show the producer lied.
 */
export interface VerdictEnvelope {
  readonly claim: ClaimInput;
  readonly bar: Bar;
  readonly instrument_id: string;
  readonly instrument_sha: string;
  /** Producer's claimed outcome — UNTRUSTED, never used by the gate/verifier to decide. */
  readonly self_reported_verdict: Verdict;
  /** Producer's claimed tier — UNTRUSTED. */
  readonly self_reported_tier: Tier;
  /** Producer's measured value (string | decimal-string of a bigint). */
  readonly self_reported_measurement: string;
}

/**
 * Map a (recomputed) Verdict to an earned Tier. Used ONLY on independently
 * recomputed verdicts — never on a producer's self-report.
 */
export function verdictToEarnedTier(v: Verdict): Tier {
  switch (v) {
    case "HELD":
      return "settled";
    case "PENDING":
      return "claimed"; // measured nothing yet → only a claim
    case "FALSIFIED":
      return "abstained"; // evidence contradicts → cannot proceed
    case "INSUFFICIENT":
      return "abstained"; // evidence inadequate → abstain over fabricate
  }
}
