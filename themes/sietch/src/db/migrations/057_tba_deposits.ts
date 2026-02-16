/**
 * Migration 057: TBA Deposits Table (Sprint 288, Task 5.1)
 *
 * Creates the `tba_deposits` table for tracking on-chain deposits
 * to ERC-6551 Token-Bound Accounts. Each deposit goes through:
 *   detected → confirmed → bridged (or failed)
 *
 * tx_hash UNIQUE constraint provides idempotency for the bridge algorithm.
 *
 * SDD refs: §3.1.2 tba_deposits table
 * PRD refs: FR-2.4, FR-2.5
 */

// =============================================================================
// TBA Deposits Table
// =============================================================================

export const TBA_DEPOSITS_SQL = `
-- =============================================================================
-- tba_deposits: On-chain deposit records for Token-Bound Accounts
-- =============================================================================
-- Each deposit is verified on-chain before bridging to a credit lot.
-- tx_hash uniqueness prevents double-bridging the same on-chain transaction.

CREATE TABLE IF NOT EXISTS tba_deposits (
  id TEXT PRIMARY KEY,
  agent_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  token_address TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (
    (status IN ('detected', 'confirmed', 'failed') AND amount_micro >= 0)
    OR (status = 'bridged' AND amount_micro > 0)
  ),
  lot_id TEXT REFERENCES credit_lots(id),
  escrow_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  finality_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed', 'bridged', 'failed')),
  error_message TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  bridged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tba_deposits_agent
  ON tba_deposits(agent_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tba_deposits_status
  ON tba_deposits(status);
`;

export const TBA_DEPOSITS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_tba_deposits_status;
DROP INDEX IF EXISTS idx_tba_deposits_agent;
DROP TABLE IF EXISTS tba_deposits;
`;

/**
 * Run migration forward.
 */
export function up(db: { exec(sql: string): void }): void {
  db.exec(TBA_DEPOSITS_SQL);
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(TBA_DEPOSITS_ROLLBACK_SQL);
}
