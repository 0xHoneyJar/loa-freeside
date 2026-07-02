import type { PublicOrder } from '@freeside/ordering-protocol';
import type { OrderRecord } from './store.js';

/**
 * The ONE public order projection (SDD D7) — used by `GET /v1/orders/:id`, the
 * advance-ingredient response, and the reprobe response. This is the redaction
 * boundary: `placed_by`, raw `inputs`, `inputs_digest`, `output_digest`, and
 * `created_at_unix` stay internal. Contract type: `PublicOrderSchema` in
 * `@freeside/ordering-protocol` (pinned by the projection stability test).
 */
export function toPublicOrder(record: OrderRecord): PublicOrder {
  return {
    order_id: record.order_id,
    product: record.product,
    state: record.state,
    placed_at_unix: record.placed_at_unix,
    updated_at_unix: record.updated_at_unix,
    recipe_id: record.recipe_id,
    resolved_buildings: record.resolved_buildings,
    result_ref: record.result_ref,
    output: record.output,
    refusal: record.refusal,
    ingredients: record.ingredients,
    fulfillment: record.fulfillment,
    ingredient_jobs: record.ingredient_jobs,
    operator_audit: record.operator_audit,
    probe_meta: record.probe_meta,
  };
}
