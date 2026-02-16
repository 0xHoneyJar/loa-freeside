/**
 * Migration 052: Agent Budget Engine (Sprint 279, Task 5.1)
 *
 * Creates agent spending limits and budget finalization tracking tables.
 * Supports per-agent daily caps with rolling-window spend tracking
 * and circuit breaker state for budget exhaustion.
 *
 * SDD refs: §SS3.1, §SS4.2
 * PRD refs: FR-2
 */

export const AGENT_BUDGET_SQL = `
-- =============================================================================
-- agent_spending_limits: Per-agent daily budget caps with circuit breaker
-- =============================================================================
-- Each agent account has at most one spending limit row.
-- circuit_state transitions: closed -> warning (80%) -> open (100%)
-- Window resets via cron when current time >= window_start + window_duration_seconds.

CREATE TABLE IF NOT EXISTS agent_spending_limits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
  daily_cap_micro INTEGER NOT NULL CHECK (daily_cap_micro > 0),
  current_spend_micro INTEGER NOT NULL DEFAULT 0 CHECK (current_spend_micro >= 0),
  window_start TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  window_duration_seconds INTEGER NOT NULL DEFAULT 86400,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'warning', 'open')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- =============================================================================
-- agent_budget_finalizations: Idempotent finalization tracking
-- =============================================================================
-- PK (account_id, reservation_id) prevents double-counting.
-- finalized_at enables precise windowed spend queries.

CREATE TABLE IF NOT EXISTS agent_budget_finalizations (
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  reservation_id TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (amount_micro >= 0),
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (account_id, reservation_id)
);

-- Index for efficient windowed spend computation
CREATE INDEX IF NOT EXISTS idx_agent_budget_finalizations_window
  ON agent_budget_finalizations(account_id, finalized_at);
`;

export const AGENT_BUDGET_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_budget_finalizations_window;
DROP TABLE IF EXISTS agent_budget_finalizations;
DROP TABLE IF EXISTS agent_spending_limits;
`;
