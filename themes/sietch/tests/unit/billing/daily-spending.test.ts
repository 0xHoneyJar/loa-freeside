/**
 * Daily Spending Counter Tests (Sprint 241, Task 3.5)
 *
 * Covers: SQLite UPSERT, Redis INCRBY fallback chain, cap enforcement at
 * finalize, 3-layer read (Redis → SQLite → in-memory), sync vs async budget.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import {
  AgentWalletPrototype,
  type AgentRedisClient,
  type AgentWalletConfig,
  type AgentWallet,
} from '../../../src/packages/adapters/billing/AgentWalletPrototype.js';

import type {
  ICreditLedgerService,
  CreditAccount,
  BalanceResult,
  ReservationResult,
  FinalizeResult,
} from '../../../src/packages/core/ports/ICreditLedgerService.js';

// Migrations
import { up as upCreditLedger } from '../../../src/db/migrations/030_credit_ledger.js';
import { up as upDailySpending } from '../../../src/db/migrations/036_daily_agent_spending.js';

// =============================================================================
// Mock Ledger
// =============================================================================

function createMockLedger(): ICreditLedgerService {
  const accounts = new Map<string, CreditAccount>();
  let balance = 100_000_000n; // 100 USD in micro-USD

  return {
    async getOrCreateAccount(entityType, entityId) {
      const key = `${entityType}:${entityId}`;
      if (!accounts.has(key)) {
        accounts.set(key, {
          id: `acct-${randomUUID().slice(0, 8)}`,
          entityType,
          entityId,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      return accounts.get(key)!;
    },

    async getBalance(accountId) {
      return {
        accountId,
        poolId: null,
        availableMicro: balance,
        reservedMicro: 0n,
      };
    },

    async mintLot(accountId, amountMicro, _sourceType, _options) {
      balance += amountMicro;
      return {
        id: `lot-${randomUUID().slice(0, 8)}`,
        accountId,
        poolId: null,
        sourceType: 'deposit',
        sourceId: null,
        originalMicro: amountMicro,
        availableMicro: amountMicro,
        reservedMicro: 0n,
        consumedMicro: 0n,
        expiresAt: null,
        createdAt: new Date().toISOString(),
      };
    },

    async reserve(accountId, _poolId, amountMicro, _options) {
      return {
        reservationId: `rsv-${randomUUID().slice(0, 8)}`,
        accountId,
        poolId: null,
        totalReservedMicro: amountMicro,
        status: 'pending' as const,
        billingMode: 'live' as const,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        lotAllocations: [],
      };
    },

    async finalize(_reservationId, actualCostMicro) {
      balance -= actualCostMicro!;
      return {
        reservationId: _reservationId,
        accountId: 'test',
        actualCostMicro: actualCostMicro!,
        surplusReleasedMicro: 0n,
        overrunMicro: 0n,
        finalizedAt: new Date().toISOString(),
      };
    },

    // Stubs for unused methods
    async release() { return {} as any; },
    async getHistory() { return []; },
    async getLots() { return []; },
    async getAccount() { return null as any; },
  } as ICreditLedgerService;
}

// =============================================================================
// Mock Redis
// =============================================================================

function createMockRedis(): AgentRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  return {
    store,
    async get(key) { return store.get(key) ?? null; },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async setex(key, _seconds, value) { store.set(key, value); return 'OK'; },
    async expire(key, seconds) { ttls.set(key, seconds); return 1; },
    async incrby(key, increment) {
      const current = BigInt(store.get(key) ?? '0');
      const inc = typeof increment === 'bigint' ? increment : BigInt(increment);
      const newVal = current + inc;
      store.set(key, newVal.toString());
      return Number(newVal);
    },
    async eval(_script, _numkeys, ...args) {
      // Simulate Lua: INCRBY + EXPIREAT on first write
      const key = String(args[0]);
      const inc = typeof args[1] === 'bigint' ? (args[1] as bigint) : BigInt(args[1]);
      const current = BigInt(store.get(key) ?? '0');
      const newVal = current + inc;
      store.set(key, newVal.toString());
      return Number(newVal);
    },
  };
}

/** Redis that throws on all operations */
function createBrokenRedis(): AgentRedisClient {
  return {
    async get() { throw new Error('Redis connection refused'); },
    async set() { throw new Error('Redis connection refused'); },
    async setex() { throw new Error('Redis connection refused'); },
    async expire() { throw new Error('Redis connection refused'); },
    async incrby() { throw new Error('Redis connection refused'); },
    async eval() { throw new Error('Redis connection refused'); },
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_CONFIG: AgentWalletConfig = {
  tokenId: 'test-nft-001',
  dailyCapMicro: 10_000_000n, // 10 USD
  refillThresholdMicro: 1_000_000n, // 1 USD
  ownerAddress: '0xTestOwner',
};

let db: Database.Database;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  upCreditLedger(testDb);
  upDailySpending(testDb);
  return testDb;
}

async function createTestWallet(
  prototype: AgentWalletPrototype,
  config?: Partial<AgentWalletConfig>,
  testDb?: Database.Database | null,
): Promise<AgentWallet> {
  const wallet = await prototype.createAgentWallet({ ...DEFAULT_CONFIG, ...config });
  // Seed credit_accounts so FK constraint on daily_agent_spending passes
  if (testDb) {
    testDb.prepare(`
      INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES (?, 'agent', ?, 1, datetime('now'), datetime('now'))
    `).run(wallet.account.id, wallet.account.entityId);
  }
  return wallet;
}

// =============================================================================
// Tests
// =============================================================================

describe('daily spending counter', () => {
  beforeEach(() => {
    db = setupDb();
  });

  // ---------------------------------------------------------------------------
  // SQLite UPSERT Tests
  // ---------------------------------------------------------------------------

  describe('SQLite persistence', () => {
    it('records daily spending in SQLite after finalize', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, db);
      const wallet = await createTestWallet(proto, undefined, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-001');

      const rsv = await proto.reserveForInference(wallet, 1_000_000n);
      await proto.finalizeInference(wallet, rsv.reservationId, 800_000n);

      // Verify SQLite has the row
      const today = new Date().toISOString().slice(0, 10);
      const row = db.prepare(
        `SELECT total_spent_micro FROM daily_agent_spending
         WHERE agent_account_id = ? AND spending_date = ?`
      ).get(wallet.account.id, today) as { total_spent_micro: number } | undefined;

      expect(row).toBeDefined();
      expect(BigInt(row!.total_spent_micro)).toBe(800_000n);
    });

    it('accumulates across multiple finalizations (UPSERT)', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, db);
      const wallet = await createTestWallet(proto, undefined, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-002');

      // Finalize 3 times
      for (let i = 0; i < 3; i++) {
        const rsv = await proto.reserveForInference(wallet, 1_000_000n);
        await proto.finalizeInference(wallet, rsv.reservationId, 500_000n);
      }

      const today = new Date().toISOString().slice(0, 10);
      const row = db.prepare(
        `SELECT total_spent_micro FROM daily_agent_spending
         WHERE agent_account_id = ? AND spending_date = ?`
      ).get(wallet.account.id, today) as { total_spent_micro: number };

      // 500_000 × 3 = 1_500_000
      expect(BigInt(row.total_spent_micro)).toBe(1_500_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // Redis INCRBY Fallback Chain
  // ---------------------------------------------------------------------------

  describe('Redis INCRBY', () => {
    it('uses Lua eval for atomic INCRBY + EXPIREAT', async () => {
      const ledger = createMockLedger();
      const redis = createMockRedis();
      const proto = new AgentWalletPrototype(ledger, redis, db);
      const wallet = await createTestWallet(proto, undefined, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-003');
      const rsv = await proto.reserveForInference(wallet, 2_000_000n);
      await proto.finalizeInference(wallet, rsv.reservationId, 1_500_000n);

      // Redis should have the spending cached
      const today = new Date().toISOString().slice(0, 10);
      const redisKey = `billing:agent:daily:${wallet.account.id}:${today}`;
      const redisVal = redis.store.get(redisKey);
      expect(redisVal).toBeDefined();
      expect(parseInt(redisVal!, 10)).toBe(1_500_000);
    });

    it('falls back to SQLite when Redis is unavailable', async () => {
      const ledger = createMockLedger();
      const brokenRedis = createBrokenRedis();
      const proto = new AgentWalletPrototype(ledger, brokenRedis, db);
      const wallet = await createTestWallet(proto, undefined, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-004');

      // First finalize — Redis fails but SQLite works
      const rsv1 = await proto.reserveForInference(wallet, 2_000_000n);
      await proto.finalizeInference(wallet, rsv1.reservationId, 1_000_000n);

      // Second finalize — getDailySpent should read from SQLite (Redis fails)
      const rsv2 = await proto.reserveForInference(wallet, 2_000_000n);
      const result = await proto.finalizeInference(wallet, rsv2.reservationId, 1_000_000n);

      // Both should have been recorded
      expect(result.finalizedMicro).toBe(1_000_000n);

      const today = new Date().toISOString().slice(0, 10);
      const row = db.prepare(
        `SELECT total_spent_micro FROM daily_agent_spending
         WHERE agent_account_id = ? AND spending_date = ?`
      ).get(wallet.account.id, today) as { total_spent_micro: number };

      expect(BigInt(row.total_spent_micro)).toBe(2_000_000n);
    });

    it('works with in-memory only (no Redis, no SQLite)', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, null);
      const wallet = await createTestWallet(proto);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-005');

      const rsv = await proto.reserveForInference(wallet, 2_000_000n);
      await proto.finalizeInference(wallet, rsv.reservationId, 1_200_000n);

      // In-memory sync budget check should reflect spending
      const remaining = proto.getRemainingDailyBudgetSync(wallet);
      expect(remaining).toBe(10_000_000n - 1_200_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // Cap Enforcement at Finalize
  // ---------------------------------------------------------------------------

  describe('daily cap enforcement', () => {
    it('caps actual cost when daily budget would be exceeded at finalize', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, db);
      const wallet = await createTestWallet(proto, {
        dailyCapMicro: 5_000_000n, // 5 USD cap
      }, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-006');

      // Spend 4M of 5M cap
      const rsv1 = await proto.reserveForInference(wallet, 4_500_000n);
      await proto.finalizeInference(wallet, rsv1.reservationId, 4_000_000n);

      // Try to finalize 3M more — should be capped to remaining 1M
      const rsv2 = await proto.reserveForInference(wallet, 1_000_000n);
      const result = await proto.finalizeInference(wallet, rsv2.reservationId, 3_000_000n);

      // Should be capped to 1_000_000 (5M cap - 4M already spent)
      expect(result.finalizedMicro).toBe(1_000_000n);
    });

    it('rejects reservation when daily cap already reached', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, db);
      const wallet = await createTestWallet(proto, {
        dailyCapMicro: 2_000_000n, // 2 USD cap
      }, db);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-007');

      // Spend exactly the cap
      const rsv1 = await proto.reserveForInference(wallet, 2_000_000n);
      await proto.finalizeInference(wallet, rsv1.reservationId, 2_000_000n);

      // Trying to reserve more should fail
      await expect(
        proto.reserveForInference(wallet, 100_000n),
      ).rejects.toThrow(/daily cap exceeded/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3-Layer Read Path
  // ---------------------------------------------------------------------------

  describe('3-layer read fallback', () => {
    it('reads from Redis first when available', async () => {
      const ledger = createMockLedger();
      const redis = createMockRedis();
      const proto = new AgentWalletPrototype(ledger, redis, db);
      const wallet = await createTestWallet(proto, undefined, db);

      // Pre-seed Redis with a spending value
      const today = new Date().toISOString().slice(0, 10);
      const redisKey = `billing:agent:daily:${wallet.account.id}:${today}`;
      redis.store.set(redisKey, '3000000');

      // getRemainingDailyBudget should read from Redis
      const remaining = await proto.getRemainingDailyBudget(wallet);
      expect(remaining).toBe(10_000_000n - 3_000_000n); // 7M remaining
    });

    it('falls through to SQLite when Redis returns null', async () => {
      const ledger = createMockLedger();
      const redis = createMockRedis(); // Empty redis — no pre-seeded data
      const proto = new AgentWalletPrototype(ledger, redis, db);
      const wallet = await createTestWallet(proto, undefined, db);

      // Pre-seed SQLite with a spending value
      const today = new Date().toISOString().slice(0, 10);

      // Need a valid credit account for FK — create via migration seed
      db.prepare(`
        INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
        VALUES (?, 'agent', 'test', 1, datetime('now'), datetime('now'))
      `).run(wallet.account.id);

      db.prepare(`
        INSERT INTO daily_agent_spending (agent_account_id, spending_date, total_spent_micro)
        VALUES (?, ?, 5000000)
      `).run(wallet.account.id, today);

      const remaining = await proto.getRemainingDailyBudget(wallet);
      expect(remaining).toBe(10_000_000n - 5_000_000n); // 5M remaining
    });
  });

  // ---------------------------------------------------------------------------
  // Sync vs Async Budget
  // ---------------------------------------------------------------------------

  describe('sync vs async budget', () => {
    it('sync returns 0 spent before any finalize', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, null);
      const wallet = await createTestWallet(proto);

      const remaining = proto.getRemainingDailyBudgetSync(wallet);
      expect(remaining).toBe(10_000_000n); // Full cap available
    });

    it('sync reflects in-memory spending after finalize', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, null);
      const wallet = await createTestWallet(proto);

      await proto.simulateTbaDeposit(wallet, 50_000_000n, 'tx-008');
      const rsv = await proto.reserveForInference(wallet, 3_000_000n);
      await proto.finalizeInference(wallet, rsv.reservationId, 2_500_000n);

      const syncRemaining = proto.getRemainingDailyBudgetSync(wallet);
      const asyncRemaining = await proto.getRemainingDailyBudget(wallet);

      // Both should agree
      expect(syncRemaining).toBe(10_000_000n - 2_500_000n);
      expect(asyncRemaining).toBe(syncRemaining);
    });
  });

  // ---------------------------------------------------------------------------
  // Identity Anchor
  // ---------------------------------------------------------------------------

  describe('identity anchor', () => {
    it('includes identity anchor in TBA address derivation', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, null);

      const walletWithAnchor = await proto.createAgentWallet({
        ...DEFAULT_CONFIG,
        identityAnchor: 'anchor-hash-abc123',
      });
      const walletWithout = await proto.createAgentWallet(DEFAULT_CONFIG);

      expect(walletWithAnchor.tbaAddress).not.toBe(walletWithout.tbaAddress);
      expect(walletWithAnchor.tbaAddress).toMatch(/^0x[0-9a-f]{40}$/);
    });

    it('verifies identity binding', async () => {
      const ledger = createMockLedger();
      const proto = new AgentWalletPrototype(ledger, null, null);

      const wallet = await proto.createAgentWallet({
        ...DEFAULT_CONFIG,
        identityAnchor: 'anchor-hash-abc123',
      });

      expect(proto.verifyIdentityBinding(wallet, 'anchor-hash-abc123')).toBe(true);
      expect(proto.verifyIdentityBinding(wallet, 'wrong-anchor')).toBe(false);
    });
  });
});
