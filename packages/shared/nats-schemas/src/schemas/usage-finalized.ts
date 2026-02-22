/**
 * Usage Finalized Event Schema (Sprint 4, Task 4.4)
 *
 * Defines the wire format for `inference.usage.finalized` NATS events.
 * Published by loa-finn after inference completion; consumed by freeside
 * for durable budget finalization independent of HTTP stream.
 *
 * USAGE stream: WorkQueue retention, 72h max age.
 * At-least-once delivery; finalization is idempotent (UNIQUE constraint).
 *
 * @see SDD §4.4 Durable Usage Reporting
 */

import { z } from 'zod';

// --------------------------------------------------------------------------
// Schema
// --------------------------------------------------------------------------

/**
 * Zod schema for inference.usage.finalized event payload.
 *
 * Published by loa-finn after each inference request completes.
 * Contains the budget_reservation_id for correlation with freeside's
 * budget reservation system.
 */
export const UsageFinalizedSchema = z.object({
  /** Budget reservation ID (matches idempotency_key in JWT) */
  budget_reservation_id: z.string().min(1).max(256),
  /** Total tokens consumed (input + output) */
  tokens_used: z.number().int().nonnegative().max(100_000_000),
  /** Input tokens consumed */
  input_tokens: z.number().int().nonnegative().max(100_000_000),
  /** Output tokens consumed */
  output_tokens: z.number().int().nonnegative().max(100_000_000),
  /** Model ID used for inference */
  model: z.string().min(1).max(128),
  /** Pool that served the request */
  pool_used: z.string().min(1).max(128),
  /** Personality ID applied (null if none) */
  personality_id: z.string().max(256).nullable(),
  /** Request latency in milliseconds */
  latency_ms: z.number().int().nonnegative(),
  /** Actual cost in micro-USD (string for BigInt safety) */
  cost_micro_usd: z.string().regex(/^\d+$/, 'Must be non-negative integer string'),
  /** Community ID for budget counter update */
  community_id: z.string().min(1).max(256),
  /** User wallet address */
  user_wallet: z.string().min(1).max(256),
  /** Timestamp of finalization (ISO 8601) */
  finalized_at: z.string().datetime(),
});

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Inferred type for usage finalized event payload */
export type UsageFinalizedEvent = z.infer<typeof UsageFinalizedSchema>;
