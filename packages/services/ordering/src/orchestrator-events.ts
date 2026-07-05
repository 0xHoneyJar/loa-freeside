import { z } from 'zod';
import { IngredientStatus } from '@freeside/ordering-protocol';

/**
 * Fulfillment-orchestrator telemetry event PAYLOAD schemas (SDD §4.1 / D-1).
 *
 * The sibling `fulfillment-orchestrator` worker emits these to the SAME durable outbox
 * as the lifecycle events (`store.appendEvent`) — they are additive event kinds, never a
 * schema change (SDD D-1: "new event kinds only"). Lifecycle events are the public order
 * contract; these are the orchestrator's operational trail (`fulfill watch` surfaces
 * `escalate`). Subjects mirror the versioned lifecycle convention
 * (`orders.lifecycle.*.v1` → `orders.orchestrator.*.v1`).
 */

export const ORCHESTRATOR_SUBJECTS = {
  probe: 'orders.orchestrator.probe.v1',
  dispatch: 'orders.orchestrator.dispatch.v1',
  advance: 'orders.orchestrator.advance.v1',
  escalate: 'orders.orchestrator.escalate.v1',
  slug_divergence: 'orders.orchestrator.slug_divergence.v1',
} as const;

export type OrchestratorEventKind = keyof typeof ORCHESTRATOR_SUBJECTS;

/** Snapshot of every ingredient's probed status for one tick. */
export const OrchestratorProbeSchema = z
  .object({
    order_id: z.string().min(1),
    statuses: z.record(z.string(), IngredientStatus),
    /** worlds-api canonical slug, when the worlds probe already resolved one. */
    world_slug: z.string().min(1).optional(),
    at_unix: z.number().int(),
  })
  .strict();
export type OrchestratorProbe = z.infer<typeof OrchestratorProbeSchema>;

/** One idempotent upstream write fired for a `pending` ingredient. */
export const OrchestratorDispatchSchema = z
  .object({
    order_id: z.string().min(1),
    ingredient: z.enum(['sonar', 'score', 'worlds_manifest']),
    ok: z.boolean(),
    /** Stable upstream idempotency key (re-dispatch after crash is safe on this key). */
    idempotency_key: z.string().min(1),
    at_unix: z.number().int(),
  })
  .strict();
export type OrchestratorDispatch = z.infer<typeof OrchestratorDispatchSchema>;

/** An in-process `advanceIngredient()` the orchestrator drove from a green probe. */
export const OrchestratorAdvanceSchema = z
  .object({
    order_id: z.string().min(1),
    ingredient: z.string().min(1),
    status: IngredientStatus,
    world_slug: z.string().min(1).optional(),
    at_unix: z.number().int(),
  })
  .strict();
export type OrchestratorAdvance = z.infer<typeof OrchestratorAdvanceSchema>;

/** A blocked/ambiguous ingredient handed to HITL (D-2). NEVER a silent stall. */
export const OrchestratorEscalateSchema = z
  .object({
    order_id: z.string().min(1),
    ingredient: z.string().min(1),
    reason: z.string().min(1),
    /** `orderId:ingredient:escalate` — lets a consumer dedupe a re-emit after restart. */
    idempotency_key: z.string().min(1),
    at_unix: z.number().int(),
  })
  .strict();
export type OrchestratorEscalate = z.infer<typeof OrchestratorEscalateSchema>;

/**
 * score-api returned a `world_slug` that differs from the worlds-api canonical slug (D-5).
 * Logged, never fatal — worlds is canonical; score's slug is internal to score.
 */
export const SlugDivergenceSchema = z
  .object({
    order_id: z.string().min(1),
    worlds_slug: z.string().min(1),
    score_slug: z.string().min(1),
    at_unix: z.number().int(),
  })
  .strict();
export type SlugDivergence = z.infer<typeof SlugDivergenceSchema>;
