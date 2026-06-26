/**
 * The `shadow.event.v1` envelope (PRD FR-1, SDD §3).
 *
 * Every event carries the same envelope shape; `payload` is typed per `name`
 * via the discriminated union in `events.ts`. `event_id` is the idempotency key
 * (FR-2): replaying the same `event_id` is a no-op.
 */

import { z } from 'zod';
import { SourceKindSchema, TruthStatusSchema } from './common.js';

export const SCHEMA_VERSION = 'shadow.event.v1' as const;

/** The 8 consumed event names (PRD FR-4 + FR-13 revoke). */
export const EventNameSchema = z.enum([
  'discord.member.snapshot.v1',
  'identity.wallet.linked.v1',
  'identity.account.linked.v1',
  'identity.link.revoked.v1',
  'sonar.wallet.attributed.v1',
  'incumbent.role.observed.v1',
  'freeside.role.computed.v1',
  'community.config.updated.v1',
]);
export type EventName = z.infer<typeof EventNameSchema>;

/**
 * Common envelope fields shared by every event. Used as the base for each
 * discriminated member in `events.ts`. ISO-8601 datetimes for observed/emitted.
 */
export const envelopeBase = {
  event_id: z.string().min(1),
  schema_version: z.literal(SCHEMA_VERSION),
  community_id: z.string().min(1),
  source: SourceKindSchema,
  truth_status: TruthStatusSchema,
  observed_at: z.string().datetime(),
  emitted_at: z.string().datetime(),
  evidence_ref: z.string().min(1).optional(),
} as const;

/** Generic envelope type (compile-time convenience; runtime validation is per-event). */
export interface EventEnvelope<TName extends EventName, TPayload> {
  event_id: string;
  schema_version: typeof SCHEMA_VERSION;
  community_id: string;
  name: TName;
  source: z.infer<typeof SourceKindSchema>;
  truth_status: z.infer<typeof TruthStatusSchema>;
  observed_at: string;
  emitted_at: string;
  evidence_ref?: string;
  payload: TPayload;
}
