/**
 * Migration 019: Dashboard Configuration Tables (Sprint 117)
 *
 * Adds configuration management infrastructure for the Web Dashboard:
 * - current_configurations: Head pointer for O(1) runtime reads
 * - config_records: Append-only history for audit trail and restore
 * - threshold_changes: Delegated payload for tier threshold edits
 * - feature_gate_changes: Delegated payload for feature gate edits
 * - role_map_changes: Delegated payload for role mapping edits
 * - checkpoint_snapshots: CLI checkpoint storage for destructive action recovery
 *
 * Sprint 117: Database Schema (cycle-004)
 * @see grimoires/loa/sdd.md §5. Data Architecture
 */

export const DASHBOARD_CONFIG_SCHEMA_SQL = `
-- =============================================================================
-- Current Configurations (Head Pointer) - Sprint 117.1
-- =============================================================================
-- Materialized current state for O(1) runtime reads.
-- Updated on every config change via write-through pattern.

CREATE TABLE IF NOT EXISTS current_configurations (
  server_id TEXT PRIMARY KEY,

  -- Materialized current state (denormalized for read performance)
  thresholds TEXT NOT NULL DEFAULT '{}',       -- JSON: Record<tierId, TierThresholds>
  feature_gates TEXT NOT NULL DEFAULT '{}',    -- JSON: Record<featureId, FeatureGate>
  role_mappings TEXT NOT NULL DEFAULT '{}',    -- JSON: Record<roleId, RoleMapping>
  active_theme_id TEXT,

  -- Version tracking for optimistic locking
  last_record_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for updated_at queries (monitoring/cleanup)
CREATE INDEX IF NOT EXISTS idx_current_configs_updated
  ON current_configurations(updated_at);

-- =============================================================================
-- Config Records (Append-Only History) - Sprint 117.2
-- =============================================================================
-- Immutable audit trail for all configuration changes.
-- Enables restore functionality and compliance auditing.
-- Note: SQLite doesn't support partitioning, so we use a single table with
-- indexes for query performance. Archival can be handled by application logic.

CREATE TABLE IF NOT EXISTS config_records (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- Action metadata
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'RESTORE')),
  recordable_type TEXT NOT NULL CHECK (recordable_type IN (
    'ThresholdChange',
    'FeatureGateChange',
    'RoleMapChange',
    'ThemeChange',
    'CheckpointSnapshot'
  )),
  recordable_id TEXT NOT NULL,

  -- Optional context
  metadata TEXT DEFAULT '{}',    -- JSON: restoredFrom, cliCommand, sessionId, etc.

  -- Schema version for forward compatibility
  schema_version INTEGER NOT NULL DEFAULT 1,

  -- Immutable timestamp
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for server-specific history queries (most common)
CREATE INDEX IF NOT EXISTS idx_config_records_server
  ON config_records(server_id, created_at DESC);

-- Index for recordable type filtering
CREATE INDEX IF NOT EXISTS idx_config_records_type
  ON config_records(recordable_type);

-- Index for user activity queries
CREATE INDEX IF NOT EXISTS idx_config_records_user
  ON config_records(user_id);

-- Index for date-range queries (archival, cleanup)
CREATE INDEX IF NOT EXISTS idx_config_records_created
  ON config_records(created_at);

-- =============================================================================
-- Threshold Changes (Delegated Payload) - Sprint 117.3
-- =============================================================================
-- Records changes to tier thresholds (bgt, engagement, tenure, activity).
-- One record per field change.

CREATE TABLE IF NOT EXISTS threshold_changes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  tier_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('bgt', 'engagement', 'tenure', 'activity')),
  old_value REAL,              -- NULL for initial creation
  new_value REAL NOT NULL
);

-- Index for tier-specific queries
CREATE INDEX IF NOT EXISTS idx_threshold_changes_tier
  ON threshold_changes(tier_id);

-- =============================================================================
-- Feature Gate Changes (Delegated Payload) - Sprint 117.4
-- =============================================================================
-- Records changes to feature access gates per tier.

CREATE TABLE IF NOT EXISTS feature_gate_changes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  feature_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  old_access INTEGER,          -- NULL for initial creation (0/1 for boolean)
  new_access INTEGER NOT NULL,
  condition TEXT               -- e.g., "OR has_badge:early_adopter"
);

-- Index for feature-specific queries
CREATE INDEX IF NOT EXISTS idx_feature_gate_changes_feature
  ON feature_gate_changes(feature_id);

-- Index for tier-specific queries
CREATE INDEX IF NOT EXISTS idx_feature_gate_changes_tier
  ON feature_gate_changes(tier_id);

-- =============================================================================
-- Role Map Changes (Delegated Payload) - Sprint 117.5
-- =============================================================================
-- Records changes to Discord role -> tier mappings.
-- Denormalizes role_name for history readability (roles can be renamed/deleted).

CREATE TABLE IF NOT EXISTS role_map_changes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  role_id TEXT NOT NULL,
  role_name TEXT NOT NULL,      -- Denormalized for history readability
  old_tier_id TEXT,             -- NULL for initial creation
  new_tier_id TEXT,             -- NULL for deletion
  priority INTEGER NOT NULL DEFAULT 0
);

-- Index for role-specific queries
CREATE INDEX IF NOT EXISTS idx_role_map_changes_role
  ON role_map_changes(role_id);

-- =============================================================================
-- Theme Changes (Delegated Payload) - Sprint 117.3 (bonus)
-- =============================================================================
-- Records theme activation/deactivation/modification events.

CREATE TABLE IF NOT EXISTS theme_changes (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  theme_name TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('activate', 'deactivate', 'modify', 'create', 'delete')),
  config_snapshot TEXT NOT NULL  -- JSON: Full theme config at time of change
);

-- Index for theme-specific queries
CREATE INDEX IF NOT EXISTS idx_theme_changes_theme
  ON theme_changes(theme_name);

-- =============================================================================
-- Checkpoint Snapshots - Sprint 117.6
-- =============================================================================
-- Full state snapshots for destructive action recovery (CLI checkpoints).
-- Automatically expired by application logic based on expires_at.

CREATE TABLE IF NOT EXISTS checkpoint_snapshots (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  trigger_command TEXT NOT NULL,     -- e.g., "DELETE_ALL_ROLE_MAPPINGS"
  full_state_json TEXT NOT NULL,     -- JSON: Complete configuration state
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT NOT NULL           -- ISO datetime for auto-cleanup
);

-- Index for expiration queries (cleanup job)
CREATE INDEX IF NOT EXISTS idx_checkpoints_expires
  ON checkpoint_snapshots(expires_at);

-- Index for server-specific checkpoint queries
CREATE INDEX IF NOT EXISTS idx_checkpoints_server
  ON checkpoint_snapshots(server_id);
`;

