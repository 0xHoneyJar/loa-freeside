/**
 * Classifier port — domain → posture. (T1.2)
 *
 * Glob path-classifier (run-mode-ice shape, no regex/LLM). Synchronous: the gate
 * calls it inline. An unknown domain (no rule matches) MUST resolve to the
 * highest posture, `FAIL_CLOSED` (SKP-006) — absence of a rule is not permission.
 */

import type { PostureLevel } from "../domain/posture.js";

export interface Classifier {
  /** Resolve the posture for a domain path. Never throws on unknown input —
   * returns `FAIL_CLOSED`. (Construction MAY throw on a tampered determinism-map.) */
  classify(domain: string): PostureLevel;
}
