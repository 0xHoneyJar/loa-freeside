import { z } from 'zod';
import { ProductId } from './order.js';

/**
 * Order lifecycle event PAYLOAD schemas.
 *
 * These are the payloads only; the ordering SERVICE wraps each in the Hounfour signed
 * envelope (ed25519 + JCS + hash-chain, @0xhoneyjar/events) before publishing on durable
 * JetStream. Subjects: `orders.lifecycle.{placed,routing,producing,fulfilled,failed}.v1`.
 *
 * Terminal events: `fulfilled` (ok) and `failed` (typed, SANITIZED refusal). The public
 * failure event carries a sanitized refusal only — full diagnostic cause belongs on a
 * private ops channel (SDD §13 M-8), never here.
 */

export const ORDER_LIFECYCLE_SUBJECTS = {
  placed: 'orders.lifecycle.placed.v1',
  routing: 'orders.lifecycle.routing.v1',
  producing: 'orders.lifecycle.producing.v1',
  fulfilled: 'orders.lifecycle.fulfilled.v1',
  failed: 'orders.lifecycle.failed.v1',
} as const;

export type OrderLifecyclePhase = keyof typeof ORDER_LIFECYCLE_SUBJECTS;

/** How a building endpoint was resolved. Truthful: `config` for the MVP, `loa-where` once declared. */
export const ResolutionSourceSchema = z.enum(['config', 'loa-where']);
export type ResolutionSource = z.infer<typeof ResolutionSourceSchema>;

/** A resolved building the order will use, named by capability + how it was resolved. */
export const ResolvedBuildingSchema = z
  .object({
    capability: z.string().min(1),
    building: z.string().min(1),
    endpoint: z.string().min(1),
    source: ResolutionSourceSchema,
  })
  .strict();
export type ResolvedBuilding = z.infer<typeof ResolvedBuildingSchema>;

export const OrderPlacedSchema = z
  .object({
    order_id: z.string().min(1),
    product: ProductId,
    /** Digest of the validated inputs (the full canonical signed order is SDD §13 H-5, a later sprint). */
    inputs_digest: z.string().min(1),
  })
  .strict();
export type OrderPlaced = z.infer<typeof OrderPlacedSchema>;

export const OrderRoutingSchema = z
  .object({
    order_id: z.string().min(1),
    recipe_id: z.string().min(1),
    resolved_buildings: z.array(ResolvedBuildingSchema),
  })
  .strict();
export type OrderRouting = z.infer<typeof OrderRoutingSchema>;

export const OrderProducingSchema = z
  .object({
    order_id: z.string().min(1),
    /** Monotonic step index within the recipe (0..n). */
    step: z.number().int().nonnegative(),
    step_label: z.string().min(1),
  })
  .strict();
export type OrderProducing = z.infer<typeof OrderProducingSchema>;

export const OrderFulfilledSchema = z
  .object({
    order_id: z.string().min(1),
    /** Pointer to the persisted result (the store owns the body). */
    result_ref: z.string().min(1),
    output_digest: z.string().min(1),
  })
  .strict();
export type OrderFulfilled = z.infer<typeof OrderFulfilledSchema>;

/** A typed, SANITIZED refusal — safe for the public topic. */
export const OrderRefusalSchema = z
  .object({
    code: z.string().min(1),
    /** Operator-safe one-line reason. Full cause goes to the private ops channel (M-8). */
    reason: z.string().min(1),
  })
  .strict();
export type OrderRefusal = z.infer<typeof OrderRefusalSchema>;

export const OrderFailedSchema = z
  .object({
    order_id: z.string().min(1),
    refusal: OrderRefusalSchema,
  })
  .strict();
export type OrderFailed = z.infer<typeof OrderFailedSchema>;
