/**
 * Migration: Custom Providers Table
 *
 * Sprint 103: Provider Registry
 *
 * Creates the custom_providers table for community-defined
 * token-gating bot detection patterns.
 *
 * Note: Using SQLite-compatible syntax (TEXT[] stored as JSON)
 */

import type { Database } from 'better-sqlite3';

export const id = '016_custom_providers';

export function up(db: Database): void {
  // Create custom_providers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_providers (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      bot_ids TEXT DEFAULT '[]',
      channel_patterns TEXT DEFAULT '[]',
      role_patterns TEXT DEFAULT '[]',
      weight REAL DEFAULT 0.80,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slug, community_id)
    )
  `);

  // Create indexes for efficient lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_custom_providers_community
    ON custom_providers(community_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_custom_providers_active
    ON custom_providers(is_active)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_custom_providers_slug
    ON custom_providers(slug)
  `);
}

export function down(db: Database): void {
  db.exec('DROP INDEX IF EXISTS idx_custom_providers_slug');
  db.exec('DROP INDEX IF EXISTS idx_custom_providers_active');
  db.exec('DROP INDEX IF EXISTS idx_custom_providers_community');
  db.exec('DROP TABLE IF EXISTS custom_providers');
}
