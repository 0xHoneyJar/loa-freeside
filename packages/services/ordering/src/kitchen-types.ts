import { z } from 'zod';

export const EnqueueIngredientKey = z.enum(['sonar', 'score', 'worlds_manifest']);
export type EnqueueIngredientKey = z.infer<typeof EnqueueIngredientKey>;

export const IngredientJob = z.object({
  ingredient: EnqueueIngredientKey,
  kind: z.literal('github_issue'),
  external_ref: z.string().url(),
  external_id: z.string(),
  repo: z.string(),
  idempotency_key: z.string(),
  enqueued_at_unix: z.number().int(),
});
export type IngredientJob = z.infer<typeof IngredientJob>;

export const OperatorAuditEntry = z.object({
  event: z.literal('operator.advance'),
  ingredient: z.string(),
  status: z.string(),
  world_slug: z.string().optional(),
  at_unix: z.number().int(),
});
export type OperatorAuditEntry = z.infer<typeof OperatorAuditEntry>;

export function ingredientJobIdempotencyKey(orderId: string, ingredient: EnqueueIngredientKey): string {
  return `${orderId}:${ingredient}`;
}
