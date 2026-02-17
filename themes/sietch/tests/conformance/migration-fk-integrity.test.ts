/**
 * Migration FK Integrity Conformance Test (Sprint 299, Task 5.3)
 *
 * Verifies that running all credit-ledger-related migrations in production
 * order leaves the database with:
 *   1. No row-level FK violations (PRAGMA foreign_key_check)
 *   2. No schema-level FK target corruption (PRAGMA foreign_key_list)
 *   3. All expected indexes present on credit_lots
 *
 * This is a regression test for the Migration 060 FK corruption bug where
 * ALTER TABLE RENAME caused SQLite to auto-update FK references in dependent
 * tables to point at a backup table name. When the backup was dropped, those
 * FKs became dangling.
 *
 * SDD refs: §3.2 credit_lots, §3.5.3 sqlite_master introspection
 * Sprint refs: Sprint 299 Task 5.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Migrations in production order
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../src/db/migrations/056_peer_transfers.js';
import { TBA_DEPOSITS_SQL } from '../../src/db/migrations/057_tba_deposits.js';
import { AGENT_GOVERNANCE_SQL } from '../../src/db/migrations/058_agent_governance.js';
import { CREDIT_LOTS_REBUILD_SQL } from '../../src/db/migrations/060_credit_lots_tba_source.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;

/**
 * Run all credit-ledger-related migrations in production order.
 * This mirrors what connection.ts + later migrations do at startup.
 *
 * FK enforcement is ON during this test (unlike entry-types-consistency.test.ts)
 * because the entire point is verifying FK integrity survives the rebuild.
 */
function createFullyMigratedDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Migration 030: Base credit ledger schema
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Migration 054: Economic events (no table rebuild)
  testDb.exec(ECONOMIC_EVENTS_SQL);

  // Migration 056: Peer transfers + credit_ledger rebuild (adds transfer_out/transfer_in)
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);
  testDb.pragma('foreign_keys = ON');
  testDb.exec(PEER_TRANSFERS_SQL);

  // Migration 057: TBA deposits (no table rebuild)
  testDb.exec(TBA_DEPOSITS_SQL);

  // Migration 058: Agent governance (no table rebuild)
  testDb.exec(AGENT_GOVERNANCE_SQL);

  // Migration 060: credit_lots rebuild (adds tba_deposit source_type)
  // This is the migration that previously caused FK corruption.
  // The safe CREATE→COPY→SWAP→DROP pattern should preserve FK targets.
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LOTS_REBUILD_SQL);
  testDb.pragma('foreign_keys = ON');

  return testDb;
}

/** Tables that have FK references to credit_lots */
const FK_DEPENDENT_TABLES = ['credit_ledger', 'reservation_lots', 'credit_debts'];

/** Columns that should reference credit_lots */
const LOT_FK_COLUMNS = new Set(['lot_id', 'source_lot_id']);

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

