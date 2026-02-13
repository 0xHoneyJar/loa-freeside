/**
 * Event-specific data schemas for the `data` field of GatewayEvent.
 *
 * Each schema corresponds to one event_type value and describes the shape
 * of the `data` payload that Rust serializes into GatewayEvent.data.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Guild events
// ---------------------------------------------------------------------------

/**
 * data payload for event_type = "guild.join"
 *
 * Rust serializes the full Twilight guild object via `serde_json::to_value(guild)`,
 * which produces 40+ fields. This schema validates only the fields the worker
 * currently reads. `.passthrough()` is intentional: it allows unknown fields
 * through without stripping them, so the fixture represents the **minimum
 * contract** — not the full envelope.
 *
 * This mirrors Stripe's API team pattern where the public SDK validates a subset
 * of the wire payload and forwards the rest untouched. (BB60-S5-2)
 */
export const GuildJoinDataSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    member_count: z.number().int().optional(),
  })
  .passthrough();

export type GuildJoinData = z.infer<typeof GuildJoinDataSchema>;

/**
 * data payload for event_type = "guild.leave"
 */
export const GuildLeaveDataSchema = z.object({
  unavailable: z.boolean().optional(),
});

export type GuildLeaveData = z.infer<typeof GuildLeaveDataSchema>;

// ---------------------------------------------------------------------------
// Member events
// ---------------------------------------------------------------------------

/**
 * data payload for event_type = "member.join"
 */
export const MemberJoinDataSchema = z.object({
  username: z.string(),
  discriminator: z.number().int().nullable(),
});

export type MemberJoinData = z.infer<typeof MemberJoinDataSchema>;

/**
 * data payload for event_type = "member.leave"
 * Rust sends Value::Null — an empty object or null.
 */
export const MemberLeaveDataSchema = z.union([z.null(), z.object({})]);

export type MemberLeaveData = z.infer<typeof MemberLeaveDataSchema>;

/**
 * data payload for event_type = "member.update"
 */
export const MemberUpdateDataSchema = z.object({
  roles: z.array(z.string()),
  nick: z.string().nullable(),
});

export type MemberUpdateData = z.infer<typeof MemberUpdateDataSchema>;

// ---------------------------------------------------------------------------
// Interaction events
// ---------------------------------------------------------------------------

/**
 * data payload for event_type = "interaction.create"
 *
 * Maps directly to the serde_json::json! block in serialize.rs lines 133-137.
 * Note: field is "interaction_token" (NOT "token") per BB60-20 fix.
 */
export const InteractionCreateDataSchema = z.object({
  interaction_id: z.string(),
  interaction_type: z.string(),
  interaction_token: z.string(),
});

export type InteractionCreateData = z.infer<typeof InteractionCreateDataSchema>;
