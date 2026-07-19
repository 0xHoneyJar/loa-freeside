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
 *
 * S5-T3 — BRIDGING IS NOT SELLING. This teaser was single-source, and on one chain of a bridged collection
 * a holder who BRIDGED OUT looks exactly like a holder who SOLD: they qualified at the snapshot and no
 * longer do *on that chain*. They were counted in `sold_lapsed`, i.e. in the public, sales-facing
 * `stale_access_upper_bound` — inflating the very number we lead with. The teaser now reconstructs the same
 * UNION the authed audit does (`any-source`, fail-closed on any unreachable source), so a wallet that moved
 * its token to a sibling deployment still qualifies and is NOT counted as churned out.
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
import type { OwnershipSource, WhaleSource } from './audit-service.js';
import {
  qualifiesAnySource,
  reconstructUnion,
  UNION_SEMANTICS,
  walletsAcross,
  type SourceResolver,
} from './collection-union.js';

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
  /** S5-T3 — the ADDRESSED deployment → the collection's FULL source set. Required for the same reason
   *  the audit requires it: a single-source teaser reports BRIDGING as SELLING (see the header). */
  sources: SourceResolver;
  k?: number;
}

export interface AccessRiskOutput {
  run_id: string;
  inputs_hash: string;
  /** Names the epistemic basis so this can never be read as the real stale-access set. */
  access_basis: 'on-chain-only';
  /**
   * How the collection's deployments were combined (S5-T3). `any-source`: a wallet qualifies iff it
   * meets the threshold on AT LEAST ONE declared deployment. Stated, not assumed — a reader cannot
   * otherwise tell whether a cross-chain holder was counted once, twice, or not at all.
   */
  union_semantics: typeof UNION_SEMANTICS;
  /**
   * EVERY deployment reconstructed — the CHAIN and the block it was read at. A missing one is
   * impossible: an unreachable source refuses the whole request rather than serving a partial union.
   *
   * Chains + blocks, deliberately NOT contract addresses. This payload is public and unauthenticated,
   * and it holds a hard invariant enforced by test: NO 40-hex address appears anywhere in it. That is
   * the cheap, blanket guard against ever leaking a member wallet through a field nobody re-examined.
   * A contract address is not member data — but keeping the invariant blanket-shaped is worth more than
   * restating a contract the caller supplied and can read back from `GET /v1/collections/:chain/:contract`.
   * The authed audit's `methodology.collection_sources` carries the full contracts.
   */
  collection_sources: Array<{ chain: string; snapshot_block: number }>;
  /** The block of the deployment the CALLER addressed. The full set is `collection_sources`. */
  snapshot_block: number;
  /** Wallets meeting the gate at the snapshot date (the denominator). */
  qualified_at_snapshot: CohortCount;
  /** Qualified@snapshot that NO LONGER qualify — the churn-out set. */
  sold_lapsed: CohortCount;
  /** Same cohort as `sold_lapsed`, named for what it MEANS: the ceiling on sale-attributable stale access. */
  stale_access_upper_bound: CohortCount;
  /** Qualify NOW but did NOT at the snapshot — on-chain churn-in (may be missing access today). */
  newly_eligible: CohortCount;
  /**
   * sold_lapsed / qualified@snapshot — but ONLY when `sold_lapsed` is EXACT.
   *
   * NULL when `sold_lapsed` is k-anon-suppressed. This is a hard privacy requirement, not caution:
   * `qualified_at_snapshot` is published EXACTLY (the denominator N is public), so ANY function of the
   * true numerator n back-computes it. Rounding is not suppression — with N=6, round(n/N,1) maps
   * n=1,2,3,4 → 0.2,0.3,0.5,0.7, each value uniquely revealing n and defeating the `<k` bucket entirely.
   * When n is suppressed, no true-ratio-derived number may be emitted at all.
   */
  holder_turnover: number | null;
  /**
   * NULL when the whale source failed OR the collection has multiple deployments whose economic supply
   * cannot be reconciled safely. A missing value must never read as "no whale risk".
   */
  whale_concentration: number | null;
  /**
   * Risk band. When `sold_lapsed` is exact, this is the true band. When suppressed, it is the band of the
   * UPPER BOUND (k-1)/N — a function of k and N only (both public), so it leaks nothing about n while
   * staying consistent with this endpoint's upper-bound contract.
   */
  risk_band: RiskBand;
  /** True when `risk_band` was computed from the suppressed cohort's upper bound rather than the real n. */
  risk_band_is_upper_bound: boolean;
  cta: Cta;
  disclosure: string;
}

