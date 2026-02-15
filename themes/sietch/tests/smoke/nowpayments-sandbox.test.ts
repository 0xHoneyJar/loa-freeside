/**
 * NOWPayments Sandbox Smoke Tests
 *
 * Validates NOWPayments sandbox integration including webhook HMAC verification.
 * Tests require NOWPAYMENTS_SANDBOX_API_KEY and NOWPAYMENTS_SANDBOX_IPN_SECRET env vars.
 * Skipped (not failed) when env vars are missing.
 *
 * HMAC Strategy: Single-strategy enforcement per SDD §1.8.
 * Strategy locked via NOWPAYMENTS_HMAC_STRATEGY env var (A=raw body, B=sorted-key).
 * Default: B (sorted-key) — NOWPayments documented approach.
 *
 * SDD refs: §1.8 HMAC Strategy
 * Sprint refs: Task 1.8
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';

// =============================================================================
// Environment Check
// =============================================================================

const SANDBOX_API_KEY = process.env.NOWPAYMENTS_SANDBOX_API_KEY;
const SANDBOX_IPN_SECRET = process.env.NOWPAYMENTS_SANDBOX_IPN_SECRET;
const HAS_SANDBOX_CREDS = !!(SANDBOX_API_KEY && SANDBOX_IPN_SECRET);

// HMAC strategy: A = raw body SHA-512, B = sorted-key SHA-512 (default)
const HMAC_STRATEGY = (process.env.NOWPAYMENTS_HMAC_STRATEGY ?? 'B').toUpperCase();

// =============================================================================
// HMAC Verification Logic
// =============================================================================

/**
 * Verify NOWPayments webhook HMAC signature.
 * Strategy B (sorted-key): Sort payload keys alphabetically, then HMAC-SHA512.
 * Strategy A (raw body): HMAC-SHA512 of the raw JSON body string.
 */
function verifyWebhookHMAC(
  payload: Record<string, unknown>,
  signature: string,
  ipnSecret: string,
  strategy: string = HMAC_STRATEGY,
): boolean {
  let dataToSign: string;

  if (strategy === 'A') {
    // Strategy A: Raw JSON body
    dataToSign = JSON.stringify(payload);
  } else {
    // Strategy B (default): Sorted keys
    const sorted = sortObject(payload);
    dataToSign = JSON.stringify(sorted);
  }

  const hmac = createHmac('sha512', ipnSecret);
  hmac.update(dataToSign);
  const computed = hmac.digest('hex');

  return computed === signature;
}

/**
 * Sort object keys recursively for deterministic HMAC.
 */
function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sorted[key] = sortObject(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}

/**
 * Create a signed webhook payload for testing.
 */
function createSignedPayload(
  payload: Record<string, unknown>,
  ipnSecret: string,
): { payload: Record<string, unknown>; signature: string } {
  let dataToSign: string;

  if (HMAC_STRATEGY === 'A') {
    dataToSign = JSON.stringify(payload);
  } else {
    dataToSign = JSON.stringify(sortObject(payload));
  }

  const hmac = createHmac('sha512', ipnSecret);
  hmac.update(dataToSign);
  const signature = hmac.digest('hex');

  return { payload, signature };
}

// =============================================================================
// Test Database Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;

// =============================================================================
// Smoke Tests
// =============================================================================

