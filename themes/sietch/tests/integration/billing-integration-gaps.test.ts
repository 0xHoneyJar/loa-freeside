/**
 * Billing Integration Gaps Tests (Sprint 238, Task 9.5)
 *
 * Validates:
 * - Task 9.5: Reconciliation generation counter
 * - Task 9.2: S2S contract type imports compile correctly
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Tasks 9.2, 9.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { createDailyReconciliation } from '../../src/jobs/daily-reconciliation.js';
import { s2sFinalizeRequestSchema, historyQuerySchema } from '../../src/packages/core/contracts/s2s-billing.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;

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
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 9.5: Reconciliation Generation Counter
// =============================================================================

describe('Task 9.5: Reconciliation Generation Counter', () => {
  it('increments generation counter on each run', () => {
    const reconciler = createDailyReconciliation({ db });

    const result1 = reconciler.runOnce();
    expect(result1.generation).toBe(1);

    const result2 = reconciler.runOnce();
    expect(result2.generation).toBe(2);

    const result3 = reconciler.runOnce();
    expect(result3.generation).toBe(3);
  });

  it('persists generation in billing_config', () => {
    const reconciler = createDailyReconciliation({ db });
    reconciler.runOnce();
    reconciler.runOnce();

    const row = db.prepare(
      `SELECT value FROM billing_config WHERE key = 'reconciliation_generation'`
    ).get() as { value: string };
    expect(row.value).toBe('2');
  });

  it('includes generation in log result', () => {
    const reconciler = createDailyReconciliation({ db });
    const result = reconciler.runOnce();

    // Result stored in billing_config should contain generation
    const stored = db.prepare(
      `SELECT value FROM billing_config WHERE key = 'last_reconciliation_result'`
    ).get() as { value: string };
    const parsed = JSON.parse(stored.value);
    expect(parsed.generation).toBe(1);
  });
});

// =============================================================================
// Task 9.2: S2S Contract Types Compile
// =============================================================================

describe('Task 9.2: S2S Contract Types', () => {
  it('validates finalize request schema', () => {
    const valid = s2sFinalizeRequestSchema.safeParse({
      reservationId: 'res-123',
      actualCostMicro: '500000',
    });
    expect(valid.success).toBe(true);

    const withAccount = s2sFinalizeRequestSchema.safeParse({
      reservationId: 'res-123',
      actualCostMicro: '500000',
      accountId: 'acc-456',
    });
    expect(withAccount.success).toBe(true);

    const invalid = s2sFinalizeRequestSchema.safeParse({
      reservationId: '',
      actualCostMicro: 'not-a-number',
    });
    expect(invalid.success).toBe(false);
  });

  it('validates history query schema', () => {
    const valid = historyQuerySchema.safeParse({
      limit: '25',
      offset: '0',
    });
    expect(valid.success).toBe(true);
    expect(valid.data?.limit).toBe(25);

    const defaults = historyQuerySchema.safeParse({});
    expect(defaults.success).toBe(true);
    expect(defaults.data?.limit).toBe(50);
    expect(defaults.data?.offset).toBe(0);
  });
});
