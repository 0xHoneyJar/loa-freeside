/**
 * SDD §3.3 — the audit response.
 *
 * `records` is present ONLY for an authed, community-bound caller
 * (AssociationVerifier); anonymous callers get the aggregate + cta only. The
 * response always carries `run_id` (IMP-007) and `inputs_hash` (IMP-001) for
 * correlation/idempotency. Output mode is always `dogfood-full` — `external`
 * is refused before any output is produced.
 */

import { z } from 'zod';
import { RiskBandSchema } from './common.js';
import { AccessDecisionRecordSchema } from './access-decision-record.js';
import { DiscrepancyReportSchema } from '../discrepancy.js';

/**
 * A cohort size that honors k-anonymity (SDD §11 / AC-7): an EXACT count is
 * only ever emitted when the cohort is >= k (default 5); smaller cohorts are
 * reported as a coarse BUCKET, never an exact small number. This reconciles the
 * §3.3 `*_count` fields with the §11 privacy hardening — the count is always
 * represented, but its precision is privacy-bounded.
 */
export const CohortCountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), value: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('bucketed'), bucket: z.string().min(1) }).strict(),
]);
export type CohortCount = z.infer<typeof CohortCountSchema>;

export const AuditAggregateSchema = z
  .object({
    /** sold_lapsed / snapshot_holders, in [0,1]. Deterministic (SDD §11). */
    holder_turnover: z.number().min(0).max(1),
    sold_lapsed: CohortCountSchema,
    newly_eligible: CohortCountSchema,
    /** The "confront number": role-holders who no longer qualify. */
    stale_access: CohortCountSchema,
    /** Top-holder share in [0,1] (whale concentration). */
    whale_concentration: z.number().min(0).max(1),
    stale_access_risk_band: RiskBandSchema,

    // ── ROLE COVERAGE — what we could NOT see (bug 20260712-486383) ────────────────────────────
    // Every cohort above is computed over the role-holders whose wallet we RESOLVED. A role-holder we
    // could not resolve is structurally indistinguishable from someone with no role, so they silently
    // land in `newly_eligible` and shrink `stale_access_risk_band`'s denominator. These fields make the
    // blind spot part of the answer instead of a hidden assumption. (Coverage below the documented floor
    // does not reach here at all — it is refused as `role-coverage-too-low`.)

    /**
     * Role-holders whose wallet could not be resolved — FLAGGED, never dropped (IMP-005).
     * k-anonymized like every other cohort.
     */
    unmatched_role_holders: CohortCountSchema,
    /**
     * matched / total role-holders, in [0,1] — how much of the role set this audit can actually see.
     *
     * NULL when `unmatched_role_holders` is k-anon-SUPPRESSED and non-zero. This is the same hard
     * privacy rule as `access-risk.ts`'s `holder_turnover`: publishing a true-ratio-derived number
     * beside a suppressed cohort back-computes the suppressed numerator the moment the total is known
     * (and a Discord role's member count is visible to the guild) — "rounding is not suppression".
     * A ZERO unmatched cohort is exempt: it identifies nobody, so `role_coverage: 1` is safe to state.
     */
    role_coverage: z.number().min(0).max(1).nullable(),
    /**
     * TRUE when coverage is below the confident bar: the numbers are DIRECTIONAL, not fact.
     * Not derivable from `role_coverage` (which may be null), so it is stated explicitly.
     */
    coverage_uncertain: z.boolean(),
  })
  .strict();
export type AuditAggregate = z.infer<typeof AuditAggregateSchema>;

// ══ THE DRIFT REPORT (S5-T4) — two measured facts, and two bounded claims derived from them ══════════
//
// thj has ~0% discord→wallet coverage (280 samples / 7 roles / 0 hits) and CollabLand will not export
// member wallets, so the audit cannot name WHICH members are stale. But distinct members need distinct
// wallets, so role-member counts + on-chain holder counts alone BOUND the drift — with zero identity data.
//
// THE HEADLINE IS THE SIDE-BY-SIDE, NOT THE FLOORS. `role_members` next to `per_source_holders` is two
// measured facts with no derivation and no assumption ("HC role: 515 members · Honeycomb held by 2,280
// wallets on ethereum, 1,813 on berachain"). That side-by-side cannot be wrong, and it IS the drift.
//
// THE FLOORS ARE DERIVED, AND THEY ARE NOT SYMMETRICALLY SAFE. Each rests on an identity assumption, and
// when that assumption breaks each errs ALARMIST — it OVERSTATES. The SUM/MAX slack argument (S >= distinct
// holders, M <= distinct holders) makes them conservative against *double-counting*; it does NOT save them
// from an assumption violation. So each floor ships carrying its assumption, the direction of its error, and
// the fact that it bounds WALLETS, not PEOPLE — one person with ten wallets is ten holders.

