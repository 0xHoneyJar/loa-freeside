/**
 * Migration 039: Billing Notifications (Sprint 240, Task 2.5)
 *
 * Creates the billing_notifications table for tracking governance events
 * such as revenue rule activations and emergency overrides.
 *
 * Separate from audit triggers (038) to avoid coupling.
 *
 * SDD refs: §2.5, §2.7
 * Sprint refs: Task 2.5
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const NOTIFICATIONS_SCHEMA_SQL = `
-- =============================================================================
-- billing_notifications: Governance event notifications
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_notifications (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL REFERENCES revenue_rules(id),
  transition      TEXT NOT NULL,
  old_splits      TEXT,          -- JSON: { commons_bps, community_bps, foundation_bps }
  new_splits      TEXT NOT NULL,  -- JSON: { commons_bps, community_bps, foundation_bps }
  actor_id        TEXT NOT NULL,
  urgency         TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_notifications_rule
  ON billing_notifications(rule_id);

CREATE INDEX IF NOT EXISTS idx_billing_notifications_urgency
  ON billing_notifications(urgency, created_at DESC);
`;

export const ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_billing_notifications_urgency;
DROP INDEX IF EXISTS idx_billing_notifications_rule;
DROP TABLE IF EXISTS billing_notifications;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 039_billing_notifications: Creating notifications table');
  db.exec(NOTIFICATIONS_SCHEMA_SQL);
  logger.info('Migration 039_billing_notifications completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 039_billing_notifications');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 039_billing_notifications reverted');
}
