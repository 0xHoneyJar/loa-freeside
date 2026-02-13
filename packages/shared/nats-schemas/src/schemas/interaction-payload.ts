/**
 * InteractionPayload schemas — typed specializations of GatewayEvent
 * for event_type = "interaction.create".
 *
 * Two schema tiers exist to separate transport from enrichment (BB60-S5-1):
 *
 * **Transport** (what Rust produces):
 *   - InteractionTransportDataSchema — 3 required fields from the gateway
 *   - InteractionTransportPayloadSchema — strict wire boundary validation
 *
 * **Enriched** (what TypeScript workers consume after middleware):
 *   - EnrichedInteractionDataSchema — transport + 3 optional command routing fields
 *   - InteractionPayloadSchema — backward-compatible, permissive validation
 *
 * FAANG parallel: Confluent's schema governance post-mortem showed that mixing
 * transport and application schemas causes evolution problems. Keeping them
 * separate means changing an enrichment field never pollutes the wire contract.
 */

import { z } from 'zod';
import { InteractionCreateDataSchema } from './event-data.js';

// ---------------------------------------------------------------------------
// Transport tier — strict, only what Rust produces
// ---------------------------------------------------------------------------

/**
 * Strict transport data: only the 3 fields the Rust gateway serializes.
 * Use this when validating at the NATS wire boundary before any enrichment.
 */
export const InteractionTransportDataSchema = InteractionCreateDataSchema;

// ---------------------------------------------------------------------------
// Enrichment tier — transport + optional middleware fields
// ---------------------------------------------------------------------------

/**
 * Enriched interaction data with optional command routing fields.
 * The base 3 fields come from Rust; command_name/subcommand/options
 * may be populated by a middleware layer or enrichment step.
 */
export const EnrichedInteractionDataSchema = InteractionCreateDataSchema.extend({
  command_name: z.string().optional(),
  subcommand: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Envelope schemas
// ---------------------------------------------------------------------------

/** Shared envelope fields for interaction events. */
const InteractionEnvelopeFields = {
  event_id: z.string().uuid(),
  event_type: z.literal('interaction.create'),
  shard_id: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  guild_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  user_id: z.string().nullable(),
} as const;

/**
 * Strict transport payload — validates only what Rust puts on the wire.
 * Use in consumers that want to validate before enrichment.
 */
export const InteractionTransportPayloadSchema = z.object({
  ...InteractionEnvelopeFields,
  data: InteractionTransportDataSchema,
});

export type InteractionTransportPayload = z.infer<typeof InteractionTransportPayloadSchema>;

/**
 * Full interaction payload as received by CommandNatsConsumer.
 * Uses enriched data (transport + optional command routing fields).
 * This is backward compatible — existing consumers continue to work unchanged.
 */
export const InteractionPayloadSchema = z.object({
  ...InteractionEnvelopeFields,
  data: EnrichedInteractionDataSchema,
});

export type InteractionPayload = z.infer<typeof InteractionPayloadSchema>;
