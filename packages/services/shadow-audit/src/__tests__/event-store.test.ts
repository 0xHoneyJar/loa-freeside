import { describe, it, expect } from 'vitest';
import {
  InMemoryEventStore,
  isRunWithinWindow,
  RunEventSchema,
  ContactRecordSchema,
} from '../event-store.js';

const runEvent = {
  run_id: 'r1',
  mode: 'dogfood-full' as const,
  inputs_hash: '0'.repeat(64),
  stale_set_size: 3,
  reruns: 0,
  ts: '2026-06-22T12:00:00.000Z',
};
const contact = {
  run_id: 'r1',
  contact: 'operator@example.com',
  consent: true as const,
  ts: '2026-06-22T12:01:00.000Z',
};

describe('RunEventSchema — no member data (NFR-1)', () => {
  it('accepts an aggregate run-event', () => {
    expect(RunEventSchema.safeParse(runEvent).success).toBe(true);
  });

  it('rejects a smuggled member-level field (.strict)', () => {
    expect(
      RunEventSchema.safeParse({ ...runEvent, member_wallets: ['0x1'] }).success,
    ).toBe(false);
  });
});

describe('ContactRecordSchema — consent required', () => {
  it('accepts a consented contact', () => {
    expect(ContactRecordSchema.safeParse(contact).success).toBe(true);
  });

  it('rejects an over-long contact (SEC-M3)', () => {
    expect(ContactRecordSchema.safeParse({ ...contact, contact: 'x'.repeat(400) }).success).toBe(false);
  });

  it('rejects a contact without consent === true', () => {
    expect(ContactRecordSchema.safeParse({ ...contact, consent: false }).success).toBe(false);
    const { consent: _omit, ...noConsent } = contact;
    expect(ContactRecordSchema.safeParse(noConsent).success).toBe(false);
  });
});

describe('InMemoryEventStore — append-only', () => {
  it('appends run-events and exposes the run for lifecycle checks', async () => {
    const store = new InMemoryEventStore();
    expect(await store.getRun('r1')).toBeUndefined();
    await store.appendRunEvent(runEvent);
    expect(await store.getRun('r1')).toEqual({ ts: runEvent.ts, inputs_hash: runEvent.inputs_hash });
    expect(store.counts().runEvents).toBe(1);
  });

  it('rejects a run-event with a member field on append', async () => {
    const store = new InMemoryEventStore();
    await expect(
      store.appendRunEvent({ ...runEvent, holdings: 5 } as never),
    ).rejects.toThrow();
  });

  it('requires consent to append a contact', async () => {
    const store = new InMemoryEventStore();
    await store.appendRunEvent(runEvent);
    await expect(
      store.appendContact({ ...contact, consent: false } as never),
    ).rejects.toThrow();
  });

  it('rejects a contact for an unknown run_id', async () => {
    const store = new InMemoryEventStore();
    await expect(store.appendContact({ ...contact, run_id: 'nope' })).rejects.toThrow();
  });

  it('appends a consented contact for a known run', async () => {
    const store = new InMemoryEventStore();
    await store.appendRunEvent(runEvent);
    await store.appendContact(contact);
    expect(store.counts().contacts).toBe(1);
  });
});

describe('isRunWithinWindow (IMP-007)', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const HOUR = 3_600_000;

  it('accepts a run that landed within the window', () => {
    expect(isRunWithinWindow({ ts: '2026-06-22T11:59:00.000Z' }, now, HOUR)).toBe(true);
  });

  it('rejects a run that landed before the window', () => {
    expect(isRunWithinWindow({ ts: '2026-06-22T10:00:00.000Z' }, now, HOUR)).toBe(false);
  });

  it('rejects an unknown (missing) run', () => {
    expect(isRunWithinWindow(undefined, now, HOUR)).toBe(false);
  });
});

