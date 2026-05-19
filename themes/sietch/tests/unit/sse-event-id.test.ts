/**
 * SSE Event ID Generator Tests
 * Sprint S14-T1: Distributed SSE Event ID Design (Finding B)
 *
 * Tests both Monotonic and Composite generators, the parser,
 * and server-switch detection.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fs before barrel imports (budget-manager loads Lua at module level)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import {
  MonotonicEventIdGenerator,
  CompositeEventIdGenerator,
  parseLastEventId,
  createEventIdGenerator,
} from '@freeside/adapters/agent';

describe('SSE Event ID', () => {
  // --------------------------------------------------------------------------
  // parseLastEventId
  // --------------------------------------------------------------------------

  describe('parseLastEventId', () => {
    it('parses monotonic format "42"', () => {
      const result = parseLastEventId('42');
      expect(result).toEqual({ sequence: 42 });
      expect(result.serverId).toBeUndefined();
    });

    it('parses composite format "srv1:42"', () => {
      const result = parseLastEventId('srv1:42');
      expect(result).toEqual({ sequence: 42, serverId: 'srv1' });
    });

    it('handles zero sequence', () => {
      expect(parseLastEventId('0')).toEqual({ sequence: 0 });
      expect(parseLastEventId('srv1:0')).toEqual({ sequence: 0, serverId: 'srv1' });
    });

    it('handles invalid sequence as 0', () => {
      expect(parseLastEventId('abc')).toEqual({ sequence: 0 });
      expect(parseLastEventId('srv1:abc')).toEqual({ sequence: 0, serverId: 'srv1' });
    });

    it('handles empty string', () => {
      expect(parseLastEventId('')).toEqual({ sequence: 0 });
    });

    it('handles composite with empty serverId', () => {
      const result = parseLastEventId(':42');
      expect(result).toEqual({ sequence: 42, serverId: undefined });
    });

    it('handles composite with multiple colons', () => {
      // Only first colon is the delimiter
      const result = parseLastEventId('srv:region:42');
      expect(result.serverId).toBe('srv');
      // "region:42" parsed as int = NaN → 0
      expect(result.sequence).toBe(0);
    });

    it('handles large sequence numbers', () => {
      expect(parseLastEventId('999999999')).toEqual({ sequence: 999999999 });
      expect(parseLastEventId('us-east-1:999999999')).toEqual({
        sequence: 999999999,
        serverId: 'us-east-1',
      });
    });
  });

  // --------------------------------------------------------------------------
  // MonotonicEventIdGenerator
  // --------------------------------------------------------------------------

  describe('MonotonicEventIdGenerator', () => {
    it('generates sequential integer IDs starting from 1', () => {
      const gen = new MonotonicEventIdGenerator();
      expect(gen.next()).toBe('1');
      expect(gen.next()).toBe('2');
      expect(gen.next()).toBe('3');
    });

    it('starts from custom offset', () => {
      const gen = new MonotonicEventIdGenerator(100);
      expect(gen.next()).toBe('101');
      expect(gen.next()).toBe('102');
    });

    it('resumes from Last-Event-ID (monotonic format)', () => {
      const gen = new MonotonicEventIdGenerator();
      const resumed = gen.fromLastEventId('42');
      expect(resumed.next()).toBe('43');
      expect(resumed.next()).toBe('44');
    });

    it('resumes from Last-Event-ID (composite format — extracts sequence)', () => {
      const gen = new MonotonicEventIdGenerator();
      const resumed = gen.fromLastEventId('srv1:42');
      expect(resumed.next()).toBe('43');
    });

    it('handles invalid Last-Event-ID gracefully', () => {
      const gen = new MonotonicEventIdGenerator();
      const resumed = gen.fromLastEventId('invalid');
      expect(resumed.next()).toBe('1');
    });
  });

  // --------------------------------------------------------------------------
  // CompositeEventIdGenerator
  // --------------------------------------------------------------------------

  describe('CompositeEventIdGenerator', () => {
    it('generates composite IDs with server prefix', () => {
      const gen = new CompositeEventIdGenerator('us-east-1');
      expect(gen.next()).toBe('us-east-1:1');
      expect(gen.next()).toBe('us-east-1:2');
      expect(gen.next()).toBe('us-east-1:3');
    });

    it('starts from custom offset', () => {
      const gen = new CompositeEventIdGenerator('srv1', 10);
      expect(gen.next()).toBe('srv1:11');
    });

    it('resumes from same-server Last-Event-ID', () => {
      const gen = new CompositeEventIdGenerator('srv1');
      const resumed = gen.fromLastEventId('srv1:42');
      expect(resumed.next()).toBe('srv1:43');
      expect(resumed.next()).toBe('srv1:44');
    });

    it('starts fresh on different-server Last-Event-ID', () => {
      const gen = new CompositeEventIdGenerator('srv2');
      const resumed = gen.fromLastEventId('srv1:42');
      // Different server — starts from 0 (STREAM_RESUME_LOST handles reconnect)
      expect(resumed.next()).toBe('srv2:1');
    });

    it('resumes from monotonic Last-Event-ID (no serverId)', () => {
      const gen = new CompositeEventIdGenerator('srv1');
      const resumed = gen.fromLastEventId('42');
      // No serverId in last ID → treat as same server
      expect(resumed.next()).toBe('srv1:43');
    });

    it('handles invalid Last-Event-ID gracefully', () => {
      const gen = new CompositeEventIdGenerator('srv1');
      const resumed = gen.fromLastEventId('invalid');
      expect(resumed.next()).toBe('srv1:1');
    });
  });

  // --------------------------------------------------------------------------
  // createEventIdGenerator (factory)
  // --------------------------------------------------------------------------

  describe('createEventIdGenerator', () => {
    const originalEnv = process.env.SSE_SERVER_ID;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.SSE_SERVER_ID;
      } else {
        process.env.SSE_SERVER_ID = originalEnv;
      }
    });

    it('returns MonotonicEventIdGenerator by default', () => {
      delete process.env.SSE_SERVER_ID;
      const gen = createEventIdGenerator();
      expect(gen.next()).toBe('1');
      expect(gen.next()).toBe('2');
    });

    it('returns CompositeEventIdGenerator when SSE_SERVER_ID is set', () => {
      process.env.SSE_SERVER_ID = 'us-west-2';
      const gen = createEventIdGenerator();
      expect(gen.next()).toBe('us-west-2:1');
      expect(gen.next()).toBe('us-west-2:2');
    });

    it('respects config override over env var', () => {
      process.env.SSE_SERVER_ID = 'from-env';
      const gen = createEventIdGenerator({ serverId: 'from-config' });
      expect(gen.next()).toBe('from-config:1');
    });

    it('uses env var when config.serverId is undefined', () => {
      process.env.SSE_SERVER_ID = 'from-env';
      const gen = createEventIdGenerator({});
      expect(gen.next()).toBe('from-env:1');
    });
  });

  // --------------------------------------------------------------------------
  // Server Switch Detection
  // --------------------------------------------------------------------------

  describe('server switch detection', () => {
    it('detects server switch via parsed serverId mismatch', () => {
      const parsed = parseLastEventId('srv1:42');
      const currentServerId = 'srv2';

      const isServerSwitch = parsed.serverId != null && parsed.serverId !== currentServerId;
      expect(isServerSwitch).toBe(true);
    });

    it('no server switch when serverIds match', () => {
      const parsed = parseLastEventId('srv1:42');
      const currentServerId = 'srv1';

      const isServerSwitch = parsed.serverId != null && parsed.serverId !== currentServerId;
      expect(isServerSwitch).toBe(false);
    });

    it('no server switch for monotonic IDs (no serverId)', () => {
      const parsed = parseLastEventId('42');
      const currentServerId = 'srv1';

      const isServerSwitch = parsed.serverId != null && parsed.serverId !== currentServerId;
      expect(isServerSwitch).toBe(false);
    });
  });
});
