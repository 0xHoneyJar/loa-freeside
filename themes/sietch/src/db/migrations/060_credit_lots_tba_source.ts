/**
 * Migration 060: Add 'tba_deposit' to credit_lots source_type (Sprint 290, Task 8.3)
 *
 * Rebuilds `credit_lots` to add 'tba_deposit' to the source_type CHECK constraint.
 * SQLite does not support ALTER CONSTRAINT, so we use the table-rebuild pattern:
 *   CREATE _new → COPY data → legacy_alter_table ON → RENAME old → RENAME _new → DROP _old
 *
 * **Why legacy_alter_table matters (FK safety):**
 * By default (legacy_alter_table=OFF, since SQLite 3.26.0), ALTER TABLE RENAME
 * auto-updates FK references in OTHER tables to follow the rename. So when
 * `credit_lots` is renamed to `_credit_lots_old`, the FKs in credit_ledger,
 * reservation_lots, and credit_debts get rewritten to point at `_credit_lots_old`.
 * When the old table is dropped, those FKs become dangling.
 *
 * Setting `legacy_alter_table = ON` before the renames prevents this auto-update.
 * The FKs in dependent tables continue to reference `credit_lots` (the name),
 * which resolves to the new table after the swap completes.
 *
 * Required because migration 057 created `tba_deposits` and TbaDepositBridge
 * mints lots with source_type='tba_deposit', but the CHECK constraint from
 * migration 030 does not include this value.
 *
 * SDD refs: §3.1.2 tba_deposits, §3.2 credit_lots
 */

export const CREDIT_LOTS_REBUILD_SQL = `
-- Guard: clean up any partial previous run (idempotency)
DROP TABLE IF EXISTS _credit_lots_new;
DROP TABLE IF EXISTS _credit_lots_old;

-- Step 1: Create new table with 'tba_deposit' in source_type CHECK
CREATE TABLE _credit_lots_new (
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

-- Step 2: Copy all existing data
INSERT INTO _credit_lots_new SELECT * FROM credit_lots;

-- Step 3: Swap tables (old table preserved until step 5)
-- legacy_alter_table=ON prevents SQLite from auto-updating FK references
-- in dependent tables (credit_ledger, reservation_lots, credit_debts) to
-- follow the rename. Without this, FKs would point to '_credit_lots_old'.
PRAGMA legacy_alter_table = ON;
ALTER TABLE credit_lots RENAME TO _credit_lots_old;
ALTER TABLE _credit_lots_new RENAME TO credit_lots;
PRAGMA legacy_alter_table = OFF;

-- Step 4: Drop old indexes (they moved with _credit_lots_old) and recreate on new credit_lots
DROP INDEX IF EXISTS idx_credit_lots_redemption;
DROP INDEX IF EXISTS idx_credit_lots_account;
DROP INDEX IF EXISTS idx_credit_lots_source;

CREATE INDEX idx_credit_lots_redemption
  ON credit_lots(account_id, pool_id, expires_at)
  WHERE available_micro > 0;

CREATE INDEX idx_credit_lots_account
  ON credit_lots(account_id);

CREATE UNIQUE INDEX idx_credit_lots_source
  ON credit_lots(source_type, source_id)
  WHERE source_id IS NOT NULL;

-- Step 5: Drop old table only after everything succeeds
DROP TABLE _credit_lots_old;
`;

export const CREDIT_LOTS_REBUILD_ROLLBACK_SQL = `
-- Rollback is a no-op — the added 'tba_deposit' value is harmless to leave.
-- A full rollback would require another table rebuild.
`;

/**
 * Check if credit_lots already has 'tba_deposit' in its CHECK constraint.
 * Used for idempotency — skip rebuild if already migrated.
 */
function alreadyMigrated(db: { prepare(sql: string): { get(...args: unknown[]): unknown } }): boolean {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credit_lots'`,
  ).get() as { sql: string } | undefined;
  return row ? row.sql.includes("'tba_deposit'") : false;
}

/**
 * Verify that FK references in dependent tables point to 'credit_lots'
 * (not '_credit_lots_old' or '_credit_lots_058_backup').
 */
function verifyFkTargets(db: { pragma(sql: string): unknown }): void {
  const dependentTables = ['credit_ledger', 'reservation_lots', 'credit_debts'];
  const lotFkColumns = new Set(['lot_id', 'source_lot_id']);

  for (const table of dependentTables) {
    const fkList = db.pragma(`foreign_key_list(${table})`) as Array<{ table: string; from: string }>;
    for (const fk of fkList) {
      // Enforce that any lot-related FK columns must reference credit_lots
      if (lotFkColumns.has(fk.from) && fk.table !== 'credit_lots') {
        throw new Error(
          `FK corruption detected: ${table}.${fk.from} references '${fk.table}' instead of 'credit_lots'`,
        );
      }
      // Catch any credit_lots backup/old/new names regardless of prefix
      if (fk.table !== 'credit_lots' && fk.table.includes('credit_lots')) {
        throw new Error(
          `FK corruption detected: ${table} references '${fk.table}' instead of 'credit_lots'`,
        );
      }
    }
  }
}

/**
 * Run migration forward.
 */
export function up(db: {
  exec(sql: string): void;
  pragma(sql: string): unknown;
  prepare(sql: string): { get(...args: unknown[]): unknown };
}): void {
  // Idempotency: skip if already migrated
  if (alreadyMigrated(db)) {
    return;
  }

  // Capture prior FK state to restore after migration
  const fkState = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
  const fkWasOn = Array.isArray(fkState) ? fkState[0]?.foreign_keys === 1 : false;

  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(CREDIT_LOTS_REBUILD_SQL);

    // Row-level FK integrity check
    const fkViolations = db.pragma('foreign_key_check') as unknown;
    if (Array.isArray(fkViolations) && fkViolations.length > 0) {
      throw new Error(`foreign_key_check failed: ${JSON.stringify(fkViolations)}`);
    }

    // Schema-level FK target verification
    verifyFkTargets(db);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.pragma(`foreign_keys = ${fkWasOn ? 'ON' : 'OFF'}`);
  }
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(CREDIT_LOTS_REBUILD_ROLLBACK_SQL);
}
