/**
 * Migration 031: Crypto Payments V2 — Credit Ledger Integration
 *
 * Extends crypto_payments table for multi-provider support (NOWPayments + x402)
 * and credit ledger integration.
 *
 * Uses SQLite table recreation pattern with PRAGMA foreign_keys = OFF/ON wrapping.
 *
 * New columns: provider, provider_payment_id, account_id, amount_usd_micro, lot_id, raw_payload
 * New constraint: UNIQUE(provider, provider_payment_id)
 * Trigger: trg_payment_id_sync keeps payment_id = provider_payment_id on INSERT/UPDATE
 *
 * SDD refs: §3.2 Migration 031, §3.3 Rollback
 * Sprint refs: Task 2.1
 *
 * BACKUP PROCEDURE (before applying in production):
 *   sqlite3 arrakis.db ".backup 'arrakis_pre_031.db'"
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Schema SQL
// =============================================================================

export const CRYPTO_PAYMENTS_V2_SCHEMA_SQL = `
-- =============================================================================
-- Migration 031: Crypto Payments V2 — Multi-Provider + Credit Ledger
-- =============================================================================

-- Disable foreign keys during table recreation
PRAGMA foreign_keys = OFF;

-- Step 1: Create new table with extended schema
CREATE TABLE IF NOT EXISTS crypto_payments_v2 (
  id TEXT PRIMARY KEY,

  -- Provider identification (new)
  provider TEXT NOT NULL DEFAULT 'nowpayments'
    CHECK (provider IN ('nowpayments', 'x402')),

  -- External payment ID from provider (new)
  provider_payment_id TEXT NOT NULL,

  -- Backward-compatible payment_id (synced via trigger)
  payment_id TEXT NOT NULL,

  -- Community and tier (existing)
  community_id TEXT,
  tier TEXT,

  -- Fiat pricing (existing)
  price_amount DECIMAL(10, 2),
  price_currency TEXT DEFAULT 'usd',

  -- Crypto payment details (existing)
  pay_amount DECIMAL(20, 10),
  pay_currency TEXT,
  pay_address TEXT,

  -- Payment status (extended for x402)
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'confirming', 'confirmed', 'sending',
                      'partially_paid', 'finished', 'failed', 'refunded', 'expired')),

  actually_paid DECIMAL(20, 10),
  order_id TEXT,

  -- Credit ledger integration (new)
  account_id TEXT,
  amount_usd_micro INTEGER,
  lot_id TEXT,

  -- Raw webhook/verification payload (new)
  raw_payload TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT,
  finished_at TEXT,

  -- Multi-provider uniqueness
  UNIQUE(provider, provider_payment_id)
);

-- Step 2: Migrate existing data
INSERT OR IGNORE INTO crypto_payments_v2 (
  id, provider, provider_payment_id, payment_id,
  community_id, tier, price_amount, price_currency,
  pay_amount, pay_currency, pay_address, status,
  actually_paid, order_id,
  account_id, amount_usd_micro, lot_id, raw_payload,
  created_at, updated_at, expires_at, finished_at
)
SELECT
  id, 'nowpayments', payment_id, payment_id,
  community_id, tier, price_amount, price_currency,
  pay_amount, pay_currency, pay_address, status,
  actually_paid, order_id,
  NULL, NULL, NULL, NULL,
  created_at, updated_at, expires_at, finished_at
FROM crypto_payments;

-- Step 3: Drop old table and rename
DROP TABLE IF EXISTS crypto_payments;
ALTER TABLE crypto_payments_v2 RENAME TO crypto_payments;

-- Step 4: Recreate all indexes (original + new)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_payment_id
  ON crypto_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_id
  ON crypto_payments(community_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_status
  ON crypto_payments(status);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_created_at
  ON crypto_payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_order_id
  ON crypto_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_status
  ON crypto_payments(community_id, status);

-- New indexes for credit ledger integration
CREATE INDEX IF NOT EXISTS idx_crypto_payments_provider
  ON crypto_payments(provider);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_provider_pid
  ON crypto_payments(provider, provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_account_id
  ON crypto_payments(account_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_lot_id
  ON crypto_payments(lot_id);

-- Step 5: Create trigger to keep payment_id synced with provider_payment_id
CREATE TRIGGER IF NOT EXISTS trg_payment_id_sync_insert
  AFTER INSERT ON crypto_payments
  WHEN NEW.payment_id != NEW.provider_payment_id
BEGIN
  UPDATE crypto_payments SET payment_id = NEW.provider_payment_id WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_id_sync_update
  AFTER UPDATE OF provider_payment_id ON crypto_payments
  WHEN NEW.provider_payment_id != OLD.provider_payment_id
BEGIN
  UPDATE crypto_payments SET payment_id = NEW.provider_payment_id WHERE id = NEW.id;
END;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;
`;

// =============================================================================
// Post-migration verification
// =============================================================================

export const CRYPTO_PAYMENTS_V2_VERIFY_SQL = `
SELECT
  (SELECT COUNT(*) FROM crypto_payments) as row_count,
  (SELECT COUNT(*) FROM crypto_payments WHERE payment_id IS NULL) as null_payment_ids,
  (SELECT COUNT(*) FROM crypto_payments WHERE provider IS NULL) as null_providers,
  (SELECT COUNT(*) FROM crypto_payments WHERE provider_payment_id IS NULL) as null_provider_pids
`;

// =============================================================================
// Rollback SQL
// =============================================================================

export const CRYPTO_PAYMENTS_V2_ROLLBACK_SQL = `
-- Rollback Migration 031: Revert to original crypto_payments schema

PRAGMA foreign_keys = OFF;

-- Step 1: Create original schema
CREATE TABLE IF NOT EXISTS crypto_payments_original (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  community_id TEXT NOT NULL,
  tier TEXT NOT NULL
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),
  price_amount DECIMAL(10, 2) NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'usd',
  pay_amount DECIMAL(20, 10),
  pay_currency TEXT,
  pay_address TEXT,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'confirming', 'confirmed', 'sending',
                      'partially_paid', 'finished', 'failed', 'refunded', 'expired')),
  actually_paid DECIMAL(20, 10),
  order_id TEXT,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (community_id) REFERENCES communities(id)
);

-- Step 2: Copy back only NOWPayments records (x402 records would be lost)
INSERT OR IGNORE INTO crypto_payments_original (
  id, payment_id, community_id, tier, price_amount, price_currency,
  pay_amount, pay_currency, pay_address, status, actually_paid, order_id,
  created_at, updated_at, expires_at, finished_at
)
SELECT
  id, payment_id, community_id, tier, price_amount, price_currency,
  pay_amount, pay_currency, pay_address, status, actually_paid, order_id,
  created_at, updated_at, expires_at, finished_at
FROM crypto_payments
WHERE provider = 'nowpayments' AND community_id IS NOT NULL AND tier IS NOT NULL;

-- Step 3: Drop triggers
DROP TRIGGER IF EXISTS trg_payment_id_sync_insert;
DROP TRIGGER IF EXISTS trg_payment_id_sync_update;

-- Step 4: Replace table
DROP TABLE IF EXISTS crypto_payments;
ALTER TABLE crypto_payments_original RENAME TO crypto_payments;

-- Step 5: Recreate original indexes
CREATE INDEX IF NOT EXISTS idx_crypto_payments_payment_id ON crypto_payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_id ON crypto_payments(community_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_status ON crypto_payments(status);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_created_at ON crypto_payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_order_id ON crypto_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_status ON crypto_payments(community_id, status);

PRAGMA foreign_keys = ON;
`;

// =============================================================================
// Migration Functions
// =============================================================================

export function up(db: Database.Database): void {
  logger.info('Running migration 031_crypto_payments_v2: Multi-provider + credit ledger');

  db.exec(CRYPTO_PAYMENTS_V2_SCHEMA_SQL);

  // Post-migration verification
  const verify = db.prepare(CRYPTO_PAYMENTS_V2_VERIFY_SQL).get() as {
    row_count: number;
    null_payment_ids: number;
    null_providers: number;
    null_provider_pids: number;
  };

  if (verify.null_payment_ids > 0 || verify.null_providers > 0 || verify.null_provider_pids > 0) {
    logger.error({
      event: 'migration.031.verify_failed',
      ...verify,
    }, 'Migration 031 verification failed: NULL values in required columns');
    throw new Error('Migration 031 verification failed');
  }

  logger.info({
    event: 'migration.031.complete',
    row_count: verify.row_count,
  }, `Migration 031 completed: ${verify.row_count} records migrated`);
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 031_crypto_payments_v2');
  db.exec(CRYPTO_PAYMENTS_V2_ROLLBACK_SQL);
  logger.info('Migration 031 reverted');
}
