/**
 * S2-T3 (G-5, IMP-006) — the PUBLIC access-risk teaser: ON-CHAIN ONLY, no Discord access required.
 *
 * `runAudit()` is role-DEPENDENT: it loads a RoleSnapshot and refuses `external-mode` without one, because
 * its whole claim is "incumbent roles × current on-chain qualification". The teaser must work for a
 * community we have NO Discord access to, so it computes only the on-chain subset of that pipeline:
 *
 *     qualified@snapshot → sold/lapsed → holder_turnover → whale concentration
 *
 * THE HONEST CLAIM. Without roles we CANNOT know the actual stale-access set. What we CAN prove from chain
 * data alone is: of the wallets that qualified at your snapshot date, N no longer qualify. If roles were
 * granted at that date and never re-checked, those N are the wallets whose access is now stale. So
 * `sold_lapsed` is an UPPER BOUND on sale-attributable stale access — not the number itself. The output
 * names that explicitly (`access_basis: 'on-chain-only'`, `stale_access_upper_bound`, `disclosure`) so the
 * teaser can never be misread as the real stale-access count. The real number needs the role snapshot —
 * which is the upsell, and the honest one.
 *
 * NEVER returns member data: aggregate + k-anon cohorts only. No wallets, no records, no role data.
 *
 * ANTI-ENUMERATION (IMP-006): the caller cannot probe arbitrary contracts — the route gates on the
 * COLLECTION_REGISTRY before this is ever called (unknown contract → `unindexed-contract`). Combined with
 * k-anon suppression + a per-IP rate limit, an attacker cannot walk the chain/contract space or difference
 * small cohorts out of the aggregate.
 */

import {
  computeInputsHash,
  sha256Hex,
  tokenGatingPolicy,
  type CohortCount,
  type Cta,
  type Refusal,
  type RiskBand,
} from '@freeside/shadow-audit-protocol';
import { DEFAULT_K, holderTurnover, kAnonCohort, staleRiskBand } from './metrics.js';
import type { Balances, OwnershipSource, WhaleSource } from './audit-service.js';

export interface AccessRiskRequest {
  chain: string;
  contract: string;
  /** ISO date (YYYY-MM-DD) — the "when were roles granted" reference point. */
  snapshotDate: string;
  /** nft-balance threshold; defaults to 1. */
  threshold: number;
  nowUnixSeconds: number;
  cta: Cta;
}

export interface AccessRiskDeps {
  ownership: OwnershipSource;
  whale: WhaleSource;
  k?: number;
}

export interface AccessRiskOutput {
  run_id: string;
  inputs_hash: string;
  /** Names the epistemic basis so this can never be read as the real stale-access set. */
  access_basis: 'on-chain-only';
  snapshot_block: number;
  /** Wallets meeting the gate at the snapshot date (the denominator). */
  qualified_at_snapshot: CohortCount;
  /** Qualified@snapshot that NO LONGER qualify — the churn-out set. */
  sold_lapsed: CohortCount;
  /** Same cohort as `sold_lapsed`, named for what it MEANS: the ceiling on sale-attributable stale access. */
  stale_access_upper_bound: CohortCount;
  /** Qualify NOW but did NOT at the snapshot — on-chain churn-in (may be missing access today). */
  newly_eligible: CohortCount;
  holder_turnover: number;
  whale_concentration: number;
  /** Risk band from the on-chain churn ratio (sold_lapsed / qualified@snapshot). */
  risk_band: RiskBand;
  cta: Cta;
  disclosure: string;
}

export type AccessRiskResult =
  | { ok: true; output: AccessRiskOutput }
  | { ok: false; refusal: Refusal };

const DISCLOSURE =
  'On-chain only. This is the set of wallets that qualified at your snapshot date and no longer do — ' +
  'the CEILING on stale access attributable to sales, not the actual stale-access set. The real number ' +
  'requires your role snapshot (who actually holds the role today).';

