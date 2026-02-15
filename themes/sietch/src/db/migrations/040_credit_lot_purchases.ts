/**
 * Migration 040: Credit Lot Purchases (Sprint 248, Task 4.1)
 *
 * Tracks credit pack purchases with idempotency and audit trail.
 * Links purchases to the lot they created, enabling purchase history
 * queries and duplicate payment detection.
 *
 * SDD refs: §4.1 Credit Pack Purchase
 * Sprint refs: Task 4.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const CREDIT_LOT_PURCHASES_SCHEMA_SQL = `
-- =============================================================================
-- credit_lot_purchases: Tracks credit pack purchases with idempotency
-- =============================================================================
-- Each row represents a single credit pack purchase.
-- The idempotency_key (SHA-256 of payment reference + recipient + amount + accountId)
-- prevents duplicate lot creation from the same payment event.

CREATE TABLE IF NOT EXISTS credit_lot_purchases (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES credit_accounts(id),
  pack_id           TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  lot_id            TEXT NOT NULL REFERENCES credit_lots(id),
  amount_micro      INTEGER NOT NULL CHECK (amount_micro > 0),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_lot_purchases_account
  ON credit_lot_purchases(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_lot_purchases_lot
  ON credit_lot_purchases(lot_id);
`;

export const ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_credit_lot_purchases_lot;
DROP INDEX IF EXISTS idx_credit_lot_purchases_account;
DROP TABLE IF EXISTS credit_lot_purchases;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 040_credit_lot_purchases: Creating purchases table');
  db.exec(CREDIT_LOT_PURCHASES_SCHEMA_SQL);
  logger.info('Migration 040_credit_lot_purchases completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 040_credit_lot_purchases');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 040_credit_lot_purchases reverted');
}
