/**
 * Migration 050: Constitutional Governance — System Config (Sprint 275, Tasks 1.1-1.2)
 *
 * Creates the constitutional governance schema:
 *   - system_config: Parameter storage with governance lifecycle
 *   - system_config_audit: Append-only audit trail
 *   - system_config_version_seq: Monotonic version counter
 *
 * State machine: draft → pending_approval → cooling_down → active → superseded
 *                                        ↘ rejected (terminal)
 *
 * Seeds 10 global defaults (matching current hardcoded values) and
 * 4 agent-specific overrides per SDD §7.2.
 *
 * SDD refs: §3.1, §7.1, §7.2
 * PRD refs: FR-4, FR-5
 */

export const SYSTEM_CONFIG_SCHEMA_SQL = `
-- =============================================================================
-- system_config: Constitutional parameters with governance lifecycle
-- =============================================================================
-- All monetary values in micro-USD (bigint). All durations in integer seconds/days.
-- entity_type NULL = global default; non-NULL = entity-specific override.

CREATE TABLE IF NOT EXISTS system_config (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  param_key TEXT NOT NULL,
  entity_type TEXT,
  value_json TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  active_from TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'cooling_down', 'active', 'superseded', 'rejected')),
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  approved_by TEXT,
  approval_count INTEGER NOT NULL DEFAULT 0,
  required_approvals INTEGER NOT NULL DEFAULT 2,
  cooldown_ends_at TEXT,
  activated_at TEXT,
  superseded_at TEXT,
  superseded_by TEXT REFERENCES system_config(id),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Only one active config per (param_key, entity_type) pair.
-- COALESCE handles SQLite NULL uniqueness semantics (NULL != NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_active
  ON system_config(param_key, COALESCE(entity_type, '__global__')) WHERE status = 'active';

-- Version uniqueness per (param_key, entity_type) — prevents concurrent version collision
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_version
  ON system_config(param_key, COALESCE(entity_type, '__global__'), config_version);

-- Lookup active config: entity-specific first, then global fallback
CREATE INDEX IF NOT EXISTS idx_system_config_lookup
  ON system_config(param_key, status, entity_type);

-- =============================================================================
-- system_config_audit: Append-only audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_config_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id TEXT NOT NULL REFERENCES system_config(id),
  action TEXT NOT NULL
    CHECK (action IN ('proposed', 'approved', 'rejected', 'cooling_started', 'activated', 'superseded', 'emergency_override')),
  actor TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  config_version INTEGER NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_config_audit_config
  ON system_config_audit(config_id);
CREATE INDEX IF NOT EXISTS idx_config_audit_action
  ON system_config_audit(action, created_at);

-- =============================================================================
-- system_config_version_seq: Monotonic version counter
-- =============================================================================
-- Updated within BEGIN IMMEDIATE to prevent concurrent version allocation.

CREATE TABLE IF NOT EXISTS system_config_version_seq (
  param_key TEXT NOT NULL,
  entity_type TEXT,
  current_version INTEGER NOT NULL DEFAULT 0
);

-- COALESCE handles NULL entity_type for global defaults
CREATE UNIQUE INDEX IF NOT EXISTS idx_version_seq_unique
  ON system_config_version_seq(param_key, COALESCE(entity_type, '__global__'));
`;

