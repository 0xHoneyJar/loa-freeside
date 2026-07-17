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
  })
  .strict();
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
     *  promotion/demotion DELTA does NOT settle against this block — it settles against CURRENT on-chain balances. */
    evidence_block: z.number().int().nonnegative(),
    /** the data sources the decision drew on. */
    sources: z.array(z.string().min(1)).min(1),
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
