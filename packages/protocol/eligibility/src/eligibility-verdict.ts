import { z } from 'zod';

/**
 * The `EligibilityVerdict` — the OUTPUT of evaluating an `EligibilityRule` against a subject.
 *
 * Deliberately distinct from shadow-audit's `AccessDecisionRecord` (this package never imports
 * it): that record is a per-member *actual-vs-expected* audit datum; THIS is "may this subject
 * proceed?". Keeping them separate is the PRD §7 hedge against welding two bounded contexts into
 * a false shared kernel — "who may order" is not "who passes the audit rule".
 *
 * `degraded` is a FIRST-CLASS outcome (G-5): a checker that structurally cannot evaluate a rule
 * (e.g. a score-backed checker facing `token_balance`/`activity_check`) returns `degraded`, never
 * a silent confident-negative. Refuse-not-approximate (NFR-1).
 */

/** Provenance of the decision. Mirrors the live `ArrakisEligibilityResult.source` (coexistence.ts:169). */
export const EligibilitySource = z.enum(['native', 'score_service', 'native_degraded']);
export type EligibilitySource = z.infer<typeof EligibilitySource>;

export const EligibilityStatus = z.enum(['eligible', 'ineligible', 'degraded']);
export type EligibilityStatus = z.infer<typeof EligibilityStatus>;

/**
 * Discriminated on `status` so the non-eligible outcomes STRUCTURALLY require a `reason` + `code`
 * — the gate maps those directly onto the ordering `OrderRefusal {code, reason}` envelope, so a
 * refusal can never be emitted without a stated cause. `.strict()` on every member.
 */
export const EligibilityVerdictSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('eligible'),
      source: EligibilitySource,
      /** Assigned tier, when the checker resolved one (from ArrakisEligibilityResult). */
      tier: z.string().nullable().optional(),
      /** Conviction score, when the checker resolved one. */
      score: z.number().nullable().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('ineligible'),
      source: EligibilitySource,
      /** Human-readable cause — maps to `OrderRefusal.reason`. */
      reason: z.string().min(1),
      /** Machine code — maps to `OrderRefusal.code`. */
      code: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('degraded'),
      source: EligibilitySource,
      /** Why the checker could not judge — maps to `OrderRefusal.reason`. */
      reason: z.string().min(1),
      /** Machine code — maps to `OrderRefusal.code`. */
      code: z.string().min(1),
    })
    .strict(),
]);

export type EligibilityVerdict = z.infer<typeof EligibilityVerdictSchema>;
