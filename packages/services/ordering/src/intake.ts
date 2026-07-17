import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ProductId,
  resolvePreset,
  ORDER_LIFECYCLE_SUBJECTS,
  INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS,
  PRESETS,
  type OrderPlaced,
} from '@freeside/ordering-protocol';
import type { OrderStore } from './store.js';
import { digestOf } from './digest.js';
import type { OrderOrchestrator } from './orchestrator.js';
import { IngredientStatus } from '@freeside/ordering-protocol';
import { toPublicOrder } from './projection.js';
import {
  buildCommunityOnboardingOpsNotice,
  fireCommunityOnboardingOpsWebhook,
} from './order-ops-webhook.js';

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
  /**
   * Optional fire-and-forget nudge invoked after a `placed` order is persisted. Prod leaves
   * this UNSET — the NATS consumer drives the order off the `placed` event. The local demo
   * (bin/demo.ts) wires it to drive the orchestrator in-process. Never blocks the 200 response.
   */
  onPlaced?: (orderId: string) => void;
  /** When set, enables the write routes (advance-ingredient, reprobe). */
  orchestrator?: OrderOrchestrator;
  /** Bearer token required for write routes when set. */
  serviceToken?: string;
  /** Label naming the credential — recorded as audit actor identity (NFR-8b). */
  serviceTokenLabel?: string;
  /** Deploy-facing healthz payload extras (write-route posture, store kind, …). */
  healthz?: Record<string, unknown>;
}

const PlaceOrderBodySchema = z
  .object({
    product: ProductId,
    placed_by: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
  })
  .strict();

const AdvanceIngredientBodySchema = z
  .object({
    ingredient: z.enum(['sonar', 'score', 'worlds_manifest', 'discord_observer', 'shadow_preview']),
    status: IngredientStatus,
    world_slug: z.string().min(1).optional(),
    /** Untrusted display metadata (SDD D3) — never audit authority. */
    caller_note: z.string().max(120).optional(),
  })
  .strict();

const ReprobeBodySchema = z
  .object({
    ingredient: z.enum(['sonar', 'score', 'worlds_manifest', 'discord_observer', 'shadow_preview']).optional(),
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

    // Unknown-preset support (FR-1): an unrecognized product gets the available-preset
    // list in the error body — the CLI ships no preset table and surfaces this verbatim.
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as Record<string, unknown>).product === 'string' &&
      !Object.hasOwn(PRESETS, (raw as Record<string, unknown>).product as string)
    ) {
      return c.json(
        {
          error: `unknown product: ${(raw as Record<string, unknown>).product as string}`,
          available_presets: Object.keys(PRESETS),
        },
        400,
      );
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
        ingredients:
          body.data.product === 'community-onboarding'
            ? { ...INITIAL_COMMUNITY_ONBOARDING_INGREDIENTS }
            : undefined,
      },
      { subject: ORDER_LIFECYCLE_SUBJECTS.placed, payload: placedEvent },
    );

    deps.onPlaced?.(order_id);

    if (body.data.product === 'community-onboarding') {
      const notice = buildCommunityOnboardingOpsNotice({
        order_id,
        placed_by: body.data.placed_by,
        inputs,
        placed_at_unix,
      });
      if (notice) fireCommunityOnboardingOpsWebhook(notice);
    }

    return c.json({ order_id }, 200);
  });

  app.get('/v1/orders/:id', async (c) => {
    const record = await deps.store.get(c.req.param('id'));
    if (!record) return c.json({ error: 'order not found' }, 404);
    // ONE public projection for every route (SDD D7).
    return c.json(toPublicOrder(record), 200);
  });

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: 'ordering-service',
      ...deps.healthz,
    }),
  );

  if (deps.orchestrator) {
    const requireToken = (c: Context): boolean => {
      if (!deps.serviceToken) return true;
      return c.req.header('authorization') === `Bearer ${deps.serviceToken}`;
    };

    app.post('/v1/orders/:id/advance-ingredient', async (c) => {
      if (!requireToken(c)) return c.json({ error: 'unauthorized' }, 401);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: 'request body must be JSON' }, 400);
      }

      const body = AdvanceIngredientBodySchema.safeParse(raw);
      if (!body.success) {
        return c.json({ error: 'invalid advance payload', issues: body.error.issues }, 400);
      }

      const result = await deps.orchestrator!.communityOnboarding.advanceIngredient(
        c.req.param('id'),
        body.data.ingredient,
        body.data.status,
        body.data.world_slug,
        { tokenLabel: deps.serviceTokenLabel, callerNote: body.data.caller_note },
      );

      if (!result.ok) {
        const status = result.error === 'order not found' ? 404 : 400;
        return c.json({ error: result.error }, status);
      }

      return c.json(toPublicOrder(result.record!), 200);
    });

    // On-demand fresh probe (SDD D1, FR-4). Token-gated — it triggers outbound
    // building calls. Probe failure is a RESULT in the body, never a 5xx.
    app.post('/v1/orders/:id/reprobe', async (c) => {
      if (!requireToken(c)) return c.json({ error: 'unauthorized' }, 401);

      let raw: unknown = {};
      const text = await c.req.text();
      if (text.length > 0) {
        try {
          raw = JSON.parse(text);
        } catch {
          return c.json({ error: 'request body must be JSON' }, 400);
        }
      }

      const body = ReprobeBodySchema.safeParse(raw);
      if (!body.success) {
        return c.json({ error: 'invalid reprobe payload', issues: body.error.issues }, 400);
      }

      const result = await deps.orchestrator!.communityOnboarding.reprobe(
        c.req.param('id'),
        body.data.ingredient,
      );

      if (!result.ok) {
        if (result.error === 'order not found') return c.json({ error: result.error }, 404);
        if (result.error === 'order already terminal') return c.json({ error: result.error }, 409);
        if (result.error === 'cooldown') {
          return c.json({ error: 'reprobe cooldown active', retry_after_unix: result.retry_after_unix }, 429);
        }
        return c.json({ error: result.error }, 400);
      }

      return c.json({ ...toPublicOrder(result.record), probes: result.probes }, 200);
    });
  }

  return app;
}
