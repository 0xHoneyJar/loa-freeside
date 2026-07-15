/**
 * FR-5 / SDD §2 + §6 — EventStore (append-only, consented).
 *
 * The ONLY persistence in the audit (NFR-1): aggregate run-events + consented
 * contact. Member holdings/scores/roles are NEVER stored — the RunEvent schema
 * has no member fields and is `.strict()`, so a smuggled member field is a hard
 * parse failure. Contact capture REQUIRES explicit consent. Append-only: no
 * update/delete in the interface.
 */

import { z } from 'zod';
import {
  AttentionEventSchema,
  PublicGateLeakOutcomeSchema,
  PublicGateLeakSubjectSchema,
  RefusalCodeSchema,
  type AttentionEvent,
  type PublicGateLeakOutcome,
} from '@freeside/shadow-audit-protocol';

export const ReactionSchema = z.enum(['worse', 'expected', 'surprised']);
export type Reaction = z.infer<typeof ReactionSchema>;

export const CtaInteractionSchema = z.enum(['product', 'conversation']);

/** An aggregate run-event. Deliberately carries NO member-level data. */
/**
 * Which lifecycle produced this run. `dogfood-full` is the authed operator audit;
 * `public-gate-leak` is the login-less public teaser (`GET /v1/access-risk`). Both
 * are aggregate-only and member-field-free — the mode only records provenance so a
 * public teaser run can be registered (and thus receive feedback) without pretending
 * to be a full dogfood audit.
 */
export const RunModeSchema = z.enum(['dogfood-full', 'public-gate-leak']);
export type RunMode = z.infer<typeof RunModeSchema>;

export const RunEventSchema = z
  .object({
    run_id: z.string().min(1),
    mode: RunModeSchema,
    inputs_hash: z.string().regex(/^[0-9a-f]{64}$/),
    /** Aggregate cohort size only — never the member list. */
    stale_set_size: z.number().int().nonnegative(),
    time_on_stale_section_ms: z.number().int().nonnegative().optional(),
    reruns: z.number().int().nonnegative(),
    reaction: ReactionSchema.optional(),
    cta_interaction: CtaInteractionSchema.optional(),
    /** ISO-8601 UTC. */
    ts: z.string().datetime(),
  })
  .strict();
export type RunEvent = z.infer<typeof RunEventSchema>;

/** A consented contact capture. `consent` MUST be literally true. */
export const ContactRecordSchema = z
  .object({
    run_id: z.string().min(1),
    contact: z.string().min(1).max(320), // SEC-M3: email-sized cap (storage-abuse guard)
    consent: z.literal(true),
    ts: z.string().datetime(),
  })
  .strict();
export type ContactRecord = z.infer<typeof ContactRecordSchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Immutable first observation for a login-less gate-leak journey. */
export const PublicGateLeakRunSchema = z
  .object({
    run_id: z.string().min(1),
    journey_token: z.string().min(1),
    subject: PublicGateLeakSubjectSchema,
    /** Digest of the original address submission. Never rewritten on resume. */
    inputs_hash: z.string().regex(/^[0-9a-f]{64}$/),
    threshold: z.number().int().positive(),
    outcome: PublicGateLeakOutcomeSchema,
    refusal_code: RefusalCodeSchema.optional(),
    /** Present for a direct compute; absent on the initial needs-input observation. */
    access_started_at: IsoDateSchema.optional(),
    ts: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'refused' && !value.refusal_code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refusal_code'], message: 'required for refused outcome' });
    }
  });
export type PublicGateLeakRun = z.infer<typeof PublicGateLeakRunSchema>;

/** Appended semantic input; the original run/digest remains immutable. */
export const PublicJourneyInputEventSchema = z
  .object({
    run_id: z.string().min(1),
    input: z.literal('access_started_at'),
    value: IsoDateSchema,
    ts: z.string().datetime(),
  })
  .strict();
export type PublicJourneyInputEvent = z.infer<typeof PublicJourneyInputEventSchema>;

/** Appended state transition after the first observation (e.g. needs_input -> delivered_e1). */
export const PublicJourneyTransitionSchema = z
  .object({
    run_id: z.string().min(1),
    outcome: PublicGateLeakOutcomeSchema,
    refusal_code: RefusalCodeSchema.optional(),
    ts: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'refused' && !value.refusal_code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['refusal_code'], message: 'required for refused outcome' });
    }
  });
export type PublicJourneyTransition = z.infer<typeof PublicJourneyTransitionSchema>;

export interface PublicGateLeakJourneyRecord extends PublicGateLeakRun {
  /** Latest folded outcome across the immutable run + appended transitions. */
  current_outcome: PublicGateLeakOutcome;
  current_refusal_code?: z.infer<typeof RefusalCodeSchema>;
  supplied_access_started_at?: string;
}

