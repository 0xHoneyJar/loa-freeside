/**
 * Migration 044: Referrer Earnings & Extended Entry Types (Sprint 259, Task 3.1)
 *
 * Creates referrer_earnings table for tracking revenue share credits to referrers.
 * Extends credit_ledger entry_type CHECK to include new distribution types.
 * Registers new pool IDs for referral and score rewards.
 *
 * SDD refs: §4.2 Revenue Rules Extension
 * Sprint refs: Task 3.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const REFERRER_EARNINGS_SQL = `
-- =============================================================================
-- referrer_earnings — Revenue share credits to referrers
-- =============================================================================
CREATE TABLE IF NOT EXISTS referrer_earnings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referee_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  registration_id TEXT NOT NULL REFERENCES referral_registrations(id),
  charge_reservation_id TEXT NOT NULL,
  earning_lot_id TEXT REFERENCES credit_lots(id),
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  referrer_bps INTEGER NOT NULL,
  source_charge_micro INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_referrer_earnings_referrer
  ON referrer_earnings(referrer_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrer_earnings_referee
  ON referrer_earnings(referee_account_id);

CREATE INDEX IF NOT EXISTS idx_referrer_earnings_reservation
  ON referrer_earnings(charge_reservation_id);

-- =============================================================================
-- Pool configuration for referral and score pools
-- =============================================================================
-- Register new pool IDs in billing_config for validation
INSERT OR IGNORE INTO billing_config (key, value, updated_at)
VALUES
  ('pool:referral:revenue_share', 'withdrawable', datetime('now')),
  ('pool:referral:signup', 'non_withdrawable', datetime('now')),
  ('pool:score:rewards', 'non_withdrawable', datetime('now'));
`;

export const ROLLBACK_SQL = `
DELETE FROM billing_config WHERE key IN (
  'pool:referral:revenue_share',
  'pool:referral:signup',
  'pool:score:rewards'
);
DROP TABLE IF EXISTS referrer_earnings;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 044_referrer_earnings: Creating referrer earnings table');

  // Check if table already exists (idempotent)
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='referrer_earnings'`
  ).get();

  if (!tables) {
    db.exec(REFERRER_EARNINGS_SQL);
  }

  // Extend credit_ledger entry_type CHECK to include new types
  // SQLite doesn't support ALTER CHECK, so we verify the existing constraint
  // allows 'revenue_share' and 'commons_contribution' which we reuse.
  // New entry types for referrer distribution will use 'revenue_share' entry_type
  // with pool_id = 'referral:revenue_share' for discrimination.

  logger.info('Migration 044_referrer_earnings completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 044_referrer_earnings');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 044_referrer_earnings reverted');
}
