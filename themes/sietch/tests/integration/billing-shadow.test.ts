/**
 * Billing Shadow Mode Integration Tests
 *
 * Validates Sprint 3: shadow billing, revenue distribution,
 * DLQ processing, reconciliation, billing_config seeding.
 *
 * SDD refs: §1.4 BillingMiddleware, §1.4 RevenueDistributionService
 * Sprint refs: Tasks 3.1–3.7
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { RevenueDistributionService } from '../../src/packages/adapters/billing/RevenueDistributionService.js';
import { ShadowBillingService } from '../../src/api/middleware/shadow-billing.js';
import { createDLQProcessor, enqueueDLQ } from '../../src/jobs/dlq-processor.js';
import { createDailyReconciliation } from '../../src/jobs/daily-reconciliation.js';
import { createBalanceReconciler } from '../../src/jobs/balance-reconciler.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Create crypto_payments table (simplified for tests)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS crypto_payments (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'nowpayments',
      provider_payment_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      community_id TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      account_id TEXT,
      amount_usd_micro INTEGER,
      lot_id TEXT,
      price_amount DECIMAL(10, 2),
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
      UNIQUE(provider, provider_payment_id)
    )
  `);

  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Billing Shadow Mode Integration', () => {
  // ---------------------------------------------------------------------------
  // Migration 032 — Billing Ops Tables
  // ---------------------------------------------------------------------------

  describe('migration-032-structure', () => {
    it('billing_config table seeded with default rates', () => {
      const rates = db.prepare(
        `SELECT key, value FROM billing_config WHERE key LIKE '%_rate_bps' ORDER BY key`
      ).all() as Array<{ key: string; value: string }>;

      expect(rates).toHaveLength(3);
      const rateMap = Object.fromEntries(rates.map(r => [r.key, Number(r.value)]));
      expect(rateMap.commons_rate_bps).toBe(500);
      expect(rateMap.community_rate_bps).toBe(7000);
      expect(rateMap.foundation_rate_bps).toBe(2500);

      // Rates sum to 10000 bps (100%)
      const total = Object.values(rateMap).reduce((a, b) => a + b, 0);
      expect(total).toBe(10000);
    });

    it('system accounts created for revenue distribution', () => {
      const accounts = db.prepare(
        `SELECT id, entity_type, entity_id FROM credit_accounts
         WHERE id LIKE 'sys-%' ORDER BY id`
      ).all() as Array<{ id: string; entity_type: string; entity_id: string }>;

      expect(accounts).toHaveLength(3);
      expect(accounts.map(a => a.id)).toEqual(
        expect.arrayContaining(['sys-foundation', 'sys-commons', 'sys-community-pool'])
      );
    });

    it('billing_config references system account IDs', () => {
      const foundation = db.prepare(
        `SELECT value FROM billing_config WHERE key = 'foundation_account_id'`
      ).get() as { value: string };
      expect(foundation.value).toBe('sys-foundation');

      const commons = db.prepare(
        `SELECT value FROM billing_config WHERE key = 'commons_account_id'`
      ).get() as { value: string };
      expect(commons.value).toBe('sys-commons');
    });

    it('billing_dlq table exists with correct schema', () => {
      const columns = db.prepare(
        `PRAGMA table_info(billing_dlq)`
      ).all() as Array<{ name: string }>;
      const colNames = columns.map(c => c.name);

      expect(colNames).toContain('operation_type');
      expect(colNames).toContain('retry_count');
      expect(colNames).toContain('max_retries');
      expect(colNames).toContain('next_retry_at');
    });

    it('billing_config has billing mode defaulted to shadow', () => {
      const mode = db.prepare(
        `SELECT value FROM billing_config WHERE key = 'billing_mode'`
      ).get() as { value: string };
      expect(mode.value).toBe('shadow');
    });
  });

  // ---------------------------------------------------------------------------
  // Revenue Distribution
  // ---------------------------------------------------------------------------

  describe('revenue-distribution', () => {
    it('calculates shares correctly with foundation absorbing remainder', () => {
      const revDist = new RevenueDistributionService(db);
      const shares = revDist.calculateShares(1_000_000n); // $1.00

      // 500 bps (5%) of 1_000_000 = 50_000
      expect(shares.commonsShare).toBe(50_000n);
      // 7000 bps (70%) of 1_000_000 = 700_000
      expect(shares.communityShare).toBe(700_000n);
      // Foundation gets remainder: 1_000_000 - 50_000 - 700_000 = 250_000
      expect(shares.foundationShare).toBe(250_000n);

      // Zero-sum invariant
      expect(shares.commonsShare + shares.communityShare + shares.foundationShare)
        .toBe(1_000_000n);
    });

    it('foundation absorbs integer truncation on odd amounts', () => {
      const revDist = new RevenueDistributionService(db);
      // $0.000003 — triggers truncation
      const shares = revDist.calculateShares(3n);

      // 3 * 500 / 10000 = 0 (truncated)
      expect(shares.commonsShare).toBe(0n);
      // 3 * 7000 / 10000 = 2 (truncated from 2.1)
      expect(shares.communityShare).toBe(2n);
      // Foundation: 3 - 0 - 2 = 1
      expect(shares.foundationShare).toBe(1n);

      // Still zero-sum
      expect(shares.commonsShare + shares.communityShare + shares.foundationShare)
        .toBe(3n);
    });

    it('posts distribution entries to credit_ledger', async () => {
      const revDist = new RevenueDistributionService(db);
      const account = await ledger.createAccount('community', 'comm-dist');

      const result = revDist.postDistribution(
        account.id, 'general', 1_000_000n, 'res-test-1', 10,
      );

      expect(result.commonsShare).toBe(50_000n);
      expect(result.communityShare).toBe(700_000n);
      expect(result.foundationShare).toBe(250_000n);

      // Check ledger entries
      const entries = db.prepare(
        `SELECT entry_type, amount_micro, account_id
         FROM credit_ledger
         WHERE reservation_id = 'res-test-1'
         ORDER BY entry_seq`
      ).all() as Array<{ entry_type: string; amount_micro: string; account_id: string }>;

      expect(entries).toHaveLength(3);
      expect(entries[0].entry_type).toBe('commons_contribution');
      expect(entries[0].account_id).toBe('sys-commons');
      expect(entries[1].entry_type).toBe('revenue_share');
      expect(entries[1].account_id).toBe('sys-community-pool');
      expect(entries[2].entry_type).toBe('revenue_share');
      expect(entries[2].account_id).toBe('sys-foundation');
    });

    it('zero charge produces no distribution entries', () => {
      const revDist = new RevenueDistributionService(db);
      const result = revDist.postDistribution(
        'acc-1', 'general', 0n, 'res-empty', 10,
      );

      expect(result.commonsShare).toBe(0n);
      expect(result.communityShare).toBe(0n);
      expect(result.foundationShare).toBe(0n);

      const entries = db.prepare(
        `SELECT COUNT(*) as c FROM credit_ledger WHERE reservation_id = 'res-empty'`
      ).get() as { c: number };
      expect(entries.c).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Shadow Billing
  // ---------------------------------------------------------------------------

  describe('shadow-billing', () => {
    it('logs shadow reserve entry without affecting balance', async () => {
      const account = await ledger.createAccount('community', 'comm-shadow');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'shadow-test',
      });

      const shadow = new ShadowBillingService({ db });
      const entryId = shadow.logShadowReserve(
        account.id, 'general', 500_000n,
        { model: 'gpt-4', maxTokens: 1000 },
      );

      expect(entryId).not.toBeNull();

      // Balance should be unchanged
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(10_000_000n);

      // Shadow entry exists in ledger
      const entry = db.prepare(
        `SELECT entry_type, amount_micro FROM credit_ledger WHERE id = ?`
      ).get(entryId!) as { entry_type: string; amount_micro: string };
      expect(entry.entry_type).toBe('shadow_reserve');
    });

    it('logs shadow finalize entry', async () => {
      const account = await ledger.createAccount('community', 'comm-shadow-fin');
      const shadow = new ShadowBillingService({ db });

      const entryId = shadow.logShadowFinalize(
        account.id, 'general', 350_000n,
        { model: 'gpt-4', inputTokens: 500, outputTokens: 200, overheadMs: 15 },
      );

      expect(entryId).not.toBeNull();

      const entry = db.prepare(
        `SELECT entry_type, metadata FROM credit_ledger WHERE id = ?`
      ).get(entryId!) as { entry_type: string; metadata: string };
      expect(entry.entry_type).toBe('shadow_finalize');

      const meta = JSON.parse(entry.metadata);
      expect(meta.model).toBe('gpt-4');
      expect(meta.overheadMs).toBe(15);
    });

    it('shadow summary counts entries correctly', async () => {
      const account = await ledger.createAccount('community', 'comm-shadow-sum');
      const shadow = new ShadowBillingService({ db });

      shadow.logShadowReserve(account.id, 'general', 100_000n);
      shadow.logShadowFinalize(account.id, 'general', 80_000n);
      shadow.logShadowReserve(account.id, 'general', 200_000n);
      shadow.logShadowFinalize(account.id, 'general', 190_000n);

      const summary = shadow.getShadowSummary(account.id);
      expect(summary.totalReserves).toBe(2);
      expect(summary.totalFinalizes).toBe(2);
      expect(summary.totalShadowCostMicro).toBe(270_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // DLQ Processor
  // ---------------------------------------------------------------------------

  describe('dlq-processor', () => {
    it('processes and completes a DLQ item', async () => {
      let handlerCalled = false;
      const dlq = createDLQProcessor({
        db,
        handlers: {
          deposit: async (payload: unknown) => {
            handlerCalled = true;
          },
        },
      });

      const dlqId = enqueueDLQ(db, 'deposit', { accountId: 'acc-1', amount: 1000 }, 'timeout');

      // Set next_retry_at to past so it's immediately processable
      db.prepare(
        `UPDATE billing_dlq SET next_retry_at = datetime('now', '-1 minute') WHERE id = ?`
      ).run(dlqId);

      const result = await dlq.processOnce();
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(handlerCalled).toBe(true);

      // Verify status is completed
      const item = db.prepare(
        `SELECT status FROM billing_dlq WHERE operation_type = 'deposit'`
      ).get() as { status: string };
      expect(item.status).toBe('completed');
    });

    it('escalates to manual_review after max retries', async () => {
      let callCount = 0;
      const dlq = createDLQProcessor({
        db,
        handlers: {
          webhook: async () => {
            callCount++;
            throw new Error('Still failing');
          },
        },
      });

      // Enqueue with max_retries = 3
      const id = enqueueDLQ(db, 'webhook', { paymentId: 'p-1' }, 'initial error');

      // Process 3 times (hitting max retries)
      for (let i = 0; i < 3; i++) {
        // Reset next_retry_at so it's processable now
        db.prepare(
          `UPDATE billing_dlq SET next_retry_at = datetime('now', '-1 minute'), status = 'pending' WHERE id = ?`
        ).run(id);
        await dlq.processOnce();
      }

      const item = db.prepare(
        `SELECT status, retry_count FROM billing_dlq WHERE id = ?`
      ).get(id) as { status: string; retry_count: number };
      expect(item.status).toBe('manual_review');
      expect(item.retry_count).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Daily Reconciliation
  // ---------------------------------------------------------------------------

  describe('daily-reconciliation', () => {
    it('all checks pass on a healthy system', async () => {
      const account = await ledger.createAccount('community', 'comm-healthy');
      await ledger.mintLot(account.id, 5_000_000n, 'deposit', {
        sourceId: 'healthy-deposit',
      });

      const reconciliation = createDailyReconciliation({ db });
      const result = reconciliation.runOnce();

      expect(result.passed).toBe(true);
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
      expect(result.checks.every(c => c.passed)).toBe(true);

      // Verify stored in billing_config
      const stored = db.prepare(
        `SELECT value FROM billing_config WHERE key = 'last_reconciliation_result'`
      ).get() as { value: string };
      const storedResult = JSON.parse(stored.value);
      expect(storedResult.passed).toBe(true);
    });

    it('detects finished payments without lots', async () => {
      // Insert a finished payment with no lot_id
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      db.prepare(
        `INSERT INTO crypto_payments
         (id, provider, provider_payment_id, payment_id, status, amount_usd_micro, created_at, updated_at)
         VALUES ('cp_orphan', 'nowpayments', 'np-orphan', 'np-orphan', 'finished', 5000000, ?, ?)`
      ).run(now, now);

      const reconciliation = createDailyReconciliation({ db });
      const result = reconciliation.runOnce();

      const depositCheck = result.checks.find(c => c.name === 'webhook_deposit_match');
      expect(depositCheck).toBeDefined();
      expect(depositCheck!.passed).toBe(false);
      expect(depositCheck!.details).toContain('1 finished payments missing lot records');
    });
  });

  // ---------------------------------------------------------------------------
  // Balance Reconciler
  // ---------------------------------------------------------------------------

  describe('balance-reconciler', () => {
    it('detects and corrects Redis drift', async () => {
      const account = await ledger.createAccount('community', 'comm-drift');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'drift-test',
      });

      // Simulate a drifted Redis cache
      const redisStore = new Map<string, string>();
      redisStore.set(
        `billing:balance:${account.id}:general`,
        JSON.stringify({ availableMicro: '5000000', reservedMicro: '0' }),
      );

      const mockRedis = {
        get: async (key: string) => redisStore.get(key) ?? null,
        set: async (key: string, value: string) => { redisStore.set(key, value); return 'OK'; },
      };

      const reconciler = createBalanceReconciler({
        db,
        redis: mockRedis,
        maxAccounts: 100,
      });

      const result = await reconciler.reconcileOnce();
      expect(result.driftFound).toBe(1);
      expect(result.driftCorrected).toBe(1);

      // Verify Redis was corrected
      const corrected = JSON.parse(redisStore.get(`billing:balance:${account.id}:general`)!);
      expect(corrected.availableMicro).toBe('10000000');
    });

    it('skips when Redis is null', async () => {
      const reconciler = createBalanceReconciler({
        db,
        redis: null,
      });

      const result = await reconciler.reconcileOnce();
      expect(result.accountsChecked).toBe(0);
    });
  });
});
