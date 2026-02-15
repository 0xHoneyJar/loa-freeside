/**
 * Migration 035: Revenue Rules Governance System (Sprint 237, Task 8.1)
 *
 * Creates tables for managing revenue distribution rule changes:
 * - revenue_rules: Rule definitions with lifecycle state machine
 * - revenue_rule_audit_log: Immutable audit trail for all state transitions
 *
 * State machine: draft → pending_approval → cooling_down → active → superseded
 * Terminal states: rejected, superseded
 *
 * Enforces at-most-one active rule via unique expression index.
 * Seeds initial rule matching current hardcoded split.
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 8.1
 */

export const REVENUE_RULES_SCHEMA_SQL = `
-- =============================================================================
-- revenue_rules: Revenue distribution rule definitions
-- =============================================================================
-- State machine: draft → pending_approval → cooling_down → active → superseded
-- Terminal: rejected, superseded

CREATE TABLE IF NOT EXISTS revenue_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'cooling_down', 'active', 'superseded', 'rejected'
  )),
  commons_bps INTEGER NOT NULL,
  community_bps INTEGER NOT NULL,
  foundation_bps INTEGER NOT NULL,
  proposed_by TEXT NOT NULL,
  approved_by TEXT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  activates_at TEXT,
  activated_at TEXT,
  superseded_at TEXT,
  superseded_by TEXT REFERENCES revenue_rules(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT bps_non_negative CHECK (
    commons_bps >= 0 AND community_bps >= 0 AND foundation_bps >= 0
  ),
  CONSTRAINT bps_sum_100 CHECK (
    commons_bps + community_bps + foundation_bps = 10000
  )
);

-- At most one active rule at the database level
CREATE UNIQUE INDEX IF NOT EXISTS revenue_rules_one_active
  ON revenue_rules(1) WHERE status = 'active';

-- Fast lookup by status
CREATE INDEX IF NOT EXISTS idx_revenue_rules_status
  ON revenue_rules(status);

-- Cooldown expiry check (for activator job)
CREATE INDEX IF NOT EXISTS idx_revenue_rules_cooldown
  ON revenue_rules(activates_at)
  WHERE status = 'cooling_down';

-- =============================================================================
-- revenue_rule_audit_log: Immutable audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS revenue_rule_audit_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES revenue_rules(id),
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

CREATE INDEX IF NOT EXISTS idx_revenue_rule_audit_rule
  ON revenue_rule_audit_log(rule_id, created_at DESC);

-- =============================================================================
-- Seed initial active rule matching current hardcoded split
-- =============================================================================
-- commons=500bps (5%), community=7000bps (70%), foundation=2500bps (25%)

INSERT OR IGNORE INTO revenue_rules
  (id, name, status, commons_bps, community_bps, foundation_bps,
   proposed_by, approved_by, proposed_at, approved_at, activated_at,
   created_at, updated_at)
VALUES
  ('seed-initial-rule', 'Initial Revenue Split', 'active',
   500, 7000, 2500,
   'system', 'system', datetime('now'), datetime('now'), datetime('now'),
   datetime('now'), datetime('now'));

INSERT OR IGNORE INTO revenue_rule_audit_log
  (id, rule_id, action, actor, reason, previous_status, new_status, created_at)
VALUES
  ('seed-initial-audit', 'seed-initial-rule', 'activated', 'system',
   'Initial seed from migration 035', NULL, 'active', datetime('now'));
`;

export const REVENUE_RULES_ROLLBACK_SQL = `
DROP TABLE IF EXISTS revenue_rule_audit_log;
DROP TABLE IF EXISTS revenue_rules;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export function up(db: Database.Database): void {
  logger.info('Running migration 035_revenue_rules: Adding revenue rules governance tables');
  db.exec(REVENUE_RULES_SCHEMA_SQL);
  logger.info('Migration 035_revenue_rules completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 035_revenue_rules');
  db.exec(REVENUE_RULES_ROLLBACK_SQL);
  logger.info('Migration 035_revenue_rules reverted');
}
