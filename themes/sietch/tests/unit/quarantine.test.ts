/**
 * Dead-letter Quarantine — Unit + Integration Tests
 *
 * Tests for the micro_usd_parse_failures quarantine system per Sprint 4, Task 4.4.
 *
 * Coverage:
 *   - AC-4.4.3b: Schema, fingerprint dedup, ON CONFLICT DO NOTHING
 *   - AC-4.4.3d: 30-day retention purge (integration test with aged rows)
 *   - AC-4.4.3e: Replay script idempotency (skip replayed_at IS NOT NULL)
 *   - AC-4.4.3f: Repeated failures don't re-quarantine (UNIQUE fingerprint)
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.4
 * @see grimoires/loa/sdd.md §3.6 IMP-006
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  quarantineParseFailure,
  computeSourceFingerprint,
  getUnreplayedQuarantineEntries,
  markReplayed,
  recordReplayFailure,
  purgeQuarantineEntries,
  countQuarantineEntries,
} from '../../src/packages/core/protocol/quarantine.js';
import { up } from '../../src/db/migrations/068_micro_usd_parse_failures.js';

// ---------------------------------------------------------------------------
// Test Setup — In-memory SQLite
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  up(db);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Fingerprint Tests
// ---------------------------------------------------------------------------

describe('computeSourceFingerprint', () => {
  it('produces deterministic sha256 hash', () => {
    const fp1 = computeSourceFingerprint('credit_lots', '42', '0x1f', 'CANONICAL_REJECTION');
    const fp2 = computeSourceFingerprint('credit_lots', '42', '0x1f', 'CANONICAL_REJECTION');
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // sha256 hex
  });

  it('produces different hashes for different inputs', () => {
    const fp1 = computeSourceFingerprint('credit_lots', '42', '0x1f', 'CANONICAL_REJECTION');
    const fp2 = computeSourceFingerprint('credit_lots', '43', '0x1f', 'CANONICAL_REJECTION');
    expect(fp1).not.toBe(fp2);
  });
});

// ---------------------------------------------------------------------------
// Quarantine Insert Tests (AC-4.4.3b)
// ---------------------------------------------------------------------------

describe('quarantineParseFailure', () => {
  it('inserts a new quarantine entry', () => {
    const inserted = quarantineParseFailure(db, {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
      reason: 'Invalid format',
    });

    expect(inserted).toBe(true);
    const count = countQuarantineEntries(db);
    expect(count.total).toBe(1);
    expect(count.unreplayed).toBe(1);
  });

  it('deduplicates via source_fingerprint (ON CONFLICT DO NOTHING)', () => {
    const params = {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    };

    const first = quarantineParseFailure(db, params);
    const second = quarantineParseFailure(db, params);

    expect(first).toBe(true);
    expect(second).toBe(false); // Already exists — 0 rows affected
    expect(countQuarantineEntries(db).total).toBe(1);
  });

  it('allows different errors for the same row (different fingerprint)', () => {
    quarantineParseFailure(db, {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });
    quarantineParseFailure(db, {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'SAFETY_MAX_VALUE',
    });

    expect(countQuarantineEntries(db).total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Replay Tests (AC-4.4.3e)
// ---------------------------------------------------------------------------

describe('replay operations', () => {
  beforeEach(() => {
    quarantineParseFailure(db, {
      originalRowId: '1',
      tableName: 'credit_lots',
      rawValue: 'abc',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });
    quarantineParseFailure(db, {
      originalRowId: '2',
      tableName: 'credit_lots',
      rawValue: 'xyz',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });
  });

  it('getUnreplayedQuarantineEntries returns only unreplayed rows', () => {
    const entries = getUnreplayedQuarantineEntries(db);
    expect(entries).toHaveLength(2);
    expect(entries[0].replayedAt).toBeNull();
  });

  it('markReplayed sets replayed_at and increments replay_attempts', () => {
    const entries = getUnreplayedQuarantineEntries(db);
    const success = markReplayed(db, entries[0].id);
    expect(success).toBe(true);

    const remaining = getUnreplayedQuarantineEntries(db);
    expect(remaining).toHaveLength(1);

    const counts = countQuarantineEntries(db);
    expect(counts.replayed).toBe(1);
    expect(counts.unreplayed).toBe(1);
  });

  it('markReplayed is idempotent — second call returns false', () => {
    const entries = getUnreplayedQuarantineEntries(db);
    markReplayed(db, entries[0].id);
    const second = markReplayed(db, entries[0].id);
    expect(second).toBe(false); // Already replayed — WHERE replayed_at IS NULL fails
  });

  it('recordReplayFailure records error without setting replayed_at', () => {
    const entries = getUnreplayedQuarantineEntries(db);
    recordReplayFailure(db, entries[0].id, 'Still invalid');

    const stillUnreplayed = getUnreplayedQuarantineEntries(db);
    expect(stillUnreplayed).toHaveLength(2); // Both still unreplayed
    expect(stillUnreplayed[0].replayAttempts).toBe(1);
    expect(stillUnreplayed[0].lastReplayError).toBe('Still invalid');
  });

  it('replay script skips already-replayed rows', () => {
    const entries = getUnreplayedQuarantineEntries(db);
    markReplayed(db, entries[0].id);

    // After replaying one, only one remains
    const remaining = getUnreplayedQuarantineEntries(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].originalRowId).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// Purge Tests (AC-4.4.3d)
// ---------------------------------------------------------------------------

describe('purgeQuarantineEntries', () => {
  it('deletes rows older than retention period', () => {
    // Insert a row
    quarantineParseFailure(db, {
      originalRowId: '1',
      tableName: 'credit_lots',
      rawValue: 'bad',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });

    // Manually backdate the row to 31 days ago
    db.prepare(`
      UPDATE micro_usd_parse_failures
      SET created_at = datetime('now', '-31 days')
      WHERE original_row_id = '1'
    `).run();

    // Insert a recent row (should survive purge)
    quarantineParseFailure(db, {
      originalRowId: '2',
      tableName: 'credit_lots',
      rawValue: 'also_bad',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });

    const deleted = purgeQuarantineEntries(db, 30);
    expect(deleted).toBe(1);

    const remaining = countQuarantineEntries(db);
    expect(remaining.total).toBe(1);
  });

  it('purge is idempotent — running twice deletes nothing on second run', () => {
    quarantineParseFailure(db, {
      originalRowId: '1',
      tableName: 'credit_lots',
      rawValue: 'bad',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    });
    db.prepare(`
      UPDATE micro_usd_parse_failures
      SET created_at = datetime('now', '-31 days')
    `).run();

    purgeQuarantineEntries(db, 30);
    const secondPurge = purgeQuarantineEntries(db, 30);
    expect(secondPurge).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: Repeated Failures (AC-4.4.3f)
// ---------------------------------------------------------------------------

describe('Integration: repeated parse failures', () => {
  it('same row not re-quarantined on retry (UNIQUE fingerprint)', () => {
    const params = {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    };

    // Simulate 5 retries of the same failure
    for (let i = 0; i < 5; i++) {
      quarantineParseFailure(db, params);
    }

    // Only 1 row should exist
    expect(countQuarantineEntries(db).total).toBe(1);
  });

  it('system remains available during repeated quarantine attempts', () => {
    // This test verifies that repeated ON CONFLICT DO NOTHING doesn't throw
    const params = {
      originalRowId: '42',
      tableName: 'credit_lots',
      rawValue: '0x1f',
      context: 'db',
      errorCode: 'CANONICAL_REJECTION',
    };

    // No exceptions should be thrown
    expect(() => {
      for (let i = 0; i < 100; i++) {
        quarantineParseFailure(db, params);
      }
    }).not.toThrow();
  });
});
