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
  AccessStartedAtDateSchema,
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
    access_started_at: AccessStartedAtDateSchema.optional(),
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
    value: AccessStartedAtDateSchema,
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

export interface PublicComputeClaim {
  compute_key: string;
  owner_token: string;
  claimed_at: string;
  lease_expires_at: string;
}

export type PublicComputeClaimResult = 'claimed' | 'busy' | 'complete';

export interface PublicJourneyWriteBudget {
  bucket: string;
  window_started_at: string;
  limit: number;
}

const RETRYABLE_REFUSALS = new Set(['unindexed-contract', 'reconstruction-failed', 'upstream-exhausted', 'rate-limited']);

/** One state-machine rule shared by memory and Postgres adapters. */
export function publicJourneyTransitionDisposition(
  current: Pick<PublicGateLeakJourneyRecord, 'current_outcome' | 'current_refusal_code'>,
  next: PublicJourneyTransition,
): 'append' | 'noop' {
  if (current.current_outcome === next.outcome) {
    if (current.current_refusal_code !== next.refusal_code) {
      throw new Error(`conflicting public journey transition: ${next.run_id}/${next.outcome}`);
    }
    return 'noop';
  }
  if (current.current_outcome === 'delivered_e1') {
    throw new Error(`terminal public journey cannot transition: ${next.run_id}/delivered_e1`);
  }
  if (
    current.current_outcome === 'refused' &&
    (!current.current_refusal_code || !RETRYABLE_REFUSALS.has(current.current_refusal_code))
  ) {
    throw new Error(`terminal public journey cannot transition: ${next.run_id}/refused`);
  }

  const allowed: Record<PublicGateLeakOutcome, ReadonlySet<PublicGateLeakOutcome>> = {
    submitted: new Set(['resolving_subject', 'indexing', 'computing', 'needs_input', 'delivered_e1', 'refused', 'unavailable']),
    resolving_subject: new Set(['indexing', 'computing', 'needs_input', 'delivered_e1', 'refused', 'unavailable']),
    indexing: new Set(['computing', 'needs_input', 'delivered_e1', 'refused', 'unavailable']),
    computing: new Set(['delivered_e1', 'refused', 'unavailable']),
    needs_input: new Set(['computing', 'delivered_e1', 'refused', 'unavailable']),
    delivered_e1: new Set(),
    refused: new Set(['computing', 'needs_input', 'delivered_e1', 'unavailable']),
    unavailable: new Set(['computing', 'needs_input', 'delivered_e1', 'refused']),
  };
  if (!allowed[current.current_outcome].has(next.outcome)) {
    throw new Error(
      `invalid public journey transition: ${next.run_id}/${current.current_outcome}->${next.outcome}`,
    );
  }
  return 'append';
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
  appendPublicGateLeakRun(
    run: PublicGateLeakRun,
    budget: PublicJourneyWriteBudget,
  ): Promise<{ created: boolean; rate_limited?: boolean }>;
  appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }>;
  appendPublicJourneyTransition(event: PublicJourneyTransition): Promise<{ created: boolean }>;
  /** Idempotent on (journey_token, kind), so one journey cannot inflate demand by retrying. */
  appendAttention(event: AttentionEvent): Promise<{ created: boolean }>;
  getPublicGateLeakJourney(runId: string): Promise<PublicGateLeakJourneyRecord | undefined>;
  getPublicGateLeakJourneyByToken(journeyToken: string): Promise<PublicGateLeakJourneyRecord | undefined>;
  getPublicComputeResult(computeKey: string): Promise<unknown | undefined>;
  claimPublicCompute(claim: PublicComputeClaim): Promise<PublicComputeClaimResult>;
  /** Commit only while this owner still holds a live lease. False means the work lost the lease. */
  completePublicCompute(computeKey: string, ownerToken: string, result: unknown, completedAt: string): Promise<boolean>;
  releasePublicCompute(computeKey: string, ownerToken: string): Promise<void>;
}

/** In-memory append-only store (tests + a reference impl). */
export class InMemoryEventStore implements EventStore {
  private readonly runEvents: RunEvent[] = [];
  private readonly contacts: ContactRecord[] = [];
  private readonly publicRuns = new Map<string, PublicGateLeakRun>();
  private readonly publicRunIdsByToken = new Map<string, string>();
  private readonly publicInputs: PublicJourneyInputEvent[] = [];
  private readonly publicTransitions: PublicJourneyTransition[] = [];
  private readonly attention = new Map<string, AttentionEvent>();
  private readonly publicComputes = new Map<
    string,
    { state: 'running'; owner_token: string; lease_expires_at: string } | { state: 'complete'; result: unknown }
  >();
  private readonly publicJourneyWrites = new Map<string, number>();

