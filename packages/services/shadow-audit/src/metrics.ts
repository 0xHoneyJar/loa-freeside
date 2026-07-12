/**
 * SDD §11 — deterministic, documented audit metric formulas + k-anonymity.
 *
 * Every formula here is a pure function of integer inputs, so the same audit
 * inputs always yield the same aggregate (longitudinally comparable).
 */

import type { CohortCount, RiskBand } from '@freeside/shadow-audit-protocol';

export const DEFAULT_K = 5;

/**
 * k-anonymity (AC-7): emit an EXACT count only for cohorts of size >= k; smaller
 * cohorts collapse to a coarse `<k` bucket — never an exact small number.
 */
export function kAnonCohort(count: number, k: number = DEFAULT_K): CohortCount {
  if (count >= k) return { kind: 'exact', value: count };
  return { kind: 'bucketed', bucket: `<${k}` };
}

/** holder_turnover = sold_lapsed / qualified@snapshot, in [0,1]; 0 if none qualified. */
export function holderTurnover(soldLapsed: number, qualifiedAtSnapshot: number): number {
  if (qualifiedAtSnapshot <= 0) return 0;
  return soldLapsed / qualifiedAtSnapshot;
}

/**
 * Stale-access risk band from the stale/role ratio. Documented thresholds:
 *   < 5%  → low · < 20% → elevated · otherwise → high.
 */
export function staleRiskBand(staleCount: number, roleCount: number): RiskBand {
  if (roleCount <= 0) return 'low';
  const ratio = staleCount / roleCount;
  if (ratio < 0.05) return 'low';
  if (ratio < 0.2) return 'elevated';
  return 'high';
}

/**
 * ROLE COVERAGE (bug 20260712-486383) — the fraction of role-holders whose wallet we could resolve.
 *
 * Every cohort in the aggregate is computed over the MATCHED role-wallets. An unmatched role-holder is
 * structurally indistinguishable from someone who simply has no role, so low coverage does not merely
 * add noise — it CONTAMINATES: `newly_eligible` (= qualifies && not a known role-wallet) silently
 * swallows every role-holder we could not resolve, and `stale_access_risk_band`'s denominator shrinks
 * to the matched set. Live proof: a THJ snapshot of 515 role-holders resolved 1 wallet (their links
 * live in CollabLand, not identity-api); the audit would have reported ~1813 holders as "newly
 * eligible" and banded stale-access risk on a denominator of 1 — confident, deterministic, and wrong.
 *
 * Documented thresholds (the same "bands, not scores" doctrine as `staleRiskBand`):
 *   < 50% → BELOW THE FLOOR: refuse (`role-coverage-too-low`). The matched set is a minority of the
 *           role-holders, so the unmatched set can dominate every cohort. An aggregate here is not
 *           uncertain, it is MEANINGLESS — and this service refuses rather than serve a vacuous
 *           number (the `cohort-too-small` doctrine in access-risk.ts).
 *   < 90% → served, but LABELLED (`coverage_uncertain`) — directional, not fact.
 *   >= 90% → confident.
 */
export const ROLE_COVERAGE_FLOOR = 0.5;
export const ROLE_COVERAGE_CONFIDENT = 0.9;

/** matched / total role-holders, in [0,1]. Zero role-holders → 0 (an audit with nothing to audit). */
export function roleCoverage(matched: number, total: number): number {
  if (total <= 0) return 0;
  return matched / total;
}
