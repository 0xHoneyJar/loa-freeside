/**
 * S5-T4 (G-2) — the two PROVABLE drift floors, computed with ZERO identity data.
 *
 * THE PROBLEM THIS SOLVES. thj has ~0% discord→wallet coverage (280 samples across 7 roles, 0 hits) and
 * CollabLand will not export member wallets. So the audit cannot name WHICH members are stale — the whole
 * per-member pipeline is blocked on an identity map that does not exist and is not coming. But distinct
 * members need distinct wallets, so the COUNTS alone bound the drift:
 *
 *     stale_floor      = max(0, R − S)      R = role members
 *     undergrant_floor = max(0, M − R)      S = SUM of per-source holder counts
 *                                           M = MAX holders on any single source
 *
 * WHY THE SLACK IS SAFE (the SUM/MAX argument). A wallet holding on two chains is counted twice in S, so
 * S >= the distinct holder count — using it can only make `stale_floor` SMALLER than the truth. M counts a
 * single deployment, so M <= the distinct holder count — using it can only make `undergrant_floor` SMALLER.
 * Both floors therefore understate. That is what makes them FLOORS.
 *
 * ⚠ WHY THAT ARGUMENT DOES NOT SAVE THEM. The slack protects against double-counting. It does NOT protect
 * against an IDENTITY-assumption violation, and the two floors do not rest on the same assumption:
 *
 *   stale_floor      sound iff no two members SHARE a wallet.  Shared wallets  → it OVERSTATES.
 *   undergrant_floor sound iff each member holds via <=1 wallet. Multi-wallet members → it OVERSTATES.
 *
 * Multi-wallet holders are COMMON in crypto, and `undergrant_floor` is the big number (thj: >=3,350). So the
 * FRAGILE floor is the one a reader most wants to lead with, and under violation BOTH err ALARMIST — the
 * confidently-wrong shape this service exists to prevent (it has already shipped one confidently-wrong audit
 * and had two k-anon leaks caught).
 *
 * HOLDERS ARE WALLETS, NOT PEOPLE. One person with ten wallets is ten holders. A floor is a bound over
 * WALLETS and must never be presented as a fact about PEOPLE.
 *
 * HENCE THE SHAPE. The assumption-free SIDE-BY-SIDE leads: `role_members` next to `per_source_holders` —
 * two measured facts, no derivation, no assumption ("HC role: 515 members · Honeycomb held by 2,280 wallets
 * on ethereum, 1,813 on berachain"). That cannot be wrong, and it IS the drift the DoD asks the community to
 * see. The floors ship as clearly-labelled DERIVED claims, each carrying its assumption, its direction of
 * error, and `bounds: 'wallets'`. They are never the headline. This mirrors `access-risk.ts`'s
 * `access_basis` / `stale_access_upper_bound` / `disclosure` contract — the house style for an honest bound.
 *
 * K-ANON lives in the protocol (`publicSourceBounds`): the floors are derived from the PUBLISHED cohorts,
 * never from a true count that was suppressed — else publishing the floor back-computes the count we hid.
 */

import {
  DRIFT_DISCLOSURE,
  STALE_FLOOR_ASSUMPTION,
  STALE_FLOOR_BREAKS_WHEN,
  UNDERGRANT_FLOOR_ASSUMPTION,
  UNDERGRANT_FLOOR_BREAKS_WHEN,
  publicSourceBounds,
  staleFloorFrom,
  undergrantFloorFrom,
  type AccessDecisionPort,
  type DriftReport,
  type SourceHolders,
} from '@freeside/shadow-audit-protocol';
import { kAnonCohort } from './metrics.js';
import type { Balances } from './audit-service.js';
import type { RoleSnapshot } from './role-snapshot.js';

/**
 * R — the number of MEMBERS holding the incumbent role.
 *
 * MEMBERS, not wallets: `resolveRoles` yields a wallet SET, and two members sharing a wallet collapse into
 * one entry there. R is the count the floors need, and the shared-wallet case is exactly the one that makes
 * `stale_floor` overstate — so counting distinct discord ids (rather than entries) keeps a duplicated export
 * row from inflating R, which would inflate `stale_floor` in the alarmist direction.
 */
export function roleMemberCount(snap: RoleSnapshot): number {
  return new Set(snap.entries.map((e) => e.discord_user_id)).size;
}

/** Wallets meeting the gate on ONE deployment. The gate, not "nonzero balance": the drift being bounded is
 *  drift against the GATE, so a sub-threshold holder is not a holder for this purpose. */
export function countQualifying(policy: AccessDecisionPort<bigint>, balances: Balances): number {
  let n = 0;
  for (const v of balances.values()) if (policy.qualifies(v)) n++;
  return n;
}

export interface DriftInputs {
  roleMembers: number;
  /** One entry per DECLARED deployment, in the union's order. Holder counts are the TRUE counts; this
   *  function k-anonymizes them and derives the floors from the SUPPRESSED view — never from these. */
  perSource: ReadonlyArray<{ chain: string; holders: number }>;
  k: number;
}

/**
 * Build the drift report. Every count here is k-anonymized exactly like the cohorts in the aggregate, and the
 * floors are derived from the K-ANONYMIZED view — NOT from `perSource`'s true counts — so a published floor
 * can never back-compute a count the same payload suppressed.
 *
 * WHEN `roleMembers < k` THE FLOORS ARE SUPPRESSED, NOT THE AUDIT. `role_members` buckets like any other
 * cohort, and both floors go NULL — because both are functions of R, so publishing either beside a bucketed R
 * back-computes it (`R = stale_floor + S`). The audit itself still serves: its other cohorts already
 * k-anonymize themselves and reported small role sets correctly long before this field existed. Refusal is
 * the right tool when the ANSWER is meaningless (`role-coverage-too-low`); suppression is the right tool when
 * one optional DERIVED field is unsafe to publish. The assumption-free side-by-side survives either way — and
 * that is the half that leads.
 */
export function computeDrift(inputs: DriftInputs): DriftReport {
  const per_source_holders: SourceHolders[] = inputs.perSource.map((s) => ({
    chain: s.chain,
    holders: kAnonCohort(s.holders, inputs.k),
  }));
  const role_members = kAnonCohort(inputs.roleMembers, inputs.k);

  // A bucketed R cannot carry a floor: both floors are functions of R, so either one hands the bucket back.
  if (role_members.kind === 'bucketed') {
    return {
      access_basis: 'counts-only',
      role_members,
      per_source_holders,
      k_anonymity: inputs.k,
      stale_floor: null,
      undergrant_floor: null,
      floors_from_public_bound: false,
      disclosure: DRIFT_DISCLOSURE,
    };
  }

  // The ONLY view the floors are allowed to see: what we actually published.
  const bounds = publicSourceBounds(per_source_holders, inputs.k);

  return {
    access_basis: 'counts-only',
    role_members,
    per_source_holders,
    k_anonymity: inputs.k,
    stale_floor: {
      value: staleFloorFrom(role_members.value, bounds),
      bounds: 'wallets',
      assumption: STALE_FLOOR_ASSUMPTION,
      breaks_when: STALE_FLOOR_BREAKS_WHEN,
      direction_if_violated: 'overstates',
    },
    undergrant_floor: {
      value: undergrantFloorFrom(role_members.value, bounds),
      bounds: 'wallets',
      assumption: UNDERGRANT_FLOOR_ASSUMPTION,
      breaks_when: UNDERGRANT_FLOOR_BREAKS_WHEN,
      direction_if_violated: 'overstates',
    },
    floors_from_public_bound: bounds.suppressed > 0,
    disclosure: DRIFT_DISCLOSURE,
  };
}
