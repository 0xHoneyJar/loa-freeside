/**
 * Gate port — the synchronous, pre-action seam. (T1.2, SKP-001a)
 *
 * `checkSync` returns a `GateDecision` DIRECTLY — not a `Promise`. This is the
 * load-bearing correction: an async gate cannot block a synchronous action call
 * site (the action would fire before the await resolves). All evidence is
 * pre-computed into a signed snapshot during evidence-prep; the gate only does
 * synchronous reads + synchronous signature verification.
 *
 * The return type being non-Promise is asserted both at compile time
 * (`ports/__tests__/gate-sync-type.test.ts`) and at runtime
 * (`live/__tests__/gate.test.ts`: the result has no `.then`).
 */

import type { TierStamp } from "../domain/tier.js";

export interface GateAction {
  readonly domain: string;
  readonly claim: { readonly id: string };
}

export interface GateDecision {
  readonly proceed: boolean;
  readonly reason: string;
  readonly stamp: TierStamp;
}

export interface Gate {
  /** SYNCHRONOUS. Returns the decision directly; never a Promise. */
  checkSync(action: GateAction): GateDecision;
}