export async function computeAccessRisk(
  req: AccessRiskRequest,
  deps: AccessRiskDeps,
): Promise<AccessRiskResult> {
  const k = deps.k ?? DEFAULT_K;
  const collection = { chain: req.chain, contract: req.contract };

  // 1. Ownership reconstruction — any failure is a typed refusal, never a silently-wrong teaser.
  let snapshotBlock: number;
  let snapBal: Balances;
  let curBal: Balances;
  try {
    snapshotBlock = await deps.ownership.resolveSnapshotBlock({
      ...collection,
      snapshotDate: req.snapshotDate,
    });
    [snapBal, curBal] = await Promise.all([
      deps.ownership.balancesAt({ ...collection, snapshotBlock }),
      deps.ownership.currentBalances(collection),
    ]);
  } catch (e) {
    return {
      ok: false,
      refusal: {
        code: 'reconstruction-failed',
        reason: `ownership reconstruction failed: ${(e as Error).message}`,
        retryable: true,
      },
    };
  }

  // 2. Cohorts — the SAME gate policy the authed audit uses, so teaser and audit can never disagree.
  const policy = tokenGatingPolicy(BigInt(req.threshold));
  const qualifies = (m: Balances, w: string): boolean => policy.qualifies(m.get(w) ?? 0n);

  const qualifiedSnapshot = [...snapBal.keys()].filter((w) => qualifies(snapBal, w));
  const soldLapsed = qualifiedSnapshot.filter((w) => !qualifies(curBal, w));
  // On-chain churn-IN (no roles): qualifies now, did NOT at the snapshot.
  const newlyEligible = [...curBal.keys()].filter((w) => qualifies(curBal, w) && !qualifies(snapBal, w));

  // 3. Meaningful-or-refuse (S1-T1 AC: the teaser NEVER returns empty/always-true).
  //    A denominator below k means every cohort would be k-anon-suppressed and holder_turnover would be
  //    either 0 (vacuously "no risk" — an always-true lie) or a ratio that back-computes a tiny cohort.
  //    Refuse instead of serving a meaningless or deanonymizing number.
  if (qualifiedSnapshot.length < k) {
    return {
      ok: false,
      refusal: {
        code: 'cohort-too-small',
        reason:
          `only ${qualifiedSnapshot.length < k ? 'fewer than ' + k : k} wallets qualified at ${req.snapshotDate}; ` +
          'the cohort is too small to report without deanonymizing it',
        retryable: false,
      },
    };
  }

  // 4. Whale concentration (best-effort, clamped) — mirrors runAudit.
  let whale = 0;
  try {
    whale = await deps.whale.concentration(curBal);
  } catch {
    whale = 0;
  }
  whale = Math.min(1, Math.max(0, whale));

  // 5. Aggregate — k-anon every cohort; coarsen the ratio when the numerator is suppressed (BB-4) so it
  //    cannot be used to back-compute the hidden count from a known denominator.
  const soldLapsedCohort = kAnonCohort(soldLapsed.length, k);
  let holder_turnover = holderTurnover(soldLapsed.length, qualifiedSnapshot.length);
  if (soldLapsedCohort.kind === 'bucketed') {
    holder_turnover = Math.round(holder_turnover * 10) / 10;
  }

  const inputs_hash = computeInputsHash({
    chain: req.chain,
    contract: req.contract,
    snapshot_block: snapshotBlock,
    rule: { kind: 'nft-balance', threshold: req.threshold },
  });

  return {
    ok: true,
    output: {
      run_id: `risk_${sha256Hex(`${inputs_hash}:${req.nowUnixSeconds}`).slice(0, 24)}`,
      inputs_hash,
      access_basis: 'on-chain-only',
      snapshot_block: snapshotBlock,
      qualified_at_snapshot: kAnonCohort(qualifiedSnapshot.length, k),
      sold_lapsed: soldLapsedCohort,
      stale_access_upper_bound: soldLapsedCohort,
      newly_eligible: kAnonCohort(newlyEligible.length, k),
      holder_turnover,
      whale_concentration: whale,
      // The on-chain analogue of the audit's band: churn-out ratio, same low/elevated/high thresholds.
      risk_band: staleRiskBand(soldLapsed.length, qualifiedSnapshot.length),
      cta: req.cta,
      disclosure: DISCLOSURE,
    },
  };
}