/**
 * Rollback SQL for dashboard config migration
 * WARNING: This will permanently delete all configuration history.
 */
export const DASHBOARD_CONFIG_ROLLBACK_SQL = `
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS checkpoint_snapshots;
DROP TABLE IF EXISTS theme_changes;
DROP TABLE IF EXISTS role_map_changes;
DROP TABLE IF EXISTS feature_gate_changes;
DROP TABLE IF EXISTS threshold_changes;
DROP TABLE IF EXISTS config_records;
DROP TABLE IF EXISTS current_configurations;

-- Drop indexes (automatically dropped with tables, but explicit for clarity)
DROP INDEX IF EXISTS idx_current_configs_updated;
DROP INDEX IF EXISTS idx_config_records_server;
DROP INDEX IF EXISTS idx_config_records_type;
DROP INDEX IF EXISTS idx_config_records_user;
DROP INDEX IF EXISTS idx_config_records_created;
DROP INDEX IF EXISTS idx_threshold_changes_tier;
DROP INDEX IF EXISTS idx_feature_gate_changes_feature;
DROP INDEX IF EXISTS idx_feature_gate_changes_tier;
DROP INDEX IF EXISTS idx_role_map_changes_role;
DROP INDEX IF EXISTS idx_theme_changes_theme;
DROP INDEX IF EXISTS idx_checkpoints_expires;
DROP INDEX IF EXISTS idx_checkpoints_server;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add dashboard configuration tables
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 019_dashboard_config: Adding dashboard configuration tables');
  db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);
  logger.info('Migration 019_dashboard_config completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 019_dashboard_config');
  db.exec(DASHBOARD_CONFIG_ROLLBACK_SQL);
  logger.info('Migration 019_dashboard_config reverted');
}
