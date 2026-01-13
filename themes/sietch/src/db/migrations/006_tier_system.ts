/**
 * Migration 006: Tier System (v3.0)
 *
 * Sprint 15 (Tier Foundation):
 * - Add tier columns to member_profiles
 * - tier_history: Track tier progression over time
 * - sponsor_invites: Track Water Sharer sponsor invites
 * - story_fragments: Store Dune-themed narrative fragments
 * - weekly_digests: Track weekly digest posts
 *
 * This migration enables the 9-tier system (Hajra through Naib) with
 * sponsor invites, story fragments, and weekly community digests.
 */

export const TIER_SYSTEM_SCHEMA_SQL = `
-- =============================================================================
-- Member Profiles Extension (Sprint 15: Tier System)
-- =============================================================================
-- Add tier columns to track member tier and progression

-- Add tier column with default 'hajra' (6.9+ BGT minimum)
-- Tier is calculated based on BGT holdings and rank
-- Valid tiers: 'hajra', 'ichwan', 'qanat', 'sihaya', 'mushtamal',
--              'sayyadina', 'usul', 'fedaykin', 'naib'
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra' NOT NULL
  CHECK (tier IN ('hajra', 'ichwan', 'qanat', 'sihaya', 'mushtamal',
                  'sayyadina', 'usul', 'fedaykin', 'naib'));

-- Track when tier was last updated
ALTER TABLE member_profiles ADD COLUMN tier_updated_at TEXT DEFAULT (datetime('now')) NOT NULL;

-- Index for tier-based queries
CREATE INDEX IF NOT EXISTS idx_member_profiles_tier
  ON member_profiles(tier);

-- Index for tier update timestamp
CREATE INDEX IF NOT EXISTS idx_member_profiles_tier_updated
  ON member_profiles(tier_updated_at);

-- =============================================================================
-- Tier History (Sprint 15)
-- =============================================================================
-- Tracks all tier changes for analytics and member progress tracking.
-- Enables features like "promoted from Ichwan to Qanat on 2025-01-15"

CREATE TABLE IF NOT EXISTS tier_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Member whose tier changed
  member_id TEXT NOT NULL,

  -- Previous tier (NULL for initial assignment)
  old_tier TEXT CHECK (old_tier IN ('hajra', 'ichwan', 'qanat', 'sihaya',
                                     'mushtamal', 'sayyadina', 'usul',
                                     'fedaykin', 'naib')),

  -- New tier
  new_tier TEXT NOT NULL CHECK (new_tier IN ('hajra', 'ichwan', 'qanat',
                                              'sihaya', 'mushtamal', 'sayyadina',
                                              'usul', 'fedaykin', 'naib')),

  -- BGT holdings at time of change (wei as string)
  bgt_at_change TEXT NOT NULL,

  -- Eligibility rank at time of change
  rank_at_change INTEGER,

  -- When the change occurred
  changed_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Foreign key to member_profiles
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE
);

-- Index for member tier history lookups
CREATE INDEX IF NOT EXISTS idx_tier_history_member
  ON tier_history(member_id);

-- Index for tier change queries (e.g., "all promotions to Usul")
CREATE INDEX IF NOT EXISTS idx_tier_history_new_tier
  ON tier_history(new_tier);

-- Index for recent changes
CREATE INDEX IF NOT EXISTS idx_tier_history_changed_at
  ON tier_history(changed_at);

-- =============================================================================
-- Sponsor Invites (Sprint 17: Sponsor System)
-- =============================================================================
-- Tracks sponsor invites from Water Sharer badge holders.
-- Each sponsor can have ONE active invite at a time.
-- Invitee receives sponsor's tier on onboarding completion.

CREATE TABLE IF NOT EXISTS sponsor_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Sponsor (must have Water Sharer badge)
  sponsor_member_id TEXT NOT NULL,

  -- Invitee Discord user ID
  invitee_discord_user_id TEXT NOT NULL,

  -- Sponsor's tier at time of invite (invitee will receive this tier)
  sponsor_tier_at_invite TEXT NOT NULL CHECK (sponsor_tier_at_invite IN
    ('hajra', 'ichwan', 'qanat', 'sihaya', 'mushtamal', 'sayyadina',
     'usul', 'fedaykin', 'naib')),

  -- Invite status
  status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),

  -- When invite was created
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- When invite was accepted (NULL if not accepted)
  accepted_at TEXT,

  -- Member ID created after acceptance (NULL if not accepted)
  invitee_member_id TEXT,

  -- Admin who revoked (if status = 'revoked')
  revoked_by TEXT,

  -- Reason for revocation
  revoke_reason TEXT,

  -- When revoked
  revoked_at TEXT,

  -- Foreign key to sponsor
  FOREIGN KEY (sponsor_member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_member_id) REFERENCES member_profiles(member_id) ON DELETE SET NULL
);

-- Index for sponsor lookups (find invite by sponsor)
CREATE INDEX IF NOT EXISTS idx_sponsor_invites_sponsor
  ON sponsor_invites(sponsor_member_id);

-- Index for invitee lookups (check if Discord user has pending invite)
CREATE INDEX IF NOT EXISTS idx_sponsor_invites_invitee
  ON sponsor_invites(invitee_discord_user_id);

-- Index for active invites (pending status)
CREATE INDEX IF NOT EXISTS idx_sponsor_invites_status
  ON sponsor_invites(status);

-- Unique constraint: only one pending invite per sponsor
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_invites_active_sponsor
  ON sponsor_invites(sponsor_member_id) WHERE status = 'pending';

-- Unique constraint: only one pending invite per Discord user
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_invites_active_invitee
  ON sponsor_invites(invitee_discord_user_id) WHERE status = 'pending';

-- =============================================================================
-- Story Fragments (Sprint 21: Stories & Analytics)
-- =============================================================================
-- Stores cryptic Dune-themed narrative fragments posted when elite members join.
-- Fragments are randomly selected (least-used first) for variety.

CREATE TABLE IF NOT EXISTS story_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Fragment category (determines when it's used)
  category TEXT NOT NULL CHECK (category IN ('fedaykin_join', 'naib_join')),

  -- The narrative text (Markdown supported)
  fragment_text TEXT NOT NULL,

  -- How many times this fragment has been used
  usage_count INTEGER DEFAULT 0 NOT NULL,

  -- When fragment was added
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- When fragment was last used
  last_used_at TEXT
);

-- Index for category lookups
CREATE INDEX IF NOT EXISTS idx_story_fragments_category
  ON story_fragments(category);

-- Index for least-used selection (category + usage_count)
CREATE INDEX IF NOT EXISTS idx_story_fragments_selection
  ON story_fragments(category, usage_count, last_used_at);

-- =============================================================================
-- Weekly Digests (Sprint 20: Weekly Digest)
-- =============================================================================
-- Tracks weekly community digest posts for audit trail and analytics.
-- One digest per week, posted every Monday at 00:00 UTC.

CREATE TABLE IF NOT EXISTS weekly_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Week identifier (ISO 8601 week: YYYY-Wnn, e.g., "2025-W03")
  week_identifier TEXT NOT NULL UNIQUE,

  -- Total members at time of digest
  total_members INTEGER NOT NULL,

  -- New members this week
  new_members INTEGER NOT NULL,

  -- Total BGT represented (wei as string)
  total_bgt TEXT NOT NULL,

  -- Tier distribution (JSON: {"hajra": 50, "ichwan": 30, ...})
  tier_distribution TEXT NOT NULL,

  -- Most active tier this week
  most_active_tier TEXT,

  -- Total promotions this week
  promotions_count INTEGER NOT NULL,

  -- Notable promotions (JSON array of promotion records)
  notable_promotions TEXT,

  -- Badges awarded this week
  badges_awarded INTEGER NOT NULL,

  -- Top new member by BGT (nym)
  top_new_member_nym TEXT,

  -- Discord message ID of posted digest
  message_id TEXT,

  -- Discord channel ID where posted
  channel_id TEXT,

  -- When digest was generated
  generated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- When digest was posted to Discord
  posted_at TEXT
);

-- Index for week lookups
CREATE INDEX IF NOT EXISTS idx_weekly_digests_week
  ON weekly_digests(week_identifier);

-- Index for recent digests
CREATE INDEX IF NOT EXISTS idx_weekly_digests_generated
  ON weekly_digests(generated_at);
`;

