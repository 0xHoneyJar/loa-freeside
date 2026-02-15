/**
 * Migration 038: Audit Log Immutability Triggers (Sprint 240, Task 2.1)
 *
 * Adds BEFORE UPDATE and BEFORE DELETE triggers on revenue_rule_audit_log
 * to enforce immutability at the database level. Any attempt to UPDATE or
 * DELETE audit log entries will be ABORTed by SQLite.
 *
 * Pre-check: Verifies revenue_rule_audit_log exists (created in 035_revenue_rules).
 *
 * SDD refs: §2.2, §2.6
 * Sprint refs: Task 2.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const AUDIT_IMMUTABILITY_SQL = `
-- =============================================================================
-- Audit log immutability triggers
-- =============================================================================
-- Prevent any modification of audit log entries after creation.
-- These triggers fire BEFORE the operation and ABORT the transaction.

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
  BEFORE UPDATE ON revenue_rule_audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
  BEFORE DELETE ON revenue_rule_audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit log is immutable');
END;
`;

export const ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 038_audit_immutability: Adding immutability triggers to audit log');

  // Pre-check: verify the audit log table exists
  const tableExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='revenue_rule_audit_log'`
  ).get();

  if (!tableExists) {
    throw new Error('Migration 038 requires revenue_rule_audit_log table (from migration 035)');
  }

  db.exec(AUDIT_IMMUTABILITY_SQL);
  logger.info('Migration 038_audit_immutability completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 038_audit_immutability');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 038_audit_immutability reverted');
}
