/**
 * SQLite Database Schema
 *
 * Tables:
 * - eligibility_snapshots: Historical record of eligibility snapshots
 * - current_eligibility: Fast lookups for current eligibility status
 * - admin_overrides: Manual eligibility adjustments
 * - audit_log: Event history for auditing
 * - health_status: Service health tracking
 * - wallet_mappings: Discord user to wallet address mappings
 */

/**
 * SQL statements for creating database schema
 */
export const SCHEMA_SQL = `
-- Enable WAL mode for better concurrent read performance
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Eligibility snapshots (historical record)
CREATE TABLE IF NOT EXISTS eligibility_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  data TEXT NOT NULL  -- Full eligibility list as JSON
);

CREATE INDEX IF NOT EXISTS idx_eligibility_snapshots_created
  ON eligibility_snapshots(created_at);

-- Current eligibility (fast lookups)
CREATE TABLE IF NOT EXISTS current_eligibility (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  rank INTEGER NOT NULL,
  bgt_held TEXT NOT NULL,  -- Stored as string for bigint precision
  role TEXT NOT NULL CHECK (role IN ('naib', 'fedaykin', 'none')),
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_current_eligibility_rank
  ON current_eligibility(rank);

CREATE INDEX IF NOT EXISTS idx_current_eligibility_role
  ON current_eligibility(role);

-- Admin overrides
CREATE TABLE IF NOT EXISTS admin_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL COLLATE NOCASE,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT,  -- NULL = permanent
  active INTEGER DEFAULT 1 NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_overrides_address
  ON admin_overrides(address);

CREATE INDEX IF NOT EXISTS idx_admin_overrides_active
  ON admin_overrides(active);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,  -- JSON
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_type
  ON audit_log(event_type);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log(created_at);

-- Health status (single row)
CREATE TABLE IF NOT EXISTS health_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_successful_query TEXT,
  last_query_attempt TEXT,
  consecutive_failures INTEGER DEFAULT 0 NOT NULL,
  in_grace_period INTEGER DEFAULT 0 NOT NULL,
  last_synced_block TEXT,  -- Last block synced for incremental sync
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Insert default health status row if not exists
INSERT OR IGNORE INTO health_status (id, consecutive_failures, in_grace_period)
VALUES (1, 0, 0);

-- Discord wallet mappings (populated by Collab.Land events)
CREATE TABLE IF NOT EXISTS wallet_mappings (
  discord_user_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL COLLATE NOCASE,
  verified_at TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_mappings_address
  ON wallet_mappings(wallet_address);

-- Cached claim events (RewardPaid events from reward vaults)
CREATE TABLE IF NOT EXISTS cached_claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  address TEXT NOT NULL COLLATE NOCASE,
  amount TEXT NOT NULL,  -- Stored as string for bigint precision
  vault_address TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  UNIQUE(tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_cached_claim_events_address
  ON cached_claim_events(address);

CREATE INDEX IF NOT EXISTS idx_cached_claim_events_block
  ON cached_claim_events(block_number);

-- Cached burn events (Transfer to 0x0 from BGT token)
CREATE TABLE IF NOT EXISTS cached_burn_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  from_address TEXT NOT NULL COLLATE NOCASE,
  amount TEXT NOT NULL,  -- Stored as string for bigint precision
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  UNIQUE(tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_cached_burn_events_address
  ON cached_burn_events(from_address);

CREATE INDEX IF NOT EXISTS idx_cached_burn_events_block
  ON cached_burn_events(block_number);
`;

/**
 * Migration for cleaning up old snapshots (keep last 30 days)
 */
export const CLEANUP_OLD_SNAPSHOTS_SQL = `
DELETE FROM eligibility_snapshots
WHERE created_at < datetime('now', '-30 days');
`;

// Re-export social layer schema for v2.0
export { SOCIAL_LAYER_SCHEMA_SQL, SOCIAL_LAYER_ROLLBACK_SQL } from './migrations/002_social_layer.js';

// Re-export Naib/Threshold schema for v2.1
export { NAIB_THRESHOLD_SCHEMA_SQL, NAIB_THRESHOLD_ROLLBACK_SQL } from './migrations/005_naib_threshold.js';

// Re-export Water Sharer schema for v3.0 (Sprint 17)
export { WATER_SHARER_SCHEMA_SQL, WATER_SHARER_ROLLBACK_SQL } from './migrations/007_water_sharer.js';

// Re-export Usul Ascended schema for v3.0 (Sprint 18)
export { USUL_ASCENDED_SCHEMA_SQL, USUL_ASCENDED_ROLLBACK_SQL } from './migrations/008_usul_ascended.js';

// Re-export Billing schema for v4.0 (Sprint 23)
export { BILLING_SCHEMA_SQL, BILLING_ROLLBACK_SQL } from './migrations/009_billing.js';

// Re-export Score Badges schema for v4.0 (Sprint 27)
export { BADGES_SCHEMA_SQL, BADGES_ROLLBACK_SQL } from './migrations/010_badges.js';

// Re-export Community Boosts schema for v4.0 (Sprint 28)
export { BOOSTS_SCHEMA_SQL, BOOSTS_ROLLBACK_SQL } from './migrations/011_boosts.js';

// Re-export Telegram Identity schema for v4.1 (Sprint 30)
export {
  TELEGRAM_IDENTITY_SCHEMA_SQL,
  TELEGRAM_IDENTITY_SAFE_SQL,
  TELEGRAM_IDENTITY_ROLLBACK_SQL,
} from './migrations/012_telegram_identity.js';

// Re-export Dashboard Config schema for cycle-004 (Sprint 117)
export {
  DASHBOARD_CONFIG_SCHEMA_SQL,
  DASHBOARD_CONFIG_ROLLBACK_SQL,
} from './migrations/019_dashboard_config.js';
