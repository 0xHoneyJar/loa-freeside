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

export const ReactionSchema = z.enum(['worse', 'expected', 'surprised']);
export type Reaction = z.infer<typeof ReactionSchema>;

export const CtaInteractionSchema = z.enum(['product', 'conversation']);

/** An aggregate run-event. Deliberately carries NO member-level data. */
export const RunEventSchema = z
  .object({
    run_id: z.string().min(1),
    mode: z.literal('dogfood-full'),
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
    contact: z.string().min(1),
    consent: z.literal(true),
    ts: z.string().datetime(),
  })
  .strict();
export type ContactRecord = z.infer<typeof ContactRecordSchema>;

/** Append-only event store. No update/delete by design. */
export interface EventStore {
  appendRunEvent(event: RunEvent): Promise<void>;
  /** Append a consented contact. Rejects if the run_id is unknown. */
  appendContact(record: ContactRecord): Promise<void>;
  /** Lifecycle check (IMP-007): does this run exist, and when did it land? */
  getRun(runId: string): Promise<{ ts: string } | undefined>;
}

/** In-memory append-only store (tests + a reference impl). */
export class InMemoryEventStore implements EventStore {
  private readonly runEvents: RunEvent[] = [];
  private readonly contacts: ContactRecord[] = [];

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

  async getRun(runId: string): Promise<{ ts: string } | undefined> {
    // Earliest event for the run defines its landing time.
    const ev = this.runEvents.find((e) => e.run_id === runId);
    return ev ? { ts: ev.ts } : undefined;
  }

  /** Test/inspection helper. */
  counts(): { runEvents: number; contacts: number } {
    return { runEvents: this.runEvents.length, contacts: this.contacts.length };
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
