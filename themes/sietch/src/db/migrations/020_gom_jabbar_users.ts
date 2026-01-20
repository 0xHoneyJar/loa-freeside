/**
 * Migration 020: Gom Jabbar User Management Tables (Sprint 139)
 *
 * Adds user authentication infrastructure for QA Tester Accounts:
 * - users: Local user accounts with Argon2id password hashing
 * - user_sessions: CLI and dashboard session management
 * - user_audit_log: Security audit trail for all user actions
 *
 * Sprint 139: Database Schema & Core Models (cycle-004)
 * @see grimoires/loa/prd.md §12. Gom Jabbar
 * @see grimoires/loa/sdd.md §13. User Management System
 */

export const GOM_JABBAR_USERS_SCHEMA_SQL = `
-- =============================================================================
-- Users Table - Sprint 139.1
-- =============================================================================
-- Local user accounts for CLI and dashboard authentication.
-- Supports QA testers and admin accounts as alternative to Discord OAuth.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,

  -- Authentication credentials
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,           -- Argon2id hash

  -- Role-based access control
  -- Roles: 'admin', 'qa_admin', 'qa_tester'
  -- - admin: Full access, can manage all users
  -- - qa_admin: Can manage qa_tester users, access QA sandboxes
  -- - qa_tester: Can access granted QA sandboxes only
  roles TEXT NOT NULL DEFAULT '["qa_tester"]',  -- JSON array of roles

  -- Sandbox access control
  -- Array of sandbox IDs this user can access
  -- Empty array = no sandbox access (must be explicitly granted)
  sandbox_access TEXT NOT NULL DEFAULT '[]',    -- JSON array of sandbox IDs

  -- Account status
  is_active INTEGER NOT NULL DEFAULT 1,  -- 0 = disabled, 1 = active

  -- Optional metadata
  display_name TEXT,                     -- Human-friendly name
  created_by TEXT,                       -- User ID of creator (for audit)

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  last_login_at TEXT,

  -- Password management
  password_changed_at TEXT DEFAULT (datetime('now')) NOT NULL,
  require_password_change INTEGER NOT NULL DEFAULT 0  -- Force change on next login
);

-- Index for username lookups (case-insensitive via COLLATE NOCASE)
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Index for active users (common filter)
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_roles ON users(roles);

-- =============================================================================
-- User Sessions Table - Sprint 139.2
-- =============================================================================
-- Session tokens for authenticated users (CLI and dashboard).
-- Supports multiple concurrent sessions per user.

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Session identification
  token_hash TEXT NOT NULL UNIQUE,       -- SHA-256 hash of session token

  -- Session type and context
  session_type TEXT NOT NULL CHECK (session_type IN ('cli', 'dashboard')),
  user_agent TEXT,                       -- Browser/CLI version info
  ip_address TEXT,                       -- Client IP for security auditing

  -- Expiration management
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT NOT NULL,
  last_activity_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Session status
  is_revoked INTEGER NOT NULL DEFAULT 0  -- 0 = active, 1 = revoked
);

-- Index for token lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);

-- Index for user's sessions (list/revoke all)
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- Index for active sessions only
CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions(user_id, is_revoked) WHERE is_revoked = 0;

-- =============================================================================
-- User Audit Log Table - Sprint 139.3
-- =============================================================================
-- Immutable audit trail for all user-related actions.
-- Essential for security compliance and incident investigation.

CREATE TABLE IF NOT EXISTS user_audit_log (
  id TEXT PRIMARY KEY,

  -- Actor information (who performed the action)
  actor_id TEXT,                         -- User ID of actor (NULL for system)
  actor_username TEXT,                   -- Denormalized for history readability
  actor_ip TEXT,                         -- Client IP address

  -- Target information (who was affected)
  target_user_id TEXT,                   -- User ID being affected (if applicable)
  target_username TEXT,                  -- Denormalized for history readability

  -- Action details
  action TEXT NOT NULL CHECK (action IN (
    -- Authentication events
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGOUT',
    'SESSION_EXPIRED',
    'SESSION_REVOKED',

    -- User management events
    'USER_CREATED',
    'USER_UPDATED',
    'USER_DISABLED',
    'USER_ENABLED',
    'USER_DELETED',
    'PASSWORD_CHANGED',
    'PASSWORD_RESET',

    -- Role management events
    'ROLE_GRANTED',
    'ROLE_REVOKED',

    -- Sandbox access events
    'SANDBOX_ACCESS_GRANTED',
    'SANDBOX_ACCESS_REVOKED',

    -- Security events
    'RATE_LIMIT_EXCEEDED',
    'INVALID_TOKEN',
    'UNAUTHORIZED_ACCESS'
  )),

  -- Additional context
  metadata TEXT DEFAULT '{}',            -- JSON: additional event details

  -- Immutable timestamp
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for actor queries (who did what)
CREATE INDEX IF NOT EXISTS idx_user_audit_actor ON user_audit_log(actor_id, created_at DESC);

-- Index for target queries (what happened to user X)
CREATE INDEX IF NOT EXISTS idx_user_audit_target ON user_audit_log(target_user_id, created_at DESC);

-- Index for action type queries (all login failures, etc.)
CREATE INDEX IF NOT EXISTS idx_user_audit_action ON user_audit_log(action, created_at DESC);

-- Index for time-range queries (recent events, compliance reports)
CREATE INDEX IF NOT EXISTS idx_user_audit_created ON user_audit_log(created_at DESC);

-- =============================================================================
-- Login Rate Limiting Table - Sprint 139.4
-- =============================================================================
-- Tracks failed login attempts for brute force protection.
-- 5 attempts per 15 minutes per username.

CREATE TABLE IF NOT EXISTS login_rate_limits (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT DEFAULT (datetime('now')) NOT NULL,
  locked_until TEXT                      -- NULL = not locked
);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS idx_login_rate_limits_first_attempt
  ON login_rate_limits(first_attempt_at);
`;

/**
 * Rollback SQL for Gom Jabbar users migration
 * WARNING: This will permanently delete all user data and audit history.
 */
export const GOM_JABBAR_USERS_ROLLBACK_SQL = `
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS login_rate_limits;
DROP TABLE IF EXISTS user_audit_log;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;

-- Drop indexes (automatically dropped with tables, but explicit for clarity)
DROP INDEX IF EXISTS idx_users_username;
DROP INDEX IF EXISTS idx_users_active;
DROP INDEX IF EXISTS idx_users_roles;
DROP INDEX IF EXISTS idx_user_sessions_token;
DROP INDEX IF EXISTS idx_user_sessions_user;
DROP INDEX IF EXISTS idx_user_sessions_expires;
DROP INDEX IF EXISTS idx_user_sessions_active;
DROP INDEX IF EXISTS idx_user_audit_actor;
DROP INDEX IF EXISTS idx_user_audit_target;
DROP INDEX IF EXISTS idx_user_audit_action;
DROP INDEX IF EXISTS idx_user_audit_created;
DROP INDEX IF EXISTS idx_login_rate_limits_first_attempt;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add Gom Jabbar user management tables
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 020_gom_jabbar_users: Adding user management tables');
  db.exec(GOM_JABBAR_USERS_SCHEMA_SQL);
  logger.info('Migration 020_gom_jabbar_users completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 020_gom_jabbar_users');
  db.exec(GOM_JABBAR_USERS_ROLLBACK_SQL);
  logger.info('Migration 020_gom_jabbar_users reverted');
}
