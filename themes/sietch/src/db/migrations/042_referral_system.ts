/**
 * Migration 042: Referral System (Sprint 257, Tasks 1.1)
 *
 * Creates the referral system foundation tables:
 * - referral_codes: Referral code generation and tracking
 * - referral_registrations: Referee-to-referrer bindings
 * - referral_attribution_log: Audit trail for attribution events
 * - referral_bonuses: Qualifying action bonus tracking
 * - referral_events: Fraud signal persistence (hashed PII)
 *
 * SDD refs: §4.1 ReferralService, §3.1 Tables
 * Sprint refs: Task 1.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const REFERRAL_SCHEMA_SQL = `
-- =============================================================================
-- referral_codes — Referral code generation and tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  revoked_by TEXT
);

-- One active code per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_account_active
  ON referral_codes(account_id) WHERE status = 'active';

-- =============================================================================
-- referral_registrations — Referee-to-referrer bindings
-- =============================================================================
CREATE TABLE IF NOT EXISTS referral_registrations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referee_account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referral_code_id TEXT NOT NULL REFERENCES referral_codes(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  attribution_expires_at TEXT NOT NULL,
  CHECK (referee_account_id != referrer_account_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_reg_referrer
  ON referral_registrations(referrer_account_id);

-- =============================================================================
-- referral_attribution_log — Audit trail for attribution events
-- =============================================================================
CREATE TABLE IF NOT EXISTS referral_attribution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_account_id TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'bound', 'rebound_grace', 'admin_rebind', 'dispute_resolved',
    'rejected_existing', 'rejected_self', 'rejected_expired', 'rejected_max_uses'
  )),
  effective_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =============================================================================
-- referral_bonuses — Qualifying action bonus tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  referee_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  referrer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  registration_id TEXT NOT NULL REFERENCES referral_registrations(id),
  qualifying_action TEXT NOT NULL CHECK (qualifying_action IN ('dnft_creation', 'credit_purchase')),
  qualifying_action_id TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'granted', 'withheld', 'flagged', 'denied', 'expired')),
  risk_score REAL,
  flag_reason TEXT,
  reviewed_by TEXT,
  fraud_check_at TEXT,
  granted_at TEXT,
  grant_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(referee_account_id, qualifying_action, qualifying_action_id)
);

-- =============================================================================
-- referral_events — Fraud signal persistence (hashed PII)
-- =============================================================================
CREATE TABLE IF NOT EXISTS referral_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('registration', 'bonus_claim', 'qualifying_action')),
  ip_hash TEXT,
  ip_prefix TEXT,
  user_agent_hash TEXT,
  fingerprint_hash TEXT,
  referral_code_id TEXT REFERENCES referral_codes(id),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_referral_events_account
  ON referral_events(account_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_ip_prefix
  ON referral_events(ip_prefix, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_fingerprint
  ON referral_events(fingerprint_hash, created_at)
  WHERE fingerprint_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_events_type_time
  ON referral_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_referral_events_created_at
  ON referral_events(created_at);
`;

export const ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_referral_events_created_at;
DROP INDEX IF EXISTS idx_referral_events_type_time;
DROP INDEX IF EXISTS idx_referral_events_fingerprint;
DROP INDEX IF EXISTS idx_referral_events_ip_prefix;
DROP INDEX IF EXISTS idx_referral_events_account;
DROP TABLE IF EXISTS referral_events;
DROP TABLE IF EXISTS referral_bonuses;
DROP TABLE IF EXISTS referral_attribution_log;
DROP TABLE IF EXISTS referral_registrations;
DROP INDEX IF EXISTS idx_referral_codes_account_active;
DROP TABLE IF EXISTS referral_codes;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 042_referral_system: Creating referral tables');
  db.exec(REFERRAL_SCHEMA_SQL);
  logger.info('Migration 042_referral_system completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 042_referral_system');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 042_referral_system reverted');
}