export type AccessRiskResult =
  | { ok: true; output: AccessRiskOutput }
  | { ok: false; refusal: Refusal };

const DISCLOSURE =
  'On-chain only. This is the set of wallets that qualified at your snapshot date and no longer do — ' +
  'the CEILING on stale access attributable to sales, not the actual stale-access set. The real number ' +
  'requires your role snapshot (who actually holds the role today). Computed across EVERY chain your ' +
  'collection is deployed on: a wallet that qualifies on any one of them still qualifies, so moving a ' +
  'token between chains is not counted as selling it. Whale concentration is unavailable for multi-chain ' +
  'collections until bridge escrow and represented supply can be reconciled without double-counting.';

export async function computeAccessRisk(
  req: AccessRiskRequest,
  deps: AccessRiskDeps,
): Promise<AccessRiskResult> {
  const k = deps.k ?? DEFAULT_K;
  const addressed = { chain: req.chain, contract: req.contract };

  // 1. THE UNION (S5-T3) — the caller names ONE deployment; it ADDRESSES the collection. An undeclared
  //    contract is refused (the route gates on the same registry, so this is belt-and-braces).
  const sources = deps.sources(addressed);
  if (!sources || sources.length === 0) {
    return {
      ok: false,
      refusal: {
        code: 'unindexed-contract',
        reason: 'contract is not in the audited collection registry',
        retryable: false,
      },
    };
  }

  // Ownership reconstruction — any failure is a typed refusal, never a silently-wrong teaser. FAIL-CLOSED
  // across the union: one unreachable source and we refuse, because a partial union counts every holder on
  // the missing chain as churned out — inflating the public number in the alarming direction.
  let perSource: Awaited<ReturnType<typeof reconstructUnion>>;
  try {
    perSource = await reconstructUnion(deps.ownership, sources, req.snapshotDate);
  } catch {
    return {
      ok: false,
      refusal: {
        code: 'reconstruction-failed',
        // The message is SCRUBBED of any URL before it reaches the caller: this refusal is returned
        // verbatim (and access-risk is the ANONYMOUS teaser), and RPC endpoint URLs carry provider API
        // keys in the path (arrakis-qf5kc).
        // Public refusal surfaces never echo arbitrary upstream diagnostics.
        reason: 'ownership reconstruction failed',
        retryable: true,
      },
    };
  }
  const snapBals = perSource.map((p) => p.snapshot);
  const curBals = perSource.map((p) => p.current);

  // 2. Cohorts — the SAME gate policy AND the same union semantics the authed audit uses, so teaser and
  //    audit can never disagree.
  const policy = tokenGatingPolicy(BigInt(req.threshold));
  const qualifies = (maps: readonly Map<string, bigint>[], w: string): boolean =>
    qualifiesAnySource(policy, maps, w);

  const qualifiedSnapshot = walletsAcross(snapBals).filter((w) => qualifies(snapBals, w));
  // A wallet that BRIDGED — gone from the chain it was on, present on a sibling — still qualifies here, so
  // it is NOT in sold_lapsed. Under the old single-source teaser it was, and bridging read as selling.
  const soldLapsed = qualifiedSnapshot.filter((w) => !qualifies(curBals, w));
  // On-chain churn-IN (no roles): qualifies now, did NOT at the snapshot.
  const newlyEligible = walletsAcross(curBals).filter(
    (w) => qualifies(curBals, w) && !qualifies(snapBals, w),
  );

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
          `only fewer than ${k} wallets qualified at ${req.snapshotDate}; ` +
          'the cohort is too small to report without deanonymizing it',
        retryable: false,
      },
    };
  }

  // 4. Whale concentration. A FAILED computation must be NULL, never 0 — on a public, sales-facing payload
  //    a coerced 0 reads as an affirmative "no whale risk", which is a silent lie. The same applies to a
  //    multi-source collection: summing deployments may double-count bridge escrow + represented supply,
  //    while taking either deployment alone would understate concentration. Until the collection registry
  //    carries explicit economic-supply reconciliation rules, the only honest multi-source result is NULL.
  let whale: number | null = null;
  if (perSource.length === 1) {
    try {
      const w = await deps.whale.concentration(curBals[0]!);
      whale = Math.min(1, Math.max(0, w));
    } catch {
      whale = null;
    }
  }

  // 5. Aggregate — k-anon every cohort.
  //
  //    PRIVACY (the subtle one): `qualified_at_snapshot` is published EXACTLY, so the denominator N is
  //    public. That means ANY function of the true numerator n back-computes it when n is suppressed.
  //    Rounding is NOT suppression — with N=6, round(n/N,1) → 0.2/0.3/0.5/0.7 for n=1..4, each uniquely
  //    identifying n and defeating the `<k` bucket. So when the cohort is bucketed we emit NO
  //    true-ratio-derived number: holder_turnover is null, and risk_band is banded from the UPPER BOUND
  //    (k-1)/N — a function of k and N only, both public, therefore leak-free.
  const soldLapsedCohort = kAnonCohort(soldLapsed.length, k);
  const suppressed = soldLapsedCohort.kind === 'bucketed';
  const holder_turnover = suppressed
    ? null
    : holderTurnover(soldLapsed.length, qualifiedSnapshot.length);
  const risk_band = suppressed
    ? staleRiskBand(k - 1, qualifiedSnapshot.length) // worst case consistent with "<k" — leaks nothing
    : staleRiskBand(soldLapsed.length, qualifiedSnapshot.length);

  // Fingerprints the WHOLE union (every source + its block), so two different unions cannot collide on one
  // run_id. ⚠ Changes every previously-issued inputs_hash — a disclosed break (see computeInputsHash).
  const inputs_hash = computeInputsHash({
    sources: perSource.map((p) => ({
      chain: p.source.chain,
      contract: p.source.contract,
      snapshot_block: p.snapshot_block,
    })),
    rule: { kind: 'nft-balance', threshold: req.threshold },
  });
  // The PUBLIC view of the union: chains + blocks, no addresses (see AccessRiskOutput.collection_sources).
  const collection_sources = perSource.map((p) => ({
    chain: p.source.chain,
    snapshot_block: p.snapshot_block,
  }));
  const addressedRun =
    perSource.find(
      (p) =>
        p.source.chain === addressed.chain &&
        p.source.contract.toLowerCase() === addressed.contract.toLowerCase(),
    ) ?? perSource[0]!;

  return {
    ok: true,
    output: {
      run_id: `risk_${sha256Hex(`${inputs_hash}:${req.nowUnixSeconds}`).slice(0, 24)}`,
      inputs_hash,
      access_basis: 'on-chain-only',
      union_semantics: UNION_SEMANTICS,
      collection_sources,
      snapshot_block: addressedRun.snapshot_block,
      qualified_at_snapshot: kAnonCohort(qualifiedSnapshot.length, k),
      sold_lapsed: soldLapsedCohort,
      stale_access_upper_bound: soldLapsedCohort,
      newly_eligible: kAnonCohort(newlyEligible.length, k),
      holder_turnover,
      whale_concentration: whale,
      risk_band,
      risk_band_is_upper_bound: suppressed,
      cta: req.cta,
      disclosure: DISCLOSURE,
    },
  };
}