/** A per-deployment holder count, k-anonymized like every other cohort. CHAIN only: the contracts travel in
 *  `methodology.collection_sources`, and this block is the board — `eth 2,280 · bera 1,813`. */
export const SourceHoldersSchema = z
  .object({
    chain: z.string().min(1),
    holders: CohortCountSchema,
  })
  .strict();
export type SourceHolders = z.infer<typeof SourceHoldersSchema>;

/** stale_floor = max(0, R − S). Sound iff no two members SHARE a wallet. Robust to multi-wallet members. */
export const STALE_FLOOR_ASSUMPTION = 'no two role members hold the role through the same wallet';
export const STALE_FLOOR_BREAKS_WHEN =
  'two or more members share one wallet — the chain sees one holder where the role sees several members, ' +
  'so the floor counts members it cannot separate and OVERSTATES how many have stale access';

/** undergrant_floor = max(0, M − R). Sound iff each member holds via AT MOST ONE wallet — and multi-wallet
 *  members are COMMON in crypto, which makes this the fragile floor. It is also the big number (thj: >=3,350),
 *  so the fragile floor is the one a reader most wants to lead with. It is not the headline. */
export const UNDERGRANT_FLOOR_ASSUMPTION =
  'each role member holds the collection through at most one wallet';
export const UNDERGRANT_FLOOR_BREAKS_WHEN =
  'a member holds through several wallets (common in crypto) — one member is then several holders, so the ' +
  'floor counts as unrecognized holders the wallets of members it has already counted, and OVERSTATES how ' +
  'many qualifying holders lack a role';

export const DRIFT_DISCLOSURE =
  'Read the two counts, not the two floors. The role-member count and the per-chain holder counts are ' +
  'MEASURED — no identity data, no derivation, no assumption — and the gap between them IS the drift. ' +
  'The floors below are DERIVED claims and each bounds a number of WALLETS, never a number of PEOPLE: one ' +
  'person with ten wallets is ten holders. Each names the identity assumption it rests on; when that ' +
  'assumption is violated the floor OVERSTATES — it errs alarmist, not safe. That is why it is never the ' +
  'headline.';

/** A derived floor: the number, and everything a reader needs to know NOT to trust it as a fact about people.
 *  The assumption + violation-direction are LITERALS, not free strings — a floor that ships without its
 *  epistemic basis, or with the sibling floor's basis, must not be representable. */
const derivedFloor = <A extends string, B extends string>(assumption: A, breaksWhen: B) =>
  z
    .object({
      /** A LOWER bound on a count of WALLETS (see `bounds`), under `assumption`. */
      value: z.number().int().nonnegative(),
      /** WALLETS, never people. Stated in the payload so no downstream renderer has to remember it. */
      bounds: z.literal('wallets'),
      assumption: z.literal(assumption),
      breaks_when: z.literal(breaksWhen),
      /** The direction of the error when `assumption` is violated. Both floors err ALARMIST — never "safe". */
      direction_if_violated: z.literal('overstates'),
    })
    .strict();

export const StaleFloorSchema = derivedFloor(STALE_FLOOR_ASSUMPTION, STALE_FLOOR_BREAKS_WHEN);
export const UndergrantFloorSchema = derivedFloor(
  UNDERGRANT_FLOOR_ASSUMPTION,
  UNDERGRANT_FLOOR_BREAKS_WHEN,
);

/**
 * The bounds on (S, M) that are consistent with what was PUBLISHED — computed from the k-anonymized cohorts
 * only, NEVER from the true counts.
 *
 * This is the whole k-anon answer for this block. `role_members` is published exactly (a sub-k role set is
 * REFUSED, never served), so ANY floor computed from a TRUE suppressed count back-computes that count:
 * with R=244, bera=157 exact, eth suppressed, publishing stale_floor=85 says eth=2 out loud. Suppressing the
 * FLOOR instead is fiction — a reader recomputes it from the counts we did publish.
 *
 * So the floors are derived from the worst case consistent with the published buckets:
 *   • `sumUpper` — every suppressed source could hold up to k-1. The LARGEST S we cannot rule out.
 *   • `maxLower` — a suppressed source is < k <= every exact source, so it can never BE the max. The
 *     SMALLEST M we cannot rule out (0 when every source is suppressed).
 * Both are functions of (published exact counts, k, #suppressed) alone — so they leak nothing — and both
 * keep the floors CONSERVATIVE: stale_floor falls as S rises, undergrant_floor rises as M rises, so the
 * published floor is <= the floor the true counts would give. It understates; it never overstates.
 * (This is the same move as access-risk.ts's `risk_band_is_upper_bound`: band the worst case consistent
 * with the bucket, using only k and the public denominator.)
 */
