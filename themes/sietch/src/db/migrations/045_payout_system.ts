/**
 * Migration 045: Payout System (Sprint 264, Task 8.1)
 *
 * Creates payout infrastructure tables:
 * - payout_requests: Payout request lifecycle tracking
 * - treasury_state: Optimistic concurrency control for treasury ops
 * - Treasury payout reserve account (idempotent seed)
 * - New pool IDs: withdrawal:pending, reserve:held
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Task 8.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const PAYOUT_SYSTEM_SQL = `
-- =============================================================================
-- payout_requests — Payout request lifecycle
-- =============================================================================
CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  fee_micro INTEGER NOT NULL DEFAULT 0 CHECK (fee_micro >= 0),
  net_amount_micro INTEGER NOT NULL CHECK (net_amount_micro > 0),
  currency TEXT NOT NULL DEFAULT 'usdc',
  payout_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'processing', 'completed', 'failed', 'cancelled', 'quarantined'
  )),
  provider_payout_id TEXT,
  provider_status TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  error_message TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_at TEXT,
  processing_at TEXT,
  completed_at TEXT,
  failed_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_account
  ON payout_requests(account_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_requests_status
  ON payout_requests(status)
  WHERE status IN ('pending', 'approved', 'processing');

-- =============================================================================
-- treasury_state — Optimistic concurrency control for treasury operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS treasury_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  reserve_balance_micro INTEGER NOT NULL DEFAULT 0,
  last_invariant_check_at TEXT,
  last_invariant_passed INTEGER,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Initialize with version 0
INSERT OR IGNORE INTO treasury_state (id, version, reserve_balance_micro, updated_at)
VALUES (1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- =============================================================================
-- webhook_events — Raw webhook payload storage for audit trail
-- =============================================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_id
  ON webhook_events(provider, id);

-- =============================================================================
-- Pool configuration for payout pools
-- =============================================================================
INSERT OR IGNORE INTO billing_config (key, value, updated_at)
VALUES
  ('pool:withdrawal:pending', 'escrow', datetime('now')),
  ('pool:reserve:held', 'escrow', datetime('now'));
`;

export const PAYOUT_SYSTEM_SEED_SQL = `
-- Treasury payout reserve account (idempotent)
INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
VALUES ('sys-treasury-payout', 'foundation', 'treasury:payout_reserve', datetime('now'), datetime('now'));

-- Store treasury payout account ID
INSERT OR REPLACE INTO billing_config (key, value, description, updated_at)
VALUES ('treasury_payout_account_id', 'sys-treasury-payout', 'Treasury payout reserve account', datetime('now'));
`;

export const ROLLBACK_SQL = `
DELETE FROM billing_config WHERE key IN (
  'pool:withdrawal:pending',
  'pool:reserve:held',
  'treasury_payout_account_id'
);
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS treasury_state;
DROP TABLE IF EXISTS payout_requests;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 045_payout_system: Creating payout tables');
  db.exec(PAYOUT_SYSTEM_SQL);

  try {
    db.exec(PAYOUT_SYSTEM_SEED_SQL);
    logger.info('Treasury payout account seeded');
  } catch (err) {
    logger.warn({ err }, 'Treasury payout account seeding skipped');
  }

  logger.info('Migration 045_payout_system completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 045_payout_system');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 045_payout_system reverted');
}
