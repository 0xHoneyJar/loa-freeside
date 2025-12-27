/**
 * Migration 012: Telegram Identity (v4.1 - Sprint 30)
 *
 * Adds support for cross-platform identity bridging with Telegram:
 * - Adds telegram_user_id column to member_profiles
 * - Creates telegram_verification_sessions table for wallet linking
 *
 * Identity Model:
 * - Wallet address is the canonical identifier
 * - Platform IDs (Discord, Telegram) link TO the wallet
 * - All services use member_id (derived from wallet)
 */

/**
 * SQL for adding Telegram identity support
 */
export const TELEGRAM_IDENTITY_SCHEMA_SQL = `
-- Add Telegram user ID to member_profiles
-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we handle this gracefully
ALTER TABLE member_profiles ADD COLUMN telegram_user_id TEXT UNIQUE;

-- Add Telegram linked timestamp
ALTER TABLE member_profiles ADD COLUMN telegram_linked_at INTEGER;

-- Index for fast Telegram user lookups
CREATE INDEX IF NOT EXISTS idx_member_profiles_telegram
  ON member_profiles(telegram_user_id);

-- Telegram verification sessions table
-- Tracks wallet linking attempts from Telegram users
CREATE TABLE IF NOT EXISTS telegram_verification_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  collabland_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  wallet_address TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT
);

-- Index for session lookups by status and expiry (for cleanup)
CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_status
  ON telegram_verification_sessions(status, expires_at);

-- Index for finding pending sessions by Telegram user
CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_user
  ON telegram_verification_sessions(telegram_user_id, status);

-- Index for Collab.Land callback lookups
CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_collabland
  ON telegram_verification_sessions(collabland_session_id);
`;

/**
 * Safe SQL that handles cases where columns already exist
 * SQLite will error on ALTER TABLE ADD COLUMN if column exists
 * We use this alternative approach
 */
export const TELEGRAM_IDENTITY_SAFE_SQL = `
-- Create telegram_verification_sessions table
CREATE TABLE IF NOT EXISTS telegram_verification_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  collabland_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  wallet_address TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT
);

-- Create indexes (IF NOT EXISTS handles duplicates)
CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_status
  ON telegram_verification_sessions(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_user
  ON telegram_verification_sessions(telegram_user_id, status);

CREATE INDEX IF NOT EXISTS idx_telegram_verification_sessions_collabland
  ON telegram_verification_sessions(collabland_session_id);

-- Index for member_profiles telegram lookups
CREATE INDEX IF NOT EXISTS idx_member_profiles_telegram
  ON member_profiles(telegram_user_id);
`;

/**
 * SQL for rolling back Telegram identity tables
 */
export const TELEGRAM_IDENTITY_ROLLBACK_SQL = `
DROP TABLE IF EXISTS telegram_verification_sessions;
DROP INDEX IF EXISTS idx_member_profiles_telegram;
-- Note: Cannot drop columns in SQLite without table rebuild
`;

/**
 * Verification session status values
 */
export type VerificationSessionStatus = 'pending' | 'completed' | 'expired' | 'failed';

/**
 * Verification session expiry time (15 minutes)
 */
export const VERIFICATION_SESSION_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Maximum verification attempts per hour per user
 */
export const MAX_VERIFICATION_ATTEMPTS_PER_HOUR = 3;
