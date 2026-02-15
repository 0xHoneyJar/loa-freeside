/**
 * Migration 033 — Campaign Engine Tables
 *
 * Creates tables for the Reverse Airdrop campaign system:
 * - credit_campaigns: Campaign lifecycle management
 * - credit_grants: Individual grant records with dedup
 *
 * SDD refs: §3.2 Migration 033
 * Sprint refs: Task 4.1
 */

export const CAMPAIGNS_SCHEMA_SQL = `
-- =============================================================================
-- credit_campaigns: Campaign lifecycle management
-- =============================================================================
-- Campaigns group grants for batch operations like Reverse Airdrops.
-- Status lifecycle: draft → active → paused → completed → expired

CREATE TABLE IF NOT EXISTS credit_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN (
    'reverse_airdrop', 'promotional', 'loyalty', 'referral'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'active', 'paused', 'completed', 'expired'
  )),
  budget_micro INTEGER NOT NULL DEFAULT 0,
  spent_micro INTEGER NOT NULL DEFAULT 0,
  grant_formula TEXT NOT NULL DEFAULT 'fixed_amount' CHECK (grant_formula IN (
    'proportional_loss', 'fixed_amount', 'tiered'
  )),
  grant_config TEXT,
  pool_id TEXT,
  per_wallet_cap_micro INTEGER NOT NULL DEFAULT 5000000,
  expires_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT positive_budget CHECK (budget_micro >= 0),
  CONSTRAINT positive_spent CHECK (spent_micro >= 0),
  CONSTRAINT budget_cap CHECK (spent_micro <= budget_micro)
);

-- =============================================================================
-- credit_grants: Individual grant records
-- =============================================================================
-- Each grant creates a credit lot via mintLot().
-- UNIQUE(campaign_id, account_id) prevents duplicate grants.

CREATE TABLE IF NOT EXISTS credit_grants (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES credit_campaigns(id),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  lot_id TEXT REFERENCES credit_lots(id),
  amount_micro INTEGER NOT NULL,
  grant_formula TEXT NOT NULL,
  formula_input TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'granted', 'failed', 'revoked'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT positive_grant CHECK (amount_micro > 0),
  UNIQUE(campaign_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_grants_campaign
  ON credit_grants(campaign_id);

CREATE INDEX IF NOT EXISTS idx_credit_grants_account
  ON credit_grants(account_id);

CREATE INDEX IF NOT EXISTS idx_credit_campaigns_status
  ON credit_campaigns(status)
  WHERE status IN ('active', 'paused');
`;

// =============================================================================
// Rollback SQL
// =============================================================================

export const CAMPAIGNS_ROLLBACK_SQL = `
DROP TABLE IF EXISTS credit_grants;
DROP TABLE IF EXISTS credit_campaigns;
`;

// =============================================================================
// Migration Runner
// =============================================================================

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export function up(db: Database.Database): void {
  logger.info('Running migration 033_campaigns: Adding campaign tables');
  db.exec(CAMPAIGNS_SCHEMA_SQL);
  logger.info('Migration 033_campaigns completed');
}
