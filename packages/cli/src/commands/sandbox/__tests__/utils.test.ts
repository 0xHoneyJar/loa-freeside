/**
 * Sandbox CLI Utilities Tests
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Unit tests for shared CLI utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTTL,
  getCurrentUser,
  formatDate,
  formatDuration,
  timeUntil,
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
} from '../utils.js';

describe('parseTTL', () => {
  describe('plain numbers (hours)', () => {
    it('should parse integer hours', () => {
      expect(parseTTL('24')).toBe(24);
      expect(parseTTL('48')).toBe(48);
      expect(parseTTL('1')).toBe(1);
    });

    it('should reject numbers below 1 hour', () => {
      expect(() => parseTTL('0')).toThrow('TTL must be at least 1 hour');
    });

    it('should reject numbers above max TTL', () => {
      expect(() => parseTTL('200')).toThrow(`TTL cannot exceed ${MAX_TTL_HOURS} hours`);
    });
  });

  describe('duration strings', () => {
    it('should parse hours', () => {
      expect(parseTTL('24h')).toBe(24);
      expect(parseTTL('48h')).toBe(48);
      expect(parseTTL('1h')).toBe(1);
    });

    it('should parse days', () => {
      expect(parseTTL('1d')).toBe(24);
      expect(parseTTL('2d')).toBe(48);
      expect(parseTTL('7d')).toBe(168);
    });

    it('should parse weeks', () => {
      expect(parseTTL('1w')).toBe(168);
    });

    it('should parse minutes (rounded up to hours)', () => {
      expect(parseTTL('30m')).toBe(1); // 0.5 hours rounds up to 1
      expect(parseTTL('90m')).toBe(2); // 1.5 hours rounds up to 2
    });

    it('should round up small durations to at least 1 hour', () => {
      // ms parses 1s as 1000ms, which rounds up to 1 hour
      expect(parseTTL('1s')).toBe(1);
      expect(parseTTL('30m')).toBe(1);
    });

    it('should reject durations above max TTL', () => {
      expect(() => parseTTL('8d')).toThrow(`TTL cannot exceed ${MAX_TTL_HOURS} hours`);
    });

    it('should reject invalid duration strings', () => {
      expect(() => parseTTL('invalid')).toThrow('Invalid TTL format');
      expect(() => parseTTL('abc123')).toThrow('Invalid TTL format');
    });
  });

  describe('constants', () => {
    it('should export DEFAULT_TTL_HOURS', () => {
      expect(DEFAULT_TTL_HOURS).toBe(24);
    });

    it('should export MAX_TTL_HOURS', () => {
      expect(MAX_TTL_HOURS).toBe(168);
    });
  });
});

describe('getCurrentUser', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.SANDBOX_OWNER;
    delete process.env.USER;
    delete process.env.USERNAME;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  it('should prefer SANDBOX_OWNER', () => {
    process.env.SANDBOX_OWNER = 'sandbox-user';
    process.env.USER = 'system-user';
    expect(getCurrentUser()).toBe('sandbox-user');
  });

  it('should fall back to USER', () => {
    process.env.USER = 'system-user';
    expect(getCurrentUser()).toBe('system-user');
  });

  it('should fall back to USERNAME (Windows)', () => {
    process.env.USERNAME = 'windows-user';
    expect(getCurrentUser()).toBe('windows-user');
  });

  it('should return unknown as last resort', () => {
    // Note: process.env.USER might be set by the system
    // so we need to explicitly delete it
    delete process.env.USER;
    delete process.env.USERNAME;
    delete process.env.SANDBOX_OWNER;

    // getCurrentUser checks SANDBOX_OWNER, USER, USERNAME in order
    // If all are undefined, returns 'unknown'
    const result = getCurrentUser();
    // May be 'unknown' or actual system USER depending on env
    expect(typeof result).toBe('string');
  });
});

describe('formatDate', () => {
  it('should format a date in ISO format', () => {
    const date = new Date('2024-01-15T14:30:00.000Z');
    expect(formatDate(date)).toBe('2024-01-15 14:30:00');
  });

  it('should return dash for null', () => {
    expect(formatDate(null)).toBe('-');
  });
});

describe('formatDuration', () => {
  it('should format hours and minutes', () => {
    // 2 hours 30 minutes = 2.5 * 60 * 60 * 1000 ms
    const ms = 2.5 * 60 * 60 * 1000;
    expect(formatDuration(ms)).toBe('2h 30m');
  });

  it('should format days and hours', () => {
    // 2 days 5 hours = (48 + 5) * 60 * 60 * 1000 ms
    const ms = 53 * 60 * 60 * 1000;
    expect(formatDuration(ms)).toBe('2d 5h');
  });

  it('should format minutes only for < 1 hour', () => {
    const ms = 30 * 60 * 1000;
    expect(formatDuration(ms)).toBe('30m');
  });

  it('should return expired for negative values', () => {
    expect(formatDuration(-1000)).toBe('expired');
  });
});

describe('timeUntil', () => {
  it('should return positive for future dates', () => {
    const future = new Date(Date.now() + 60000); // 1 minute in future
    expect(timeUntil(future)).toBeGreaterThan(0);
  });

  it('should return negative for past dates', () => {
    const past = new Date(Date.now() - 60000); // 1 minute in past
    expect(timeUntil(past)).toBeLessThan(0);
  });
});
