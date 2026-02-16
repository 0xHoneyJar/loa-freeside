/**
 * Migration 058: Add 'tba_deposit' to credit_lots source_type (Sprint 290, Task 8.3)
 *
 * Rebuilds `credit_lots` to add 'tba_deposit' to the source_type CHECK constraint.
 * SQLite does not support ALTER CONSTRAINT, so we use the standard table-rebuild
 * pattern (rename → create → copy → drop → reindex).
 *
 * Required because migration 057 created `tba_deposits` and TbaDepositBridge
 * mints lots with source_type='tba_deposit', but the CHECK constraint from
 * migration 030 does not include this value.
 *
 * SDD refs: §3.1.2 tba_deposits, §3.2 credit_lots
 */

export const CREDIT_LOTS_REBUILD_SQL = `
-- Step 1: Rename existing table
ALTER TABLE credit_lots RENAME TO _credit_lots_058_backup;

-- Step 2: Create new table with 'tba_deposit' in source_type CHECK
CREATE TABLE credit_lots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  pool_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'deposit', 'grant', 'purchase', 'transfer_in', 'commons_dividend',
    'tba_deposit'
  )),
  source_id TEXT,
  original_micro INTEGER NOT NULL,
  available_micro INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  consumed_micro INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT lot_balance CHECK (available_micro >= 0 AND reserved_micro >= 0 AND consumed_micro >= 0),
  CONSTRAINT lot_invariant CHECK (available_micro + reserved_micro + consumed_micro = original_micro)
);

-- Step 3: Copy all existing data
INSERT INTO credit_lots SELECT * FROM _credit_lots_058_backup;

-- Step 4: Drop backup
DROP TABLE _credit_lots_058_backup;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_credit_lots_redemption
  ON credit_lots(account_id, pool_id, expires_at)
  WHERE available_micro > 0;

CREATE INDEX IF NOT EXISTS idx_credit_lots_account
  ON credit_lots(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_lots_source
  ON credit_lots(source_type, source_id)
  WHERE source_id IS NOT NULL;
`;

export const CREDIT_LOTS_REBUILD_ROLLBACK_SQL = `
-- Rollback is a no-op — the added 'tba_deposit' value is harmless to leave.
-- A full rollback would require another table rebuild.
`;

/**
 * Run migration forward.
 */
export function up(db: { exec(sql: string): void; pragma(sql: string): unknown }): void {
  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(CREDIT_LOTS_REBUILD_SQL);
    const fkViolations = db.pragma('foreign_key_check') as unknown;
    if (Array.isArray(fkViolations) && fkViolations.length > 0) {
      throw new Error(`foreign_key_check failed: ${JSON.stringify(fkViolations)}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(CREDIT_LOTS_REBUILD_ROLLBACK_SQL);
}
