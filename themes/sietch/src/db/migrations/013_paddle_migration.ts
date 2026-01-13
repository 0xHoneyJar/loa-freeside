/**
 * Migration 013: Stripe to Paddle Migration
 *
 * Sprint 1: Paddle Migration - Provider-agnostic schema changes
 *
 * Changes:
 * - subscriptions: stripe_customer_id -> payment_customer_id
 * - subscriptions: stripe_subscription_id -> payment_subscription_id
 * - subscriptions: Add payment_provider column
 * - webhook_events: stripe_event_id -> provider_event_id
 * - badge_purchases: stripe_payment_id -> payment_id
 * - boost_purchases: stripe_payment_id -> payment_id
 *
 * Note: SQLite doesn't support RENAME COLUMN directly in older versions,
 * so we recreate tables with new column names and migrate data.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Migration SQL for Paddle (provider-agnostic schema)
 *
 * SQLite 3.25.0+ supports RENAME COLUMN, but for compatibility
 * we use the table recreation approach.
 */
export const PADDLE_MIGRATION_SQL = `
-- =============================================================================
-- Step 1: Migrate subscriptions table
-- =============================================================================

-- Create new subscriptions table with provider-agnostic columns
CREATE TABLE IF NOT EXISTS subscriptions_new (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL DEFAULT 'default',

  -- Provider-agnostic payment identifiers (renamed from stripe_*)
  payment_customer_id TEXT,
  payment_subscription_id TEXT UNIQUE,

  -- NEW: Payment provider identifier
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

-- Migrate existing data
INSERT INTO subscriptions_new (
  id, community_id, payment_customer_id, payment_subscription_id,
  payment_provider, tier, status, grace_until,
  current_period_start, current_period_end, created_at, updated_at
)
SELECT
  id, community_id, stripe_customer_id, stripe_subscription_id,
  'stripe', tier, status, grace_until,
  current_period_start, current_period_end, created_at, updated_at
FROM subscriptions;

-- Drop old table and rename new one
DROP TABLE IF EXISTS subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

-- Recreate indexes with updated names
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
-- Step 2: Migrate webhook_events table
-- =============================================================================

-- Create new webhook_events table with provider-agnostic column
CREATE TABLE IF NOT EXISTS webhook_events_new (
  id TEXT PRIMARY KEY,

  -- Provider-agnostic event ID (renamed from stripe_event_id)
  provider_event_id TEXT NOT NULL UNIQUE,

  event_type TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed', 'failed')),

  payload TEXT NOT NULL,
  error_message TEXT,

  received_at TEXT DEFAULT (datetime('now')) NOT NULL,
  processed_at TEXT,

  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Migrate existing data
INSERT INTO webhook_events_new (
  id, provider_event_id, event_type, status, payload,
  error_message, received_at, processed_at, created_at
)
SELECT
  id, stripe_event_id, event_type, status, payload,
  error_message, received_at, processed_at, created_at
FROM webhook_events;

-- Drop old table and rename new one
DROP TABLE IF EXISTS webhook_events;
ALTER TABLE webhook_events_new RENAME TO webhook_events;

-- Recreate indexes with updated names
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_id
  ON webhook_events(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type
  ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON webhook_events(status);

-- =============================================================================
-- Step 3: Migrate badge_purchases table
-- =============================================================================

-- Create new badge_purchases table with provider-agnostic column
CREATE TABLE IF NOT EXISTS badge_purchases_new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,

  -- Provider-agnostic payment ID (renamed from stripe_payment_id)
  payment_id TEXT,

  purchased_at TEXT DEFAULT (datetime('now')) NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  UNIQUE(member_id)
);

-- Migrate existing data
INSERT INTO badge_purchases_new (id, member_id, payment_id, purchased_at, created_at)
SELECT id, member_id, stripe_payment_id, purchased_at, created_at
FROM badge_purchases;

-- Drop old table and rename new one
DROP TABLE IF EXISTS badge_purchases;
ALTER TABLE badge_purchases_new RENAME TO badge_purchases;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_badge_purchases_member
  ON badge_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_badge_purchases_payment
  ON badge_purchases(payment_id);

-- =============================================================================
-- Step 4: Migrate boost_purchases table
-- =============================================================================

-- Create new boost_purchases table with provider-agnostic column
CREATE TABLE IF NOT EXISTS boost_purchases_new (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  community_id TEXT NOT NULL,

  -- Provider-agnostic payment ID (renamed from stripe_payment_id)
  payment_id TEXT,

  months_purchased INTEGER NOT NULL CHECK (months_purchased > 0),
  amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing data
INSERT INTO boost_purchases_new (
  id, member_id, community_id, payment_id, months_purchased,
  amount_paid_cents, purchased_at, expires_at, is_active, created_at
)
SELECT
  id, member_id, community_id, stripe_payment_id, months_purchased,
  amount_paid_cents, purchased_at, expires_at, is_active, created_at
FROM boost_purchases;

-- Drop old table and rename new one
DROP TABLE IF EXISTS boost_purchases;
ALTER TABLE boost_purchases_new RENAME TO boost_purchases;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_boost_purchases_member
  ON boost_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community
  ON boost_purchases(community_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_active
  ON boost_purchases(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_payment
  ON boost_purchases(payment_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community_active
  ON boost_purchases(community_id, is_active, expires_at);
`;

