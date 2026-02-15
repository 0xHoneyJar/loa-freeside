/**
 * Atomic Counter Tests
 *
 * Unit tests for ICounterBackend implementations and factory.
 * - InMemory backend
 * - SQLite backend (in-memory DB)
 * - Redis backend (mocked)
 * - Factory fallback chain
 * - Concurrent increment correctness
 *
 * Sprint refs: Task 2.7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { InMemoryCounterBackend } from '../../../src/packages/adapters/billing/counters/InMemoryCounterBackend.js';
import { SqliteCounterBackend } from '../../../src/packages/adapters/billing/counters/SqliteCounterBackend.js';
import { RedisCounterBackend } from '../../../src/packages/adapters/billing/counters/RedisCounterBackend.js';
import { createAtomicCounter } from '../../../src/packages/core/protocol/atomic-counter.js';
import type { AgentRedisClient } from '../../../src/packages/adapters/billing/AgentWalletPrototype.js';
import { DAILY_SPENDING_SCHEMA_SQL } from '../../../src/db/migrations/036_daily_agent_spending.js';

// =============================================================================
// InMemory Backend
// =============================================================================

describe('InMemoryCounterBackend', () => {
  let backend: InMemoryCounterBackend;

  beforeEach(() => {
    backend = new InMemoryCounterBackend();
  });

  it('returns 0n for unknown key', async () => {
    expect(await backend.get('unknown')).toBe(0n);
  });

  it('increments and returns new total', async () => {
    expect(await backend.increment('k', 100n)).toBe(100n);
    expect(await backend.increment('k', 50n)).toBe(150n);
    expect(await backend.get('k')).toBe(150n);
  });

  it('reset clears value', async () => {
    await backend.increment('k', 100n);
    await backend.reset('k');
    expect(await backend.get('k')).toBe(0n);
  });
});

// =============================================================================
// SQLite Backend
// =============================================================================

describe('SqliteCounterBackend', () => {
  let db: Database.Database;
  let backend: SqliteCounterBackend;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(DAILY_SPENDING_SCHEMA_SQL);
    // Create a dummy credit account for FK reference
    db.exec(`
      CREATE TABLE IF NOT EXISTS credit_accounts (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO credit_accounts (id, entity_type, entity_id)
      VALUES ('acct-1', 'agent', 'test-agent');
    `);
    backend = new SqliteCounterBackend(db);
  });

  it('returns 0n for unknown key', async () => {
    expect(await backend.get('acct-1:2026-02-15')).toBe(0n);
  });

  it('increments atomically via UPSERT', async () => {
    expect(await backend.increment('acct-1:2026-02-15', 100n)).toBe(100n);
    expect(await backend.increment('acct-1:2026-02-15', 50n)).toBe(150n);
    expect(await backend.get('acct-1:2026-02-15')).toBe(150n);
  });

  it('reset deletes the row', async () => {
    await backend.increment('acct-1:2026-02-15', 100n);
    await backend.reset('acct-1:2026-02-15');
    expect(await backend.get('acct-1:2026-02-15')).toBe(0n);
  });
});

// =============================================================================
// Redis Backend (Mocked)
// =============================================================================

describe('RedisCounterBackend', () => {
  function createMockRedis(): AgentRedisClient & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
      setex: async (key: string, _seconds: number, value: string) => { store.set(key, value); return 'OK'; },
      expire: async (_key: string, _seconds: number) => 1,
      incrby: async (key: string, increment: number) => {
        const current = parseInt(store.get(key) ?? '0', 10);
        const newVal = current + increment;
        store.set(key, String(newVal));
        return newVal;
      },
      eval: async (_script: string, _numkeys: number, ...args: (string | number)[]) => {
        const key = String(args[0]);
        const increment = Number(args[1]);
        const current = parseInt(store.get(key) ?? '0', 10);
        const newVal = current + increment;
        store.set(key, String(newVal));
        return newVal;
      },
    };
  }

  it('increments via Lua eval when available', async () => {
    const redis = createMockRedis();
    const backend = new RedisCounterBackend(redis, 'test:');

    expect(await backend.increment('k', 100n)).toBe(100n);
    expect(await backend.increment('k', 50n)).toBe(150n);
    expect(await backend.get('k')).toBe(150n);
  });

  it('throws on cache miss (enabling fallback chain)', async () => {
    const redis = createMockRedis();
    const backend = new RedisCounterBackend(redis, 'test:');

    await expect(backend.get('nonexistent')).rejects.toThrow('Redis cache miss');
  });

  it('falls back to incrby when eval is not available', async () => {
    const redis = createMockRedis();
    delete (redis as any).eval;
    const backend = new RedisCounterBackend(redis, 'test:');

    expect(await backend.increment('k', 200n)).toBe(200n);
    expect(await backend.get('k')).toBe(200n);
  });

  it('reset sets key to 0', async () => {
    const redis = createMockRedis();
    const backend = new RedisCounterBackend(redis, 'test:');

    await backend.increment('k', 100n);
    await backend.reset('k');
    expect(await backend.get('k')).toBe(0n);
  });
});

// =============================================================================
// Factory: createAtomicCounter
// =============================================================================

describe('createAtomicCounter', () => {
  it('primary-only configuration', async () => {
    const inMemory = new InMemoryCounterBackend();
    const counter = createAtomicCounter({ primary: inMemory });

    expect(await counter.increment('k', 10n)).toBe(10n);
    expect(await counter.get('k')).toBe(10n);
  });

  it('falls back to fallback when primary throws', async () => {
    const failing = {
      increment: async () => { throw new Error('fail'); },
      get: async () => { throw new Error('fail'); },
      reset: async () => { throw new Error('fail'); },
    };
    const fallback = new InMemoryCounterBackend();
    const counter = createAtomicCounter({ primary: failing, fallback });

    expect(await counter.increment('k', 10n)).toBe(10n);
    expect(await counter.get('k')).toBe(10n);
  });

  it('falls back to bootstrap when primary and fallback both throw', async () => {
    const failing = {
      increment: async () => { throw new Error('fail'); },
      get: async () => { throw new Error('fail'); },
      reset: async () => { throw new Error('fail'); },
    };
    const bootstrap = new InMemoryCounterBackend();
    const counter = createAtomicCounter({ primary: failing, fallback: failing, bootstrap });

    expect(await counter.increment('k', 5n)).toBe(5n);
    expect(await counter.get('k')).toBe(5n);
  });

  it('throws when all backends fail', async () => {
    const failing = {
      increment: async () => { throw new Error('all dead'); },
      get: async () => { throw new Error('all dead'); },
      reset: async () => {},
    };
    const counter = createAtomicCounter({ primary: failing });

    await expect(counter.increment('k', 1n)).rejects.toThrow('all dead');
  });

  it('reset is best-effort across all backends', async () => {
    const a = new InMemoryCounterBackend();
    const b = new InMemoryCounterBackend();
    const counter = createAtomicCounter({ primary: a, fallback: b });

    await a.increment('k', 10n);
    await b.increment('k', 20n);

    await counter.reset('k');
    expect(await a.get('k')).toBe(0n);
    expect(await b.get('k')).toBe(0n);
  });
});

// =============================================================================
// Concurrent Increments
// =============================================================================

describe('Concurrent increment correctness', () => {
  it('10 parallel increments produce correct sum', async () => {
    const backend = new InMemoryCounterBackend();
    const counter = createAtomicCounter({ primary: backend });

    const promises = Array.from({ length: 10 }, (_, i) =>
      counter.increment('concurrent', BigInt(i + 1))
    );
    await Promise.all(promises);

    // Sum of 1..10 = 55
    expect(await counter.get('concurrent')).toBe(55n);
  });
});
