/**
 * Settlement Service & Creator Dashboard Integration Tests (Sprint 6)
 *
 * Tests settlement batch processing, clawback flow, settled balance queries,
 * and creator dashboard earnings aggregation.
 *
 * SDD refs: §4.3 SettlementService
 * Sprint refs: Tasks 6.1–6.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { SettlementService } from '../../src/packages/adapters/billing/SettlementService.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let settlement: SettlementService;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(REFERRAL_SCHEMA_SQL);
  testDb.exec(REFERRER_EARNINGS_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, 'person', ?, datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
}

function createReferralSetup(): { codeId: string; regId: string } {
  const codeId = 'code-settle-1';
  const regId = 'reg-settle-1';

  db.prepare(`
    INSERT INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, 'alice', 'settletest0', 'active', datetime('now'))
  `).run(codeId);

  db.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
    VALUES (?, 'bob', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
  `).run(regId, codeId);

  return { codeId, regId };
}

function insertEarning(
  earningId: string,
  regId: string,
  amount: number,
  hoursAgo: number,
): void {
  db.prepare(`
    INSERT INTO referrer_earnings
      (id, referrer_account_id, referee_account_id, registration_id,
       charge_reservation_id, amount_micro, referrer_bps, source_charge_micro, created_at)
    VALUES (?, 'alice', 'bob', ?, ?, ?, 1000, ?, datetime('now', '-${hoursAgo} hours'))
  `).run(earningId, regId, `res-${earningId}`, amount, amount * 10);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  settlement = new SettlementService(db);

  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
  seedAccount(db, 'charlie');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Settlement Service & Creator Dashboard (Sprint 6)', () => {
  // ---------------------------------------------------------------------------
  // Task 6.1: settleEarnings
  // ---------------------------------------------------------------------------

  describe('settleEarnings', () => {
    it('skips earnings younger than 48h', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-young', regId, 100_000, 24); // Only 24h old

      const result = settlement.settleEarnings();
      expect(result.settled).toBe(0);
      expect(result.processed).toBe(0);
    });

    it('settles earnings older than 48h', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-old', regId, 100_000, 50); // 50h old

      const result = settlement.settleEarnings();
      expect(result.settled).toBe(1);
      expect(result.processed).toBe(1);

      // Verify settled_at is set
      const earning = db.prepare(
        `SELECT settled_at FROM referrer_earnings WHERE id = 'e-old'`
      ).get() as { settled_at: string };
      expect(earning.settled_at).toBeTruthy();
    });

    it('creates settlement ledger entry', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-ledger', regId, 200_000, 50);

      settlement.settleEarnings();

      const entry = db.prepare(`
        SELECT * FROM credit_ledger
        WHERE idempotency_key = 'settlement:e-ledger'
      `).get() as Record<string, unknown>;

      expect(entry).toBeTruthy();
      expect(entry.account_id).toBe('alice');
      expect(entry.pool_id).toBe('referral:revenue_share');
      expect(entry.entry_type).toBe('revenue_share');
      expect(Number(entry.amount_micro)).toBe(200_000);
    });

    it('is idempotent on retry', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-idem', regId, 100_000, 50);

      const result1 = settlement.settleEarnings();
      expect(result1.settled).toBe(1);

      // Second call should find nothing to settle
      const result2 = settlement.settleEarnings();
      expect(result2.settled).toBe(0);

      // Only one ledger entry
      const entries = db.prepare(`
        SELECT COUNT(*) as count FROM credit_ledger
        WHERE idempotency_key = 'settlement:e-idem'
      `).get() as { count: number };
      expect(entries.count).toBe(1);
    });

    it('processes multiple earnings in batch', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-batch-1', regId, 100_000, 50);
      insertEarning('e-batch-2', regId, 200_000, 72);
      insertEarning('e-batch-3', regId, 300_000, 96);

      const result = settlement.settleEarnings();
      expect(result.settled).toBe(3);
      expect(result.processed).toBe(3);
    });

    it('returns empty result when no pending earnings', () => {
      const result = settlement.settleEarnings();
      expect(result.processed).toBe(0);
      expect(result.settled).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 6.2: clawbackEarning
  // ---------------------------------------------------------------------------

  describe('clawbackEarning', () => {
    it('claws back pending earning', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-claw', regId, 500_000, 24);

      const result = settlement.clawbackEarning('e-claw', 'Fraudulent activity');
      expect(result.success).toBe(true);

      // Earning marked with clawback_reason
      const earning = db.prepare(
        `SELECT clawback_reason, settled_at FROM referrer_earnings WHERE id = 'e-claw'`
      ).get() as { clawback_reason: string; settled_at: string };
      expect(earning.clawback_reason).toBe('Fraudulent activity');
      expect(earning.settled_at).toBeTruthy();
    });

    it('creates compensating ledger entry', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-comp', regId, 300_000, 24);

      settlement.clawbackEarning('e-comp', 'Reversed');

      const entry = db.prepare(`
        SELECT * FROM credit_ledger
        WHERE idempotency_key = 'clawback:e-comp'
      `).get() as Record<string, unknown>;

      expect(entry).toBeTruthy();
      expect(entry.entry_type).toBe('refund');
      expect(Number(entry.amount_micro)).toBe(-300_000);
    });

    it('rejects clawback of settled earning', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-settled', regId, 100_000, 50);

      // Settle first
      settlement.settleEarnings();

      // Try to claw back
      const result = settlement.clawbackEarning('e-settled', 'Too late');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already settled');
    });

    it('rejects clawback of non-existent earning', () => {
      const result = settlement.clawbackEarning('e-nonexist', 'Not found');
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('is idempotent — second clawback fails gracefully', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-idem-claw', regId, 100_000, 24);

      const result1 = settlement.clawbackEarning('e-idem-claw', 'First attempt');
      expect(result1.success).toBe(true);

      // Second clawback should fail (earning already has settled_at set)
      const result2 = settlement.clawbackEarning('e-idem-claw', 'Second attempt');
      expect(result2.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 6.4: Settled balance queries
  // ---------------------------------------------------------------------------

  describe('balance-queries', () => {
    it('getSettledBalance returns 0 with no earnings', () => {
      const balance = settlement.getSettledBalance('alice');
      expect(balance).toBe(0n);
    });

    it('getSettledBalance returns settled amount', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-bal-1', regId, 100_000, 50);
      insertEarning('e-bal-2', regId, 200_000, 50);

      settlement.settleEarnings();

      const balance = settlement.getSettledBalance('alice');
      expect(balance).toBe(300_000n);
    });

    it('getSettledBalance excludes clawed-back earnings', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-clawed', regId, 500_000, 24);
      insertEarning('e-kept', regId, 300_000, 50);

      // Claw back one, settle the other
      settlement.clawbackEarning('e-clawed', 'Fraud');
      settlement.settleEarnings();

      const balance = settlement.getSettledBalance('alice');
      expect(balance).toBe(300_000n);
    });

    it('getPendingBalance returns unsettled amount', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-pend-1', regId, 100_000, 24); // Too young to settle
      insertEarning('e-pend-2', regId, 200_000, 50); // Old enough

      // Settle old ones
      settlement.settleEarnings();

      const pending = settlement.getPendingBalance('alice');
      expect(pending).toBe(100_000n); // Only the young one
    });

    it('getPendingBalance returns 0 after all settled', () => {
      const { regId } = createReferralSetup();
      insertEarning('e-all', regId, 100_000, 50);

      settlement.settleEarnings();

      const pending = settlement.getPendingBalance('alice');
      expect(pending).toBe(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // E2E: Full settlement lifecycle
  // ---------------------------------------------------------------------------

  describe('e2e-settlement', () => {
    it('earning → settle → verify balance → clawback rejected', () => {
      const { regId } = createReferralSetup();

      // Step 1: Create earnings
      insertEarning('e-e2e-1', regId, 1_000_000, 50);
      insertEarning('e-e2e-2', regId, 500_000, 50);

      // Step 2: Verify pending balance
      expect(settlement.getPendingBalance('alice')).toBe(1_500_000n);
      expect(settlement.getSettledBalance('alice')).toBe(0n);

      // Step 3: Settle
      const result = settlement.settleEarnings();
      expect(result.settled).toBe(2);

      // Step 4: Verify settled balance
      expect(settlement.getSettledBalance('alice')).toBe(1_500_000n);
      expect(settlement.getPendingBalance('alice')).toBe(0n);

      // Step 5: Clawback rejected (already settled)
      const clawback = settlement.clawbackEarning('e-e2e-1', 'Too late');
      expect(clawback.success).toBe(false);

      // Balance unchanged
      expect(settlement.getSettledBalance('alice')).toBe(1_500_000n);
    });

    it('earning → clawback → settle remaining', () => {
      const { regId } = createReferralSetup();

      insertEarning('e-claw-e2e', regId, 1_000_000, 24);
      insertEarning('e-keep-e2e', regId, 500_000, 50);

      // Claw back the pending one
      const clawback = settlement.clawbackEarning('e-claw-e2e', 'Fraud detected');
      expect(clawback.success).toBe(true);

      // Settle remaining
      settlement.settleEarnings();

      // Only the non-clawed-back one counts
      expect(settlement.getSettledBalance('alice')).toBe(500_000n);

      // Verify compensating ledger entry
      const refundEntry = db.prepare(`
        SELECT * FROM credit_ledger WHERE idempotency_key = 'clawback:e-claw-e2e'
      `).get() as Record<string, unknown>;
      expect(refundEntry).toBeTruthy();
      expect(Number(refundEntry.amount_micro)).toBe(-1_000_000);
    });
  });
});
