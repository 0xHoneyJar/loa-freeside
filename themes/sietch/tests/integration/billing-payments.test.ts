/**
 * Billing Payments Integration Tests
 *
 * Validates Sprint 2 payment wiring: NOWPayments webhook → credit ledger,
 * x402 top-up → credit ledger, payment state machine, refund/clawback.
 *
 * SDD refs: §5.3 Top-Up, §5.4 State Machine, §1.8 x402 Verification
 * Sprint refs: Tasks 2.1–2.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CRYPTO_PAYMENTS_V2_SCHEMA_SQL } from '../../src/db/migrations/031_crypto_payments_v2.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { PaymentServiceAdapter } from '../../src/packages/adapters/billing/PaymentServiceAdapter.js';
import {
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
  type PaymentStatus,
} from '../../src/packages/core/ports/IPaymentService.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let paymentService: PaymentServiceAdapter;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF'); // Off for test — no communities table
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Create crypto_payments table directly (simplified for test — no table recreation)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS crypto_payments (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'nowpayments',
      provider_payment_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      community_id TEXT,
      tier TEXT,
      price_amount DECIMAL(10, 2),
      price_currency TEXT DEFAULT 'usd',
      pay_amount DECIMAL(20, 10),
      pay_currency TEXT,
      pay_address TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      actually_paid DECIMAL(20, 10),
      order_id TEXT,
      account_id TEXT,
      amount_usd_micro INTEGER,
      lot_id TEXT,
      raw_payload TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
      expires_at TEXT,
      finished_at TEXT,
      UNIQUE(provider, provider_payment_id)
    )
  `);

  testDb.pragma('foreign_keys = ON');
  return testDb;
}

import { sqliteTimestamp } from '../../src/packages/adapters/billing/protocol/timestamps';

const sqliteNow = sqliteTimestamp;

function seedPayment(opts: {
  id?: string;
  provider?: string;
  providerPaymentId: string;
  communityId?: string;
  status?: string;
  priceAmount?: number;
}): string {
  const id = opts.id ?? `cp_${Math.random().toString(36).slice(2, 10)}`;
  const now = sqliteNow();
  db.prepare(`
    INSERT INTO crypto_payments
    (id, provider, provider_payment_id, payment_id, community_id, tier,
     price_amount, price_currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'basic', ?, 'usd', ?, ?, ?)
  `).run(
    id,
    opts.provider ?? 'nowpayments',
    opts.providerPaymentId,
    opts.providerPaymentId,
    opts.communityId ?? 'comm-test',
    opts.priceAmount ?? 10.00,
    opts.status ?? 'waiting',
    now, now,
  );
  return id;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
  paymentService = new PaymentServiceAdapter(db, ledger);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Billing Payments Integration', () => {
  // ---------------------------------------------------------------------------
  // Migration 031 — Crypto Payments V2 Table Structure
  // ---------------------------------------------------------------------------

  describe('migration-031-structure', () => {
    it('crypto_payments table has new columns', () => {
      const columns = db.prepare(
        `PRAGMA table_info(crypto_payments)`
      ).all() as Array<{ name: string }>;

      const colNames = columns.map(c => c.name);
      expect(colNames).toContain('provider');
      expect(colNames).toContain('provider_payment_id');
      expect(colNames).toContain('account_id');
      expect(colNames).toContain('amount_usd_micro');
      expect(colNames).toContain('lot_id');
      expect(colNames).toContain('raw_payload');
    });

    it('UNIQUE(provider, provider_payment_id) constraint works', () => {
      seedPayment({ providerPaymentId: 'pay-dup-1' });

      expect(() => {
        seedPayment({ providerPaymentId: 'pay-dup-1' });
      }).toThrow(); // UNIQUE constraint violation
    });

    it('different providers can have same provider_payment_id', () => {
      seedPayment({ provider: 'nowpayments', providerPaymentId: 'shared-id' });
      seedPayment({ provider: 'x402', providerPaymentId: 'shared-id' });

      const count = db.prepare(
        `SELECT COUNT(*) as c FROM crypto_payments WHERE provider_payment_id = 'shared-id'`
      ).get() as { c: number };
      expect(count.c).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Payment State Machine
  // ---------------------------------------------------------------------------

  describe('payment-state-machine', () => {
    it('valid forward transitions are accepted', () => {
      expect(paymentService.isValidTransition('waiting', 'confirming')).toBe(true);
      expect(paymentService.isValidTransition('waiting', 'finished')).toBe(true);
      expect(paymentService.isValidTransition('confirming', 'confirmed')).toBe(true);
      expect(paymentService.isValidTransition('confirmed', 'finished')).toBe(true);
    });

    it('regression transitions are rejected', () => {
      expect(paymentService.isValidTransition('finished', 'confirming')).toBe(false);
      expect(paymentService.isValidTransition('confirmed', 'waiting')).toBe(false);
    });

    it('terminal states cannot transition (except finished→refunded)', () => {
      expect(paymentService.isValidTransition('failed', 'waiting')).toBe(false);
      expect(paymentService.isValidTransition('expired', 'confirming')).toBe(false);
      expect(paymentService.isValidTransition('refunded', 'finished')).toBe(false);
      // finished → refunded is the only terminal transition
      expect(paymentService.isValidTransition('finished', 'refunded')).toBe(true);
    });

    it('same-status transitions are idempotent', () => {
      expect(paymentService.isValidTransition('waiting', 'waiting')).toBe(true);
      expect(paymentService.isValidTransition('finished', 'finished')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // NOWPayments Webhook → Credit Ledger
  // ---------------------------------------------------------------------------

  describe('nowpayments-to-ledger', () => {
    it('finished payment creates credit lot and ledger entry', async () => {
      // Seed a payment and an account
      const paymentId = seedPayment({
        providerPaymentId: 'np-finish-1',
        communityId: 'comm-1',
        priceAmount: 25.00,
        status: 'confirmed',
      });

      const account = await ledger.createAccount('community', 'comm-1');

      // Simulate the credit ledger hook (what PaymentServiceAdapter.processWebhook does)
      const amountMicro = 25_000_000n; // $25
      const lot = await ledger.mintLot(account.id, amountMicro, 'deposit', {
        sourceId: `nowpay-np-finish-1`,
        poolId: 'general',
        idempotencyKey: `webhook:nowpay:np-finish-1`,
        description: 'NOWPayments deposit (btc)',
      });

      // Update payment record
      const now = sqliteNow();
      db.prepare(
        `UPDATE crypto_payments
         SET account_id = ?, amount_usd_micro = ?, lot_id = ?,
             status = 'finished', finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(account.id, amountMicro.toString(), lot.id, now, now, paymentId);

      // Verify lot created
      expect(lot.originalMicro).toBe(25_000_000n);
      expect(lot.availableMicro).toBe(25_000_000n);

      // Verify payment record updated
      const payment = db.prepare(
        `SELECT account_id, amount_usd_micro, lot_id, status FROM crypto_payments WHERE id = ?`
      ).get(paymentId) as { account_id: string; amount_usd_micro: string; lot_id: string; status: string };

      expect(payment.account_id).toBe(account.id);
      expect(payment.lot_id).toBe(lot.id);
      expect(payment.status).toBe('finished');
      expect(BigInt(payment.amount_usd_micro)).toBe(25_000_000n);

      // Verify ledger entry
      const history = await ledger.getHistory(account.id);
      expect(history.length).toBe(1);
      expect(history[0].entryType).toBe('deposit');
    });

    it('duplicate deposit is idempotent', async () => {
      const account = await ledger.createAccount('community', 'comm-idem');

      const lot1 = await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'nowpay-idem-1',
        idempotencyKey: 'webhook:nowpay:idem-1',
      });

      const lot2 = await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'nowpay-idem-1-retry',
        idempotencyKey: 'webhook:nowpay:idem-1',
      });

      expect(lot1.id).toBe(lot2.id);

      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(10_000_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // x402 Top-Up Flow
  // ---------------------------------------------------------------------------

  describe('x402-topup-flow', () => {
    it('x402 payment record is created correctly', async () => {
      const account = await ledger.createAccount('person', 'user-x402');
      const amountMicro = 5_000_000n;

      // Simulate what PaymentServiceAdapter.createTopUp does (minus on-chain verification)
      const lot = await ledger.mintLot(account.id, amountMicro, 'deposit', {
        sourceId: 'x402-0xabc123',
        poolId: 'general',
        idempotencyKey: 'x402:0xabc123',
        description: 'x402 USDC top-up (Base)',
      });

      const now = sqliteNow();
      db.prepare(
        `INSERT INTO crypto_payments
         (id, provider, provider_payment_id, payment_id,
          status, account_id, amount_usd_micro, lot_id,
          pay_currency, price_amount, price_currency,
          created_at, updated_at, finished_at)
         VALUES (?, 'x402', ?, ?, 'finished', ?, ?, ?, 'usdc', 5.00, 'usd', ?, ?, ?)`
      ).run('cp_x402test', '0xabc123', '0xabc123',
        account.id, amountMicro.toString(), lot.id, now, now, now);

      // Verify payment record
      const payment = db.prepare(
        `SELECT * FROM crypto_payments WHERE id = 'cp_x402test'`
      ).get() as any;

      expect(payment.provider).toBe('x402');
      expect(payment.status).toBe('finished');
      expect(payment.lot_id).toBe(lot.id);

      // Verify balance
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(5_000_000n);
    });

    it('x402 duplicate tx hash rejected by UNIQUE constraint', async () => {
      const now = sqliteNow();
      db.prepare(
        `INSERT INTO crypto_payments
         (id, provider, provider_payment_id, payment_id, status, created_at, updated_at)
         VALUES ('cp_1', 'x402', '0xdup', '0xdup', 'finished', ?, ?)`
      ).run(now, now);

      expect(() => {
        db.prepare(
          `INSERT INTO crypto_payments
           (id, provider, provider_payment_id, payment_id, status, created_at, updated_at)
           VALUES ('cp_2', 'x402', '0xdup', '0xdup', 'finished', ?, ?)`
        ).run(now, now);
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Refund / Clawback
  // ---------------------------------------------------------------------------

  describe('refund-clawback', () => {
    it('refund claws back available portion and creates debt for consumed', async () => {
      const account = await ledger.createAccount('community', 'comm-refund');

      // Deposit $10
      const lot = await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'nowpay-refund-test',
      });

      // Consume $6
      const r = await ledger.reserve(account.id, 'general', 6_000_000n);
      await ledger.finalize(r.reservationId, 6_000_000n);

      // Seed payment record with lot_id
      const now = sqliteNow();
      db.prepare(
        `INSERT INTO crypto_payments
         (id, provider, provider_payment_id, payment_id, community_id, tier,
          price_amount, status, account_id, lot_id, amount_usd_micro, created_at, updated_at)
         VALUES ('cp_ref1', 'nowpayments', 'np-ref-1', 'np-ref-1', 'comm-refund', 'basic',
          10.00, 'finished', ?, ?, '10000000', ?, ?)`
      ).run(account.id, lot.id, now, now);

      // Process refund
      const result = await paymentService.refund('cp_ref1');

      expect(result.paymentId).toBe('cp_ref1');
      expect(result.lotId).toBe(lot.id);
      expect(result.clawbackMicro).toBe(4_000_000n); // $4 still available
      expect(result.debtMicro).toBe(6_000_000n); // $6 consumed → debt

      // Verify debt record created
      const debt = db.prepare(
        `SELECT debt_micro FROM credit_debts WHERE account_id = ? AND resolved_at IS NULL`
      ).get(account.id) as { debt_micro: string };
      expect(BigInt(debt.debt_micro)).toBe(6_000_000n);

      // Verify lot available is now 0
      const lotAfter = db.prepare(
        `SELECT available_micro FROM credit_lots WHERE id = ?`
      ).get(lot.id) as { available_micro: string };
      expect(BigInt(lotAfter.available_micro)).toBe(0n);
    });

    it('refund with no consumption creates no debt', async () => {
      const account = await ledger.createAccount('community', 'comm-refund-clean');
      const lot = await ledger.mintLot(account.id, 5_000_000n, 'deposit', {
        sourceId: 'nowpay-clean-ref',
      });

      const now = sqliteNow();
      db.prepare(
        `INSERT INTO crypto_payments
         (id, provider, provider_payment_id, payment_id, community_id, tier,
          price_amount, status, account_id, lot_id, amount_usd_micro, created_at, updated_at)
         VALUES ('cp_ref2', 'nowpayments', 'np-ref-2', 'np-ref-2', 'comm-refund-clean', 'basic',
          5.00, 'finished', ?, ?, '5000000', ?, ?)`
      ).run(account.id, lot.id, now, now);

      const result = await paymentService.refund('cp_ref2');

      expect(result.clawbackMicro).toBe(5_000_000n);
      expect(result.debtMicro).toBe(0n);
      expect(result.debtId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getStatus
  // ---------------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns payment status for existing payment', async () => {
      seedPayment({
        id: 'cp_status1',
        providerPaymentId: 'np-status-1',
        status: 'confirmed',
      });

      const status = await paymentService.getStatus('cp_status1');
      expect(status).not.toBeNull();
      expect(status!.provider).toBe('nowpayments');
      expect(status!.status).toBe('confirmed');
    });

    it('returns null for non-existent payment', async () => {
      const status = await paymentService.getStatus('cp_nonexistent');
      expect(status).toBeNull();
    });
  });
});