/**
 * Rollback SQL for tier system migration
 * WARNING: This will permanently delete all tier history, sponsor invites,
 * story fragments, and weekly digest data.
 */
export const TIER_SYSTEM_ROLLBACK_SQL = `
-- Drop tier system tables (in reverse dependency order)
DROP TABLE IF EXISTS weekly_digests;
DROP TABLE IF EXISTS story_fragments;
DROP TABLE IF EXISTS sponsor_invites;
DROP TABLE IF EXISTS tier_history;

-- Drop tier-related indexes
DROP INDEX IF EXISTS idx_member_profiles_tier_updated;
DROP INDEX IF EXISTS idx_member_profiles_tier;

-- Remove tier columns from member_profiles
-- Note: SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
-- For now, we'll leave the columns (they'll just be unused after rollback)
-- In production, a full table recreation would be required:
-- 1. CREATE TABLE member_profiles_backup AS SELECT (all columns except tier) FROM member_profiles
-- 2. DROP TABLE member_profiles
-- 3. RENAME TABLE member_profiles_backup TO member_profiles
-- 4. Recreate all indexes and constraints

-- For development/testing, we can just set tier back to default
UPDATE member_profiles SET tier = 'hajra', tier_updated_at = datetime('now');
`;

/**
 * Migration runner function
 * @param db SQLite database instance
 */
export async function up(db: any): Promise<void> {
  await db.exec(TIER_SYSTEM_SCHEMA_SQL);
  console.log('Migration 006: Tier System schema applied successfully');
}

/**
 * Rollback function
 * @param db SQLite database instance
 */
export async function down(db: any): Promise<void> {
  await db.exec(TIER_SYSTEM_ROLLBACK_SQL);
  console.log('Migration 006: Tier System schema rolled back successfully');
}
