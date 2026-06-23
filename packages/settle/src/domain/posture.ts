/**
 * PostureLevel — the blast-radius ladder a domain is classified into. (T1.1)
 *
 * `FAIL_CLOSED` (highest) → `VERIFY_THEN_PROCEED` → `FEEDBACK_LOOP` → `FREE`.
 * Each maps to the required tier the gate enforces. FEEDBACK_LOOP is special:
 * taste/feel/voice domains are never forced to settle — the gate proceeds on
 * `claimed` there (SDD §5.2). The mapping is the machine twin of the vault
 * grounding ladder.
 */

import type { Tier } from "./tier.js";

export type PostureLevel =
  | "FAIL_CLOSED"
  | "VERIFY_THEN_PROCEED"
  | "FEEDBACK_LOOP"
  | "FREE";

/** The tier a posture requires before a must-settle action may proceed. */
export function postureToRequiredTier(p: PostureLevel): Tier {
  switch (p) {
    case "FAIL_CLOSED":
      return "settled"; // money/ops/auth/deployed — nothing below settled proceeds
    case "VERIFY_THEN_PROCEED":
      return "pinned"; // evidence must at least be pinned
    case "FEEDBACK_LOOP":
      return "claimed"; // taste/feel/voice — claimed-ok, never forced to settle
    case "FREE":
      return "claimed";
  }
}

/**
 * Does this posture block (i.e., is it a must-verify posture)? FEEDBACK_LOOP and
 * FREE never block on tier; FAIL_CLOSED and VERIFY_THEN_PROCEED do. Used by the
 * gate to apply the FEEDBACK_LOOP exemption explicitly (not just via tier math).
 */
export function postureIsFeedbackLoop(p: PostureLevel): boolean {
  return p === "FEEDBACK_LOOP";
}
