/**
 * Idempotency State Machine Unit Tests
 * Sprint S11-T0: State transition table verification (Flatline SKP-002)
 *
 * Verifies all state transitions, terminal states, key derivation,
 * and edit semantics per the idempotency state machine spec.
 */

import { describe, it, expect } from 'vitest';
import {
  type IdempotencyKeyState,
  IDEMPOTENCY_TRANSITIONS,
  TERMINAL_STATES,
  isValidTransition,
  isTerminal,
  deriveIdempotencyKey,
} from '@arrakis/adapters/agent/idempotency';

// --------------------------------------------------------------------------
// State Transition Table
// --------------------------------------------------------------------------

describe('Idempotency State Machine (S11-T0)', () => {
  describe('state transitions', () => {
    // Valid transitions
    const VALID: [IdempotencyKeyState, IdempotencyKeyState][] = [
      ['NEW', 'ACTIVE'],
      ['ACTIVE', 'ACTIVE'],       // retry / ALREADY_RESERVED
      ['ACTIVE', 'COMPLETED'],    // usage event received
      ['ACTIVE', 'ABORTED'],      // client disconnect
      ['ACTIVE', 'RESUME_LOST'],  // loa-finn 409
    ];

    it.each(VALID)('should allow %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    // Invalid transitions
    const INVALID: [IdempotencyKeyState, IdempotencyKeyState][] = [
      ['NEW', 'COMPLETED'],
      ['NEW', 'ABORTED'],
      ['NEW', 'RESUME_LOST'],
      ['NEW', 'NEW'],
      ['COMPLETED', 'ACTIVE'],
      ['COMPLETED', 'COMPLETED'],
      ['COMPLETED', 'ABORTED'],
      ['COMPLETED', 'NEW'],
      ['ABORTED', 'ACTIVE'],
      ['ABORTED', 'COMPLETED'],
      ['ABORTED', 'ABORTED'],
      ['ABORTED', 'NEW'],
      ['RESUME_LOST', 'ACTIVE'],
      ['RESUME_LOST', 'COMPLETED'],
      ['RESUME_LOST', 'NEW'],
      ['RESUME_LOST', 'RESUME_LOST'],
    ];

    it.each(INVALID)('should reject %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe('terminal states', () => {
    it('should mark COMPLETED as terminal', () => {
      expect(isTerminal('COMPLETED')).toBe(true);
    });

    it('should mark ABORTED as terminal', () => {
      expect(isTerminal('ABORTED')).toBe(true);
    });

    it('should mark RESUME_LOST as terminal', () => {
      expect(isTerminal('RESUME_LOST')).toBe(true);
    });

    it('should NOT mark NEW as terminal', () => {
      expect(isTerminal('NEW')).toBe(false);
    });

    it('should NOT mark ACTIVE as terminal', () => {
      expect(isTerminal('ACTIVE')).toBe(false);
    });

    it('should have no outgoing transitions from terminal states', () => {
      for (const state of TERMINAL_STATES) {
        const transitions = IDEMPOTENCY_TRANSITIONS.get(state);
        expect(transitions).toEqual([]);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Key Derivation
  // --------------------------------------------------------------------------

  describe('deriveIdempotencyKey', () => {
    it('should derive Discord interaction key', () => {
      const key = deriveIdempotencyKey({
        platform: 'discord',
        eventId: 'interaction:1234567890',
      });
      expect(key).toBe('discord:interaction:1234567890');
    });

    it('should derive Discord message key', () => {
      const key = deriveIdempotencyKey({
        platform: 'discord',
        eventId: 'msg:9876543210',
      });
      expect(key).toBe('discord:msg:9876543210');
    });

    it('should derive Telegram update key', () => {
      const key = deriveIdempotencyKey({
        platform: 'telegram',
        eventId: 'update:42',
      });
      expect(key).toBe('telegram:update:42');
    });

    it('should derive HTTP key from event ID', () => {
      const key = deriveIdempotencyKey({
        platform: 'http',
        eventId: 'client-provided-key-abc',
      });
      expect(key).toBe('http:client-provided-key-abc');
    });

    it('should produce deterministic keys (same input → same output)', () => {
      const ctx = { platform: 'discord' as const, eventId: 'interaction:999' };
      const key1 = deriveIdempotencyKey(ctx);
      const key2 = deriveIdempotencyKey(ctx);
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different events', () => {
      const key1 = deriveIdempotencyKey({ platform: 'discord', eventId: 'interaction:1' });
      const key2 = deriveIdempotencyKey({ platform: 'discord', eventId: 'interaction:2' });
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different platforms', () => {
      const key1 = deriveIdempotencyKey({ platform: 'discord', eventId: '123' });
      const key2 = deriveIdempotencyKey({ platform: 'telegram', eventId: '123' });
      expect(key1).not.toBe(key2);
    });
  });

  // --------------------------------------------------------------------------
  // Edit Semantics
  // --------------------------------------------------------------------------

  describe('edit semantics', () => {
    it('should append :edit suffix for message edits', () => {
      const key = deriveIdempotencyKey({
        platform: 'discord',
        eventId: 'msg:555',
        isEdit: true,
      });
      expect(key).toBe('discord:msg:555:edit');
    });

    it('should NOT append :edit when isEdit is false', () => {
      const key = deriveIdempotencyKey({
        platform: 'discord',
        eventId: 'msg:555',
        isEdit: false,
      });
      expect(key).toBe('discord:msg:555');
    });

    it('should NOT append :edit when isEdit is undefined', () => {
      const key = deriveIdempotencyKey({
        platform: 'discord',
        eventId: 'msg:555',
      });
      expect(key).toBe('discord:msg:555');
    });

    it('should produce different keys for original vs edit of same message', () => {
      const original = deriveIdempotencyKey({ platform: 'discord', eventId: 'msg:555' });
      const edited = deriveIdempotencyKey({ platform: 'discord', eventId: 'msg:555', isEdit: true });
      expect(original).not.toBe(edited);
    });
  });

  // --------------------------------------------------------------------------
  // Key Reuse Rules
  // --------------------------------------------------------------------------

  describe('key reuse rules', () => {
    it('retry: same platform event → same key (idempotent)', () => {
      const first = deriveIdempotencyKey({ platform: 'telegram', eventId: 'update:100' });
      const retry = deriveIdempotencyKey({ platform: 'telegram', eventId: 'update:100' });
      expect(first).toBe(retry);
    });

    it('STREAM_RESUME_LOST: new event ID → new key (fresh execution)', () => {
      const original = deriveIdempotencyKey({ platform: 'discord', eventId: 'interaction:1' });
      // After RESUME_LOST, caller mints new key with new event
      const fresh = deriveIdempotencyKey({ platform: 'discord', eventId: 'interaction:2' });
      expect(original).not.toBe(fresh);
    });

    it('message edit: same message ID + edit flag → new key', () => {
      const original = deriveIdempotencyKey({ platform: 'discord', eventId: 'msg:777' });
      const edit = deriveIdempotencyKey({ platform: 'discord', eventId: 'msg:777', isEdit: true });
      expect(original).not.toBe(edit);
    });
  });

  // --------------------------------------------------------------------------
  // Exhaustive Coverage
  // --------------------------------------------------------------------------

  describe('transition map completeness', () => {
    const ALL_STATES: IdempotencyKeyState[] = ['NEW', 'ACTIVE', 'COMPLETED', 'ABORTED', 'RESUME_LOST'];

    it('should have an entry for every state', () => {
      for (const state of ALL_STATES) {
        expect(IDEMPOTENCY_TRANSITIONS.has(state)).toBe(true);
      }
    });

    it('should have exactly 5 states in the transition map', () => {
      expect(IDEMPOTENCY_TRANSITIONS.size).toBe(5);
    });

    it('should have exactly 3 terminal states', () => {
      expect(TERMINAL_STATES.size).toBe(3);
    });
  });
});
