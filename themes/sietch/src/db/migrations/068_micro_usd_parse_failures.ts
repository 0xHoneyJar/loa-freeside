/**
 * Migration 068: micro_usd_parse_failures dead-letter table
 *
 * Quarantine table for DB rows where micro-USD parsing fails.
 * Instead of skipping rows, failed parses are quarantined here for
 * later investigation and replay after data normalization fixes.
 *
 * Schema per Sprint 4 (346), Task 4.4, AC-4.4.3b:
 *   - source_fingerprint: sha256(table_name || original_row_id || raw_value || error_code)
 *   - UNIQUE(source_fingerprint) for dedup — INSERT uses ON CONFLICT DO NOTHING
 *   - Indexes on (table_name, created_at) for purge queries
 *   - replayed_at: idempotency guard for replay script
 *   - replay_attempts + last_replay_error: replay audit trail
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.4
 * @see grimoires/loa/sdd.md §3.6 IMP-006
 */

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS micro_usd_parse_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_row_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      context TEXT NOT NULL,
      error_code TEXT NOT NULL,
      reason TEXT,
      source_fingerprint TEXT NOT NULL UNIQUE,
      replayed_at TEXT,
      replay_attempts INTEGER NOT NULL DEFAULT 0,
      last_replay_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_micro_usd_parse_failures_table_created
      ON micro_usd_parse_failures(table_name, created_at);

    CREATE INDEX IF NOT EXISTS idx_micro_usd_parse_failures_replayed
      ON micro_usd_parse_failures(replayed_at);
  `);
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_micro_usd_parse_failures_replayed;
    DROP INDEX IF EXISTS idx_micro_usd_parse_failures_table_created;
    DROP TABLE IF EXISTS micro_usd_parse_failures;
  `);
}
