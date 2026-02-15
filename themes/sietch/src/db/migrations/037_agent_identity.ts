/**
 * Migration 037: Agent Identity Anchors (Sprint 243, Task 5.1)
 *
 * Stores identity anchors for agent wallets, enabling cross-system
 * sybil resistance via loa-hounfour identity binding.
 *
 * UNIQUE constraint on identity_anchor prevents the same identity
 * from being bound to multiple agent accounts.
 *
 * SDD refs: §2.4, §4.2
 * Sprint refs: Task 5.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const AGENT_IDENTITY_SCHEMA_SQL = `
-- =============================================================================
-- agent_identity_anchors: Cross-system identity binding for agent wallets
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_identity_anchors (
  agent_account_id  TEXT NOT NULL REFERENCES credit_accounts(id),
  identity_anchor   TEXT NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  rotated_at        TEXT,
  rotated_by        TEXT,
  PRIMARY KEY (agent_account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_anchor_unique
  ON agent_identity_anchors(identity_anchor);
`;

export const ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_identity_anchor_unique;
DROP TABLE IF EXISTS agent_identity_anchors;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 037_agent_identity: Adding identity anchors table');
  db.exec(AGENT_IDENTITY_SCHEMA_SQL);
  logger.info('Migration 037_agent_identity completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 037_agent_identity');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 037_agent_identity reverted');
}
