/**
 * Migration 036: Daily Agent Spending Table (Sprint 241, Task 3.1)
 *
 * Tracks daily agent spending in SQLite as the persistent source of truth.
 * Redis serves as a cache for fast reads; this table is the fallback.
 *
 * Primary key: (agent_account_id, spending_date) — one row per agent per day.
 * UPSERT pattern: ON CONFLICT DO UPDATE SET total_spent_micro = total_spent_micro + excluded.total_spent_micro
 *
 * SDD refs: §2.3, §3.1
 * Sprint refs: Task 3.1
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const DAILY_SPENDING_SCHEMA_SQL = `
-- =============================================================================
-- daily_agent_spending: Persistent daily spending counters
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_agent_spending (
  agent_account_id  TEXT NOT NULL REFERENCES credit_accounts(id),
  spending_date     TEXT NOT NULL,    -- YYYY-MM-DD format
  total_spent_micro INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_account_id, spending_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_spending_date
  ON daily_agent_spending(spending_date);
`;

export const ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_daily_spending_date;
DROP TABLE IF EXISTS daily_agent_spending;
`;

export function up(db: Database.Database): void {
  logger.info('Running migration 036_daily_agent_spending: Adding daily spending table');
  db.exec(DAILY_SPENDING_SCHEMA_SQL);
  logger.info('Migration 036_daily_agent_spending completed');
}

export function down(db: Database.Database): void {
  logger.info('Reverting migration 036_daily_agent_spending');
  db.exec(ROLLBACK_SQL);
  logger.info('Migration 036_daily_agent_spending reverted');
}
