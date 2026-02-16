/**
 * EntryType TS/DB Consistency Tests (Task 1.3, Sprint 295)
 *
 * Verifies that the TypeScript ENTRY_TYPES const array is consistent with
 * the SQLite CHECK constraints defined in migrations 030+056.
 *
 * Uses sqlite_master introspection with **semantic set-based comparison**
 * (not string-exact) to tolerate formatting/quoting differences across
 * SQLite versions.
 *
 * SDD refs: §3.5.3 sqlite_master introspection
 * Sprint refs: Task 1.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CREDIT_LEDGER_REBUILD_SQL, PEER_TRANSFERS_SQL } from '../../src/db/migrations/056_peer_transfers.js';
import { CREDIT_LOTS_REBUILD_SQL } from '../../src/db/migrations/060_credit_lots_tba_source.js';
import {
  ENTRY_TYPES,
  SOURCE_TYPES,
  ENTITY_TYPES,
  buildEntryTypeCheck,
  buildSourceTypeCheck,
} from '../../src/packages/core/protocol/billing-types.js';

// =============================================================================
// Helpers
// =============================================================================

let db: Database.Database;

/**
 * Create a fresh in-memory DB with all relevant migrations applied.
 */
function createFullyMigratedDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');

  // Run all migrations with foreign_keys OFF to avoid stale FK references
  // during table rebuilds (SQLite standard pattern).
  testDb.pragma('foreign_keys = OFF');

  // Migration 030: Base schema
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Migration 056: Rebuild credit_ledger with transfer_out/transfer_in
  testDb.exec(PEER_TRANSFERS_SQL);
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);

  // Migration 060: Rebuild credit_lots with tba_deposit
  testDb.exec(CREDIT_LOTS_REBUILD_SQL);

  // NOTE: foreign_keys intentionally left OFF. This test suite validates
  // CHECK constraints (entry_type/source_type/entity_type), not FK integrity.
  // SQLite RENAME TABLE mutates FK references, making them stale after
  // table-rebuild migrations — irrelevant to our CHECK-constraint scope.

  return testDb;
}

/**
 * Extract the allowed literal set from a CHECK expression in sqlite_master.
 * Parses values from patterns like: column IN ('a', 'b', 'c')
 * Returns a sorted, deduplicated array of string literals.
 */
function extractCheckValues(tableSql: string, column: string): string[] {
  // Match the CHECK constraint for the specified column
  // Pattern: column ... IN ( 'val1', 'val2', ... )
  const checkPattern = new RegExp(
    `${column}\\s+IN\\s*\\(([^)]+)\\)`,
    'i',
  );
  const match = tableSql.match(checkPattern);
  if (!match) {
    throw new Error(`No CHECK constraint found for column "${column}" in SQL:\n${tableSql}`);
  }

  // Extract individual quoted values, strip whitespace and quotes
  const rawValues = match[1];
  const values = rawValues
    .split(',')
    .map(v => v.trim().replace(/^'|'$/g, ''))
    .filter(v => v.length > 0);

  // Deduplicate and sort for set comparison
  return [...new Set(values)].sort();
}

/**
 * Get the CREATE TABLE SQL for a table from sqlite_master.
 */
function getTableSql(database: Database.Database, tableName: string): string {
  const row = database.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
  ).get(tableName) as { sql: string } | undefined;

  if (!row) {
    throw new Error(`Table "${tableName}" not found in sqlite_master`);
  }
  return row.sql;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createFullyMigratedDb();
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('EntryType TS/DB Consistency', () => {
  // ---------------------------------------------------------------------------
  // entry_type: credit_ledger
  // ---------------------------------------------------------------------------

  describe('credit_ledger.entry_type CHECK', () => {
    it('sqlite_master CHECK values match ENTRY_TYPES (set-based comparison)', () => {
      const tableSql = getTableSql(db, 'credit_ledger');
      const dbValues = extractCheckValues(tableSql, 'entry_type');
      const tsValues = [...ENTRY_TYPES].sort();

      expect(dbValues).toEqual(tsValues);
    });

    it('buildEntryTypeCheck() contains all ENTRY_TYPES literals', () => {
      const checkExpr = buildEntryTypeCheck('entry_type');

      for (const entryType of ENTRY_TYPES) {
        expect(checkExpr).toContain(`'${entryType}'`);
      }
    });

    it('buildEntryTypeCheck(column) references the provided column name', () => {
      const customColumn = 'my_custom_column';
      const checkExpr = buildEntryTypeCheck(customColumn);

      expect(checkExpr).toMatch(new RegExp(`^${customColumn}\\s+IN\\s*\\(`));
    });

    it('invalid entry type rejected by DB CHECK constraint', () => {
      // Seed a minimal account first
      db.exec(`
        INSERT INTO credit_accounts (id, entity_type, entity_id, version)
        VALUES ('acct-1', 'person', 'user-1', 0)
      `);

      // Attempt to insert with an invalid entry_type
      expect(() => {
        db.exec(`
          INSERT INTO credit_ledger (id, account_id, entry_seq, entry_type, amount_micro)
          VALUES ('entry-1', 'acct-1', 1, 'INVALID_TYPE', 100)
        `);
      }).toThrow();
    });

    it('all valid entry types accepted by DB CHECK constraint', () => {
      db.exec(`
        INSERT INTO credit_accounts (id, entity_type, entity_id, version)
        VALUES ('acct-1', 'person', 'user-1', 0)
      `);

      let seq = 1;
      for (const entryType of ENTRY_TYPES) {
        expect(() => {
          db.exec(`
            INSERT INTO credit_ledger (id, account_id, entry_seq, entry_type, amount_micro)
            VALUES ('entry-${entryType}', 'acct-1', ${seq++}, '${entryType}', 100)
          `);
        }).not.toThrow();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // source_type: credit_lots
  // ---------------------------------------------------------------------------

  describe('credit_lots.source_type CHECK', () => {
    it('sqlite_master CHECK values match SOURCE_TYPES (set-based comparison)', () => {
      const tableSql = getTableSql(db, 'credit_lots');
      const dbValues = extractCheckValues(tableSql, 'source_type');
      const tsValues = [...SOURCE_TYPES].sort();

      expect(dbValues).toEqual(tsValues);
    });

    it('buildSourceTypeCheck() contains all SOURCE_TYPES literals', () => {
      const checkExpr = buildSourceTypeCheck('source_type');

      for (const sourceType of SOURCE_TYPES) {
        expect(checkExpr).toContain(`'${sourceType}'`);
      }
    });

    it('buildSourceTypeCheck(column) references the provided column name', () => {
      const customColumn = 'my_source_col';
      const checkExpr = buildSourceTypeCheck(customColumn);

      expect(checkExpr).toMatch(new RegExp(`^${customColumn}\\s+IN\\s*\\(`));
    });
  });

  // ---------------------------------------------------------------------------
  // entity_type: credit_accounts
  // ---------------------------------------------------------------------------

  describe('credit_accounts.entity_type CHECK', () => {
    it('sqlite_master CHECK values match ENTITY_TYPES (set-based comparison)', () => {
      const tableSql = getTableSql(db, 'credit_accounts');
      const dbValues = extractCheckValues(tableSql, 'entity_type');
      const tsValues = [...ENTITY_TYPES].sort();

      expect(dbValues).toEqual(tsValues);
    });
  });
});
