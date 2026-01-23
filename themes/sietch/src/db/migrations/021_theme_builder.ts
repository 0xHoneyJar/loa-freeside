/**
 * Migration 021: Theme Builder Tables (Sprint 1)
 *
 * Adds WYSIWYG theme builder infrastructure:
 * - themes: Theme configuration with JSON storage
 * - theme_versions: Version history for undo/rollback
 * - contract_bindings: Web3 contract references
 * - theme_assets: Uploaded logos, images, fonts
 * - theme_audit_log: Change tracking
 *
 * Sprint 1: Foundation - Database Schema & Types (WYSIWYG Theme Builder MVP)
 * @see grimoires/loa/prd.md - WYSIWYG Theme Builder PRD
 * @see grimoires/loa/sdd.md §5. Database Schema
 */

export const THEME_BUILDER_SCHEMA_SQL = `
-- =============================================================================
-- Themes Table - Sprint 1.1
-- =============================================================================
-- Root table for theme configurations.
-- Each community can have multiple themes (draft, published).

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,                    -- UUID v4
  community_id TEXT NOT NULL,             -- Owner community

  -- Metadata
  name TEXT NOT NULL,                     -- Display name (max 100 chars)
  description TEXT DEFAULT '',            -- Description (max 500 chars)

  -- Status
  status TEXT NOT NULL DEFAULT 'draft'    -- draft | published
    CHECK (status IN ('draft', 'published')),

  -- Full theme configuration as JSON
  -- Contains: branding, pages, components, discord config
  config TEXT NOT NULL,                   -- JSON: ThemeConfig

  -- Versioning
  version TEXT NOT NULL DEFAULT '1.0.0',  -- SemVer format

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  published_at TEXT                       -- When last published
);

-- Index for community lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_themes_community
  ON themes(community_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_themes_status
  ON themes(status);

-- Index for listing by update time
CREATE INDEX IF NOT EXISTS idx_themes_updated
  ON themes(updated_at DESC);

-- =============================================================================
-- Theme Versions Table - Sprint 1.1
-- =============================================================================
-- Stores snapshots of theme configurations for version history.
-- Enables undo/rollback functionality.

CREATE TABLE IF NOT EXISTS theme_versions (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Version info
  version TEXT NOT NULL,                  -- SemVer format
  config TEXT NOT NULL,                   -- JSON: Full theme snapshot at this version

  -- Change metadata
  change_summary TEXT,                    -- Description of changes
  changed_by TEXT NOT NULL,               -- User who made the change

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Ensure unique version per theme
  UNIQUE(theme_id, version)
);

-- Index for theme version lookups
CREATE INDEX IF NOT EXISTS idx_theme_versions_theme
  ON theme_versions(theme_id);

-- Index for version ordering
CREATE INDEX IF NOT EXISTS idx_theme_versions_created
  ON theme_versions(theme_id, created_at DESC);

-- =============================================================================
-- Contract Bindings Table - Sprint 1.1
-- =============================================================================
-- Web3 contract references for theme components.
-- Each theme can have multiple contract bindings for different chains.

CREATE TABLE IF NOT EXISTS contract_bindings (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Contract identity
  name TEXT NOT NULL,                     -- Human-readable name
  chain_id INTEGER NOT NULL,              -- EVM chain ID
  address TEXT NOT NULL,                  -- Checksummed Ethereum address

  -- Contract metadata
  type TEXT NOT NULL DEFAULT 'custom'     -- erc20 | erc721 | erc1155 | custom
    CHECK (type IN ('erc20', 'erc721', 'erc1155', 'custom')),
  abi TEXT NOT NULL,                      -- JSON: ABI array (read functions only)
  verified INTEGER DEFAULT 0,             -- 1 if Etherscan verified

  -- Caching configuration
  cache_ttl INTEGER NOT NULL DEFAULT 300, -- TTL in seconds (min: 60)

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Ensure unique contract per theme/chain
  UNIQUE(theme_id, chain_id, address)
);

-- Index for theme contract lookups
CREATE INDEX IF NOT EXISTS idx_contract_bindings_theme
  ON contract_bindings(theme_id);

-- Index for chain-specific queries
CREATE INDEX IF NOT EXISTS idx_contract_bindings_chain
  ON contract_bindings(chain_id);

-- =============================================================================
-- Theme Assets Table - Sprint 1.1
-- =============================================================================
-- Uploaded assets for themes (logos, images, fonts, favicons).
-- Storage can be local filesystem or S3.

CREATE TABLE IF NOT EXISTS theme_assets (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Asset metadata
  name TEXT NOT NULL,                     -- Original filename
  type TEXT NOT NULL                      -- logo | image | font | favicon
    CHECK (type IN ('logo', 'image', 'font', 'favicon')),
  mime_type TEXT NOT NULL,                -- MIME type (image/png, font/woff2, etc.)
  size INTEGER NOT NULL,                  -- Size in bytes

  -- Storage location
  storage_path TEXT NOT NULL,             -- Path in storage system
  storage_type TEXT NOT NULL DEFAULT 'local' -- local | s3
    CHECK (storage_type IN ('local', 's3')),

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for theme asset lookups
CREATE INDEX IF NOT EXISTS idx_theme_assets_theme
  ON theme_assets(theme_id);

-- Index for asset type filtering
CREATE INDEX IF NOT EXISTS idx_theme_assets_type
  ON theme_assets(theme_id, type);

-- =============================================================================
-- Theme Audit Log Table - Sprint 1.1
-- =============================================================================
-- Audit trail for theme changes.
-- Tracks all mutations for compliance and debugging.

CREATE TABLE IF NOT EXISTS theme_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Action details
  action TEXT NOT NULL                    -- create | update | publish | unpublish | delete
    CHECK (action IN ('create', 'update', 'publish', 'unpublish', 'delete')),
  actor_id TEXT NOT NULL,                 -- User who performed action
  actor_type TEXT NOT NULL DEFAULT 'user' -- user | system | api
    CHECK (actor_type IN ('user', 'system', 'api')),

  -- Additional context
  details TEXT,                           -- JSON: Action-specific details

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for theme audit lookups
CREATE INDEX IF NOT EXISTS idx_theme_audit_theme
  ON theme_audit_log(theme_id);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_theme_audit_created
  ON theme_audit_log(created_at DESC);

-- Index for actor queries
CREATE INDEX IF NOT EXISTS idx_theme_audit_actor
  ON theme_audit_log(actor_id, created_at DESC);
`;

/**
 * Rollback SQL for theme builder migration
 * WARNING: This will permanently delete all theme data.
 */
export const THEME_BUILDER_ROLLBACK_SQL = `
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS theme_audit_log;
DROP TABLE IF EXISTS theme_assets;
DROP TABLE IF EXISTS contract_bindings;
DROP TABLE IF EXISTS theme_versions;
DROP TABLE IF EXISTS themes;

-- Indexes are automatically dropped with tables
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add theme builder tables
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 021_theme_builder: Adding theme builder tables');
  db.exec(THEME_BUILDER_SCHEMA_SQL);
  logger.info('Migration 021_theme_builder completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 021_theme_builder');
  db.exec(THEME_BUILDER_ROLLBACK_SQL);
  logger.info('Migration 021_theme_builder reverted');
}
