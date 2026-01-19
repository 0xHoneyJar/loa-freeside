/**
 * Migration: User Engagement Table
 *
 * Sprint 104: Progressive Engagement
 *
 * Creates the user_engagement table for tracking user engagement
 * points and activities per community.
 *
 * Note: Using SQLite-compatible syntax (activities stored as JSON TEXT)
 */

import type { Database } from 'better-sqlite3';

export const id = '017_user_engagement';

export function up(db: Database): void {
  // Create user_engagement table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_engagement (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      points INTEGER DEFAULT 0,
      activities TEXT DEFAULT '[]',
      is_verified INTEGER DEFAULT 0,
      verified_at TEXT,
      last_activity_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, community_id)
    )
  `);

  // Create indexes for efficient lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_engagement_user_community
    ON user_engagement(user_id, community_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_engagement_community
    ON user_engagement(community_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_engagement_points
    ON user_engagement(points DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_engagement_verified
    ON user_engagement(is_verified)
  `);
}

export function down(db: Database): void {
  db.exec('DROP INDEX IF EXISTS idx_user_engagement_verified');
  db.exec('DROP INDEX IF EXISTS idx_user_engagement_points');
  db.exec('DROP INDEX IF EXISTS idx_user_engagement_community');
  db.exec('DROP INDEX IF EXISTS idx_user_engagement_user_community');
  db.exec('DROP TABLE IF EXISTS user_engagement');
}
