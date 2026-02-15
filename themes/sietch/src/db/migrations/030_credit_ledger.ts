/**
 * Migration 030: Credit Ledger Foundation (Sprint 230)
 *
 * Creates core financial tables for the credit ledger system:
 * - credit_accounts: Entity-level billing accounts
 * - credit_lots: Individual credit buckets with FIFO redemption
 * - credit_balances: Derived balance cache (rebuilt from lots)
 * - credit_ledger: Append-only financial event log
 * - credit_account_seq: Atomic sequence counter per (account_id, pool_id)
 * - credit_reservations: Canonical reservation lifecycle record
 * - reservation_lots: Per-lot allocation tracking for multi-lot reserves
 * - credit_debts: Refund liability tracking
 * - billing_idempotency_keys: Idempotent operation dedup
 *
 * SDD refs: §3.2 Migration 030
 * Sprint refs: Task 1.1
 */

export const CREDIT_LEDGER_SCHEMA_SQL = `
-- =============================================================================
-- credit_accounts: Entity-level billing accounts
-- =============================================================================
-- One account per (entity_type, entity_id). Agents, persons, communities, etc.

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'agent', 'person', 'community', 'mod', 'protocol', 'foundation', 'commons'
  )),
  entity_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id)
);

-- =============================================================================
-- credit_lots: Individual credit buckets with pool restrictions and expiry
-- =============================================================================
-- FIFO redemption order: pool-restricted first, expiring first, oldest first.
-- CHECK constraints enforce lot_invariant: available + reserved + consumed = original.

CREATE TABLE IF NOT EXISTS credit_lots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'deposit', 'grant', 'purchase', 'transfer_in', 'commons_dividend'
  )),
  source_id TEXT,
  original_micro INTEGER NOT NULL,
  available_micro INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  consumed_micro INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT lot_balance CHECK (available_micro >= 0 AND reserved_micro >= 0 AND consumed_micro >= 0),
  CONSTRAINT lot_invariant CHECK (available_micro + reserved_micro + consumed_micro = original_micro)
);

-- FIFO lot selection index: pool-restricted first, expiring first, oldest first
CREATE INDEX IF NOT EXISTS idx_credit_lots_redemption
  ON credit_lots(account_id, pool_id, expires_at)
  WHERE available_micro > 0;

CREATE INDEX IF NOT EXISTS idx_credit_lots_account
  ON credit_lots(account_id);

-- Prevents double-crediting: one lot per external payment event
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_lots_source
  ON credit_lots(source_type, source_id)
  WHERE source_id IS NOT NULL;

-- =============================================================================
-- credit_balances: Derived cache (rebuilt from lots)
-- =============================================================================
-- Materialized balance per (account_id, pool_id). Updated on every write.
-- Source of truth for fast reads; SUM(credit_lots) used for enforcement fallback.

CREATE TABLE IF NOT EXISTS credit_balances (
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  available_micro INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(account_id, pool_id)
);

-- =============================================================================
-- credit_ledger: Append-only financial event log
-- =============================================================================
-- Every monetary state change creates an immutable ledger entry.
-- entry_seq is monotonically increasing per (account_id, pool_id).

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  lot_id TEXT REFERENCES credit_lots(id),
  reservation_id TEXT,
  entry_seq INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'deposit', 'reserve', 'finalize', 'release', 'refund',
    'grant', 'shadow_charge', 'shadow_reserve', 'shadow_finalize',
    'commons_contribution', 'revenue_share',
    'marketplace_sale', 'marketplace_purchase',
    'escrow', 'escrow_release'
  )),
  amount_micro INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  description TEXT,
  metadata TEXT,
  pre_balance_micro INTEGER,
  post_balance_micro INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, pool_id, entry_seq)
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_account
  ON credit_ledger(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_reservation
  ON credit_ledger(reservation_id)
  WHERE reservation_id IS NOT NULL;

-- =============================================================================
-- credit_account_seq: Atomic sequence counter per (account_id, pool_id)
-- =============================================================================
-- Replaces MAX(entry_seq)+1 pattern which is unsafe under concurrent writers.
-- Allocated via UPDATE + SELECT within BEGIN IMMEDIATE transaction.

CREATE TABLE IF NOT EXISTS credit_account_seq (
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT NOT NULL DEFAULT '__all__',
  next_seq INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(account_id, pool_id)
);

-- =============================================================================
-- credit_reservations: Canonical reservation lifecycle record
-- =============================================================================
-- State machine: pending → finalized | released | expired
-- No terminal-to-terminal transitions allowed.

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  total_reserved_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'finalized', 'released', 'expired'
  )),
  billing_mode TEXT NOT NULL DEFAULT 'live' CHECK (billing_mode IN (
    'shadow', 'soft', 'live'
  )),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_credit_reservations_expiry
  ON credit_reservations(expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_credit_reservations_account
  ON credit_reservations(account_id, created_at DESC);

-- =============================================================================
-- reservation_lots: Per-lot allocation tracking for multi-lot reserves
-- =============================================================================
-- Links each reservation to its constituent lot allocations.

CREATE TABLE IF NOT EXISTS reservation_lots (
  reservation_id TEXT NOT NULL REFERENCES credit_reservations(id),
  lot_id TEXT NOT NULL REFERENCES credit_lots(id),
  reserved_micro INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(reservation_id, lot_id)
);

-- =============================================================================
-- credit_debts: Refund liability tracking
-- =============================================================================
-- When a refund arrives for a partially-consumed lot, the shortfall is recorded here.
-- Future deposits pay down outstanding debts before crediting the balance.

CREATE TABLE IF NOT EXISTS credit_debts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  debt_micro INTEGER NOT NULL,
  source_payment_id TEXT,
  source_lot_id TEXT REFERENCES credit_lots(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  CONSTRAINT positive_debt CHECK (debt_micro > 0)
);

CREATE INDEX IF NOT EXISTS idx_credit_debts_account
  ON credit_debts(account_id)
  WHERE resolved_at IS NULL;

-- =============================================================================
-- billing_idempotency_keys: Idempotent operation deduplication
-- =============================================================================
-- Prevents duplicate operations across billing operations.
-- TTL 24h default; expired keys cleaned by sweeper.

CREATE TABLE IF NOT EXISTS billing_idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours')),
  UNIQUE(scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_idempotency_keys_expires
  ON billing_idempotency_keys(expires_at);
`;

/**
 * Rollback SQL for credit ledger migration.
 * WARNING: This will permanently delete all credit ledger data.
 * For production rollbacks, backup the database first:
 *   cp data/arrakis.db data/arrakis.db.backup-$(date +%s)
 *
 * Tables dropped in reverse dependency order to respect foreign keys.
 */
export const CREDIT_LEDGER_ROLLBACK_SQL = `
-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS billing_idempotency_keys;
DROP TABLE IF EXISTS credit_debts;
DROP TABLE IF EXISTS reservation_lots;
DROP TABLE IF EXISTS credit_reservations;
DROP TABLE IF EXISTS credit_account_seq;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS credit_balances;
DROP TABLE IF EXISTS credit_lots;
DROP TABLE IF EXISTS credit_accounts;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add credit ledger tables
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 030_credit_ledger: Adding credit ledger tables');
  db.exec(CREDIT_LEDGER_SCHEMA_SQL);
  logger.info('Migration 030_credit_ledger completed');
}

/**
 * Reverse migration — drops all credit ledger tables.
 * WARNING: Irreversible data loss. Backup first.
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 030_credit_ledger');
  db.exec(CREDIT_LEDGER_ROLLBACK_SQL);
  logger.info('Migration 030_credit_ledger reverted');
}
