/**
 * BarRegistrar port — the Bar Registration Authority. (T2.2, SKP-002a)
 *
 * A `Bar` (success criterion) must be pinned by a party that is NOT the claim
 * producer, before the run — otherwise the producer self-grades. Registration
 * also content-binds the bar (sha = hash of the criterion) so a criterion can't
 * be edited post-hoc, and carries a TTL/validity window (SKP-005a): a settled
 * claim is valid for the bar through its TTL, not forever.
 */

import type { Bar } from "../domain/claim.js";

export interface BarRegistration {
  readonly bar: Bar;
  readonly registered_by: string;
  readonly registered_at: number;
  readonly ttl: number;
}

export interface BarRegistrar {
  /** Pin a bar. Throws if `registeredBy` is a known producer (self-grading) or
   *  if `bar.sha` does not content-bind `bar.criterion`. */
  register(bar: Bar, registeredBy: string, at: number, ttl: number): BarRegistration;
  /** Is the bar registered and within its TTL at `now`? */
  isValid(barId: string, now: number): boolean;
  get(barId: string): BarRegistration | null;
}
