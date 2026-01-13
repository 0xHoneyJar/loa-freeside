/**
 * TracedDatabase Unit Tests
 *
 * Sprint 69: Unified Tracing & Resilience
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  createTracedDatabase,
  TracedDatabase,
  createTraceContext,
  runWithTrace,
  QueryStats,
} from '../../../../../src/packages/infrastructure/tracing';

describe('TracedDatabase', () => {
  let db: Database.Database;
  let tracedDb: TracedDatabase;

  beforeEach(() => {
    // Create an in-memory database for testing
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT
      )
    `);
    db.exec(`
      INSERT INTO users (id, name, email) VALUES
        (1, 'Alice', 'alice@test.com'),
        (2, 'Bob', 'bob@test.com'),
        (3, 'Charlie', 'charlie@test.com')
    `);
  });

  afterEach(() => {
    if (db.open) {
      db.close();
    }
  });

  describe('createTracedDatabase', () => {
    it('creates a traced database wrapper', () => {
      tracedDb = createTracedDatabase(db);

      expect(tracedDb).toBeInstanceOf(TracedDatabase);
      expect(tracedDb.open).toBe(true);
    });

    it('accepts custom options', () => {
      const onQueryStats = vi.fn();
      tracedDb = createTracedDatabase(db, {
        onQueryStats,
        includeTraceComments: false,
        slowQueryThreshold: 100,
      });

      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(onQueryStats).toHaveBeenCalled();
    });
  });

  describe('prepare / run', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('executes INSERT statement', () => {
      const stmt = tracedDb.prepare<[string, string], unknown>(
        'INSERT INTO users (name, email) VALUES (?, ?)'
      );
      const result = stmt.run('Dave', 'dave@test.com');

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(4);
    });

    it('executes UPDATE statement', () => {
      const stmt = tracedDb.prepare<[string, number], unknown>(
        'UPDATE users SET name = ? WHERE id = ?'
      );
      const result = stmt.run('Alice Updated', 1);

      expect(result.changes).toBe(1);
    });

    it('executes DELETE statement', () => {
      const stmt = tracedDb.prepare<[number], unknown>(
        'DELETE FROM users WHERE id = ?'
      );
      const result = stmt.run(3);

      expect(result.changes).toBe(1);
    });
  });

  describe('prepare / get', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('retrieves a single row', () => {
      const stmt = tracedDb.prepare<[number], { id: number; name: string; email: string }>(
        'SELECT * FROM users WHERE id = ?'
      );
      const row = stmt.get(1);

      expect(row).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@test.com',
      });
    });

    it('returns undefined for no match', () => {
      const stmt = tracedDb.prepare<[number], { id: number; name: string; email: string }>(
        'SELECT * FROM users WHERE id = ?'
      );
      const row = stmt.get(999);

      expect(row).toBeUndefined();
    });
  });

  describe('prepare / all', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('retrieves all rows', () => {
      const stmt = tracedDb.prepare<[], { id: number; name: string; email: string }>(
        'SELECT * FROM users ORDER BY id'
      );
      const rows = stmt.all();

      expect(rows).toHaveLength(3);
      expect(rows[0].name).toBe('Alice');
      expect(rows[2].name).toBe('Charlie');
    });

    it('returns empty array for no matches', () => {
      const stmt = tracedDb.prepare<[number], { id: number; name: string; email: string }>(
        'SELECT * FROM users WHERE id > ?'
      );
      const rows = stmt.all(999);

      expect(rows).toEqual([]);
    });
  });

  describe('trace context integration', () => {
    let queryStats: QueryStats[];

    beforeEach(() => {
      queryStats = [];
      tracedDb = createTracedDatabase(db, {
        onQueryStats: (stats) => queryStats.push(stats),
        includeTraceComments: true,
      });
    });

    it('includes trace ID in query stats when in trace context', () => {
      const ctx = createTraceContext({ tenantId: 'test-guild' });

      runWithTrace(ctx, () => {
        const stmt = tracedDb.prepare('SELECT * FROM users');
        stmt.all();
      });

      expect(queryStats).toHaveLength(1);
      expect(queryStats[0].traceId).toBe(ctx.traceId);
    });

    it('includes trace comment in SQL', () => {
      const ctx = createTraceContext({ tenantId: 'comment-test' });

      runWithTrace(ctx, () => {
        const stmt = tracedDb.prepare('SELECT * FROM users');
        stmt.all();
      });

      expect(queryStats[0].sql).toContain('traceId:');
      expect(queryStats[0].sql).toContain('tenantId: comment-test');
    });

    it('does not include trace info when not in context', () => {
      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(queryStats).toHaveLength(1);
      expect(queryStats[0].traceId).toBeUndefined();
      expect(queryStats[0].sql).not.toContain('traceId');
    });

    it('tracks query duration', () => {
      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(queryStats[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('tracks success status', () => {
      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(queryStats[0].success).toBe(true);
      expect(queryStats[0].error).toBeUndefined();
    });

    it('tracks error status on failure', () => {
      // SQLite validates SQL at prepare time, so we need to use a query that
      // fails at execution time instead (e.g., constraint violation)
      db.exec('CREATE TABLE unique_test (id INTEGER PRIMARY KEY, val TEXT UNIQUE)');
      db.exec("INSERT INTO unique_test (id, val) VALUES (1, 'taken')");

      const stmt = tracedDb.prepare<[number, string], unknown>(
        'INSERT INTO unique_test (id, val) VALUES (?, ?)'
      );

      expect(() => stmt.run(2, 'taken')).toThrow(); // Unique constraint violation

      expect(queryStats).toHaveLength(1);
      expect(queryStats[0].success).toBe(false);
      expect(queryStats[0].error).toContain('UNIQUE constraint');
    });
  });

  describe('includeTraceComments option', () => {
    it('does not add comments when disabled', () => {
      const queryStats: QueryStats[] = [];
      tracedDb = createTracedDatabase(db, {
        onQueryStats: (stats) => queryStats.push(stats),
        includeTraceComments: false,
      });

      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const stmt = tracedDb.prepare('SELECT * FROM users');
        stmt.all();
      });

      // Still tracks trace ID, but SQL doesn't have comment
      expect(queryStats[0].traceId).toBe(ctx.traceId);
      expect(queryStats[0].sql).not.toContain('/*');
    });
  });

  describe('slowQueryThreshold', () => {
    it('logs slow queries', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      tracedDb = createTracedDatabase(db, {
        slowQueryThreshold: 0.0001, // Very low threshold - any query should exceed this
      });

      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SLOW QUERY]')
      );

      consoleSpy.mockRestore();
    });

    it('does not log when below threshold', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      tracedDb = createTracedDatabase(db, {
        slowQueryThreshold: 10000, // 10 seconds - nothing is this slow
      });

      const stmt = tracedDb.prepare('SELECT * FROM users');
      stmt.all();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('transaction', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('wraps transaction with tracing', () => {
      const insertMany = tracedDb.transaction((users: Array<{ name: string; email: string }>) => {
        const stmt = tracedDb.prepare<[string, string], unknown>(
          'INSERT INTO users (name, email) VALUES (?, ?)'
        );
        for (const user of users) {
          stmt.run(user.name, user.email);
        }
        return users.length;
      });

      const count = insertMany([
        { name: 'Dave', email: 'dave@test.com' },
        { name: 'Eve', email: 'eve@test.com' },
      ]);

      expect(count).toBe(2);

      // Verify data was inserted
      const allUsers = db.prepare('SELECT * FROM users').all();
      expect(allUsers).toHaveLength(5);
    });

    it('rolls back transaction on error', () => {
      const insertMany = tracedDb.transaction((users: Array<{ name: string; email: string }>) => {
        const stmt = tracedDb.prepare<[string, string], unknown>(
          'INSERT INTO users (name, email) VALUES (?, ?)'
        );
        for (const user of users) {
          stmt.run(user.name, user.email);
        }
        throw new Error('Rollback test');
      });

      expect(() =>
        insertMany([
          { name: 'Dave', email: 'dave@test.com' },
          { name: 'Eve', email: 'eve@test.com' },
        ])
      ).toThrow('Rollback test');

      // Verify no data was inserted
      const allUsers = db.prepare('SELECT * FROM users').all();
      expect(allUsers).toHaveLength(3);
    });
  });

  describe('exec', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('executes raw SQL', () => {
      tracedDb.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY)');

      // Verify table was created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('returns this for chaining', () => {
      const result = tracedDb.exec('SELECT 1');
      expect(result).toBe(tracedDb);
    });
  });

  describe('underlying', () => {
    it('provides access to raw database', () => {
      tracedDb = createTracedDatabase(db);

      expect(tracedDb.underlying).toBe(db);
    });
  });

  describe('close', () => {
    it('closes the database', () => {
      tracedDb = createTracedDatabase(db);

      expect(tracedDb.open).toBe(true);
      tracedDb.close();
      expect(tracedDb.open).toBe(false);
    });
  });

  describe('statement properties', () => {
    beforeEach(() => {
      tracedDb = createTracedDatabase(db);
    });

    it('exposes readonly property', () => {
      const selectStmt = tracedDb.prepare('SELECT * FROM users');
      const insertStmt = tracedDb.prepare<[string, string], unknown>(
        'INSERT INTO users (name, email) VALUES (?, ?)'
      );

      expect(selectStmt.readonly).toBe(true);
      expect(insertStmt.readonly).toBe(false);
    });

    it('exposes columns property', () => {
      const stmt = tracedDb.prepare('SELECT id, name FROM users');
      const columns = stmt.columns();

      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('id');
      expect(columns[1].name).toBe('name');
    });

    it('exposes source property', () => {
      const stmt = tracedDb.prepare('SELECT * FROM users');

      expect(stmt.source).toContain('SELECT * FROM users');
    });
  });
});
