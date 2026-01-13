/**
 * Migration 005: Naib Dynamics & Threshold Schema
 *
 * Sprint 11 (Naib Foundation):
 * - naib_seats: Track Naib seat assignments and history
 * - Add is_former_naib to member_profiles
 *
 * Sprint 12 (Cave Entrance) - placeholder for future:
 * - waitlist_registrations: Track waitlist registrations
 * - threshold_snapshots: Historical threshold data
 *
 * Sprint 13 (Notifications) - placeholder for future:
 * - notification_preferences: Member notification settings
 * - alert_history: Audit trail of sent alerts
 */

export const NAIB_THRESHOLD_SCHEMA_SQL = `
-- =============================================================================
-- Naib Seats (Sprint 11: Naib Foundation)
-- =============================================================================
-- Tracks current and historical Naib seat assignments.
-- First 7 eligible members get Naib seats, defended by BGT holdings.
-- Tenure (seated_at) is the tie-breaker when BGT is equal.

CREATE TABLE IF NOT EXISTS naib_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Seat assignment
  seat_number INTEGER NOT NULL CHECK (seat_number >= 1 AND seat_number <= 7),
  member_id TEXT NOT NULL,

  -- When the member was seated
  seated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- When/if the member was unseated (NULL = currently seated)
  unseated_at TEXT,

  -- Reason for unseating
  unseat_reason TEXT CHECK (unseat_reason IN ('bumped', 'left_server', 'ineligible', 'manual')),

  -- Who bumped them (member_id of the new seat holder, if bumped)
  bumped_by_member_id TEXT,

  -- BGT at time of seating (for historical reference)
  bgt_at_seating TEXT NOT NULL,

  -- BGT at time of unseating (for historical reference)
  bgt_at_unseating TEXT,

  -- Foreign key to member_profiles
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE,
  FOREIGN KEY (bumped_by_member_id) REFERENCES member_profiles(member_id) ON DELETE SET NULL
);

-- Index for finding current Naib members (unseated_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_naib_seats_current
  ON naib_seats(unseated_at) WHERE unseated_at IS NULL;

-- Index for member seat history
CREATE INDEX IF NOT EXISTS idx_naib_seats_member
  ON naib_seats(member_id);

-- Index for seat number lookups
CREATE INDEX IF NOT EXISTS idx_naib_seats_seat_number
  ON naib_seats(seat_number);

-- Unique constraint: only one active seat per member at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_naib_seats_active_member
  ON naib_seats(member_id) WHERE unseated_at IS NULL;

-- Unique constraint: only one active holder per seat number
CREATE UNIQUE INDEX IF NOT EXISTS idx_naib_seats_active_seat
  ON naib_seats(seat_number) WHERE unseated_at IS NULL;

-- =============================================================================
-- Member Profiles Extension (Sprint 11)
-- =============================================================================
-- Add is_former_naib flag to track members who have held Naib seats

ALTER TABLE member_profiles ADD COLUMN is_former_naib INTEGER DEFAULT 0 NOT NULL;

-- Index for Former Naib lookups
CREATE INDEX IF NOT EXISTS idx_member_profiles_former_naib
  ON member_profiles(is_former_naib) WHERE is_former_naib = 1;

-- =============================================================================
-- Waitlist Registrations (Sprint 12: Cave Entrance)
-- =============================================================================
-- Tracks users who register for eligibility alerts from positions 70-100.
-- One registration per Discord user, one registration per wallet.

CREATE TABLE IF NOT EXISTS waitlist_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Discord user who registered (not necessarily a member yet)
  discord_user_id TEXT NOT NULL UNIQUE,

  -- Wallet they're tracking
  wallet_address TEXT NOT NULL UNIQUE,

  -- Position at time of registration (70-100)
  position_at_registration INTEGER NOT NULL CHECK (position_at_registration >= 70 AND position_at_registration <= 100),

  -- BGT holdings at time of registration (wei as string)
  bgt_at_registration TEXT NOT NULL,

  -- When they registered
  registered_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Whether they've been notified of eligibility
  notified INTEGER DEFAULT 0 NOT NULL,

  -- When they were notified (if applicable)
  notified_at TEXT,

  -- Whether registration is active
  active INTEGER DEFAULT 1 NOT NULL
);

-- Index for Discord user lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_discord_user
  ON waitlist_registrations(discord_user_id) WHERE active = 1;

-- Index for wallet lookups
CREATE INDEX IF NOT EXISTS idx_waitlist_wallet
  ON waitlist_registrations(wallet_address) WHERE active = 1;

-- Index for finding unnotified registrations
CREATE INDEX IF NOT EXISTS idx_waitlist_unnotified
  ON waitlist_registrations(notified) WHERE notified = 0 AND active = 1;

-- =============================================================================
-- Threshold Snapshots (Sprint 12: Cave Entrance)
-- =============================================================================
-- Historical record of entry threshold and waitlist positions.
-- Used for displaying threshold trends and debugging.

CREATE TABLE IF NOT EXISTS threshold_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- BGT required to enter top 69 (position 69's holdings, wei as string)
  entry_threshold_bgt TEXT NOT NULL,

  -- Total wallets in positions 1-69
  eligible_count INTEGER NOT NULL,

  -- Total wallets in positions 70-100 (waitlist range)
  waitlist_count INTEGER NOT NULL,

  -- Position 70's BGT (first waitlist position, wei as string)
  waitlist_top_bgt TEXT,

  -- Position 100's BGT (last tracked waitlist position, wei as string)
  waitlist_bottom_bgt TEXT,

  -- Gap between position 69 and 70 (distance to entry, wei as string)
  gap_to_entry TEXT,

  -- When this snapshot was taken
  snapshot_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for time-based lookups
CREATE INDEX IF NOT EXISTS idx_threshold_snapshots_time
  ON threshold_snapshots(snapshot_at DESC);

-- =============================================================================
-- Notification Preferences (Sprint 13: Notification System)
-- =============================================================================
-- Stores per-member notification preferences and rate limiting counters.
-- Default: position_updates ON, at_risk_warnings ON, naib_alerts ON, 3_per_week

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Member this preference belongs to
  member_id TEXT NOT NULL UNIQUE,

  -- Notification type toggles
  position_updates INTEGER DEFAULT 1 NOT NULL,
  at_risk_warnings INTEGER DEFAULT 1 NOT NULL,
  naib_alerts INTEGER DEFAULT 1 NOT NULL,

  -- Frequency setting: '1_per_week', '2_per_week', '3_per_week', 'daily'
  frequency TEXT DEFAULT '3_per_week' NOT NULL CHECK (frequency IN ('1_per_week', '2_per_week', '3_per_week', 'daily')),

  -- Rate limiting counters
  alerts_sent_this_week INTEGER DEFAULT 0 NOT NULL,
  week_start_timestamp TEXT DEFAULT (datetime('now', 'weekday 0', '-7 days')) NOT NULL,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Foreign key to member_profiles
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id) ON DELETE CASCADE
);

-- Index for member lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_member
  ON notification_preferences(member_id);

-- =============================================================================
-- Alert History (Sprint 13: Notification System)
-- =============================================================================
-- Audit trail of all alerts sent. Used for debugging, analytics, and compliance.

CREATE TABLE IF NOT EXISTS alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Who received the alert (member_id for members, discord_user_id for waitlist)
  recipient_id TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('member', 'waitlist')),

  -- Alert classification
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'position_update',
    'at_risk_warning',
    'naib_threat',
    'naib_bump',
    'naib_seated',
    'waitlist_eligible'
  )),

  -- Alert content (JSON blob for flexibility)
  alert_data TEXT NOT NULL,

  -- Delivery status
  delivered INTEGER DEFAULT 0 NOT NULL,
  delivery_error TEXT,

  -- When the alert was sent
  sent_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for recipient lookups
CREATE INDEX IF NOT EXISTS idx_alert_history_recipient
  ON alert_history(recipient_id, recipient_type);

-- Index for alert type queries
CREATE INDEX IF NOT EXISTS idx_alert_history_type
  ON alert_history(alert_type);

-- Index for time-based queries (for analytics)
CREATE INDEX IF NOT EXISTS idx_alert_history_sent
  ON alert_history(sent_at DESC);

-- Composite index for rate limiting queries (alerts this week for a recipient)
CREATE INDEX IF NOT EXISTS idx_alert_history_recipient_week
  ON alert_history(recipient_id, sent_at);
`;

