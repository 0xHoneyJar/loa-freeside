/**
 * Migration 041: Revenue Rule Schema Versioning (Sprint 251, Task 7.3)
 *
 * Adds schema_version to revenue_rules for governance versioning.
 * Distribution entries record the governing rule's version at finalize time.
 *
 * Strictly separate from 040 (credit_lot_purchases) — 040→041 verified.
 *
 * SDD refs: §6.3 Revenue Governance
 * Sprint refs: Task 7.3
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const REVENUE_RULE_VERSION_SQL = `
-- =============================================================================
-- Add schema_version to revenue_rules
-- =============================================================================
-- Tracks governance rule schema evolution. Default 1 for existing rules.

ALTER TABLE revenue_rules ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

-- =============================================================================
-- Add rule_schema_version to credit_ledger for distribution audit
-- =============================================================================
-- Nullable for backward compatibility with pre-versioning entries.

ALTER TABLE credit_ledger ADD COLUMN rule_schema_version INTEGER;
`;

export const ROLLBACK_SQL = `
-- SQLite does not support DROP COLUMN prior to 3.35.0.
-- For rollback, create new tables without the columns.
-- In practice, this migration is forward-only.
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 041_revenue_rule_schema_version: Adding schema versioning');

  // Check if columns already exist (idempotent)
  const ruleColumns = db.prepare(`PRAGMA table_info(revenue_rules)`).all() as Array<{ name: string }>;
  const hasSchemaVersion = ruleColumns.some(c => c.name === 'schema_version');

  if (!hasSchemaVersion) {
    db.exec(`ALTER TABLE revenue_rules ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`);
  }

  const ledgerColumns = db.prepare(`PRAGMA table_info(credit_ledger)`).all() as Array<{ name: string }>;
  const hasRuleVersion = ledgerColumns.some(c => c.name === 'rule_schema_version');

  if (!hasRuleVersion) {
    db.exec(`ALTER TABLE credit_ledger ADD COLUMN rule_schema_version INTEGER`);
  }

  logger.info('Migration 041_revenue_rule_schema_version completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 041_revenue_rule_schema_version (no-op for SQLite < 3.35)');
  // SQLite < 3.35 does not support DROP COLUMN
  // In practice, unused columns are harmless
  logger.info('Migration 041_revenue_rule_schema_version revert: columns preserved');
}