export function publicSourceBounds(
  perSource: ReadonlyArray<{ holders: CohortCount }>,
  k: number,
): { sumUpper: number; maxLower: number; suppressed: number } {
  const exact = perSource.flatMap((s) => (s.holders.kind === 'exact' ? [s.holders.value] : []));
  const suppressed = perSource.length - exact.length;
  return {
    sumUpper: exact.reduce((a, b) => a + b, 0) + suppressed * (k - 1),
    maxLower: exact.length > 0 ? Math.max(...exact) : 0,
    suppressed,
  };
}

/** stale_floor = max(0, R − S): role members the collection's holders cannot account for. SUM >= the distinct
 *  holder count (a cross-chain holder is counted once per chain), so using the SUM understates the floor. */
export function staleFloorFrom(roleMembers: number, bounds: { sumUpper: number }): number {
  return Math.max(0, roleMembers - bounds.sumUpper);
}

/** undergrant_floor = max(0, M − R): holders on a single deployment that the role cannot account for. MAX <=
 *  the distinct holder count, so using the MAX understates the floor. */
export function undergrantFloorFrom(roleMembers: number, bounds: { maxLower: number }): number {
  return Math.max(0, bounds.maxLower - roleMembers);
}

export const DriftReportSchema = z
  .object({
    /** The epistemic basis, NAMED — as `access-risk.ts` names `access_basis: 'on-chain-only'`. `counts-only`:
     *  role COUNTS x on-chain COUNTS. Zero identity data; nobody is named, and nobody CAN be. */
    access_basis: z.literal('counts-only'),

    // ── THE HEADLINE — measured, assumption-free ──────────────────────────────────────────────
    /**
     * Members holding the incumbent role (distinct discord ids) — k-anonymized like EVERY other cohort in
     * this response. A role set below k is BUCKETED, not published exactly: an exact "this role has 3
     * members" is a sub-k cohort disclosure.
     *
     * It is a SUPPRESSION, not a refusal. The audit still serves — its other cohorts already k-anonymize
     * themselves and were reporting small role sets correctly long before this field existed. Refusing the
     * whole audit to protect one optional derived field would be a behaviour regression with a far larger
     * blast radius than the field. Refusal is for a MEANINGLESS answer (`role-coverage-too-low`); suppression
     * is for an UNSAFE-TO-PUBLISH field.
     */
    role_members: CohortCountSchema,
    /** Holders per declared deployment. `role_members` NEXT TO this IS the drift the community must see. */
    per_source_holders: z.array(SourceHoldersSchema).min(1),
    /** The k the cohorts above were suppressed at. Published so the floors are re-derivable by any reader —
     *  and so THIS schema can recompute them (below) rather than trust the producer. (k=1 means "no
     *  suppression": every cohort is exact and the bounds collapse to the true counts. Deploys run k=5.) */
    k_anonymity: z.number().int().min(1),

    // ── THE DERIVED CLAIMS — never the headline, and NULL when they cannot be published safely ─
    /**
     * NULL when `role_members` is k-anon-suppressed. Both floors are functions of R, so publishing one
     * beside a bucketed R back-computes R exactly (`R = stale_floor + S`) — defeating the bucket. The
     * side-by-side survives the suppression; the derived claims do not. That is the whole point of keeping
     * them separable: the assumption-free half is what leads anyway.
     */
    stale_floor: StaleFloorSchema.nullable(),
    undergrant_floor: UndergrantFloorSchema.nullable(),
    /** TRUE ⇒ at least one per-source cohort was k-anon-suppressed, so the floors were derived from the
     *  public worst-case bound rather than the true counts (see `publicSourceBounds`). Mirrors
     *  access-risk.ts's `risk_band_is_upper_bound`: the reader is TOLD the number is bound-derived.
     *  Always FALSE when the floors are suppressed — there is no bound-derived number to flag. */
    floors_from_public_bound: z.boolean(),
    disclosure: z.literal(DRIFT_DISCLOSURE),
  })
  .strict()
  .superRefine((d, ctx) => {
    // (0) The k-anon invariant every cohort here obeys: an EXACT count is only ever emitted at >= k
    //     (`kAnonCohort`). An exact sub-k count in this block is a small-cohort disclosure no matter which
    //     field it sits in — and the floor derivation below TRUSTS exact counts as exact, so a violation
    //     here would silently corrupt the bounds too.
    for (const [path, c] of [
      [['role_members'], d.role_members] as const,
      ...d.per_source_holders.map(
        (s, i) => [['per_source_holders', i, 'holders'], s.holders] as const,
      ),
    ]) {
      if (c.kind === 'exact' && c.value < d.k_anonymity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path],
          message:
            `an exact cohort of ${c.value} is below k (${d.k_anonymity}) — it must be bucketed, not published ` +
            'exactly. An exact sub-k count identifies the members it counts.',
        });
      }
    }

    // (1) A SUPPRESSED role count may not be accompanied by ANY floor. Both floors are functions of R, so a
    //     published floor back-computes the very cohort the bucket hides (`R = stale_floor + S`). This is the
    //     same rule as `role_coverage` above and `holder_turnover` in access-risk.ts: no true-value-derived
    //     number may sit beside the suppressed cohort it derives from. Rounding is not suppression; neither
    //     is a floor. The AUDIT still serves — only the floors are withheld.
    if (d.role_members.kind === 'bucketed') {
      if (d.stale_floor !== null || d.undergrant_floor !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stale_floor'],
          message:
            'both floors must be null when role_members is k-anon-suppressed — a floor beside a bucketed ' +
            'role count back-computes it (R = stale_floor + SUM(holders)) and defeats the bucket entirely.',
        });
      }
      if (d.floors_from_public_bound) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['floors_from_public_bound'],
          message: 'floors_from_public_bound must be false when there are no floors to flag',
        });
      }
      return;
    }

    // (2) THE ENFORCEMENT SITE. With R exact, the floors MUST equal what the PUBLISHED counts derive —
    //     nothing else parses. A producer that computed a floor from a TRUE suppressed HOLDER count
    //     publishes a number that does not match this recomputation, and the mismatch IS the leak: with
    //     R=244, bera=157, eth suppressed, stale_floor=85 back-computes eth=2. Only 83 (the bound) parses.
    //     A declared bound with no enforcement site is fiction — so it is enforced HERE, at the boundary
    //     every producer crosses (the service, a replay, a cache, a hand-built fixture).
    const R = d.role_members.value;
    if (d.stale_floor === null || d.undergrant_floor === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stale_floor'],
        message: 'the floors may only be null when role_members is k-anon-suppressed',
      });
      return;
    }

    const bounds = publicSourceBounds(d.per_source_holders, d.k_anonymity);
    const stale = staleFloorFrom(R, bounds);
    const undergrant = undergrantFloorFrom(R, bounds);

    if (d.stale_floor.value !== stale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stale_floor', 'value'],
        message:
          `stale_floor must be ${stale} — max(0, role_members − SUM(published holder counts, suppressed ` +
          `counted as k−1)). Got ${d.stale_floor.value}, which is derivable only from a count this payload ` +
          'k-anon-suppressed, and therefore back-computes it. Rounding is not suppression; neither is a floor.',
      });
    }
    if (d.undergrant_floor.value !== undergrant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['undergrant_floor', 'value'],
        message:
          `undergrant_floor must be ${undergrant} — max(0, MAX(published holder counts, suppressed counted ` +
          `as 0) − role_members). Got ${d.undergrant_floor.value}, which back-computes a suppressed count.`,
      });
    }

    // (3) The bound-derived flag must not lie: it is TRUE exactly when a holder cohort was suppressed.
    if (d.floors_from_public_bound !== bounds.suppressed > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['floors_from_public_bound'],
        message:
          `floors_from_public_bound must be ${bounds.suppressed > 0} (${bounds.suppressed} of ` +
          `${d.per_source_holders.length} per-source cohorts are k-anon-suppressed)`,
      });
    }
  });
