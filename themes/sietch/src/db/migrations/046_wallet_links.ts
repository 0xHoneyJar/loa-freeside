/**
 * Migration 046: Wallet Links & Score System (Sprint 267, Task 11.1)
 *
 * Creates wallet linking infrastructure and score distribution tables:
 * - wallet_link_nonces: EIP-191 nonce challenge/response
 * - wallet_links: Verified wallet→account associations
 * - score_snapshots: Per-wallet score values per period
 * - score_distributions: Distribution records per period
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Task 11.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const WALLET_LINKS_SQL = `
-- =============================================================================
-- wallet_link_nonces — EIP-191 nonce challenge/response
-- =============================================================================
CREATE TABLE IF NOT EXISTS wallet_link_nonces (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_wallet_link_nonces_expires
  ON wallet_link_nonces(expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_link_nonces_account
  ON wallet_link_nonces(account_id);

-- =============================================================================
-- wallet_links — Verified wallet → account associations
-- =============================================================================
CREATE TABLE IF NOT EXISTS wallet_links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unlinked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_links_address_chain
  ON wallet_links(wallet_address, chain_id)
  WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_links_account
  ON wallet_links(account_id)
  WHERE unlinked_at IS NULL;

-- =============================================================================
-- score_snapshots — Per-wallet score values per period
-- =============================================================================
CREATE TABLE IF NOT EXISTS score_snapshots (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1,
  score INTEGER NOT NULL CHECK (score >= 0),
  snapshot_period TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_snapshots_unique
  ON score_snapshots(wallet_address, chain_id, snapshot_period);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_period
  ON score_snapshots(snapshot_period);

-- =============================================================================
-- score_distributions — Distribution records per period
-- =============================================================================
CREATE TABLE IF NOT EXISTS score_distributions (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,
  pool_size_micro INTEGER NOT NULL CHECK (pool_size_micro > 0),
  participant_count INTEGER NOT NULL DEFAULT 0,
  total_score INTEGER NOT NULL DEFAULT 0,
  distributed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export const ROLLBACK_SQL = `
DROP TABLE IF EXISTS score_distributions;
DROP TABLE IF EXISTS score_snapshots;
DROP TABLE IF EXISTS wallet_links;
DROP TABLE IF EXISTS wallet_link_nonces;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 046_wallet_links: Creating wallet and score tables');
  db.exec(WALLET_LINKS_SQL);
  logger.info('Migration 046_wallet_links completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 046_wallet_links');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 046_wallet_links reverted');
}
