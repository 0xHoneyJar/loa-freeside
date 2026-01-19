/**
 * Migration: Migration Prompts Table
 *
 * Sprint 105: Migration System
 *
 * Creates the migration_prompts table for tracking migration prompts
 * sent to community admins.
 *
 * Note: Using SQLite-compatible syntax (content stored as JSON TEXT)
 */

import type { Database } from 'better-sqlite3';

export const id = '018_migration_prompts';

export function up(db: Database): void {
  // Create migration_prompts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_prompts (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      accuracy REAL NOT NULL,
      days_in_shadow INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_ready INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_action TEXT
    )
  `);

  // Create indexes for efficient lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_migration_prompts_community_sent
    ON migration_prompts(community_id, sent_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_migration_prompts_acknowledged
    ON migration_prompts(acknowledged_at)
  `);
}

export function down(db: Database): void {
  db.exec('DROP INDEX IF EXISTS idx_migration_prompts_acknowledged');
  db.exec('DROP INDEX IF EXISTS idx_migration_prompts_community_sent');
  db.exec('DROP TABLE IF EXISTS migration_prompts');
}
