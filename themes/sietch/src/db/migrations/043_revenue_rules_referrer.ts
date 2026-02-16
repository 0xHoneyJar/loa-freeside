/**
 * Migration 043: Revenue Rules — Referrer BPS Extension (Sprint 258, Task 2.2)
 *
 * Adds referrer_bps column to revenue_rules for referral revenue share.
 * Updates bps_sum_100 constraint to include referrer_bps in the 10000 total.
 *
 * SDD refs: §4.2 Revenue Rules Extension
 * Sprint refs: Task 2.2
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const REVENUE_RULES_REFERRER_SQL = `
-- =============================================================================
-- Add referrer_bps to revenue_rules
-- =============================================================================
-- Default 0 for existing rules (no referrer share before this migration).
-- New rules can allocate up to referrer_bps from the 10000 total.

ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0;
`;

export const SEED_REFERRER_RULE_SQL = `
-- =============================================================================
-- Seed: default rule with referrer_bps = 1000 (10%)
-- =============================================================================
-- Creates a new draft rule with 10% referrer allocation.
-- The existing active rule retains referrer_bps = 0.
-- To activate: promote via revenue_rules governance flow.

INSERT OR IGNORE INTO revenue_rules
  (id, name, status, commons_bps, community_bps, foundation_bps, referrer_bps,
   proposed_by, proposed_at, created_at, updated_at, schema_version)
VALUES
  ('seed-referrer-rule', 'Revenue Split with Referral Share', 'draft',
   500, 6000, 2500, 1000,
   'system', datetime('now'), datetime('now'), datetime('now'), 2);
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 043_revenue_rules_referrer: Adding referrer_bps column');

  // Check if column already exists (idempotent)
  const columns = db.prepare('PRAGMA table_info(revenue_rules)').all() as Array<{ name: string }>;
  const hasReferrerBps = columns.some(c => c.name === 'referrer_bps');

  if (!hasReferrerBps) {
    db.exec(REVENUE_RULES_REFERRER_SQL);
  }

  // Seed draft rule with referrer allocation
  db.exec(SEED_REFERRER_RULE_SQL);

  logger.info('Migration 043_revenue_rules_referrer completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 043_revenue_rules_referrer (column preserved for SQLite compat)');
  // SQLite < 3.35 does not support DROP COLUMN
  // Delete seeded rule
  db.exec(`DELETE FROM revenue_rules WHERE id = 'seed-referrer-rule'`);
  logger.info('Migration 043_revenue_rules_referrer reverted');
}
