/**
 * Migration 014: API Key Audit Trail
 *
 * Sprint 73: API Key Security (HIGH-1)
 *
 * Creates table for tracking API key usage:
 * - All API key validations logged
 * - Success/failure tracking
 * - IP address and user agent capture
 * - 90-day retention policy support
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Migration SQL for API Key Audit Trail
 */
export const API_KEY_AUDIT_SQL = `
-- =============================================================================
-- API Key Usage Audit Trail (Sprint 73 - HIGH-1)
-- =============================================================================

-- Create api_key_usage table
CREATE TABLE IF NOT EXISTS api_key_usage (
  id TEXT PRIMARY KEY,

  -- Key identification (never store full key!)
  key_hint TEXT NOT NULL,
  admin_name TEXT,

  -- Request context
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  ip_address TEXT NOT NULL,
  user_agent TEXT,

  -- Validation result
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for querying by date range (retention policy)
CREATE INDEX IF NOT EXISTS idx_api_key_usage_created
  ON api_key_usage(created_at);

-- Index for querying by key hint
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_hint
  ON api_key_usage(key_hint);

-- Index for querying by IP (security analysis)
CREATE INDEX IF NOT EXISTS idx_api_key_usage_ip
  ON api_key_usage(ip_address);

-- Index for querying failed attempts (security monitoring)
CREATE INDEX IF NOT EXISTS idx_api_key_usage_failures
  ON api_key_usage(success, created_at)
  WHERE success = 0;
`;

/**
 * Run the API Key Audit migration
 */
export function migrateApiKeyAudit(db: Database.Database): void {
  logger.info('Running migration 014: API Key Audit Trail');

  try {
    db.exec(API_KEY_AUDIT_SQL);
    logger.info('Migration 014 completed: api_key_usage table created');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Migration 014 failed');
    throw error;
  }
}

/**
 * Rollback the API Key Audit migration
 */
export function rollbackApiKeyAudit(db: Database.Database): void {
  logger.info('Rolling back migration 014: API Key Audit Trail');

  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_api_key_usage_failures;
      DROP INDEX IF EXISTS idx_api_key_usage_ip;
      DROP INDEX IF EXISTS idx_api_key_usage_key_hint;
      DROP INDEX IF EXISTS idx_api_key_usage_created;
      DROP TABLE IF EXISTS api_key_usage;
    `);
    logger.info('Migration 014 rollback completed');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Migration 014 rollback failed');
    throw error;
  }
}
