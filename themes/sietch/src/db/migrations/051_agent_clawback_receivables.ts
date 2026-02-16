/**
 * Migration 051: Agent Clawback Receivables (Sprint 278, Task 4.4)
 *
 * Creates the agent_clawback_receivables table for tracking partial clawback IOUs.
 * When a clawback exceeds an agent's available balance, the deficit is recorded
 * as an off-ledger receivable (IOU) to be recovered via drip from future earnings.
 *
 * Conservation invariant:
 *   clawback_applied + receivable_created = original_clawback_amount
 *
 * SDD refs: §3.1, §4.4
 * PRD refs: FR-2b
 */

export const AGENT_CLAWBACK_RECEIVABLES_SQL = `
-- =============================================================================
-- agent_clawback_receivables: Off-ledger liability tracking for partial clawbacks
-- =============================================================================
-- When clawback exceeds agent balance, the unpaid remainder is recorded here.
-- balance_micro decreases as drip recovery applies future earnings.
-- resolved_at is set when balance_micro reaches 0.

CREATE TABLE IF NOT EXISTS agent_clawback_receivables (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  source_clawback_id TEXT NOT NULL,
  original_amount_micro INTEGER NOT NULL CHECK (original_amount_micro > 0),
  balance_micro INTEGER NOT NULL CHECK (balance_micro >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

-- Index for efficient lookup of outstanding receivables per account
CREATE INDEX IF NOT EXISTS idx_agent_clawback_receivables_outstanding
  ON agent_clawback_receivables(account_id) WHERE balance_micro > 0;

-- Index for resolved receivables queries
CREATE INDEX IF NOT EXISTS idx_agent_clawback_receivables_resolved
  ON agent_clawback_receivables(account_id) WHERE resolved_at IS NOT NULL;
`;

export const AGENT_CLAWBACK_RECEIVABLES_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_clawback_receivables_resolved;
DROP INDEX IF EXISTS idx_agent_clawback_receivables_outstanding;
DROP TABLE IF EXISTS agent_clawback_receivables;
`;