describe('Migration FK Integrity (regression: migration 060 FK corruption)', () => {

  // ── Schema-level FK target verification ──────────────────────────────

  describe('schema-level FK targets', () => {
    it('should have all lot-related FKs pointing to credit_lots (not backup/old/new)', () => {
      for (const table of FK_DEPENDENT_TABLES) {
        const fkList = db.pragma(`foreign_key_list(${table})`) as Array<{
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
        }>;

        for (const fk of fkList) {
          if (LOT_FK_COLUMNS.has(fk.from)) {
            expect(fk.table, `${table}.${fk.from} FK target`).toBe('credit_lots');
          }
        }
      }
    });

    it('should have no FK references to any credit_lots variant name', () => {
      for (const table of FK_DEPENDENT_TABLES) {
        const fkList = db.pragma(`foreign_key_list(${table})`) as Array<{
          table: string;
          from: string;
        }>;

        for (const fk of fkList) {
          if (fk.table !== 'credit_lots' && fk.table.includes('credit_lots')) {
            throw new Error(
              `FK corruption: ${table}.${fk.from} references '${fk.table}' instead of 'credit_lots'`,
            );
          }
        }
      }
    });

    it('should have credit_ledger.lot_id FK pointing to credit_lots(id)', () => {
      const fkList = db.pragma('foreign_key_list(credit_ledger)') as Array<{
        table: string;
        from: string;
        to: string;
      }>;

      const lotFk = fkList.find((fk) => fk.from === 'lot_id');
      expect(lotFk, 'credit_ledger should have lot_id FK').toBeDefined();
      expect(lotFk!.table).toBe('credit_lots');
      expect(lotFk!.to).toBe('id');
    });

    it('should have reservation_lots.lot_id FK pointing to credit_lots(id)', () => {
      const fkList = db.pragma('foreign_key_list(reservation_lots)') as Array<{
        table: string;
        from: string;
        to: string;
      }>;

      const lotFk = fkList.find((fk) => fk.from === 'lot_id');
      expect(lotFk, 'reservation_lots should have lot_id FK').toBeDefined();
      expect(lotFk!.table).toBe('credit_lots');
      expect(lotFk!.to).toBe('id');
    });

    it('should have credit_debts.source_lot_id FK pointing to credit_lots(id)', () => {
      const fkList = db.pragma('foreign_key_list(credit_debts)') as Array<{
        table: string;
        from: string;
        to: string;
      }>;

      const lotFk = fkList.find((fk) => fk.from === 'source_lot_id');
      expect(lotFk, 'credit_debts should have source_lot_id FK').toBeDefined();
      expect(lotFk!.table).toBe('credit_lots');
      expect(lotFk!.to).toBe('id');
    });
  });

  // ── Row-level FK integrity ───────────────────────────────────────────

  describe('row-level FK integrity', () => {
    it('should pass PRAGMA foreign_key_check on empty database', () => {
      const violations = db.pragma('foreign_key_check') as unknown[];
      expect(violations).toHaveLength(0);
    });

    it('should pass PRAGMA foreign_key_check after seeding data', () => {
      // Seed a minimal dataset through the FK chain.
      // Column names match credit_ledger after migration 056 rebuild.
      db.exec(`
        INSERT INTO credit_accounts (id, entity_type, entity_id)
        VALUES ('acct-1', 'person', 'user-1');

        INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-1', 'general', 'deposit', 'src-1', 1000000, 1000000, 0, 0);

        INSERT INTO credit_ledger (id, account_id, pool_id, entry_type, amount_micro, lot_id, entry_seq, description)
        VALUES ('entry-1', 'acct-1', 'general', 'deposit', 1000000, 'lot-1', 1, 'test deposit');

        INSERT INTO credit_reservations (id, account_id, pool_id, total_reserved_micro, status, billing_mode, expires_at)
        VALUES ('res-1', 'acct-1', 'general', 500000, 'pending', 'live', datetime('now', '+1 hour'));

        INSERT INTO reservation_lots (reservation_id, lot_id, reserved_micro)
        VALUES ('res-1', 'lot-1', 500000);

        INSERT INTO credit_debts (id, account_id, pool_id, debt_micro, source_lot_id)
        VALUES ('debt-1', 'acct-1', 'general', 100000, 'lot-1');

        UPDATE credit_lots SET available_micro = 400000, reserved_micro = 500000, consumed_micro = 100000
        WHERE id = 'lot-1';
      `);

      const violations = db.pragma('foreign_key_check') as unknown[];
      expect(violations).toHaveLength(0);
    });
  });

  // ── Index verification ───────────────────────────────────────────────

  describe('credit_lots indexes', () => {
    it('should have idx_credit_lots_redemption on the new table', () => {
      const indexes = db.pragma('index_list(credit_lots)') as Array<{
        name: string;
        unique: number;
        partial: number;
      }>;

      const redemptionIdx = indexes.find((idx) => idx.name === 'idx_credit_lots_redemption');
      expect(redemptionIdx, 'idx_credit_lots_redemption should exist').toBeDefined();
    });

    it('should have idx_credit_lots_account on the new table', () => {
      const indexes = db.pragma('index_list(credit_lots)') as Array<{
        name: string;
        unique: number;
      }>;

      const accountIdx = indexes.find((idx) => idx.name === 'idx_credit_lots_account');
      expect(accountIdx, 'idx_credit_lots_account should exist').toBeDefined();
    });

    it('should have idx_credit_lots_source (unique) on the new table', () => {
      const indexes = db.pragma('index_list(credit_lots)') as Array<{
        name: string;
        unique: number;
      }>;

      const sourceIdx = indexes.find((idx) => idx.name === 'idx_credit_lots_source');
      expect(sourceIdx, 'idx_credit_lots_source should exist').toBeDefined();
      expect(sourceIdx!.unique).toBe(1);
    });
  });

  // ── No leftover temp tables ──────────────────────────────────────────

  describe('cleanup verification', () => {
    it('should not leave _credit_lots_old or _credit_lots_new tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%credit_lots%'")
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('credit_lots');
      expect(tableNames).not.toContain('_credit_lots_old');
      expect(tableNames).not.toContain('_credit_lots_new');
      expect(tableNames).not.toContain('_credit_lots_058_backup');
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────

  describe('migration 060 idempotency', () => {
    it('should be safe to run CREDIT_LOTS_REBUILD_SQL twice', () => {
      // The migration already ran in createFullyMigratedDb().
      // Running it again should succeed without error.
      db.pragma('foreign_keys = OFF');
      expect(() => db.exec(CREDIT_LOTS_REBUILD_SQL)).not.toThrow();
      db.pragma('foreign_keys = ON');

      // FK integrity should still hold
      const violations = db.pragma('foreign_key_check') as unknown[];
      expect(violations).toHaveLength(0);
    });
  });

  // ── CHECK constraint verification ────────────────────────────────────

  describe('credit_lots CHECK constraints', () => {
    it('should accept tba_deposit as source_type', () => {
      db.exec(`
        INSERT INTO credit_accounts (id, entity_type, entity_id)
        VALUES ('acct-tba', 'agent', 'agent-1');
      `);

      expect(() => {
        db.exec(`
          INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id, original_micro, available_micro, reserved_micro, consumed_micro)
          VALUES ('lot-tba', 'acct-tba', 'general', 'tba_deposit', 'tba-src-1', 500000, 500000, 0, 0);
        `);
      }).not.toThrow();
    });

    it('should reject invalid source_type values', () => {
      db.exec(`
        INSERT INTO credit_accounts (id, entity_type, entity_id)
        VALUES ('acct-bad', 'person', 'user-bad');
      `);

      expect(() => {
        db.exec(`
          INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id, original_micro, available_micro, reserved_micro, consumed_micro)
          VALUES ('lot-bad', 'acct-bad', 'general', 'invalid_type', 'bad-src', 100000, 100000, 0, 0);
        `);
      }).toThrow();
    });
  });
});