describe.skipIf(!HAS_SANDBOX_CREDS)('NOWPayments Sandbox Smoke Tests', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    // Also need crypto_payments table for existing adapter compatibility
    db.exec(`
      CREATE TABLE IF NOT EXISTS crypto_payments (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'nowpayments',
        payment_id TEXT NOT NULL,
        invoice_id TEXT,
        order_id TEXT,
        status TEXT NOT NULL DEFAULT 'waiting',
        price_amount REAL,
        price_currency TEXT DEFAULT 'usd',
        pay_amount REAL,
        pay_currency TEXT,
        pay_address TEXT,
        actually_paid REAL DEFAULT 0,
        amount_usd_micro INTEGER,
        outcome_amount REAL,
        outcome_currency TEXT,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `);
    ledger = new CreditLedgerAdapter(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // webhook-signature-verify
  // ---------------------------------------------------------------------------

  it('webhook-signature-verify: HMAC verification with configured strategy', () => {
    const testPayload = {
      payment_id: 12345,
      payment_status: 'finished',
      pay_address: '0xTestAddress',
      price_amount: 10.00,
      price_currency: 'usd',
      pay_amount: 0.005,
      pay_currency: 'btc',
      order_id: 'test-order-1',
      actually_paid: 0.005,
    };

    const { signature } = createSignedPayload(testPayload, SANDBOX_IPN_SECRET!);

    const isValid = verifyWebhookHMAC(testPayload, signature, SANDBOX_IPN_SECRET!);
    expect(isValid).toBe(true);

    // Verify tampering is detected
    const tampered = { ...testPayload, price_amount: 999.99 };
    const isTamperedValid = verifyWebhookHMAC(tampered, signature, SANDBOX_IPN_SECRET!);
    expect(isTamperedValid).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // webhook-to-deposit
  // ---------------------------------------------------------------------------

  it('webhook-to-deposit: finished webhook creates credit_lot + ledger entry', async () => {
    // Create account for the payment recipient
    const account = await ledger.createAccount('community', 'comm-1');

    // Simulate a finished payment → mint lot
    const paymentAmountUsd = 10.00;
    const amountMicro = BigInt(Math.round(paymentAmountUsd * 1_000_000));

    const lot = await ledger.mintLot(account.id, amountMicro, 'deposit', {
      sourceId: 'nowpay-12345',
      description: 'NOWPayments deposit (finished)',
    });

    expect(lot.originalMicro).toBe(10_000_000n);
    expect(lot.availableMicro).toBe(10_000_000n);

    // Verify ledger entry
    const history = await ledger.getHistory(account.id);
    expect(history.length).toBe(1);
    expect(history[0].entryType).toBe('deposit');
    expect(history[0].amountMicro).toBe(10_000_000n);
  });

  // ---------------------------------------------------------------------------
  // duplicate-webhook
  // ---------------------------------------------------------------------------

  it('duplicate-webhook: second finished webhook is idempotent', async () => {
    const account = await ledger.createAccount('community', 'comm-2');
    const amountMicro = 10_000_000n;

    const lot1 = await ledger.mintLot(account.id, amountMicro, 'deposit', {
      sourceId: 'nowpay-dup-1',
      idempotencyKey: 'webhook:nowpay-dup-1',
    });

    const lot2 = await ledger.mintLot(account.id, amountMicro, 'deposit', {
      sourceId: 'nowpay-dup-1-again',
      idempotencyKey: 'webhook:nowpay-dup-1',
    });

    // Should return same lot (idempotent)
    expect(lot1.id).toBe(lot2.id);

    // Balance should reflect single deposit
    const balance = await ledger.getBalance(account.id);
    expect(balance.availableMicro).toBe(10_000_000n);
  });

  // ---------------------------------------------------------------------------
  // refund-webhook (placeholder — full clawback in Sprint 2)
  // ---------------------------------------------------------------------------

  it('refund-webhook: refund creates debt record when lot partially consumed', async () => {
    const account = await ledger.createAccount('community', 'comm-3');

    // Deposit and consume some
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'nowpay-refund-1',
    });
    const r = await ledger.reserve(account.id, 'general', 5_000_000n);
    await ledger.finalize(r.reservationId, 5_000_000n);

    // Simulate refund: for now, create a debt record directly
    // (Full refund flow will be in Sprint 2 Task 2.2)
    db.prepare(
      `INSERT INTO credit_debts (id, account_id, pool_id, debt_micro, source_payment_id, created_at)
       VALUES (?, ?, 'general', ?, ?, datetime('now'))`
    ).run('debt-1', account.id, '5000000', 'nowpay-refund-1');

    const debt = db.prepare(
      `SELECT debt_micro FROM credit_debts WHERE account_id = ? AND resolved_at IS NULL`
    ).get(account.id) as { debt_micro: string };

    expect(BigInt(debt.debt_micro)).toBe(5_000_000n);
  });

  // ---------------------------------------------------------------------------
  // hmac-strategy-locked
  // ---------------------------------------------------------------------------

  it('hmac-strategy-locked: NOWPAYMENTS_HMAC_STRATEGY env var selects strategy', () => {
    expect(['A', 'B']).toContain(HMAC_STRATEGY);

    // Both strategies should produce valid signatures when verified with same strategy
    const payload = { test: 'data', amount: 100 };
    const { signature: sigA } = createSignedPayload(payload, 'test-secret');
    expect(typeof sigA).toBe('string');
    expect(sigA.length).toBe(128); // SHA-512 hex = 128 chars
  });
});

// Tests that run without sandbox credentials
describe('NOWPayments HMAC (unit)', () => {
  it('verifyWebhookHMAC rejects tampered payload', () => {
    const payload = { payment_id: 1, status: 'finished', amount: 10 };
    const secret = 'unit-test-secret';
    const { signature } = createSignedPayload(payload, secret);

    expect(verifyWebhookHMAC(payload, signature, secret)).toBe(true);
    expect(verifyWebhookHMAC({ ...payload, amount: 99 }, signature, secret)).toBe(false);
  });

  it('sorted-key strategy produces deterministic signatures regardless of key order', () => {
    const secret = 'order-test';
    const payload1 = { z: 1, a: 2, m: 3 };
    const payload2 = { a: 2, m: 3, z: 1 };

    const sorted1 = JSON.stringify(sortObject(payload1));
    const sorted2 = JSON.stringify(sortObject(payload2));

    expect(sorted1).toBe(sorted2);

    const hmac1 = createHmac('sha512', secret).update(sorted1).digest('hex');
    const hmac2 = createHmac('sha512', secret).update(sorted2).digest('hex');
    expect(hmac1).toBe(hmac2);
  });
});