  async appendRunEvent(event: RunEvent): Promise<void> {
    const parsed = RunEventSchema.parse(event);
    if (
      parsed.mode === 'public-gate-leak' &&
      !parsed.reaction &&
      !parsed.cta_interaction &&
      this.runEvents.some(
        (candidate) =>
          candidate.run_id === parsed.run_id &&
          candidate.mode === 'public-gate-leak' &&
          !candidate.reaction &&
          !candidate.cta_interaction,
      )
    ) {
      return;
    }
    this.runEvents.push(parsed);
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

  async appendPublicGateLeakRun(
    run: PublicGateLeakRun,
    budget: PublicJourneyWriteBudget,
  ): Promise<{ created: boolean; rate_limited?: boolean }> {
    const parsed = PublicGateLeakRunSchema.parse(run);
    const existingById = this.publicRuns.get(parsed.run_id);
    const existingIdForToken = this.publicRunIdsByToken.get(parsed.journey_token);
    const existing = existingById ?? (existingIdForToken ? this.publicRuns.get(existingIdForToken) : undefined);
    if (existing) {
      if (
        existing.journey_token !== parsed.journey_token ||
        existing.inputs_hash !== parsed.inputs_hash ||
        existing.subject.chain_id !== parsed.subject.chain_id ||
        existing.subject.contract_address !== parsed.subject.contract_address ||
        existing.threshold !== parsed.threshold
      ) {
        throw new Error(`conflicting public gate-leak journey: ${parsed.run_id}/${parsed.journey_token}`);
      }
      return { created: false };
    }
    const budgetKey = `${budget.bucket}:${budget.window_started_at}`;
    const used = this.publicJourneyWrites.get(budgetKey) ?? 0;
    if (used >= budget.limit) return { created: false, rate_limited: true };
    this.publicJourneyWrites.set(budgetKey, used + 1);
    this.publicRuns.set(parsed.run_id, parsed);
    this.publicRunIdsByToken.set(parsed.journey_token, parsed.run_id);
    return { created: true };
  }

  async appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }> {
    const parsed = PublicJourneyInputEventSchema.parse(event);
    const run = this.publicRuns.get(parsed.run_id);
    if (!run) throw new Error(`unknown public run_id: ${parsed.run_id}`);
    if (run.access_started_at) {
      if (run.access_started_at !== parsed.value) {
        throw new Error(`conflicting journey input: ${parsed.run_id}/${parsed.input}`);
      }
      return { created: false };
    }
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
    const current = await this.getPublicGateLeakJourney(parsed.run_id);
    if (!current) throw new Error(`unknown public run_id: ${parsed.run_id}`);
    if (publicJourneyTransitionDisposition(current, parsed) === 'noop') return { created: false };
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

  async getPublicGateLeakJourneyByToken(journeyToken: string): Promise<PublicGateLeakJourneyRecord | undefined> {
    const runId = this.publicRunIdsByToken.get(journeyToken);
    return runId ? this.getPublicGateLeakJourney(runId) : undefined;
  }

  async getPublicComputeResult(computeKey: string): Promise<unknown | undefined> {
    const value = this.publicComputes.get(computeKey);
    return value?.state === 'complete' ? value.result : undefined;
  }

  async claimPublicCompute(claim: PublicComputeClaim): Promise<PublicComputeClaimResult> {
    const current = this.publicComputes.get(claim.compute_key);
    if (current?.state === 'complete') return 'complete';
    if (current?.state === 'running' && Date.parse(current.lease_expires_at) > Date.parse(claim.claimed_at)) {
      return 'busy';
    }
    this.publicComputes.set(claim.compute_key, {
      state: 'running',
      owner_token: claim.owner_token,
      lease_expires_at: claim.lease_expires_at,
    });
    return 'claimed';
  }

  async completePublicCompute(
    computeKey: string,
    ownerToken: string,
    result: unknown,
    completedAt: string,
  ): Promise<boolean> {
    const current = this.publicComputes.get(computeKey);
    if (current?.state === 'complete') return false;
    if (current?.state !== 'running' || current.owner_token !== ownerToken) {
      return false;
    }
    if (Date.parse(current.lease_expires_at) <= Date.parse(completedAt)) {
      return false;
    }
    this.publicComputes.set(computeKey, { state: 'complete', result });
    return true;
  }

  async releasePublicCompute(computeKey: string, ownerToken: string): Promise<void> {
    const current = this.publicComputes.get(computeKey);
    if (current?.state === 'running' && current.owner_token === ownerToken) this.publicComputes.delete(computeKey);
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

  /** Test/inspection helper — attention events, optionally scoped to one journey. Member-free by schema. */
  attentionList(journeyToken?: string): AttentionEvent[] {
    const all = [...this.attention.values()];
    return journeyToken ? all.filter((event) => event.journey_token === journeyToken) : all;
  }

  /** Test/inspection helper — run events, optionally scoped to one run. */
  runEventList(runId?: string): RunEvent[] {
    return runId ? this.runEvents.filter((event) => event.run_id === runId) : [...this.runEvents];
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
