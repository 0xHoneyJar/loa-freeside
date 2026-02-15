/**
 * Migration 034: Pre/Post Balance Audit Trail (Sprint 236, Task 7.5)
 *
 * Adds pre_balance_micro and post_balance_micro nullable columns to
 * the credit_ledger table. Each new ledger entry records the account's
 * available balance before and after the operation, enabling independent
 * verification without replaying the full history.
 *
 * Nullable for backward compatibility: existing rows have NULL values.
 * No non-negative CHECK — soft billing mode allows negative balances.
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 7.5
 */

export const AUDIT_BALANCE_SCHEMA_SQL = `
-- Add pre/post balance audit columns to credit_ledger
-- Nullable: existing rows retain NULL (pre-migration)
ALTER TABLE credit_ledger ADD COLUMN pre_balance_micro INTEGER;
ALTER TABLE credit_ledger ADD COLUMN post_balance_micro INTEGER;
`;

export const AUDIT_BALANCE_ROLLBACK_SQL = `
-- SQLite does not support DROP COLUMN before 3.35.0
-- For rollback, recreate the table without the columns
-- In practice, use: ALTER TABLE credit_ledger DROP COLUMN pre_balance_micro;
--                    ALTER TABLE credit_ledger DROP COLUMN post_balance_micro;
ALTER TABLE credit_ledger DROP COLUMN pre_balance_micro;
ALTER TABLE credit_ledger DROP COLUMN post_balance_micro;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export function up(db: Database.Database): void {
  logger.info('Running migration 034_audit_balance: Adding pre/post balance audit columns');

  // Check if columns already exist (idempotent)
  const columns = db.pragma('table_info(credit_ledger)') as Array<{ name: string }>;
  const hasPreBalance = columns.some(c => c.name === 'pre_balance_micro');

  if (!hasPreBalance) {
    db.exec(AUDIT_BALANCE_SCHEMA_SQL);
  }

  logger.info('Migration 034_audit_balance completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 034_audit_balance');
  db.exec(AUDIT_BALANCE_ROLLBACK_SQL);
  logger.info('Migration 034_audit_balance reverted');
}