export type DriftReport = z.infer<typeof DriftReportSchema>;

export const CtaSchema = z
  .object({
    /** The product door (the Shadow Access control-plane). */
    product: z.string().min(1),
    /** The conversation door (the interview — the falsifier). */
    conversation: z.string().min(1),
  })
  .strict();
export type Cta = z.infer<typeof CtaSchema>;

/**
 * The settle-context of the delta — the exact basis a buyer needs to verify the migration delta reflects the
 * incumbent's REAL enforced policy, not a Freeside-vs-Freeside artifact. The promotion/demotion delta is the
 * INCUMBENT's current roles (sampled at `role_snapshot_at`) × CURRENT on-chain qualification under `rule_id`.
 * NOTE the basis honestly: the delta settles against CURRENT on-chain balances, NOT against `evidence_block`
 * (which anchors the per-member `balance_at_snapshot` evidence + the historical `sold_lapsed` metric). Anon-safe.
 */
export const MethodologySchema = z
  .object({
    /** the gating rule used to compute on-chain qualification, e.g. "nft-balance:1". */
    rule_id: z.string().min(1),
    /** ISO-8601 — when the incumbent's roles (the Discord snapshot) were sampled. The "incumbent side" of the delta. */
    role_snapshot_at: z.string().min(1),
    /** the historical block the per-member `balance_at_snapshot` evidence + `sold_lapsed` are anchored at. The
     *  promotion/demotion DELTA does NOT settle against this block — it settles against CURRENT on-chain balances.
     *  With a multi-chain collection this is the block of the deployment the ORDER addressed; the per-source
     *  blocks the union was actually read at are in `collection_sources` (one per declared deployment). */
    evidence_block: z.number().int().nonnegative(),
    /** the data sources the decision drew on. */
    sources: z.array(z.string().min(1)).min(1),

    // ── MULTI-SOURCE UNION (S5-T3) — the union is NAMED, never assumed ────────────────────────
    /**
     * How the collection's deployments were combined. `any-source`: a wallet qualifies iff it meets
     * the threshold on AT LEAST ONE declared deployment (the threshold is applied PER-SOURCE).
     *
     * The rejected alternative was SUMMING balances across chains — a bridged token would then be
     * double-counted while in flight, and a wallet under threshold everywhere could be manufactured
     * into qualification. The two only differ when `threshold > 1`; the choice is stated anyway,
     * because an unnamed choice is one nobody can audit.
     */
    union_semantics: z.literal('any-source'),
    /** EVERY declared deployment the union was reconstructed over, each with the block it was read at.
     *  This is the set the `inputs_hash` fingerprints — a reader can re-derive the run from it. */
    collection_sources: z
      .array(
        z
          .object({
            chain: z.string().min(1),
            contract: z.string().min(1),
            snapshot_block: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type Methodology = z.infer<typeof MethodologySchema>;

export const AuditOutputSchema = z
  .object({
    run_id: z.string().min(1),
    mode: z.literal('dogfood-full'),
    inputs_hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'inputs_hash must be 64-char lowercase hex'),
    aggregate: AuditAggregateSchema,
    /** The settle-context — travels with the AUTHED delta (alongside `records`/`comparison`): the rule + snapshot
     *  the delta was computed under, so a buyer can verify it matches the incumbent's policy. Kept OUT of the anon
     *  aggregate response so that response stays byte-stable for strict-decoding consumers (freeside-dashboard
     *  decodes GET /v1/audit with `onExcessProperty: error` — a new anon field silently breaks it). */
    methodology: MethodologySchema.optional(),
    /**
     * The DRIFT REPORT (S5-T4) — incumbent role members NEXT TO on-chain holder counts, plus the two
     * bounded floors derived from them. Needs ZERO identity data, so it works for thj (~0% wallet coverage).
     *
     * Travels with the AUTHED delta, NOT in the anon aggregate — for the same reason `methodology` does:
     * freeside-dashboard strict-decodes GET /v1/audit with `onExcessProperty: error` AT ANY DEPTH, so a new
     * anon field makes it reject every 200 and render empty (the incident logged at audit-router.ts). The
     * anon HUMAN surface (GET /v1/audit/view) renders the same report from the service result, where no
     * strict decoder can be broken by it. Putting this in the anon JSON requires a coordinated dashboard change.
     */
    drift: DriftReportSchema.optional(),
    /** Authed + community-bound callers only (AssociationVerifier). */
    records: z.array(AccessDecisionRecordSchema).optional(),
    /** The Comparison View (Discrepancy Report) — the migration delta: who would be PROMOTED/DEMOTED at cutover.
     *  Authed + community-bound only (per-member rows carry wallets). The buying-event artifact. */
    comparison: DiscrepancyReportSchema.optional(),
    cta: CtaSchema,
  })
  .strict();
export type AuditOutput = z.infer<typeof AuditOutputSchema>;
