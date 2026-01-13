/**
 * Migration 007: Water Sharer Badge System (v3.0 - Sprint 17)
 *
 * Implements the Water Sharer badge sharing system:
 * - Adds 'water-sharer' badge to badges table
 * - Creates water_sharer_grants table to track badge lineage
 *
 * Key Concepts:
 * - Water Sharer badge holders can share their badge with ONE other existing member
 * - This is NOT an invite system - recipients must already be onboarded members
 * - Badge lineage is tracked for audit and cascade revocation purposes
 */

export const WATER_SHARER_SCHEMA_SQL = `
-- =============================================================================
-- Water Sharer Badge Definition (Sprint 17)
-- =============================================================================
-- Add the Water Sharer badge to the badges table.
-- This badge allows members to share it with one other existing member.

INSERT OR IGNORE INTO badges (
  badge_id,
  name,
  description,
  category,
  emoji,
  auto_criteria_type,
  auto_criteria_value,
  display_order
) VALUES (
  'water-sharer',
  'Water Sharer',
  'Recognized contributor who can share this badge with one other member',
  'contribution',
  '💧',
  null,
  null,
  3
);

-- =============================================================================
-- Water Sharer Grants (Sprint 17)
-- =============================================================================
-- Tracks Water Sharer badge grants between members.
-- Each Water Sharer badge holder can grant the badge to ONE other existing member.
-- The grant creates a lineage that can be traced for cascade revocation.

CREATE TABLE IF NOT EXISTS water_sharer_grants (
  -- Unique grant identifier
  id TEXT PRIMARY KEY,

  -- Member who shared the badge (must have Water Sharer badge)
  granter_member_id TEXT NOT NULL,

  -- Member who received the badge (must be existing onboarded member)
  recipient_member_id TEXT NOT NULL,

  -- When the grant was made
  granted_at INTEGER NOT NULL,

  -- When the grant was revoked (NULL if active)
  -- Revocation cascades: if granter's badge is revoked, recipient's is too
  revoked_at INTEGER,

  -- Foreign keys
  FOREIGN KEY (granter_member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE
);

-- Each granter can only have ONE active grant at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_sharer_grants_granter_active
  ON water_sharer_grants(granter_member_id) WHERE revoked_at IS NULL;

-- Each recipient can only receive the badge ONCE (ever, not just active)
-- This prevents badge cycling and ensures clean lineage
CREATE UNIQUE INDEX IF NOT EXISTS idx_water_sharer_grants_recipient_unique
  ON water_sharer_grants(recipient_member_id);

-- Index for looking up grants by recipient
CREATE INDEX IF NOT EXISTS idx_water_sharer_grants_recipient
  ON water_sharer_grants(recipient_member_id);

-- Index for active grants queries
CREATE INDEX IF NOT EXISTS idx_water_sharer_grants_active
  ON water_sharer_grants(revoked_at) WHERE revoked_at IS NULL;
`;

/**
 * Rollback SQL for Water Sharer migration
 */
export const WATER_SHARER_ROLLBACK_SQL = `
-- Drop water_sharer_grants table
DROP TABLE IF EXISTS water_sharer_grants;

-- Remove Water Sharer badge
DELETE FROM member_badges WHERE badge_id = 'water-sharer';
DELETE FROM badges WHERE badge_id = 'water-sharer';
`;

/**
 * Migration runner function
 * @param db SQLite database instance
 */
export async function up(db: any): Promise<void> {
  await db.exec(WATER_SHARER_SCHEMA_SQL);
  console.log('Migration 007: Water Sharer badge system applied successfully');
}

/**
 * Rollback function
 * @param db SQLite database instance
 */
export async function down(db: any): Promise<void> {
  await db.exec(WATER_SHARER_ROLLBACK_SQL);
  console.log('Migration 007: Water Sharer badge system rolled back successfully');
}