describe('public gate-leak append-only journey + attention', () => {
  const budget = { bucket: 'test', window_started_at: '2026-07-15T12:00:00.000Z', limit: 100 };
  const initial = {
    run_id: 'gate_1',
    journey_token: 'journey_1',
    subject: { chain_id: '80094', contract_address: `0x${'a'.repeat(40)}` },
    inputs_hash: 'a'.repeat(64),
    threshold: 1,
    outcome: 'needs_input' as const,
    ts: '2026-07-15T12:00:00.000Z',
  };

  it('resumes by appending input + transition without mutating the original digest', async () => {
    const store = new InMemoryEventStore();
    expect(await store.appendPublicGateLeakRun(initial, budget)).toEqual({ created: true });
    expect(await store.appendPublicGateLeakRun(initial, budget)).toEqual({ created: false });
    await store.appendPublicJourneyInput({
      run_id: initial.run_id,
      input: 'access_started_at',
      value: '2026-06-01',
      ts: '2026-07-15T12:01:00.000Z',
    });
    await store.appendPublicJourneyTransition({
      run_id: initial.run_id,
      outcome: 'delivered_e1',
      ts: '2026-07-15T12:02:00.000Z',
    });
    const folded = await store.getPublicGateLeakJourney(initial.run_id);
    expect(folded?.inputs_hash).toBe(initial.inputs_hash);
    expect(folded?.outcome).toBe('needs_input');
    expect(folded?.current_outcome).toBe('delivered_e1');
    expect(folded?.supplied_access_started_at).toBe('2026-06-01');
  });

  it('reuses the server-random run bound to an idempotency token and rejects terminal regression', async () => {
    const store = new InMemoryEventStore();
    expect(await store.appendPublicGateLeakRun(initial, budget)).toEqual({ created: true });
    expect(await store.appendPublicGateLeakRun({ ...initial, run_id: 'gate_other', outcome: 'delivered_e1' }, budget)).toEqual({ created: false });
    expect((await store.getPublicGateLeakJourneyByToken(initial.journey_token))?.run_id).toBe(initial.run_id);
    await store.appendPublicJourneyTransition({
      run_id: initial.run_id,
      outcome: 'delivered_e1',
      ts: '2026-07-15T12:02:00.000Z',
    });
    await expect(
      store.appendPublicJourneyTransition({
        run_id: initial.run_id,
        outcome: 'refused',
        refusal_code: 'rate-limited',
        ts: '2026-07-15T12:03:00.000Z',
      }),
    ).rejects.toThrow(/terminal public journey/);
  });

  it('leases aggregate compute once and makes the completed result reusable', async () => {
    const store = new InMemoryEventStore();
    const claim = {
      compute_key: 'f'.repeat(64),
      owner_token: 'owner-a',
      claimed_at: '2026-07-15T12:00:00.000Z',
      lease_expires_at: '2026-07-15T12:02:00.000Z',
    };
    expect(await store.claimPublicCompute(claim)).toBe('claimed');
    expect(await store.claimPublicCompute({ ...claim, owner_token: 'owner-b' })).toBe('busy');
    await store.completePublicCompute(claim.compute_key, claim.owner_token, { aggregate: true }, claim.claimed_at);
    expect(await store.claimPublicCompute({ ...claim, owner_token: 'owner-c' })).toBe('complete');
    expect(await store.getPublicComputeResult(claim.compute_key)).toEqual({ aggregate: true });

    // A late/replayed owner must read the durable winner, never treat its own
    // uncommitted payload as the completed value.
    await expect(
      store.completePublicCompute(claim.compute_key, 'owner-b', { aggregate: false }, claim.claimed_at),
    ).resolves.toBe(false);
    expect(await store.getPublicComputeResult(claim.compute_key)).toEqual({ aggregate: true });

    const expired = { ...claim, compute_key: 'd'.repeat(64), owner_token: 'expired-owner' };
    expect(await store.claimPublicCompute(expired)).toBe('claimed');
    await expect(
      store.completePublicCompute(expired.compute_key, expired.owner_token, { stale: true }, '2026-07-15T12:03:00.000Z'),
    ).resolves.toBe(false);
  });

  it('dedupes one journey retry while counting a distinct journey once', async () => {
    const store = new InMemoryEventStore();
    const event = {
      subject_chain_id: '80094',
      subject_contract_address: `0x${'a'.repeat(40)}`,
      journey_token: 'journey_1',
      kind: 'submitted' as const,
      ts: '2026-07-15T12:00:00.000Z',
    };
    expect(await store.appendAttention(event)).toEqual({ created: true });
    expect(await store.appendAttention(event)).toEqual({ created: false });
    expect(await store.appendAttention({ ...event, journey_token: 'journey_2' })).toEqual({ created: true });
    expect(store.counts().attention).toBe(2);
  });

  it('rejects member/PII fields at the storage boundary', async () => {
    const store = new InMemoryEventStore();
    await expect(
      store.appendAttention({
        subject_chain_id: '80094',
        subject_contract_address: `0x${'a'.repeat(40)}`,
        journey_token: 'journey_1',
        kind: 'feedback',
        ts: '2026-07-15T12:00:00.000Z',
        wallet: '0xmember',
      } as never),
    ).rejects.toThrow();
  });
});
