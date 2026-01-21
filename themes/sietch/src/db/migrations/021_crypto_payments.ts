/**
 * Migration 021: Crypto Payments (Sprint 155: NOWPayments Integration)
 *
 * Adds cryptocurrency payment infrastructure:
 * - crypto_payments: Track individual crypto payment transactions
 * - Extends payment_provider constraint to include 'nowpayments'
 *
 * This migration enables parallel crypto payment processing alongside
 * the existing Paddle billing system.
 *
 * Sprint 155: Foundation
 */

export const CRYPTO_PAYMENTS_SCHEMA_SQL = `
-- =============================================================================
-- Sprint 155: Extend payment_provider to support NOWPayments
-- =============================================================================
-- SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we extend the check
-- by recreating the subscriptions table with the new constraint.
-- However, since this is a runtime check in SQLite, we can work around it by:
-- 1. Creating a trigger to validate the payment_provider value
-- 2. The actual constraint in 009_billing.ts remains but is permissive
--
-- For production PostgreSQL, we would use:
-- ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_payment_provider_check;
-- ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_payment_provider_check
--   CHECK (payment_provider IN ('paddle', 'stripe', 'nowpayments'));
--
-- For SQLite compatibility, we add a validation trigger instead:

-- Create a trigger to validate payment_provider values (allows nowpayments)
-- SQLite NOTE: This will fire BEFORE the built-in CHECK constraint,
-- but since SQLite's CHECK is evaluated first, we need to be careful.
-- The safest approach is to allow the insert/update and validate after.

-- Actually, SQLite CHECK constraints are enforced strictly. The cleanest solution
-- is to recreate the table OR use a temporary table approach.
-- For minimal migration risk, we'll use a table recreation approach wrapped in
-- a transaction.

-- Step 1: Create new table with extended constraint
CREATE TABLE IF NOT EXISTS subscriptions_new (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL DEFAULT 'default',
  payment_customer_id TEXT,
  payment_subscription_id TEXT UNIQUE,
  payment_provider TEXT NOT NULL DEFAULT 'paddle'
    CHECK (payment_provider IN ('paddle', 'stripe', 'nowpayments')),
  tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'unpaid')),
  grace_until INTEGER,
  current_period_start INTEGER,
  current_period_end INTEGER,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  UNIQUE(community_id)
);

-- Step 2: Copy existing data
INSERT OR IGNORE INTO subscriptions_new
  SELECT * FROM subscriptions WHERE 1=1;

-- Step 3: Drop old table and rename new
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_community
  ON subscriptions(community_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_sub
  ON subscriptions(payment_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_customer
  ON subscriptions(payment_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider
  ON subscriptions(payment_provider);

-- =============================================================================
-- Sprint 155: Crypto Payments Table (NOWPayments Integration)
-- =============================================================================
-- Tracks individual cryptocurrency payment transactions.
-- One-time payments only (crypto doesn't support true recurring billing).
-- Payment status flows: waiting → confirming → confirmed → sending → finished

CREATE TABLE IF NOT EXISTS crypto_payments (
  -- Internal UUID (prefixed with cp_ for identification)
  id TEXT PRIMARY KEY,

  -- NOWPayments payment_id (external reference)
  payment_id TEXT NOT NULL UNIQUE,

  -- Target community for subscription activation
  community_id TEXT NOT NULL,

  -- Subscription tier being purchased
  -- Valid: 'starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise'
  tier TEXT NOT NULL
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),

  -- Price in fiat (USD)
  price_amount DECIMAL(10, 2) NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'usd',

  -- Crypto payment details (populated after payment creation)
  pay_amount DECIMAL(20, 10),      -- Expected crypto amount
  pay_currency TEXT,                -- Crypto currency code (btc, eth, etc.)
  pay_address TEXT,                 -- Blockchain address to send payment

  -- Payment status (NOWPayments status codes)
  -- waiting: Waiting for customer payment
  -- confirming: Payment received, waiting for confirmations
  -- confirmed: Payment confirmed, not yet credited
  -- sending: Sending funds to merchant
  -- partially_paid: Partial payment received
  -- finished: Payment completed successfully
  -- failed: Payment failed
  -- refunded: Payment refunded
  -- expired: Payment expired (no payment received before timeout)
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'confirming', 'confirmed', 'sending',
                      'partially_paid', 'finished', 'failed', 'refunded', 'expired')),

  -- Actual amount received (may differ from pay_amount)
  actually_paid DECIMAL(20, 10),

  -- Our order reference for tracking
  order_id TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT,     -- Payment expiration timestamp
  finished_at TEXT,    -- Timestamp when payment completed

  -- Foreign key to communities table
  FOREIGN KEY (community_id) REFERENCES communities(id)
);

-- Index for NOWPayments payment_id lookups
CREATE INDEX IF NOT EXISTS idx_crypto_payments_payment_id
  ON crypto_payments(payment_id);

-- Index for community payment history
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_id
  ON crypto_payments(community_id);

-- Index for status queries (finding pending payments, etc.)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_status
  ON crypto_payments(status);

-- Index for time-based queries (recent payments)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_created_at
  ON crypto_payments(created_at DESC);

-- Index for order_id lookups
CREATE INDEX IF NOT EXISTS idx_crypto_payments_order_id
  ON crypto_payments(order_id);

-- Composite index for community + status queries
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community_status
  ON crypto_payments(community_id, status);
`;

/**
 * Rollback SQL for crypto payments migration
 * WARNING: This will permanently delete all crypto payment records and
 * revert the payment_provider constraint change.
 */
export const CRYPTO_PAYMENTS_ROLLBACK_SQL = `
-- Drop crypto_payments table and indexes
DROP TABLE IF EXISTS crypto_payments;

-- Indexes are automatically dropped with the table, but explicit for clarity
DROP INDEX IF EXISTS idx_crypto_payments_payment_id;
DROP INDEX IF EXISTS idx_crypto_payments_community_id;
DROP INDEX IF EXISTS idx_crypto_payments_status;
DROP INDEX IF EXISTS idx_crypto_payments_created_at;
DROP INDEX IF EXISTS idx_crypto_payments_order_id;
DROP INDEX IF EXISTS idx_crypto_payments_community_status;

-- Revert subscriptions table to original constraint (without nowpayments)
-- Step 1: Create table with original constraint
CREATE TABLE IF NOT EXISTS subscriptions_original (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL DEFAULT 'default',
  payment_customer_id TEXT,
  payment_subscription_id TEXT UNIQUE,
  payment_provider TEXT NOT NULL DEFAULT 'paddle'
    CHECK (payment_provider IN ('paddle', 'stripe')),
  tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'unpaid')),
  grace_until INTEGER,
  current_period_start INTEGER,
  current_period_end INTEGER,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  UNIQUE(community_id)
);

-- Step 2: Copy data (excluding nowpayments records which shouldn't exist after rollback)
INSERT OR IGNORE INTO subscriptions_original
  SELECT * FROM subscriptions WHERE payment_provider IN ('paddle', 'stripe');

-- Step 3: Replace table
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE subscriptions_original RENAME TO subscriptions;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_community ON subscriptions(community_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_sub ON subscriptions(payment_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_customer ON subscriptions(payment_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider ON subscriptions(payment_provider);
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add crypto payments table
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 021_crypto_payments: Adding crypto payments table');
  db.exec(CRYPTO_PAYMENTS_SCHEMA_SQL);
  logger.info('Migration 021_crypto_payments completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 021_crypto_payments');
  db.exec(CRYPTO_PAYMENTS_ROLLBACK_SQL);
  logger.info('Migration 021_crypto_payments reverted');
}
