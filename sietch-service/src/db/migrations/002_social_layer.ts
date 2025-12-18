/**
 * Migration 002: Social Layer Schema Extension
 *
 * Adds tables for:
 * - member_profiles: Pseudonymous member profiles with privacy separation
 * - badges: Badge definitions (10 types)
 * - member_badges: Junction table for awarded badges
 * - member_activity: Activity tracking with demurrage decay
 * - member_perks: Exclusive perks and access tiers
 */

export const SOCIAL_LAYER_SCHEMA_SQL = `
-- =============================================================================
-- Member Profiles (Privacy-First Design)
-- =============================================================================
-- Private fields (discord_user_id, wallet via wallet_mappings) are NEVER
-- exposed in public API responses. Only member_id is used for public identity.

CREATE TABLE IF NOT EXISTS member_profiles (
  -- Internal UUID (used for avatar generation, public identity)
  member_id TEXT PRIMARY KEY,

  -- Link to wallet_mappings (private - never exposed in public API)
  discord_user_id TEXT NOT NULL UNIQUE,

  -- Public profile fields
  nym TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bio TEXT,
  pfp_url TEXT,
  pfp_type TEXT CHECK (pfp_type IN ('custom', 'generated', 'none')) DEFAULT 'none',

  -- Tier derived from current_eligibility (naib, fedaykin)
  tier TEXT CHECK (tier IN ('naib', 'fedaykin')) NOT NULL,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  nym_last_changed TEXT,

  -- Onboarding status
  onboarding_complete INTEGER DEFAULT 0 NOT NULL,
  onboarding_step INTEGER DEFAULT 0 NOT NULL,

  -- Foreign key to wallet_mappings
  FOREIGN KEY (discord_user_id) REFERENCES wallet_mappings(discord_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_nym
  ON member_profiles(nym);

CREATE INDEX IF NOT EXISTS idx_member_profiles_tier
  ON member_profiles(tier);

CREATE INDEX IF NOT EXISTS idx_member_profiles_created
  ON member_profiles(created_at);

CREATE INDEX IF NOT EXISTS idx_member_profiles_onboarding
  ON member_profiles(onboarding_complete);

-- =============================================================================
-- Badges Definition
-- =============================================================================
-- 10 badge types across 4 categories: Tenure, Engagement, Contribution, Special

CREATE TABLE IF NOT EXISTS badges (
  badge_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('tenure', 'engagement', 'contribution', 'special')),
  emoji TEXT,

  -- Automatic award criteria (null = manual only)
  auto_criteria_type TEXT CHECK (auto_criteria_type IN ('tenure_days', 'activity_balance', 'badge_count', null)),
  auto_criteria_value REAL,

  -- Display order within category
  display_order INTEGER DEFAULT 0 NOT NULL,

  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Seed badge definitions
INSERT OR IGNORE INTO badges (badge_id, name, description, category, emoji, auto_criteria_type, auto_criteria_value, display_order) VALUES
  -- Tenure badges
  ('og', 'OG', 'Member since launch (first 30 days)', 'tenure', '🏛️', 'tenure_days', -1, 1),
  ('veteran', 'Veteran', 'Member for 90+ days', 'tenure', '⚔️', 'tenure_days', 90, 2),
  ('elder', 'Elder', 'Member for 180+ days', 'tenure', '👑', 'tenure_days', 180, 3),

  -- Engagement badges (based on activity balance with demurrage)
  ('consistent', 'Consistent', 'Maintained activity balance of 50+', 'engagement', '🔥', 'activity_balance', 50, 1),
  ('dedicated', 'Dedicated', 'Maintained activity balance of 150+', 'engagement', '💎', 'activity_balance', 150, 2),
  ('devoted', 'Devoted', 'Maintained activity balance of 300+', 'engagement', '🌟', 'activity_balance', 300, 3),

  -- Contribution badges (manual award by admin)
  ('helper', 'Helper', 'Helped community members', 'contribution', '🤝', null, null, 1),
  ('contributor', 'Contributor', 'Made significant contributions', 'contribution', '🛠️', null, null, 2),

  -- Special badges
  ('founding_fedaykin', 'Founding Fedaykin', 'Original Fedaykin at launch', 'special', '🗡️', null, null, 1),
  ('founding_naib', 'Founding Naib', 'Original Naib at launch', 'special', '⚡', null, null, 2);

-- =============================================================================
-- Member Badges (Junction Table)
-- =============================================================================

CREATE TABLE IF NOT EXISTS member_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,

  -- Award metadata
  awarded_at TEXT DEFAULT (datetime('now')) NOT NULL,
  awarded_by TEXT, -- null = automatic, otherwise admin discord_user_id
  award_reason TEXT,

  -- Badge can't be revoked once earned (except by admin)
  revoked INTEGER DEFAULT 0 NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,

  UNIQUE(member_id, badge_id),
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES badges(badge_id)
);

CREATE INDEX IF NOT EXISTS idx_member_badges_member
  ON member_badges(member_id);

CREATE INDEX IF NOT EXISTS idx_member_badges_badge
  ON member_badges(badge_id);

CREATE INDEX IF NOT EXISTS idx_member_badges_awarded
  ON member_badges(awarded_at);

-- =============================================================================
-- Member Activity (Demurrage-Based Tracking)
-- =============================================================================
-- Activity balance decays 10% every 6 hours (configurable)
-- balance = balance * 0.9 every decay period

CREATE TABLE IF NOT EXISTS member_activity (
  member_id TEXT PRIMARY KEY,

  -- Current activity balance (decays over time)
  activity_balance REAL DEFAULT 0.0 NOT NULL,

  -- Last decay application timestamp
  last_decay_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Lifetime statistics (never decay)
  total_messages INTEGER DEFAULT 0 NOT NULL,
  total_reactions_given INTEGER DEFAULT 0 NOT NULL,
  total_reactions_received INTEGER DEFAULT 0 NOT NULL,

  -- Last activity timestamp
  last_active_at TEXT,

  -- Peak activity balance achieved (for display purposes)
  peak_balance REAL DEFAULT 0.0 NOT NULL,

  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_activity_balance
  ON member_activity(activity_balance);

CREATE INDEX IF NOT EXISTS idx_member_activity_last_active
  ON member_activity(last_active_at);

-- =============================================================================
-- Member Perks (Exclusive Access Tiers)
-- =============================================================================
-- Tracks which perks/channels a member has access to

CREATE TABLE IF NOT EXISTS member_perks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  perk_type TEXT NOT NULL CHECK (perk_type IN ('channel_access', 'role', 'custom')),
  perk_id TEXT NOT NULL, -- channel_id, role_id, or custom perk identifier

  -- How perk was granted
  granted_by TEXT CHECK (granted_by IN ('automatic', 'admin', 'badge')),
  granted_reason TEXT,
  granted_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Expiration (null = permanent)
  expires_at TEXT,

  UNIQUE(member_id, perk_type, perk_id),
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_perks_member
  ON member_perks(member_id);

CREATE INDEX IF NOT EXISTS idx_member_perks_type
  ON member_perks(perk_type);
`;

/**
 * SQL to roll back social layer schema (for testing)
 */
export const SOCIAL_LAYER_ROLLBACK_SQL = `
DROP TABLE IF EXISTS member_perks;
DROP TABLE IF EXISTS member_activity;
DROP TABLE IF EXISTS member_badges;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS member_profiles;
`;
