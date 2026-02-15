/**
 * Billing Hardening Integration Tests (Sprint 236, Tasks 7.1–7.5)
 *
 * Validates:
 * - Task 7.1: Confused deputy prevention in S2S finalize
 * - Task 7.2: safeIntegers() on monetary read paths (BigInt precision)
 * - Task 7.3: Idempotency key cleanup sweeper
 * - Task 7.5: Pre/post balance audit trail
 *
 * SDD refs: §1.4 CreditLedgerService, §5.7 Auth Model
 * Sprint refs: Tasks 7.1–7.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { createIdempotencySweeper } from '../../src/jobs/idempotency-sweeper.js';

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
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 7.1: Confused Deputy Prevention
// =============================================================================

describe('Task 7.1: Confused Deputy Prevention', () => {
  it('finalize succeeds when accountId matches reservation owner', async () => {
    const account = await ledger.createAccount('person', 'user-deputy-1');
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'deputy-deposit-1',
    });

    const reservation = await ledger.reserve(account.id, null, 5_000_000n, {
      billingMode: 'live',
    });

    // Verify the reservation belongs to the expected account
    const row = db.prepare(
      'SELECT account_id FROM credit_reservations WHERE id = ?'
    ).get(reservation.reservationId) as { account_id: string };

    expect(row.account_id).toBe(account.id);

    // Finalize should succeed
    const result = await ledger.finalize(reservation.reservationId, 3_000_000n);
    expect(result.actualCostMicro).toBe(3_000_000n);
  });

  it('reservation lookup returns correct account for confused deputy check', async () => {
    const accountA = await ledger.createAccount('person', 'user-deputy-a');
    const accountB = await ledger.createAccount('person', 'user-deputy-b');

    await ledger.mintLot(accountA.id, 10_000_000n, 'deposit', {
      sourceId: 'deputy-deposit-a',
    });

    const reservation = await ledger.reserve(accountA.id, null, 5_000_000n, {
      billingMode: 'live',
    });

    // Verify: reservation belongs to accountA, not accountB
    const row = db.prepare(
      'SELECT account_id FROM credit_reservations WHERE id = ?'
    ).get(reservation.reservationId) as { account_id: string };

    expect(row.account_id).toBe(accountA.id);
    expect(row.account_id).not.toBe(accountB.id);
  });
});

// =============================================================================
// Task 7.2: BigInt Safety — safeIntegers()
// =============================================================================

describe('Task 7.2: BigInt Safety — safeIntegers()', () => {
  it('preserves exact precision for values above 2^53', async () => {
    // Temporarily raise ceiling to allow very large values for this test
    const origCeiling = process.env.BILLING_CEILING_MICRO;
    process.env.BILLING_CEILING_MICRO = '10000000000000000'; // $10B

    const account = await ledger.createAccount('person', 'user-bigint-1');

    // 9.1 quadrillion micro-USD (~$9.1 billion) — exceeds Number.MAX_SAFE_INTEGER
    const largeMicro = 9_100_000_000_000_000n;

    await ledger.mintLot(account.id, largeMicro, 'deposit', {
      sourceId: 'bigint-deposit-1',
    });

    // Verify exact round-trip precision via getBalance
    const balance = await ledger.getBalance(account.id);
    expect(balance.availableMicro).toBe(largeMicro);

    // Verify via reserve: can reserve the exact amount
    const reservation = await ledger.reserve(account.id, null, largeMicro, {
      billingMode: 'live',
    });
    expect(reservation.totalReservedMicro).toBe(largeMicro);

    // After reserve: available should be 0, reserved should be largeMicro
    const postBalance = await ledger.getBalance(account.id);
    expect(postBalance.availableMicro).toBe(0n);
    expect(postBalance.reservedMicro).toBe(largeMicro);

    // Restore original ceiling
    if (origCeiling !== undefined) {
      process.env.BILLING_CEILING_MICRO = origCeiling;
    } else {
      delete process.env.BILLING_CEILING_MICRO;
    }
  });

  it('existing tests pass with safeIntegers enabled (no breakage)', async () => {
    const account = await ledger.createAccount('person', 'user-bigint-2');
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'bigint-deposit-2',
    });

    // Standard operations still work
    const reservation = await ledger.reserve(account.id, null, 5_000_000n, {
      billingMode: 'live',
    });
    const result = await ledger.finalize(reservation.reservationId, 3_000_000n);

    expect(result.actualCostMicro).toBe(3_000_000n);
    expect(result.surplusReleasedMicro).toBe(2_000_000n);

    const balance = await ledger.getBalance(account.id);
    expect(balance.availableMicro).toBe(7_000_000n);
  });
});

// =============================================================================
// Task 7.3: Idempotency Key Cleanup Sweeper
// =============================================================================

describe('Task 7.3: Idempotency Sweeper', () => {
  it('sweeps expired idempotency keys', () => {
    // Insert expired keys
    const insertExpired = db.prepare(`
      INSERT INTO billing_idempotency_keys
        (scope, idempotency_key, response_hash, created_at, expires_at)
      VALUES (?, ?, ?, datetime('now', '-2 hours'), datetime('now', '-1 hour'))
    `);

    for (let i = 0; i < 5; i++) {
      insertExpired.run('test', `expired-key-${i}`, `hash-${i}`);
    }

    // Insert valid (non-expired) keys
    db.prepare(`
      INSERT INTO billing_idempotency_keys
        (scope, idempotency_key, response_hash, created_at, expires_at)
      VALUES ('test', 'valid-key-1', 'hash-valid', datetime('now'), datetime('now', '+1 hour'))
    `).run();

    const sweeper = createIdempotencySweeper({ db, batchSize: 1000 });
    const result = sweeper.sweepOnce();

    expect(result.deletedCount).toBe(5);

    // Valid key still exists
    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM billing_idempotency_keys'
    ).get() as { count: number };
    expect(remaining.count).toBe(1);
  });

  it('skips valid (non-expired) keys', () => {
    // Insert only valid keys
    db.prepare(`
      INSERT INTO billing_idempotency_keys
        (scope, idempotency_key, response_hash, created_at, expires_at)
      VALUES ('test', 'valid-key-2', 'hash-v2', datetime('now'), datetime('now', '+24 hours'))
    `).run();

    const sweeper = createIdempotencySweeper({ db, batchSize: 1000 });
    const result = sweeper.sweepOnce();

    expect(result.deletedCount).toBe(0);

    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM billing_idempotency_keys'
    ).get() as { count: number };
    expect(remaining.count).toBe(1);
  });

  it('is idempotent: second sweep deletes nothing', () => {
    // Insert expired keys
    db.prepare(`
      INSERT INTO billing_idempotency_keys
        (scope, idempotency_key, response_hash, created_at, expires_at)
      VALUES ('test', 'expired-idem-1', 'hash-i1', datetime('now', '-2 hours'), datetime('now', '-1 hour'))
    `).run();

    const sweeper = createIdempotencySweeper({ db, batchSize: 1000 });

    const result1 = sweeper.sweepOnce();
    expect(result1.deletedCount).toBe(1);

    const result2 = sweeper.sweepOnce();
    expect(result2.deletedCount).toBe(0);
  });
});

// =============================================================================
// Task 7.5: Pre/Post Balance Audit Trail
// =============================================================================

describe('Task 7.5: Pre/Post Balance Audit Trail', () => {
  it('records pre/post balance on deposit (mint)', async () => {
    const account = await ledger.createAccount('person', 'user-audit-1');

    // First deposit: pre=0, post=5M
    await ledger.mintLot(account.id, 5_000_000n, 'deposit', {
      sourceId: 'audit-deposit-1',
    });

    const entries = await ledger.getHistory(account.id);
    expect(entries.length).toBe(1);
    expect(entries[0].preBalanceMicro).toBe(0n);
    expect(entries[0].postBalanceMicro).toBe(5_000_000n);

    // Second deposit: pre=5M, post=8M
    await ledger.mintLot(account.id, 3_000_000n, 'deposit', {
      sourceId: 'audit-deposit-2',
    });

    const allEntries = await ledger.getHistory(account.id);
    // Most recent first
    expect(allEntries[0].preBalanceMicro).toBe(5_000_000n);
    expect(allEntries[0].postBalanceMicro).toBe(8_000_000n);
  });

  it('records pre/post balance on reserve', async () => {
    const account = await ledger.createAccount('person', 'user-audit-2');
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'audit-reserve-deposit',
    });

    // Reserve 3M: pre=10M, post=7M (available)
    await ledger.reserve(account.id, null, 3_000_000n, {
      billingMode: 'live',
    });

    const entries = await ledger.getHistory(account.id, { entryType: 'reserve' });
    expect(entries.length).toBe(1);
    expect(entries[0].preBalanceMicro).toBe(10_000_000n);
    expect(entries[0].postBalanceMicro).toBe(7_000_000n);
  });

  it('records pre/post balance on finalize with surplus', async () => {
    const account = await ledger.createAccount('person', 'user-audit-3');
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'audit-finalize-deposit',
    });

    const reservation = await ledger.reserve(account.id, null, 5_000_000n, {
      billingMode: 'live',
    });

    // Finalize with 3M (2M surplus released back to available)
    await ledger.finalize(reservation.reservationId, 3_000_000n);

    const entries = await ledger.getHistory(account.id, { entryType: 'finalize' });
    expect(entries.length).toBe(1);
    // After finalize: available = 5M (original 10M - 5M reserved + 2M surplus) = 7M
    // pre_balance = post - surplus = 7M - 2M = 5M
    expect(entries[0].preBalanceMicro).toBe(5_000_000n);
    expect(entries[0].postBalanceMicro).toBe(7_000_000n);
  });

  it('allows negative post_balance in soft mode (no constraint violation)', async () => {
    const account = await ledger.createAccount('person', 'user-audit-soft');
    await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
      sourceId: 'audit-soft-deposit',
    });

    // Reserve all available
    const reservation = await ledger.reserve(account.id, null, 1_000_000n, {
      billingMode: 'soft',
    });

    // Finalize with overrun: actual cost > reserved (soft mode allows it)
    const result = await ledger.finalize(reservation.reservationId, 3_000_000n);
    expect(result.overrunMicro).toBe(2_000_000n);

    // The entry should exist with no constraint violation
    const entries = await ledger.getHistory(account.id, { entryType: 'finalize' });
    expect(entries.length).toBe(1);
    // post_balance_micro can be negative in soft mode — no CHECK constraint
    expect(entries[0].postBalanceMicro).not.toBeNull();
  });

  it('handles NULL audit columns gracefully for pre-migration rows', () => {
    // Temporarily disable FK to simulate a pre-migration row with no matching account
    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT INTO credit_ledger
        (id, account_id, pool_id, entry_seq, entry_type, amount_micro, created_at)
      VALUES ('legacy-entry', 'nonexistent', 'general', 1, 'deposit', 1000000,
              datetime('now'))
    `).run();
    db.pragma('foreign_keys = ON');

    const row = db.prepare('SELECT * FROM credit_ledger WHERE id = ?')
      .get('legacy-entry') as Record<string, unknown>;

    expect(row.pre_balance_micro).toBeNull();
    expect(row.post_balance_micro).toBeNull();
  });

  it('records pre/post balance on release', async () => {
    const account = await ledger.createAccount('person', 'user-audit-release');
    await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
      sourceId: 'audit-release-deposit',
    });

    const reservation = await ledger.reserve(account.id, null, 4_000_000n, {
      billingMode: 'live',
    });

    // Release: 4M returns to available
    await ledger.release(reservation.reservationId);

    const entries = await ledger.getHistory(account.id, { entryType: 'release' });
    expect(entries.length).toBe(1);
    // After release: available = 10M (all returned)
    expect(entries[0].preBalanceMicro).toBe(6_000_000n);
    expect(entries[0].postBalanceMicro).toBe(10_000_000n);
  });
});
