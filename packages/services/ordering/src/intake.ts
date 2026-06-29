import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ProductId,
  resolvePreset,
  ORDER_LIFECYCLE_SUBJECTS,
  type OrderPlaced,
} from '@freeside/ordering-protocol';
import type { OrderStore } from './store.js';
import { digestOf } from './digest.js';

/**
 * order-intake (SDD §5) — the internal HTTP edge.
 *
 *   POST /v1/orders     validate envelope + the preset's input schema → persist `placed` →
 *                       enqueue `placed.v1` to the outbox (one atomic step) → 200 { order_id }.
 *                       Invalid input → 400 and NO event (validation failure never emits).
 *   GET  /v1/orders/:id polling status (SDD §13 M-9): order state + result_ref/aggregate; 404
 *                       on unknown id. JetStream stays server-side — the browser polls this.
 *
 * Internal-only for the MVP: the caller asserts `placed_by`. Authenticated operator identity +
 * replay protection is the Member-Access seam (SDD §13 H-6, S4) — NOT an auth design yet.
 */
export interface IntakeDeps {
  store: OrderStore;
  /** Injected clock, unix MILLIseconds. */
  now: () => number;
}

const PlaceOrderBodySchema = z
  .object({
    product: ProductId,
    placed_by: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
  })
  .strict();

export function createIntakeApp(deps: IntakeDeps): Hono {
  const app = new Hono();

  app.post('/v1/orders', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'request body must be JSON' }, 400);
    }

    const body = PlaceOrderBodySchema.safeParse(raw);
    if (!body.success) {
      return c.json({ error: 'invalid order envelope', issues: body.error.issues }, 400);
    }

    // Per-product input validation is the PRESET's job (the audit's gating_rule stays sealed).
    const preset = resolvePreset(body.data.product);
    const inputsParsed = preset.inputSchema.safeParse(body.data.inputs);
    if (!inputsParsed.success) {
      return c.json({ error: 'invalid inputs for product', issues: inputsParsed.error.issues }, 400);
    }

    const order_id = randomUUID();
    const placed_at_unix = Math.floor(deps.now() / 1000);
    const inputs = inputsParsed.data as Record<string, unknown>;
    const inputs_digest = digestOf(inputs);
    const placedEvent: OrderPlaced = { order_id, product: body.data.product, inputs_digest };

    await deps.store.placeOrder(
      {
        order_id,
        product: body.data.product,
        placed_by: body.data.placed_by,
        inputs,
        placed_at_unix,
        inputs_digest,
      },
      { subject: ORDER_LIFECYCLE_SUBJECTS.placed, payload: placedEvent },
    );

    return c.json({ order_id }, 200);
  });

  app.get('/v1/orders/:id', async (c) => {
    const record = await deps.store.get(c.req.param('id'));
    if (!record) return c.json({ error: 'order not found' }, 404);
    return c.json(
      {
        order_id: record.order_id,
        product: record.product,
        state: record.state,
        placed_at_unix: record.placed_at_unix,
        recipe_id: record.recipe_id,
        resolved_buildings: record.resolved_buildings,
        result_ref: record.result_ref,
        output: record.output,
        refusal: record.refusal,
      },
      200,
    );
  });

  return app;
}