/**
 * Rollback SQL to restore Stripe-specific column names
 *
 * WARNING: This will restore the old schema. Any Paddle-specific
 * data will be preserved but column names will revert.
 */
export const PADDLE_ROLLBACK_SQL = `
-- =============================================================================
-- Rollback: Restore subscriptions table with stripe_* columns
-- =============================================================================

CREATE TABLE IF NOT EXISTS subscriptions_old (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL DEFAULT 'default',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
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

INSERT INTO subscriptions_old (
  id, community_id, stripe_customer_id, stripe_subscription_id,
  tier, status, grace_until, current_period_start, current_period_end,
  created_at, updated_at
)
SELECT
  id, community_id, payment_customer_id, payment_subscription_id,
  tier, status, grace_until, current_period_start, current_period_end,
  created_at, updated_at
FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_old RENAME TO subscriptions;

CREATE INDEX IF NOT EXISTS idx_subscriptions_community ON subscriptions(community_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- =============================================================================
-- Rollback: Restore webhook_events table with stripe_event_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_events_old (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed', 'failed')),
  payload TEXT NOT NULL,
  error_message TEXT,
  received_at TEXT DEFAULT (datetime('now')) NOT NULL,
  processed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

INSERT INTO webhook_events_old (
  id, stripe_event_id, event_type, status, payload,
  error_message, received_at, processed_at, created_at
)
SELECT
  id, provider_event_id, event_type, status, payload,
  error_message, received_at, processed_at, created_at
FROM webhook_events;

DROP TABLE webhook_events;
ALTER TABLE webhook_events_old RENAME TO webhook_events;

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);

-- =============================================================================
-- Rollback: Restore badge_purchases table with stripe_payment_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS badge_purchases_old (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  stripe_payment_id TEXT,
  purchased_at TEXT DEFAULT (datetime('now')) NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  UNIQUE(member_id)
);

INSERT INTO badge_purchases_old (id, member_id, stripe_payment_id, purchased_at, created_at)
SELECT id, member_id, payment_id, purchased_at, created_at
FROM badge_purchases;

DROP TABLE badge_purchases;
ALTER TABLE badge_purchases_old RENAME TO badge_purchases;

CREATE INDEX IF NOT EXISTS idx_badge_purchases_member ON badge_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_badge_purchases_stripe ON badge_purchases(stripe_payment_id);

-- =============================================================================
-- Rollback: Restore boost_purchases table with stripe_payment_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS boost_purchases_old (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  stripe_payment_id TEXT,
  months_purchased INTEGER NOT NULL CHECK (months_purchased > 0),
  amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO boost_purchases_old (
  id, member_id, community_id, stripe_payment_id, months_purchased,
  amount_paid_cents, purchased_at, expires_at, is_active, created_at
)
SELECT
  id, member_id, community_id, payment_id, months_purchased,
  amount_paid_cents, purchased_at, expires_at, is_active, created_at
FROM boost_purchases;

DROP TABLE boost_purchases;
ALTER TABLE boost_purchases_old RENAME TO boost_purchases;

CREATE INDEX IF NOT EXISTS idx_boost_purchases_member ON boost_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community ON boost_purchases(community_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_active ON boost_purchases(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_stripe ON boost_purchases(stripe_payment_id);
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community_active ON boost_purchases(community_id, is_active, expires_at);
`;

/**
 * Run migration to update schema for Paddle
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 013_paddle_migration: Updating to provider-agnostic schema');

  // Run in transaction for atomicity
  db.exec('BEGIN TRANSACTION');

  try {
    db.exec(PADDLE_MIGRATION_SQL);
    db.exec('COMMIT');
    logger.info('Migration 013_paddle_migration completed successfully');
  } catch (error) {
    db.exec('ROLLBACK');
    logger.error({ error }, 'Migration 013_paddle_migration failed, rolling back');
    throw error;
  }
}

/**
 * Reverse migration to restore Stripe-specific column names
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 013_paddle_migration');

  db.exec('BEGIN TRANSACTION');

  try {
    db.exec(PADDLE_ROLLBACK_SQL);
    db.exec('COMMIT');
    logger.info('Migration 013_paddle_migration reverted');
  } catch (error) {
    db.exec('ROLLBACK');
    logger.error({ error }, 'Rollback of migration 013_paddle_migration failed');
    throw error;
  }
}
