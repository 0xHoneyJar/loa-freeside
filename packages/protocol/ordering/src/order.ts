import { z } from 'zod';

/**
 * The generic Order envelope — the Ordering bounded context's core type.
 *
 * Product-agnostic by design: it names WHICH product, for WHOM, with a correlation
 * id, and carries product-scoped `inputs` as an opaque record. Per-product input
 * validation is the Preset's job (see preset.ts), NOT this envelope's — that keeps a
 * product's own (often strict) input schema sealed inside the product, never welded
 * into Ordering. (EVANS: this package MUST NOT import a product's own OrderSchema.)
 */

/** Products that can be ordered today. A literal union; grows as presets are added. */
export const ProductId = z.enum(['access-risk-audit', 'community-onboarding']);
export type ProductId = z.infer<typeof ProductId>;

export const OrderEnvelopeSchema = z
  .object({
    /** Correlation id across the whole lifecycle. Opaque here (the service mints it). */
    order_id: z.string().min(1),
    /** The preset key being ordered. */
    product: ProductId,
    /** Internal operator/service identity that placed the order (MVP: internal only). */
    placed_by: z.string().min(1),
    /** Product-scoped inputs — validated by the product's Preset.inputSchema, not here. */
    inputs: z.record(z.string(), z.unknown()),
    /** Unix seconds when the order was placed. */
    placed_at_unix: z.number().int().nonnegative(),
  })
  .strict();

export type OrderEnvelope = z.infer<typeof OrderEnvelopeSchema>;
