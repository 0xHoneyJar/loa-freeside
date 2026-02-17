/**
 * Migration 056: Peer Transfers Table + Entry Type Extension (Sprint 285, Task 2.1)
 *
 * 1. Creates the `transfers` table for agent-to-agent peer credit transfers
 *    with idempotency_key UNIQUE constraint and status lifecycle.
 *
 * 2. Rebuilds `credit_ledger` to add 'transfer_out' to the entry_type CHECK
 *    constraint. SQLite does not support ALTER CONSTRAINT, so we use the
 *    standard table-rebuild pattern (rename → create → copy → drop → reindex).
 *
 * **Why legacy_alter_table matters (FK safety):**
 * By default (legacy_alter_table=OFF, since SQLite 3.26.0), ALTER TABLE RENAME
 * auto-updates FK references in OTHER tables to follow the rename. Currently
 * credit_ledger is not referenced BY other tables (it references them), but
 * applying the PRAGMA prophylactically prevents this class of bug if any future
 * table adds an FK to credit_ledger. See migration 060 for the full story.
 *
 * The credit_ledger rebuild is required because the entry_type CHECK constraint
 * from migration 030 does not include 'transfer_out'. Application-level
 * validation (TypeScript EntryType union) is authoritative (SDD §7.2), but
 * the DB constraint must also accept the new value.
 *
 * SDD refs: §3.1.1 transfers table, §7.2 application-level validation
 * PRD refs: FR-1.1, FR-1.2, FR-1.5
 */

// =============================================================================
// Transfers Table
// =============================================================================

export const PEER_TRANSFERS_SQL = `
-- =============================================================================
-- transfers: Peer-to-peer credit transfer records
-- =============================================================================
-- Each transfer is atomic: idempotency check → lot selection → lot-split →
-- ledger entries → status update. All within BEGIN IMMEDIATE.

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  to_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  correlation_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
  rejection_reason TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transfers_from
  ON transfers(from_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_transfers_to
  ON transfers(to_account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_transfers_status
  ON transfers(status, created_at);
`;

// =============================================================================
// Credit Ledger Rebuild — add 'transfer_out' to entry_type CHECK
// =============================================================================

export const CREDIT_LEDGER_REBUILD_SQL = `
-- Step 1: Rename existing table (legacy_alter_table is set ON/OFF in up())
ALTER TABLE credit_ledger RENAME TO _credit_ledger_056_backup;

-- Step 2: Create new table with 'transfer_out' in entry_type CHECK
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  lot_id TEXT REFERENCES credit_lots(id),
  reservation_id TEXT,
  entry_seq INTEGER NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'deposit', 'reserve', 'finalize', 'release', 'refund',
    'grant', 'shadow_charge', 'shadow_reserve', 'shadow_finalize',
    'commons_contribution', 'revenue_share',
    'marketplace_sale', 'marketplace_purchase',
    'escrow', 'escrow_release',
    'transfer_out', 'transfer_in'
  )),
  amount_micro INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  description TEXT,
  metadata TEXT,
  pre_balance_micro INTEGER,
  post_balance_micro INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, pool_id, entry_seq)
);

-- Step 3: Copy all existing data
INSERT INTO credit_ledger SELECT * FROM _credit_ledger_056_backup;

-- Step 4: Drop backup
DROP TABLE _credit_ledger_056_backup;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_credit_ledger_account
  ON credit_ledger(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_reservation
  ON credit_ledger(reservation_id)
  WHERE reservation_id IS NOT NULL;
`;

export const PEER_TRANSFERS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_transfers_status;
DROP INDEX IF EXISTS idx_transfers_to;
DROP INDEX IF EXISTS idx_transfers_from;
DROP TABLE IF EXISTS transfers;
`;

// Note: credit_ledger rollback would require another table rebuild to remove
// 'transfer_out' from the CHECK. In practice, the column value is harmless
// to leave and rollback is a no-op for the constraint change.

/**
 * Run migration forward.
 */
export function up(db: { exec(sql: string): void; pragma(sql: string): unknown }): void {
  // Disable foreign keys for table rebuild
  db.pragma('foreign_keys = OFF');

  try {
    // Create transfers table
    db.exec(PEER_TRANSFERS_SQL);

    // legacy_alter_table=ON prevents SQLite from auto-updating FK references
    // in dependent tables to follow the rename (prophylactic — see migration 060).
    db.pragma('legacy_alter_table = ON');
    try {
      // Rebuild credit_ledger with updated CHECK constraint
      db.exec(CREDIT_LEDGER_REBUILD_SQL);
    } finally {
      db.pragma('legacy_alter_table = OFF');
    }

    // Verify foreign key integrity after rebuild
    db.pragma('foreign_key_check');
  } finally {
    // Re-enable foreign keys
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(PEER_TRANSFERS_ROLLBACK_SQL);
  // credit_ledger constraint change is not rolled back (harmless)
}
