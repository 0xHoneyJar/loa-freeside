/**
 * Sprint 2 / S2-T1 — a real `WhaleSource` (the audit's concentration port), dependency-free.
 *
 * Sprint 1 built `AuditService` against the `WhaleSource` port but wired only a test fake. The SDD §3
 * sketched a `ScoreProxy`-backed (score-api) variant, but top-holder concentration is a property of the
 * BALANCE DISTRIBUTION itself — the share of total units held by the single largest holder, in [0,1] —
 * so the MVP needs no score-api dependency (and `AuditService` already treats whale as best-effort,
 * clamping + defaulting to 0 on failure). The score-api-weighted (USD-value) variant is a future
 * enhancement, not the MVP.
 *
 * PURE + deterministic: no I/O, fully unit-testable. The audit clamps the result to [0,1].
 */

import type { Balances, WhaleSource } from './audit-service.js';

export function makeBalanceWhaleSource(): WhaleSource {
  return {
    async concentration(balances: Balances): Promise<number> {
      let total = 0n;
      let top = 0n;
      for (const v of balances.values()) {
        if (v <= 0n) continue; // a zero/negative entry is not a holder
        total += v;
        if (v > top) top = v;
      }
      if (total === 0n) return 0; // no holders → no concentration (not a divide-by-zero)
      // the reduced ratio is in [0,1]; float division after the bigint reduction is exact enough for a
      // concentration signal (holder counts are bounded; the audit clamps the result regardless).
      return Number(top) / Number(total);
    },
  };
}
