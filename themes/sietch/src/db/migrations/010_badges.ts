/**
 * Migration 010: Score Badges (v4.0 - Sprint 27)
 *
 * Adds score badge infrastructure:
 * - badge_purchases: Track badge purchase history
 * - badge_settings: Store badge display preferences per member
 *
 * Sprint 27: Score Badges
 */

export const BADGES_SCHEMA_SQL = `
-- =============================================================================
-- Badge Purchases Table (Sprint 27: Score Badges, Sprint 1: Paddle Migration)
-- =============================================================================
-- Tracks badge purchases for members on lower tiers (Basic and below).
-- Premium+ tiers get badges for free via entitlement check.

CREATE TABLE IF NOT EXISTS badge_purchases (
  id TEXT PRIMARY KEY,

  -- Member who purchased the badge
  member_id TEXT NOT NULL,

  -- Payment provider payment ID (provider-agnostic)
  payment_id TEXT,

  -- Purchase timestamp
  purchased_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- One purchase per member (idempotency)
  UNIQUE(member_id)
);

-- Index for member lookups
CREATE INDEX IF NOT EXISTS idx_badge_purchases_member
  ON badge_purchases(member_id);

-- Index for payment tracking
CREATE INDEX IF NOT EXISTS idx_badge_purchases_payment
  ON badge_purchases(payment_id);

-- =============================================================================
-- Badge Settings Table (Sprint 27: Score Badges)
-- =============================================================================
-- Stores badge display preferences per member.
-- Created on first badge access or settings update.

CREATE TABLE IF NOT EXISTS badge_settings (
  -- Member identifier (primary key)
  member_id TEXT PRIMARY KEY,

  -- Display preferences per platform
  display_on_discord INTEGER NOT NULL DEFAULT 1,
  display_on_telegram INTEGER NOT NULL DEFAULT 0,

  -- Badge display style
  -- 'default': ⚡ 847 | Fedaykin
  -- 'minimal': ⚡847
  -- 'detailed': ⚡ Score: 847 (Fedaykin)
  badge_style TEXT NOT NULL DEFAULT 'default'
    CHECK (badge_style IN ('default', 'minimal', 'detailed')),

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for platform queries
CREATE INDEX IF NOT EXISTS idx_badge_settings_discord
  ON badge_settings(display_on_discord)
  WHERE display_on_discord = 1;

CREATE INDEX IF NOT EXISTS idx_badge_settings_telegram
  ON badge_settings(display_on_telegram)
  WHERE display_on_telegram = 1;
`;

/**
 * Rollback SQL for badge tables
 */
export const BADGES_ROLLBACK_SQL = `
DROP TABLE IF EXISTS badge_settings;
DROP TABLE IF EXISTS badge_purchases;
`;
