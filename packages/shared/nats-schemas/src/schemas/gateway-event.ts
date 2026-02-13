/**
 * GatewayEvent schema — mirrors Rust GatewayEvent struct in serialize.rs
 *
 * The committed JSON fixtures in fixtures/ are the neutral source of truth.
 * Both this Zod schema and the Rust serialization tests validate against them.
 */

import { z } from 'zod';

/**
 * Base gateway event envelope.
 * Every message on the NATS wire matches this shape.
 *
 * Field-level contract (maps 1:1 to Rust GatewayEvent):
 *   event_id       — UUIDv4 string
 *   event_type     — dot-separated event classifier (e.g. "guild.join")
 *   shard_id       — Discord shard that produced the event
 *   timestamp      — Unix epoch milliseconds (u64 in Rust → number in JS)
 *   guild_id       — nullable Discord snowflake
 *   channel_id     — nullable Discord snowflake
 *   user_id        — nullable Discord snowflake
 *   data           — event-specific payload (opaque at this level)
 */
export const GatewayEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string().min(1),
  shard_id: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
  guild_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  user_id: z.string().nullable(),
  /**
   * Event-specific payload. Currently typed as `z.unknown()` for forward
   * compatibility: new event types from the Rust gateway are accepted without
   * schema changes on the TypeScript side.
   *
   * Future (v2): Replace with a Zod discriminated union keyed on `event_type`,
   * mapping each event type to its specific data schema (e.g., GuildJoinDataSchema
   * for "guild.join"). This would provide compile-time exhaustiveness checking
   * but requires updating this schema every time the gateway adds a new event.
   * The current design is correct — `z.unknown()` is the right default for
   * forward compatibility. (BB60-S5-4)
   */
  data: z.unknown(),
});

/** Inferred TypeScript type from the Zod schema */
export type GatewayEvent = z.infer<typeof GatewayEventSchema>;

/**
 * Backward-compatible alias.
 * EventNatsConsumer.ts previously defined its own GatewayEventPayload interface;
 * this alias lets consumers migrate without renaming all references.
 */
export type GatewayEventPayload = GatewayEvent;

/**
 * Known event types produced by the Rust gateway.
 * Consumers can use {@link isKnownEventType} to log warnings on unrecognized
 * event types without rejecting them. This provides a dispatch safety guard
 * without the full discriminated union refactor. (BB60-S5-4)
 */
export const KNOWN_EVENT_TYPES = [
  'guild.join',
  'guild.leave',
  'guild.update',
  'member.join',
  'member.leave',
  'member.update',
  'interaction.create',
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** Returns true if the event type is in the known set. */
export function isKnownEventType(type: string): type is KnownEventType {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(type);
}
