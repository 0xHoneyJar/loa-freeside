/**
 * toDomainEvent — Capability Audit → canonical DomainEvent envelope
 *
 * Pins the adapter that wraps a CapabilityAuditEvent in the v8 DomainEvent<T>
 * envelope (Sprint 323, Task 2.4). The load-bearing invariants are the field
 * mappings (community_id→aggregate_id, user_id→actor, trace_id→both
 * correlation_id and causation_id), the exact event_type→aggregate routing
 * table, and the validation surface (5 required fields, throws otherwise).
 *
 * @see ./capability-audit.ts toDomainEvent
 */

import { describe, it, expect } from 'vitest';
import { toDomainEvent, type CapabilityAuditEvent } from './capability-audit.js';
import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeEvent(
  overrides: Partial<CapabilityAuditEvent> = {},
): CapabilityAuditEvent {
  return {
    event_type: 'ensemble_invocation',
    timestamp: '2026-06-27T12:00:00.000Z',
    trace_id: 'trace-abc-123',
    community_id: 'community-xyz',
    user_id: 'user-42',
    pool_id: 'pool-reasoning',
    access_level: 'premium',
    ensemble_strategy: 'majority',
    ensemble_n: 3,
    ...overrides,
  };
}

describe('toDomainEvent', () => {
  describe('envelope field mapping', () => {
    it('maps audit fields onto the canonical DomainEvent envelope', () => {
      const event = makeEvent();
      const de = toDomainEvent(event);

      // aggregate identity comes from the community, the actor from the user
      expect(de.aggregate_id).toBe('community-xyz');
      expect(de.actor).toBe('user-42');
      // timestamp is the occurrence time, not the (random) event_id
      expect(de.occurred_at).toBe('2026-06-27T12:00:00.000Z');
      // event-sourcing envelope is versioned at 1
      expect(de.version).toBe(1);
    });

    it('threads trace_id into BOTH correlation_id and causation_id', () => {
      const de = toDomainEvent(makeEvent({ trace_id: 'trace-777' }));
      expect(de.correlation_id).toBe('trace-777');
      expect(de.causation_id).toBe('trace-777');
      expect(de.correlation_id).toBe(de.causation_id);
    });

    it('carries the full audit event as payload (by reference)', () => {
      const event = makeEvent();
      const de = toDomainEvent(event);
      // The adapter does not clone or strip — the payload IS the event.
      expect(de.payload).toBe(event);
    });

    it('stamps the canonical CONTRACT_VERSION, not a hardcoded literal', () => {
      const de = toDomainEvent(makeEvent());
      expect(de.contract_version).toBe(CONTRACT_VERSION);
    });
  });

  describe('event_id', () => {
    it('mints a UUID', () => {
      expect(toDomainEvent(makeEvent()).event_id).toMatch(UUID_RE);
    });

    it('is fresh on every call (no event_id collisions for replayed input)', () => {
      const event = makeEvent();
      const a = toDomainEvent(event);
      const b = toDomainEvent(event);
      expect(a.event_id).not.toBe(b.event_id);
    });
  });

  describe('event_type routing table', () => {
    // The mapping is a security/routing-critical table: billing vs agent
    // aggregate and the exact dotted type string drive downstream consumers.
    it.each([
      ['pool_access', 'billing', 'billing.pool.accessed'],
      ['byok_usage', 'billing', 'billing.byok.used'],
      ['ensemble_invocation', 'agent', 'agent.ensemble.invoked'],
      ['model_access', 'agent', 'agent.model.accessed'],
    ] as const)(
      '%s -> aggregate_type=%s, type=%s',
      (eventType, aggregateType, dottedType) => {
        const de = toDomainEvent(makeEvent({ event_type: eventType }));
        expect(de.aggregate_type).toBe(aggregateType);
        expect(de.type).toBe(dottedType);
      },
    );
  });

  describe('required-field validation', () => {
    it.each(['event_type', 'timestamp', 'trace_id', 'community_id', 'user_id'])(
      'throws when %s is an empty string',
      (field) => {
        expect(() =>
          toDomainEvent(makeEvent({ [field]: '' } as Partial<CapabilityAuditEvent>)),
        ).toThrow(`Invalid CapabilityAuditEvent: ${field} is required`);
      },
    );

    it.each(['event_type', 'timestamp', 'trace_id', 'community_id', 'user_id'])(
      'throws when %s is undefined',
      (field) => {
        expect(() =>
          toDomainEvent(
            makeEvent({ [field]: undefined } as Partial<CapabilityAuditEvent>),
          ),
        ).toThrow(`Invalid CapabilityAuditEvent: ${field} is required`);
      },
    );

    it('does NOT require pool_id or access_level (narrower surface than emit())', () => {
      // toDomainEvent validates exactly 5 fields — pool_id/access_level are
      // intentionally not among them, unlike CapabilityAuditLogger.emit().
      const de = toDomainEvent(
        makeEvent({ event_type: 'pool_access', pool_id: '', access_level: '' }),
      );
      expect(de.aggregate_type).toBe('billing');
      expect(de.type).toBe('billing.pool.accessed');
    });
  });
});
