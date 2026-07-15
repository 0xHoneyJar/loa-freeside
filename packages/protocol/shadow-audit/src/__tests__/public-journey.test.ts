import { describe, expect, it } from 'vitest';
import {
  AttentionEventSchema,
  PUBLIC_JOURNEY_HTTP_STATUS,
  PublicJourneyProjectionSchema,
  projectPublicJourney,
} from '../public-journey.js';

const base = {
  run_id: 'gate_123',
  journey_token: 'journey_123',
  subject: { chain_id: '80094', contract_address: `0x${'a'.repeat(40)}` },
};

describe('public gate-leak journey protocol', () => {
  it.each([
    'submitted',
    'resolving_subject',
    'indexing',
    'computing',
    'delivered_e1',
    'unavailable',
  ] as const)('projects %s without member data', (outcome) => {
    const projected = projectPublicJourney({ ...base, outcome });
    expect(projected.status.state).toBe(outcome);
    expect(PublicJourneyProjectionSchema.parse(projected)).toEqual(projected);
  });

  it('makes the semantic prerequisite explicit and stable on the wire', () => {
    const projected = projectPublicJourney({ ...base, outcome: 'needs_input' });
    expect(projected.status).toEqual({ state: 'needs_input', required_input: 'access_started_at' });
    expect(PUBLIC_JOURNEY_HTTP_STATUS.needs_input).toBe(428);
  });

  it('requires a typed refusal code', () => {
    expect(() => projectPublicJourney({ ...base, outcome: 'refused' })).toThrow(/refusal_code/);
    expect(
      projectPublicJourney({ ...base, outcome: 'refused', refusal_code: 'unindexed-contract' }).status,
    ).toEqual({ state: 'refused', refusal_code: 'unindexed-contract' });
  });

  it('fails closed to unavailable when durable state is unavailable', () => {
    expect(
      projectPublicJourney({ ...base, outcome: 'computing', durable_available: false }).status,
    ).toEqual({ state: 'unavailable' });
  });
});

describe('AttentionEvent privacy boundary', () => {
  const safe = {
    subject_chain_id: '80094',
    subject_contract_address: `0x${'a'.repeat(40)}`,
    journey_token: 'journey_123',
    kind: 'submitted' as const,
    ts: '2026-07-15T12:00:00.000Z',
  };

  it('accepts only subject, journey, kind, and timestamp', () => {
    expect(AttentionEventSchema.parse(safe)).toEqual(safe);
  });

  it.each(['wallet', 'email', 'ip', 'free_text', 'sub_k_denominator']) (
    'rejects member/sensitive field %s',
    (field) => {
      expect(AttentionEventSchema.safeParse({ ...safe, [field]: 'forbidden' }).success).toBe(false);
    },
  );
});