export const SYSTEM_CONFIG_SEED_SQL = `
-- =============================================================================
-- Seed global defaults (matching current hardcoded values, normalized to integer seconds/days)
-- =============================================================================
-- SDD §7.2: All durations stored as integer seconds or days — no floating-point.

INSERT OR IGNORE INTO system_config (id, param_key, entity_type, value_json, status, config_version, proposed_by, activated_at)
VALUES
  ('seed-cfg-kyc-basic',        'kyc.basic_threshold_micro',       NULL, '100000000',  'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-kyc-enhanced',     'kyc.enhanced_threshold_micro',    NULL, '600000000',  'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-settle-hold',      'settlement.hold_seconds',         NULL, '172800',     'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-payout-min',       'payout.min_micro',                NULL, '1000000',    'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-payout-rate',      'payout.rate_limit_seconds',       NULL, '86400',      'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-payout-fee',       'payout.fee_cap_percent',          NULL, '20',         'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-rev-cooldown',     'revenue_rule.cooldown_seconds',   NULL, '172800',     'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-fraud-cooldown',   'fraud_rule.cooldown_seconds',     NULL, '604800',     'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-reservation-ttl',  'reservation.default_ttl_seconds', NULL, '300',        'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-referral-window',  'referral.attribution_window_days',NULL, '365',        'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Seed version sequence counters for global defaults
INSERT OR IGNORE INTO system_config_version_seq (param_key, entity_type, current_version)
VALUES
  ('kyc.basic_threshold_micro',       NULL, 1),
  ('kyc.enhanced_threshold_micro',    NULL, 1),
  ('settlement.hold_seconds',         NULL, 1),
  ('payout.min_micro',                NULL, 1),
  ('payout.rate_limit_seconds',       NULL, 1),
  ('payout.fee_cap_percent',          NULL, 1),
  ('revenue_rule.cooldown_seconds',   NULL, 1),
  ('fraud_rule.cooldown_seconds',     NULL, 1),
  ('reservation.default_ttl_seconds', NULL, 1),
  ('referral.attribution_window_days',NULL, 1);

-- =============================================================================
-- Seed agent-specific overrides
-- =============================================================================
-- Agents get: instant settlement (0s hold), lower min payout, faster rate limit,
-- and drip recovery percentage for clawback receivables.

INSERT OR IGNORE INTO system_config (id, param_key, entity_type, value_json, status, config_version, proposed_by, activated_at)
VALUES
  ('seed-cfg-agent-settle',     'settlement.hold_seconds',    'agent', '0',     'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-agent-payout-min', 'payout.min_micro',           'agent', '10000', 'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-agent-payout-rate','payout.rate_limit_seconds',  'agent', '8640',  'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('seed-cfg-agent-drip',      'agent.drip_recovery_pct',     'agent', '50',    'active', 1, 'migration', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Seed agent override version counters
INSERT OR IGNORE INTO system_config_version_seq (param_key, entity_type, current_version)
VALUES
  ('settlement.hold_seconds',    'agent', 1),
  ('payout.min_micro',           'agent', 1),
  ('payout.rate_limit_seconds',  'agent', 1),
  ('agent.drip_recovery_pct',    'agent', 1);

-- Seed audit entries for all seeded configs (idempotent via NOT EXISTS)
INSERT INTO system_config_audit (config_id, action, actor, previous_status, new_status, config_version, metadata)
SELECT sc.id, 'activated', 'migration', NULL, 'active', 1,
  '{"reason":"Initial seed from migration 050"}'
FROM system_config sc
WHERE sc.proposed_by = 'migration'
  AND NOT EXISTS (
    SELECT 1 FROM system_config_audit a
    WHERE a.config_id = sc.id
      AND a.action = 'activated'
      AND a.actor = 'migration'
  );
`;

export const SYSTEM_CONFIG_ROLLBACK_SQL = `
DROP TABLE IF EXISTS system_config_audit;
DROP TABLE IF EXISTS system_config_version_seq;
DROP TABLE IF EXISTS system_config;
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export function up(db: Database.Database): void {
  logger.info('Running migration 050_system_config: Constitutional governance schema + seed data');
  db.exec(SYSTEM_CONFIG_SCHEMA_SQL);
  db.exec(SYSTEM_CONFIG_SEED_SQL);
  logger.info('Migration 050_system_config completed: 3 tables, 14 config rows, 14 version counters');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 050_system_config');
  db.exec(SYSTEM_CONFIG_ROLLBACK_SQL);
  logger.info('Migration 050_system_config reverted');
}
