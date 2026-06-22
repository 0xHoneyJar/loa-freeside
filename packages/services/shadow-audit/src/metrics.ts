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