/**
 * SQL to roll back Naib/Threshold/Notification schema
 */
export const NAIB_THRESHOLD_ROLLBACK_SQL = `
-- Drop notification indexes and tables (Sprint 13)
DROP INDEX IF EXISTS idx_alert_history_recipient_week;
DROP INDEX IF EXISTS idx_alert_history_sent;
DROP INDEX IF EXISTS idx_alert_history_type;
DROP INDEX IF EXISTS idx_alert_history_recipient;
DROP TABLE IF EXISTS alert_history;

DROP INDEX IF EXISTS idx_notification_preferences_member;
DROP TABLE IF EXISTS notification_preferences;

-- Drop threshold snapshot indexes and table (Sprint 12)
DROP INDEX IF EXISTS idx_threshold_snapshots_time;
DROP TABLE IF EXISTS threshold_snapshots;

-- Drop waitlist indexes and table (Sprint 12)
DROP INDEX IF EXISTS idx_waitlist_unnotified;
DROP INDEX IF EXISTS idx_waitlist_wallet;
DROP INDEX IF EXISTS idx_waitlist_discord_user;
DROP TABLE IF EXISTS waitlist_registrations;

-- Drop Naib indexes first (Sprint 11)
DROP INDEX IF EXISTS idx_member_profiles_former_naib;
DROP INDEX IF EXISTS idx_naib_seats_active_seat;
DROP INDEX IF EXISTS idx_naib_seats_active_member;
DROP INDEX IF EXISTS idx_naib_seats_seat_number;
DROP INDEX IF EXISTS idx_naib_seats_member;
DROP INDEX IF EXISTS idx_naib_seats_current;

-- Drop Naib table
DROP TABLE IF EXISTS naib_seats;

-- Note: SQLite doesn't support DROP COLUMN directly
-- For rollback, we'd need to recreate member_profiles without is_former_naib
-- This is handled by recreating the database from scratch in tests
`;
