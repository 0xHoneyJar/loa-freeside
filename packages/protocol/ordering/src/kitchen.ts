import { z } from 'zod';
import { ProductId } from './order.js';
import {
  CommunityOnboardingIngredients,
  CommunityOnboardingOutput,
  IngredientStatus,
} from './preset.js';
import { OrderRefusalSchema, ResolvedBuildingSchema } from './events.js';

/**
 * Kitchen contract shapes (fulfillment-surface cycle, SDD D1/D3/D7).
 *
 * Canonical home for the shapes the ordering service's public surface exposes —
 * probe metadata, the operator-advance audit entry, and the ONE public order
 * projection every read/write route returns. The service re-exports these from
 * `kitchen-types.ts`; external consumers (dashboard, freeside-cli) MIRROR the
 * projection shape — they never import this platform package (ADR-007).
 */

export const EnqueueIngredientKey = z.enum(['sonar', 'score', 'worlds_manifest']);
export type EnqueueIngredientKey = z.infer<typeof EnqueueIngredientKey>;

export const IngredientJob = z.object({
  ingredient: EnqueueIngredientKey,
  kind: z.enum(['github_issue', 'http_enqueue']),
  external_ref: z.string(),
  external_id: z.string().optional(),
  repo: z.string().optional(),
  idempotency_key: z.string(),
  enqueued_at_unix: z.number().int(),
});
export type IngredientJob = z.infer<typeof IngredientJob>;

/** Where a recorded probe result came from (SDD D1). */
export const ProbeSource = z.enum(['reprobe', 'interval', 'enqueue']);
export type ProbeSource = z.infer<typeof ProbeSource>;

/** One ingredient's last raw probe truth — what the probe SAID, when, and via which path. */
export const IngredientProbeMeta = z
  .object({
    status: IngredientStatus,
    probed_at_unix: z.number().int(),
    source: ProbeSource,
    /** Why the status was produced when it did not come from a real probe
     *  (e.g. `policy_optional_no_producer`) — the durable trail records the rule
     *  that permitted the transition, not just the state. */
    reason: z.string().optional(),
  })
  .strict();
export type IngredientProbeMeta = z.infer<typeof IngredientProbeMeta>;

/** Per-ingredient probe metadata map. Legacy orders read as `{}` (field absent). */
export const OrderProbeMeta = z.record(z.string(), IngredientProbeMeta);
export type OrderProbeMeta = z.infer<typeof OrderProbeMeta>;

/**
 * Operator/agent advance audit entry (SDD D3).
 *
 * `token_label` + `evidence` are SERVER-derived — `token_label` from the credential that
 * authenticated the request, `evidence` a value COPY of the server's own probe_meta for the
 * advanced ingredient at advance time (`null` when never probed: the HITL escape hatch,
 * visibly ungrounded). `caller_note` is untrusted client display metadata, never authority.
 * Legacy entries carry none of the three.
 */
export const OperatorAuditEntry = z.object({
  event: z.literal('operator.advance'),
  ingredient: z.string(),
  status: z.string(),
  world_slug: z.string().optional(),
  at_unix: z.number().int(),
  token_label: z.string().optional(),
  caller_note: z.string().optional(),
  evidence: IngredientProbeMeta.nullable().optional(),
});
export type OperatorAuditEntry = z.infer<typeof OperatorAuditEntry>;

/**
 * The ONE public order projection (SDD D7) — the exact shape returned by
 * `GET /v1/orders/:id`, the advance response, and the reprobe response. This is the
 * redaction boundary: `placed_by`, raw `inputs`, digests, and internal timestamps stay out.
 */
export const PublicOrderSchema = z
  .object({
    order_id: z.string(),
    product: ProductId,
    state: z.string(),
    placed_at_unix: z.number().int(),
    updated_at_unix: z.number().int(),
    recipe_id: z.string().optional(),
    resolved_buildings: z.array(ResolvedBuildingSchema).optional(),
    result_ref: z.string().optional(),
    output: z.unknown().optional(),
    refusal: OrderRefusalSchema.optional(),
    ingredients: CommunityOnboardingIngredients.optional(),
    fulfillment: CommunityOnboardingOutput.optional(),
    ingredient_jobs: z.array(IngredientJob).optional(),
    operator_audit: z.array(OperatorAuditEntry).optional(),
    probe_meta: OrderProbeMeta.optional(),
  })
  .strict();
export type PublicOrder = z.infer<typeof PublicOrderSchema>;

export function ingredientJobIdempotencyKey(orderId: string, ingredient: EnqueueIngredientKey): string {
  return `${orderId}:${ingredient}`;
}
