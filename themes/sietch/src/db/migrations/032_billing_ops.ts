/**
 * Migration 032 — Billing Operations Tables
 *
 * Creates supporting tables for billing operations:
 * - billing_dlq: Dead letter queue for failed billing operations
 * - admin_audit_log: Admin action audit trail
 * - billing_config: System configuration (rates, modes, accounts)
 *
 * Seeds default configuration values including revenue distribution
 * rates and system account references.
 *
 * SDD refs: §3.2 Migration 032
 * Sprint refs: Task 3.5
 */

export const BILLING_OPS_SCHEMA_SQL = `
-- =============================================================================
-- billing_dlq: Dead Letter Queue for failed billing operations
-- =============================================================================
-- Failed operations are retried with exponential backoff.
-- After max retries, moves to manual_review status.

CREATE TABLE IF NOT EXISTS billing_dlq (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'deposit', 'refund', 'distribution', 'reconciliation', 'webhook'
  )),
  payload TEXT NOT NULL,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'manual_review'
  )),
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_dlq_status
  ON billing_dlq(status, next_retry_at)
  WHERE status IN ('pending', 'processing');

-- =============================================================================
-- admin_audit_log: Admin action audit trail
-- =============================================================================
-- Immutable log of all admin/system actions on billing.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'admin', 'operator')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log(action, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON admin_audit_log(target_type, target_id);

-- =============================================================================
-- billing_config: System configuration key-value store
-- =============================================================================
-- Stores billing configuration: rates (basis points), modes, account refs.
-- Updated by admin actions, read by billing services.

CREATE TABLE IF NOT EXISTS billing_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Seed Default Configuration
-- =============================================================================

-- Revenue distribution rates (basis points: 1 bps = 0.01%)
INSERT OR IGNORE INTO billing_config (key, value, description) VALUES
  ('commons_rate_bps', '500', 'Commons pool share: 5% (500 bps)'),
  ('community_rate_bps', '7000', 'Community share: 70% (7000 bps)'),
  ('foundation_rate_bps', '2500', 'Foundation share: 25% (2500 bps)');

-- Billing mode and safety
INSERT OR IGNORE INTO billing_config (key, value, description) VALUES
  ('billing_mode', 'shadow', 'Current billing mode: shadow/soft/live'),
  ('safety_multiplier', '1.1', 'Reserve multiplier for cost estimation'),
  ('reserve_ttl_seconds', '300', 'Default reservation TTL in seconds'),
  ('ceiling_micro', '100000000000', 'Maximum single transaction ($100,000)'),
  ('overrun_alert_threshold_pct', '5', 'Alert if overrun exceeds this % of reserved');

-- Reconciliation results (populated by daily job)
INSERT OR IGNORE INTO billing_config (key, value, description) VALUES
  ('last_reconciliation_at', '', 'Timestamp of last daily reconciliation'),
  ('last_reconciliation_result', '{}', 'JSON result of last reconciliation');
`;

// =============================================================================
// System Account Seeding SQL
// =============================================================================
// Creates foundation, commons, and community system accounts if not already present.
// Stores their IDs in billing_config for lookup by RevenueDistributionService.

export const BILLING_SYSTEM_ACCOUNTS_SQL = `
-- Create system accounts (idempotent — skips if already exist)
-- Uses 'foundation' and 'commons' entity types from credit_accounts CHECK constraint
INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at)
VALUES
  ('sys-foundation', 'foundation', 'revenue', datetime('now')),
  ('sys-commons', 'commons', 'pool', datetime('now')),
  ('sys-community-pool', 'community', 'revenue-pool', datetime('now'));

-- Store account IDs in billing_config
INSERT OR REPLACE INTO billing_config (key, value, description, updated_at) VALUES
  ('foundation_account_id', 'sys-foundation', 'Foundation revenue account', datetime('now')),
  ('commons_account_id', 'sys-commons', 'Commons pool account', datetime('now')),
  ('community_account_id', 'sys-community-pool', 'Community revenue pool account', datetime('now'));
`;

// =============================================================================
// Rollback SQL
// =============================================================================

export const BILLING_OPS_ROLLBACK_SQL = `
DROP TABLE IF EXISTS billing_dlq;
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS billing_config;
`;

// =============================================================================
// Migration Runner
// =============================================================================

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration 032: billing operations tables + system account seeding
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 032_billing_ops: Adding billing ops tables');
  db.exec(BILLING_OPS_SCHEMA_SQL);

  // Seed system accounts (requires credit_accounts from migration 030)
  try {
    db.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
    logger.info('System accounts seeded for revenue distribution');
  } catch (err) {
    logger.warn({ err }, 'System account seeding skipped (credit_accounts may not exist yet)');
  }

  logger.info('Migration 032_billing_ops completed');
}
