/**
 * Migration 004: Performance Indexes
 *
 * Adds additional indexes for optimizing common query patterns:
 * - Composite index for member badge lookups
 * - Index for audit log queries by type and date
 * - Index for onboarding status queries
 * - Index for activity balance queries
 */

import type Database from 'better-sqlite3';

export const version = 4;
export const name = '004_performance_indexes';

export function up(db: Database.Database): void {
  console.log('Adding performance indexes...');

  // Composite index for faster badge queries (member_id + revoked)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_member_badges_member_revoked
      ON member_badges(member_id, revoked);
  `);

  // Composite index for audit log queries by type and date
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_type_created
      ON audit_log(event_type, created_at DESC);
  `);

  // Index for activity leaderboard queries (balance with onboarding filter)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_member_activity_balance_desc
      ON member_activity(activity_balance DESC);
  `);

  // Covering index for directory pagination (tier + onboarding + created)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_member_profiles_directory
      ON member_profiles(onboarding_complete, tier, created_at DESC);
  `);

  // Index for nym search (case-insensitive)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_member_profiles_nym_lower
      ON member_profiles(nym COLLATE NOCASE);
  `);

  console.log('Performance indexes added successfully');
}

export function down(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_member_badges_member_revoked;
    DROP INDEX IF EXISTS idx_audit_log_type_created;
    DROP INDEX IF EXISTS idx_member_activity_balance_desc;
    DROP INDEX IF EXISTS idx_member_profiles_directory;
    DROP INDEX IF EXISTS idx_member_profiles_nym_lower;
  `);

  console.log('Performance indexes removed');
}
