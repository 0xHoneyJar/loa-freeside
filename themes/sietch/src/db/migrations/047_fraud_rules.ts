/**
 * Migration 047: Fraud Rules Governance System (Sprint 271, Task 15.1)
 *
 * Creates fraud_rules table with configurable weights and thresholds.
 * Same governance lifecycle as revenue_rules:
 *   draft → pending_approval → cooling_down → active → superseded
 *   Terminal: rejected, superseded
 *
 * Weights stored as integer basis points (out of 10000) to avoid
 * floating-point CHECK constraint issues. Same convention as revenue_rules.
 *
 * Seeds with current hardcoded FraudCheckService defaults.
 *
 * SDD refs: §4.4 Fraud Rules Engine
 * Sprint refs: Task 15.1
 */

export const FRAUD_RULES_SCHEMA_SQL = `
-- =============================================================================
-- fraud_rules: Configurable fraud scoring weights & thresholds
-- =============================================================================
-- Weights are stored as integer basis points (e.g., 3000 = 0.30 = 30%).
-- Must sum to 10000 (100%).
-- Thresholds are stored as integer basis points (e.g., 3000 = 0.30).

CREATE TABLE IF NOT EXISTS fraud_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'cooling_down', 'active', 'superseded', 'rejected'
  )),
  ip_cluster_weight INTEGER NOT NULL,
  ua_fingerprint_weight INTEGER NOT NULL,
  velocity_weight INTEGER NOT NULL,
  activity_weight INTEGER NOT NULL,
  flag_threshold INTEGER NOT NULL,
  withhold_threshold INTEGER NOT NULL,
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  activates_at TEXT,
  activated_at TEXT,
  superseded_at TEXT,
  superseded_by TEXT REFERENCES fraud_rules(id),
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT weights_non_negative CHECK (
    ip_cluster_weight >= 0 AND ua_fingerprint_weight >= 0 AND
    velocity_weight >= 0 AND activity_weight >= 0
  ),
  CONSTRAINT weights_sum_10000 CHECK (
    ip_cluster_weight + ua_fingerprint_weight + velocity_weight + activity_weight = 10000
  ),
  CONSTRAINT thresholds_valid CHECK (
    flag_threshold > 0 AND withhold_threshold > 0 AND
    flag_threshold < withhold_threshold AND
    withhold_threshold <= 10000
  )
);

-- At most one active fraud rule at the database level
CREATE UNIQUE INDEX IF NOT EXISTS fraud_rules_one_active
  ON fraud_rules(1) WHERE status = 'active';

-- Fast lookup by status
CREATE INDEX IF NOT EXISTS idx_fraud_rules_status
  ON fraud_rules(status);

-- Cooldown expiry check
CREATE INDEX IF NOT EXISTS idx_fraud_rules_cooldown
  ON fraud_rules(activates_at)
  WHERE status = 'cooling_down';

-- =============================================================================
-- fraud_rule_audit_log: Immutable audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS fraud_rule_audit_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES fraud_rules(id),
  action TEXT NOT NULL CHECK (action IN (
    'proposed', 'submitted', 'approved', 'rejected',
    'activated', 'superseded', 'cooldown_overridden'
  )),
  actor TEXT NOT NULL,
  reason TEXT,
  previous_status TEXT,
  new_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_rule_audit_rule
  ON fraud_rule_audit_log(rule_id, created_at DESC);

-- =============================================================================
-- Seed initial active rule from current hardcoded defaults
-- =============================================================================
-- ip_cluster: 3000 (0.30), ua_fingerprint: 2500 (0.25),
-- velocity: 2500 (0.25), activity: 2000 (0.20)
-- flag: 3000 (0.30), withhold: 7000 (0.70)

INSERT OR IGNORE INTO fraud_rules
  (id, name, status, ip_cluster_weight, ua_fingerprint_weight,
   velocity_weight, activity_weight, flag_threshold, withhold_threshold,
   proposed_by, approved_by, proposed_at, approved_at, activated_at,
   created_at, updated_at)
VALUES
  ('seed-initial-fraud-rule', 'Initial Fraud Weights', 'active',
   3000, 2500, 2500, 2000, 3000, 7000,
   'system', 'system', datetime('now'), datetime('now'), datetime('now'),
   datetime('now'), datetime('now'));

INSERT OR IGNORE INTO fraud_rule_audit_log
  (id, rule_id, action, actor, reason, previous_status, new_status, created_at)
VALUES
  ('seed-fraud-audit', 'seed-initial-fraud-rule', 'activated', 'system',
   'Initial seed from migration 047', NULL, 'active', datetime('now'));
`;

export const FRAUD_RULES_ROLLBACK_SQL = `
DROP TABLE IF EXISTS fraud_rule_audit_log;
DROP TABLE IF EXISTS fraud_rules;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export function up(db: Database.Database): void {
  logger.info('Running migration 047_fraud_rules: Adding fraud rules governance tables');
  db.exec(FRAUD_RULES_SCHEMA_SQL);
  logger.info('Migration 047_fraud_rules completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 047_fraud_rules');
  db.exec(FRAUD_RULES_ROLLBACK_SQL);
  logger.info('Migration 047_fraud_rules reverted');
}
