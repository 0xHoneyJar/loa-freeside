/**
 * Timestamp Format Regression Tests
 *
 * Ensures the canonical timestamp module produces SQLite-compatible format
 * and catches format mixing bugs (BB-67-001).
 *
 * Sprint 14, Task 14.4
 */

import { describe, it, expect } from 'vitest';
import {
  sqliteTimestamp,
  sqliteFutureTimestamp,
  isoTimestamp,
  isSqliteFormat,
  isIsoFormat,
  parseSqliteTimestamp,
  type SqliteTimestamp,
} from '../../../src/packages/adapters/billing/protocol/timestamps';

describe('protocol/timestamps', () => {
  describe('sqliteTimestamp', () => {
    it('returns space-separated format matching datetime("now")', () => {
      const ts = sqliteTimestamp();
      // Format: YYYY-MM-DD HH:MM:SS
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // Must NOT contain 'T' separator
      expect(ts).not.toContain('T');
      // Must NOT contain 'Z' suffix
      expect(ts).not.toContain('Z');
    });

    it('accepts a Date parameter', () => {
      const fixed = new Date('2026-03-15T14:30:45.123Z');
      const ts = sqliteTimestamp(fixed);
      expect(ts).toBe('2026-03-15 14:30:45');
    });

    it('produces correct chronological ordering via string comparison', () => {
      const t1 = sqliteTimestamp(new Date('2026-01-01T00:00:00Z'));
      const t2 = sqliteTimestamp(new Date('2026-01-01T00:00:01Z'));
      const t3 = sqliteTimestamp(new Date('2026-12-31T23:59:59Z'));

      expect(t1 < t2).toBe(true);
      expect(t2 < t3).toBe(true);
      expect(t1 < t3).toBe(true);
    });
  });

  describe('sqliteFutureTimestamp', () => {
    it('returns SQLite format with offset', () => {
      const base = new Date('2026-06-01T12:00:00Z');
      const future = sqliteFutureTimestamp(3600, base); // +1 hour
      expect(future).toBe('2026-06-01 13:00:00');
      expect(isSqliteFormat(future)).toBe(true);
    });

    it('handles large offsets (48 hours)', () => {
      const base = new Date('2026-06-01T12:00:00Z');
      const future = sqliteFutureTimestamp(48 * 3600, base);
      expect(future).toBe('2026-06-03 12:00:00');
    });
  });

  describe('isoTimestamp', () => {
    it('returns ISO 8601 format with T separator and Z suffix', () => {
      const ts = isoTimestamp();
      expect(ts).toContain('T');
      expect(ts).toMatch(/Z$/);
    });

    it('accepts a Date parameter', () => {
      const fixed = new Date('2026-03-15T14:30:45.123Z');
      const ts = isoTimestamp(fixed);
      expect(ts).toBe('2026-03-15T14:30:45.123Z');
    });
  });

  describe('format detection', () => {
    it('detects SQLite format', () => {
      expect(isSqliteFormat('2026-01-15 14:30:00')).toBe(true);
      expect(isSqliteFormat('2026-01-15T14:30:00.000Z')).toBe(false);
    });

    it('detects ISO format', () => {
      expect(isIsoFormat('2026-01-15T14:30:00.000Z')).toBe(true);
      expect(isIsoFormat('2026-01-15 14:30:00')).toBe(false);
    });

    it('SQLite and ISO formats are mutually exclusive', () => {
      const sqlTs = sqliteTimestamp();
      const isoTs = isoTimestamp();

      expect(isSqliteFormat(sqlTs)).toBe(true);
      expect(isIsoFormat(sqlTs)).toBe(false);

      expect(isIsoFormat(isoTs)).toBe(true);
      expect(isSqliteFormat(isoTs)).toBe(false);
    });
  });

  describe('parseSqliteTimestamp (DB read boundary)', () => {
    it('brands a valid SQLite timestamp string', () => {
      const raw = '2026-03-15 14:30:00';
      const branded: SqliteTimestamp = parseSqliteTimestamp(raw);
      expect(branded).toBe(raw);
      expect(isSqliteFormat(branded)).toBe(true);
    });

    it('throws on ISO 8601 input', () => {
      expect(() => parseSqliteTimestamp('2026-03-15T14:30:00.000Z')).toThrow(
        'Invalid SQLite timestamp format',
      );
    });

    it('throws on empty string', () => {
      expect(() => parseSqliteTimestamp('')).toThrow('Invalid SQLite timestamp format');
    });

    it('throws on partial timestamp', () => {
      expect(() => parseSqliteTimestamp('2026-03-15')).toThrow('Invalid SQLite timestamp format');
    });

    it('round-trips with sqliteTimestamp', () => {
      const original = sqliteTimestamp(new Date('2026-06-01T12:00:00Z'));
      const parsed = parseSqliteTimestamp(original);
      expect(parsed).toBe(original);
    });
  });

  describe('SqliteTimestamp branded type (compile-time)', () => {
    it('sqliteTimestamp returns SqliteTimestamp type', () => {
      const ts: SqliteTimestamp = sqliteTimestamp();
      expect(typeof ts).toBe('string');
    });

    it('sqliteFutureTimestamp returns SqliteTimestamp type', () => {
      const ts: SqliteTimestamp = sqliteFutureTimestamp(60);
      expect(typeof ts).toBe('string');
    });

    it('parseSqliteTimestamp returns SqliteTimestamp type', () => {
      const ts: SqliteTimestamp = parseSqliteTimestamp('2026-01-01 00:00:00');
      expect(typeof ts).toBe('string');
    });

    it('plain string is not assignable to SqliteTimestamp (compile-time check)', () => {
      const plain: string = '2026-01-01 00:00:00';
      // @ts-expect-error — branded type prevents accidental string assignment
      const _branded: SqliteTimestamp = plain;
      // If @ts-expect-error is unused, tsc fails — proving the brand works
      expect(_branded).toBeDefined();
    });
  });

  describe('cross-format ordering bug detection (BB-67-001)', () => {
    it('demonstrates why mixing formats breaks ordering', () => {
      // ISO: 2026-01-15T14:30:00.000Z (T = 0x54)
      // SQLite: 2026-01-15 14:30:00 (space = 0x20)
      // Same instant but different string comparison result
      const isoTs = '2026-01-15T14:30:00.000Z';
      const sqlTs = '2026-01-15 14:30:00';

      // Space (0x20) < T (0x54), so SQLite format sorts BEFORE ISO
      // This means string comparison gives wrong ordering when mixed
      expect(sqlTs < isoTs).toBe(true);

      // Both represent the same moment but compare differently
      // This is the BB-67-001 bug — never mix formats in the same column
    });
  });
});