/** Append-only event store. No update/delete by design. */
export interface EventStore {
  appendRunEvent(event: RunEvent): Promise<void>;
  /** Append a consented contact. Rejects if the run_id is unknown. */
  appendContact(record: ContactRecord): Promise<void>;
  /** Lifecycle check (IMP-007): does this run exist, when did it land, and its
   *  fingerprint (so a follow-up reaction event can reuse it)? */
  getRun(runId: string): Promise<{ ts: string; inputs_hash: string } | undefined>;
  /** Idempotent on run_id; a conflicting replay is rejected. Also observes the canonical subject. */
  appendPublicGateLeakRun(run: PublicGateLeakRun): Promise<{ created: boolean }>;
  appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }>;
  appendPublicJourneyTransition(event: PublicJourneyTransition): Promise<{ created: boolean }>;
  /** Idempotent on (journey_token, kind), so one journey cannot inflate demand by retrying. */
  appendAttention(event: AttentionEvent): Promise<{ created: boolean }>;
  getPublicGateLeakJourney(runId: string): Promise<PublicGateLeakJourneyRecord | undefined>;
}

/** In-memory append-only store (tests + a reference impl). */
export class InMemoryEventStore implements EventStore {
  private readonly runEvents: RunEvent[] = [];
  private readonly contacts: ContactRecord[] = [];
  private readonly publicRuns = new Map<string, PublicGateLeakRun>();
  private readonly publicInputs: PublicJourneyInputEvent[] = [];
  private readonly publicTransitions: PublicJourneyTransition[] = [];
  private readonly attention = new Map<string, AttentionEvent>();

  async appendRunEvent(event: RunEvent): Promise<void> {
    this.runEvents.push(RunEventSchema.parse(event));
  }

  async appendContact(record: ContactRecord): Promise<void> {
    const parsed = ContactRecordSchema.parse(record);
    const run = await this.getRun(parsed.run_id);
    if (!run) {
      throw new Error(`unknown run_id: ${parsed.run_id}`);
    }
    this.contacts.push(parsed);
  }

  async getRun(runId: string): Promise<{ ts: string; inputs_hash: string } | undefined> {
    // Earliest event for the run defines its landing time + fingerprint.
    const ev = this.runEvents.find((e) => e.run_id === runId);
    return ev ? { ts: ev.ts, inputs_hash: ev.inputs_hash } : undefined;
  }

  async appendPublicGateLeakRun(run: PublicGateLeakRun): Promise<{ created: boolean }> {
    const parsed = PublicGateLeakRunSchema.parse(run);
    const existing = this.publicRuns.get(parsed.run_id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
        throw new Error(`conflicting public gate-leak run_id: ${parsed.run_id}`);
      }
      return { created: false };
    }
    this.publicRuns.set(parsed.run_id, parsed);
    return { created: true };
  }

  async appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }> {
    const parsed = PublicJourneyInputEventSchema.parse(event);
    if (!this.publicRuns.has(parsed.run_id)) throw new Error(`unknown public run_id: ${parsed.run_id}`);
    const existing = this.publicInputs.find((candidate) =>
      candidate.run_id === parsed.run_id && candidate.input === parsed.input,
    );
    if (existing) {
      if (existing.value !== parsed.value) throw new Error(`conflicting journey input: ${parsed.run_id}/${parsed.input}`);
      return { created: false };
    }
    this.publicInputs.push(parsed);
    return { created: true };
  }

  async appendPublicJourneyTransition(event: PublicJourneyTransition): Promise<{ created: boolean }> {
    const parsed = PublicJourneyTransitionSchema.parse(event);
    if (!this.publicRuns.has(parsed.run_id)) throw new Error(`unknown public run_id: ${parsed.run_id}`);
    const existing = this.publicTransitions.find((candidate) =>
      candidate.run_id === parsed.run_id && candidate.outcome === parsed.outcome,
    );
    if (existing) return { created: false };
    this.publicTransitions.push(parsed);
    return { created: true };
  }

  async appendAttention(event: AttentionEvent): Promise<{ created: boolean }> {
    const parsed = AttentionEventSchema.parse(event);
    const key = `${parsed.journey_token}:${parsed.kind}`;
    if (this.attention.has(key)) return { created: false };
    this.attention.set(key, parsed);
    return { created: true };
  }

  async getPublicGateLeakJourney(runId: string): Promise<PublicGateLeakJourneyRecord | undefined> {
    const run = this.publicRuns.get(runId);
    if (!run) return undefined;
    const transitions = this.publicTransitions.filter((candidate) => candidate.run_id === runId);
    const latest = transitions.at(-1);
    const supplied = this.publicInputs.find((candidate) => candidate.run_id === runId);
    return {
      ...run,
      current_outcome: latest?.outcome ?? run.outcome,
      current_refusal_code: latest?.refusal_code ?? run.refusal_code,
      supplied_access_started_at: supplied?.value ?? run.access_started_at,
    };
  }

  /** Test/inspection helper. */
  counts(): { runEvents: number; contacts: number; publicRuns: number; attention: number } {
    return {
      runEvents: this.runEvents.length,
      contacts: this.contacts.length,
      publicRuns: this.publicRuns.size,
      attention: this.attention.size,
    };
  }
}

/**
 * Lifecycle window check (IMP-007): a reaction/contact is only valid against a
 * run that exists and landed within `windowMs`. Pure; the route supplies `now`.
 */
export function isRunWithinWindow(
  run: { ts: string } | undefined,
  nowUnixMs: number,
  windowMs: number,
): boolean {
  if (!run) return false;
  const landed = Date.parse(run.ts);
  return Number.isFinite(landed) && nowUnixMs - landed <= windowMs && nowUnixMs >= landed;
}
