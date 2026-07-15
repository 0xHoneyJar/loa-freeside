import { z } from 'zod';
import { RefusalCodeSchema } from './schemas/refusal.js';

/** Canonical public subject. It asserts observation only, never ownership or membership. */
export const PublicGateLeakSubjectSchema = z
  .object({
    chain_id: z.string().min(1),
    contract_address: z.string().min(1),
  })
  .strict();
export type PublicGateLeakSubject = z.infer<typeof PublicGateLeakSubjectSchema>;

export const RequiredPublicInputSchema = z.literal('access_started_at');
export type RequiredPublicInput = z.infer<typeof RequiredPublicInputSchema>;

const SimplePublicJourneyStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('submitted') }).strict(),
  z.object({ state: z.literal('resolving_subject') }).strict(),
  z.object({ state: z.literal('indexing') }).strict(),
  z.object({ state: z.literal('computing') }).strict(),
  z.object({ state: z.literal('delivered_e1') }).strict(),
  z
    .object({
      state: z.literal('refused'),
      refusal_code: RefusalCodeSchema,
    })
    .strict(),
  z.object({ state: z.literal('unavailable') }).strict(),
]);

export const NeedsInputPublicJourneyStateSchema = z
  .object({
    state: z.literal('needs_input'),
    required_input: RequiredPublicInputSchema,
  })
  .strict();

/** State-specific payloads keep `needs_input` and `refused` machine-readable. */
export const PublicJourneyStateSchema = z.union([
  SimplePublicJourneyStateSchema,
  NeedsInputPublicJourneyStateSchema,
]);
export type PublicJourneyState = z.infer<typeof PublicJourneyStateSchema>;

export const PublicJourneyProjectionSchema = z
  .object({
    run_id: z.string().min(1),
    journey_token: z.string().min(1),
    subject: PublicGateLeakSubjectSchema,
    status: PublicJourneyStateSchema,
  })
  .strict();
export type PublicJourneyProjection = z.infer<typeof PublicJourneyProjectionSchema>;

export const AttentionKindSchema = z.enum([
  'submitted',
  'delivered_e1',
  'needs_input',
  'refused',
  'enhance_intent',
  'feedback',
]);
export type AttentionKind = z.infer<typeof AttentionKindSchema>;

/**
 * Privacy boundary for demand telemetry. `.strict()` structurally rejects wallets,
 * roles, email, IP, prose, and sub-k denominators rather than relying on convention.
 */
export const AttentionEventSchema = z
  .object({
    subject_chain_id: z.string().min(1),
    subject_contract_address: z.string().min(1),
    journey_token: z.string().min(1),
    kind: AttentionKindSchema,
    ts: z.string().datetime(),
  })
  .strict();
export type AttentionEvent = z.infer<typeof AttentionEventSchema>;

export const PublicGateLeakOutcomeSchema = z.enum([
  'submitted',
  'resolving_subject',
  'indexing',
  'needs_input',
  'computing',
  'delivered_e1',
  'refused',
  'unavailable',
]);
export type PublicGateLeakOutcome = z.infer<typeof PublicGateLeakOutcomeSchema>;

export interface PublicJourneyProjectionInput {
  run_id: string;
  journey_token: string;
  subject: PublicGateLeakSubject;
  outcome: PublicGateLeakOutcome;
  refusal_code?: z.infer<typeof RefusalCodeSchema>;
  durable_available?: boolean;
}

/** Pure ordering/compute outcome -> public state mapper. No persistence or member data. */
export function projectPublicJourney(input: PublicJourneyProjectionInput): PublicJourneyProjection {
  let status: PublicJourneyState;
  if (input.durable_available === false || input.outcome === 'unavailable') {
    status = { state: 'unavailable' };
  } else if (input.outcome === 'needs_input') {
    status = { state: 'needs_input', required_input: 'access_started_at' };
  } else if (input.outcome === 'refused') {
    if (!input.refusal_code) throw new Error('refused public journey requires refusal_code');
    status = { state: 'refused', refusal_code: input.refusal_code };
  } else {
    status = { state: input.outcome };
  }

  return PublicJourneyProjectionSchema.parse({
    run_id: input.run_id,
    journey_token: input.journey_token,
    subject: input.subject,
    status,
  });
}

/** Stable wire status for the public lifecycle, separate from typed audit refusals. */
export const PUBLIC_JOURNEY_HTTP_STATUS: Record<PublicJourneyState['state'], number> = {
  submitted: 202,
  resolving_subject: 202,
  indexing: 202,
  needs_input: 428,
  computing: 202,
  delivered_e1: 200,
  refused: 422,
  unavailable: 503,
};
