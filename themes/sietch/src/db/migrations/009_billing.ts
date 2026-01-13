/**
 * Migration 009: Billing System (v4.0 - Sprint 23)
 *
 * Adds billing infrastructure for Stripe integration:
 * - subscriptions: Track community subscription state
 * - fee_waivers: Platform-granted complimentary access
 * - webhook_events: Idempotency tracking for Stripe webhooks
 * - billing_audit_log: Billing-specific audit trail
 *
 * Sprint 23: Billing Foundation
 */

export const BILLING_SCHEMA_SQL = `
-- =============================================================================
-- Subscriptions Table (Sprint 23: Billing Foundation, Sprint 1: Paddle Migration)
-- =============================================================================
-- Tracks subscription state for each community (provider-agnostic).
-- Single source of truth for billing status.

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,

  -- Community identifier (for future multi-tenancy, defaults to 'default')
  community_id TEXT NOT NULL DEFAULT 'default',

  -- Provider-agnostic payment identifiers
  payment_customer_id TEXT,
  payment_subscription_id TEXT UNIQUE,

  -- Payment provider identifier
  payment_provider TEXT NOT NULL DEFAULT 'paddle'
    CHECK (payment_provider IN ('paddle', 'stripe')),

  -- Subscription tier (matches SubscriptionTier type)
  -- Valid: 'starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise'
  tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),

  -- Subscription status
  -- 'active': Paid and current
  -- 'past_due': Payment failed, in grace period
  -- 'canceled': Will not renew
  -- 'trialing': Trial period (if applicable)
  -- 'unpaid': Grace period expired
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'unpaid')),

  -- Grace period end timestamp (NULL if not in grace)
  -- Set when payment fails, cleared when payment succeeds
  grace_until INTEGER,

  -- Billing cycle timestamps
  current_period_start INTEGER,
  current_period_end INTEGER,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  -- Ensure one active subscription per community
  UNIQUE(community_id)
);

-- Index for community lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_community
  ON subscriptions(community_id);

-- Index for payment subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_sub
  ON subscriptions(payment_subscription_id);

-- Index for payment customer lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_customer
  ON subscriptions(payment_customer_id);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions(status);

-- Index for provider queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider
  ON subscriptions(payment_provider);

-- =============================================================================
-- Fee Waivers Table (Sprint 23: Billing Foundation)
-- =============================================================================
-- Platform-granted complimentary access (e.g., for partners, internal use).
-- Takes precedence over subscription tier when determining entitlements.

CREATE TABLE IF NOT EXISTS fee_waivers (
  id TEXT PRIMARY KEY,

  -- Community receiving the waiver
  community_id TEXT NOT NULL,

  -- Waiver tier (what tier features they get access to)
  tier TEXT NOT NULL
    CHECK (tier IN ('starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise')),

  -- Waiver reason/justification
  reason TEXT NOT NULL,

  -- Who granted the waiver
  granted_by TEXT NOT NULL,

  -- Timestamps
  granted_at TEXT DEFAULT (datetime('now')) NOT NULL,
  expires_at TEXT,  -- NULL = permanent

  -- Revocation tracking
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for community waiver lookups
CREATE INDEX IF NOT EXISTS idx_fee_waivers_community
  ON fee_waivers(community_id);

-- Index for active waivers (not revoked, not expired)
CREATE INDEX IF NOT EXISTS idx_fee_waivers_active
  ON fee_waivers(community_id, revoked_at, expires_at);

-- =============================================================================
-- Webhook Events Table (Sprint 23: Billing Foundation, Sprint 1: Paddle Migration)
-- =============================================================================
-- Tracks processed webhook events for idempotency (provider-agnostic).
-- Prevents duplicate processing of the same event.

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,

  -- Provider event ID (provider-agnostic)
  provider_event_id TEXT NOT NULL UNIQUE,

  -- Event type (e.g., 'subscription.created')
  event_type TEXT NOT NULL,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processing', 'processed', 'failed')),

  -- Event payload (JSON)
  payload TEXT NOT NULL,

  -- Error message if failed
  error_message TEXT,

  -- Timestamps
  received_at TEXT DEFAULT (datetime('now')) NOT NULL,
  processed_at TEXT,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for provider event ID lookups (idempotency check)
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_id
  ON webhook_events(provider_event_id);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_type
  ON webhook_events(event_type);

-- Index for status queries (finding failed events)
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON webhook_events(status);

-- =============================================================================
-- Billing Audit Log Table (Sprint 23: Billing Foundation)
-- =============================================================================
-- Billing-specific audit trail for compliance and debugging.
-- Separate from main audit_log for billing isolation.

CREATE TABLE IF NOT EXISTS billing_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Event type
  event_type TEXT NOT NULL,

  -- Community affected
  community_id TEXT,

  -- Event data (JSON)
  event_data TEXT NOT NULL,

  -- Actor who triggered the event
  actor TEXT,

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_billing_audit_log_type
  ON billing_audit_log(event_type);

-- Index for community queries
CREATE INDEX IF NOT EXISTS idx_billing_audit_log_community
  ON billing_audit_log(community_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_billing_audit_log_created
  ON billing_audit_log(created_at);
`;

/**
 * Rollback SQL for billing migration
 * WARNING: This will permanently delete all billing data.
 */
export const BILLING_ROLLBACK_SQL = `
-- Drop billing tables (in reverse dependency order)
DROP TABLE IF EXISTS billing_audit_log;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS fee_waivers;
DROP TABLE IF EXISTS subscriptions;

-- Drop indexes (automatically dropped with tables, but explicit for clarity)
DROP INDEX IF EXISTS idx_subscriptions_community;
DROP INDEX IF EXISTS idx_subscriptions_payment_sub;
DROP INDEX IF EXISTS idx_subscriptions_payment_customer;
DROP INDEX IF EXISTS idx_subscriptions_status;
DROP INDEX IF EXISTS idx_subscriptions_provider;
DROP INDEX IF EXISTS idx_fee_waivers_community;
DROP INDEX IF EXISTS idx_fee_waivers_active;
DROP INDEX IF EXISTS idx_webhook_events_provider_id;
DROP INDEX IF EXISTS idx_webhook_events_type;
DROP INDEX IF EXISTS idx_webhook_events_status;
DROP INDEX IF EXISTS idx_billing_audit_log_type;
DROP INDEX IF EXISTS idx_billing_audit_log_community;
DROP INDEX IF EXISTS idx_billing_audit_log_created;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add billing tables
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 009_billing: Adding billing tables');
  db.exec(BILLING_SCHEMA_SQL);
  logger.info('Migration 009_billing completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 009_billing');
  db.exec(BILLING_ROLLBACK_SQL);
  logger.info('Migration 009_billing reverted');
}
