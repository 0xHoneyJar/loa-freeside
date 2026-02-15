/**
 * Operational Hardening Tests (Sprint 250, Task 6.6)
 *
 * Tests for:
 * - Rate limiting (within limit, exceeded, independent principals, Retry-After)
 * - Spending visibility (daily/weekly/monthly aggregates, account filter, top accounts)
 * - Lot invariant verification (valid data, violated data)
 *
 * Sprint refs: Task 6.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBillingRateLimiter } from '../../../src/packages/adapters/middleware/rate-limiter.js';
import type { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../../src/db/migrations/030_credit_ledger.js';

// =============================================================================
// Helpers
// =============================================================================

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return { headers: {}, query: {}, body: {}, ...overrides } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
  };
  return res;
}

// =============================================================================
// Rate Limiting (Task 6.1)
// =============================================================================

describe('Billing Rate Limiter', () => {
  it('allows requests within limit', () => {
    const limiter = createBillingRateLimiter({
      maxRequests: 5,
      keyExtractor: () => 'user-1',
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    // 5 requests should all pass
    for (let i = 0; i < 5; i++) {
      limiter(req, res, next);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('blocks requests exceeding limit with 429', () => {
    const limiter = createBillingRateLimiter({
      maxRequests: 3,
      keyExtractor: () => 'user-1',
      routeName: 'test',
    });

    const req = mockReq();
    const next = vi.fn();

    // First 3 pass
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      limiter(req, res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    // 4th is blocked
    const res = mockRes();
    limiter(req, res, next);
    expect(res.statusCode).toBe(429);
    expect(next).toHaveBeenCalledTimes(3); // not called again
    expect((res.body as any).error).toBe('Too Many Requests');
  });

  it('returns Retry-After header on 429', () => {
    const limiter = createBillingRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      keyExtractor: () => 'user-1',
    });

    const req = mockReq();
    const next = vi.fn();

    // First passes
    limiter(req, mockRes(), next);

    // Second is blocked
    const res = mockRes();
    limiter(req, res, next);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
    const retryAfter = parseInt(res.headers['Retry-After']!, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('independent principals have independent windows', () => {
    const limiter = createBillingRateLimiter({
      maxRequests: 2,
      keyExtractor: (req) => (req as any).principal,
    });

    const next = vi.fn();

    // User A: 2 requests (at limit)
    for (let i = 0; i < 2; i++) {
      limiter(mockReq({ principal: 'user-a' }), mockRes(), next);
    }

    // User B: 2 requests (at limit, independent)
    for (let i = 0; i < 2; i++) {
      limiter(mockReq({ principal: 'user-b' }), mockRes(), next);
    }

    expect(next).toHaveBeenCalledTimes(4); // All pass

    // User A: 3rd request blocked
    const resA = mockRes();
    limiter(mockReq({ principal: 'user-a' }), resA, next);
    expect(resA.statusCode).toBe(429);

    // User B: 3rd request also blocked
    const resB = mockRes();
    limiter(mockReq({ principal: 'user-b' }), resB, next);
    expect(resB.statusCode).toBe(429);

    expect(next).toHaveBeenCalledTimes(4); // No new calls
  });

  it('rejects unauthenticated requests with 401', () => {
    const limiter = createBillingRateLimiter({
      maxRequests: 10,
      keyExtractor: () => null, // unauthenticated
    });

    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Spending Visibility (Task 6.2)
// =============================================================================

describe('Spending Visibility — DB Queries', () => {
  function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    // Seed accounts
    db.prepare(`
      INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES ('acct-1', 'person', 'user-1', 1, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES ('acct-2', 'person', 'user-2', 1, datetime('now'), datetime('now'))
    `).run();
    return db;
  }

  function seedLedgerEntries(db: Database.Database) {
    // Seed finalize entries for spending analysis
    const stmt = db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type, amount_micro, created_at)
      VALUES (?, ?, 'general', ?, 'finalize', ?, datetime('now'))
    `);

    stmt.run('entry-1', 'acct-1', 1, '1000000'); // $1
    stmt.run('entry-2', 'acct-1', 2, '2000000'); // $2
    stmt.run('entry-3', 'acct-2', 1, '500000');  // $0.50
  }

  it('aggregates total spending across accounts', () => {
    const db = createTestDb();
    try {
      seedLedgerEntries(db);

      const today = new Date().toISOString().split('T')[0];
      const result = db.prepare(`
        SELECT COUNT(*) as tx_count, COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as total
        FROM credit_ledger
        WHERE entry_type IN ('consume', 'finalize')
          AND date(created_at) = ?
      `).get(today) as { tx_count: number; total: number };

      expect(result.tx_count).toBe(3);
      expect(result.total).toBe(3500000); // $3.50
    } finally {
      db.close();
    }
  });

  it('filters by account ID', () => {
    const db = createTestDb();
    try {
      seedLedgerEntries(db);

      const today = new Date().toISOString().split('T')[0];
      const result = db.prepare(`
        SELECT COUNT(*) as tx_count, COALESCE(SUM(CAST(amount_micro AS INTEGER)), 0) as total
        FROM credit_ledger
        WHERE entry_type IN ('consume', 'finalize')
          AND date(created_at) = ?
          AND account_id = ?
      `).get(today, 'acct-1') as { tx_count: number; total: number };

      expect(result.tx_count).toBe(2);
      expect(result.total).toBe(3000000); // $3
    } finally {
      db.close();
    }
  });

  it('returns top accounts sorted by spend', () => {
    const db = createTestDb();
    try {
      seedLedgerEntries(db);

      const today = new Date().toISOString().split('T')[0];
      const topAccounts = db.prepare(`
        SELECT account_id, SUM(CAST(amount_micro AS INTEGER)) as total_spent
        FROM credit_ledger
        WHERE entry_type IN ('consume', 'finalize')
          AND date(created_at) = ?
        GROUP BY account_id
        ORDER BY total_spent DESC
        LIMIT 10
      `).all(today) as Array<{ account_id: string; total_spent: number }>;

      expect(topAccounts).toHaveLength(2);
      expect(topAccounts[0]!.account_id).toBe('acct-1'); // $3 > $0.50
      expect(topAccounts[1]!.account_id).toBe('acct-2');
    } finally {
      db.close();
    }
  });
});

// =============================================================================
// Lot Invariant Verification (Task 6.5)
// =============================================================================

describe('Lot Invariant Verification', () => {
  function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    db.prepare(`
      INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES ('acct-1', 'person', 'user-1', 1, datetime('now'), datetime('now'))
    `).run();
    return db;
  }

  it('valid lots satisfy invariant', () => {
    const db = createTestDb();
    try {
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-1', 'general', 'deposit', 10000000, 5000000, 3000000, 2000000)
      `).run();

      const stmt = db.prepare(`
        SELECT id, original_micro, available_micro, reserved_micro, consumed_micro
        FROM credit_lots
      `);
      stmt.safeIntegers(true);
      const lots = stmt.all() as Array<{ id: string; original_micro: bigint; available_micro: bigint; reserved_micro: bigint; consumed_micro: bigint }>;

      for (const lot of lots) {
        const sum = lot.available_micro + lot.reserved_micro + lot.consumed_micro;
        expect(sum).toBe(lot.original_micro);
      }
    } finally {
      db.close();
    }
  });

  it('CHECK constraint rejects violated lot at insert', () => {
    const db = createTestDb();
    try {
      // available + reserved + consumed != original should fail
      expect(() => {
        db.prepare(`
          INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
          VALUES ('lot-bad', 'acct-1', 'general', 'deposit', 10000000, 5000000, 3000000, 3000000)
        `).run();
      }).toThrow(/CHECK constraint/);
    } finally {
      db.close();
    }
  });
});
