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
     *
     * HONEST COST OF THAT EXEMPTION: because a zero cohort publishes a ratio and a suppressed non-zero
     * one does not, `role_coverage === null` now *implies* `unmatched ∈ [1, k)` — narrowing the public
     * `<k` bucket from `{0..k-1}` to `{1..k-1}`. That discloses EXISTENCE ("at least one member is
     * unlinked"), never IDENTITY, so k-anonymity holds — but it is a real narrowing, so it is stated
     * rather than pretended away.
     *
     * ENFORCED below by `superRefine` — the rule is a CONTRACT, not a comment. It previously lived only
     * in the producer, which meant any other producer (a replay, a cache, a hand-built fixture) could
     * violate it silently. A declared bound with no enforcement site is fiction.
     */
    role_coverage: z.number().min(0).max(1).nullable(),
    /**
     * TRUE when coverage is below the confident bar: the numbers are DIRECTIONAL, not fact.
     * Not derivable from `role_coverage` (which may be null), so it is stated explicitly.
     */
    coverage_uncertain: z.boolean(),
  })
  .strict()
  .superRefine((agg, ctx) => {
    const unmatched = agg.unmatched_role_holders;
    const coverage = agg.role_coverage;

    // (1) A SUPPRESSED cohort may not be accompanied by a true ratio — that back-computes the
    //     suppressed numerator (`unmatched = total × (1 − coverage)`) and defeats the bucket entirely.
    //     The sole exemption is full coverage (ratio 1 ⇔ zero unmatched), which identifies nobody.
    if (unmatched.kind === 'bucketed' && coverage !== null && coverage !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role_coverage'],
        message:
          'role_coverage must be null when unmatched_role_holders is k-anon-suppressed (a true ratio ' +
          'beside a suppressed cohort back-computes it). Only role_coverage === 1 (zero unmatched) is exempt.',
      });
    }

    // (2) Contradiction: a positive unmatched cohort cannot coexist with full coverage.
    if (unmatched.kind === 'exact' && unmatched.value > 0 && coverage === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role_coverage'],
        message: `role_coverage === 1 contradicts unmatched_role_holders === ${unmatched.value} (coverage must be < 1)`,
      });
    }
  });
export type AuditAggregate = z.infer<typeof AuditAggregateSchema>;

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
    /** Authed + community-bound callers only (AssociationVerifier). */
    records: z.array(AccessDecisionRecordSchema).optional(),
    /** The Comparison View (Discrepancy Report) — the migration delta: who would be PROMOTED/DEMOTED at cutover.
     *  Authed + community-bound only (per-member rows carry wallets). The buying-event artifact. */
    comparison: DiscrepancyReportSchema.optional(),
    cta: CtaSchema,
  })
  .strict();
export type AuditOutput = z.infer<typeof AuditOutputSchema>;
