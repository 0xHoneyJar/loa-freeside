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
    expect(await store.getRun('r1')).toEqual({ ts: runEvent.ts });
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
