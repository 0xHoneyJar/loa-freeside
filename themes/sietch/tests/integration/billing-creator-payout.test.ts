/**
 * Creator Payout Service Integration Tests (Sprint 9)
 *
 * Tests KYC enforcement, balance validation, rate limiting,
 * withdrawable balance calculation, and payout request lifecycle.
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Tasks 9.1–9.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { PAYOUT_SYSTEM_SQL, PAYOUT_SYSTEM_SEED_SQL } from '../../src/db/migrations/045_payout_system.js';
import { CreatorPayoutService } from '../../src/packages/adapters/billing/CreatorPayoutService.js';
import { SettlementService } from '../../src/packages/adapters/billing/SettlementService.js';

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
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(REFERRAL_SCHEMA_SQL);
  testDb.exec(REFERRER_EARNINGS_SQL);
  testDb.exec(PAYOUT_SYSTEM_SQL);
  testDb.exec(PAYOUT_SYSTEM_SEED_SQL);
  // Settlement columns
  try { testDb.exec(`ALTER TABLE referrer_earnings ADD COLUMN settled_at TEXT`); } catch {}
  try { testDb.exec(`ALTER TABLE referrer_earnings ADD COLUMN clawback_reason TEXT`); } catch {}
  // KYC column
  try { testDb.exec(`ALTER TABLE credit_accounts ADD COLUMN kyc_level TEXT DEFAULT 'none'`); } catch {}
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, kyc_level, created_at, updated_at)
     VALUES (?, 'person', ?, 'none', datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
}

function createSettledEarnings(accountDb: Database.Database, accountId: string, amountMicro: number): void {
  // Create referral setup for earnings
  const codeId = `code-${accountId}-${Date.now()}`;
  const regId = `reg-${accountId}-${Date.now()}`;
  const refereeId = `referee-${accountId}-${Date.now()}`;

  seedAccount(accountDb, refereeId);

  accountDb.prepare(`
    INSERT INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
  `).run(codeId, accountId, `CODE${Date.now()}`);

  accountDb.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+12 months'))
  `).run(regId, refereeId, accountId, codeId);

  const earningId = `earn-${accountId}-${Date.now()}`;
  accountDb.prepare(`
    INSERT INTO referrer_earnings
      (id, referrer_account_id, referee_account_id, registration_id,
       charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
       created_at, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, 1000, ?, datetime('now', '-50 hours'), datetime('now'))
  `).run(earningId, accountId, refereeId, regId, `res-${earningId}`, amountMicro, amountMicro * 10);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 9.1: CreatorPayoutService with KYC
// =============================================================================

describe('Task 9.1: CreatorPayoutService', () => {
  it('creates payout request when balance sufficient', () => {
    createSettledEarnings(db, 'alice', 10_000_000); // $10

    const service = new CreatorPayoutService(db);
    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000, // $5
      payoutAddress: '0xAliceWallet',
    });

    expect(result.success).toBe(true);
    expect(result.payoutId).toBeTruthy();
  });

  it('rejects payout below minimum ($1)', () => {
    createSettledEarnings(db, 'alice', 10_000_000);

    const service = new CreatorPayoutService(db);
    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 500_000, // $0.50
      payoutAddress: '0xAlice',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Minimum payout');
  });

  it('rejects payout when insufficient balance', () => {
    createSettledEarnings(db, 'alice', 1_000_000); // $1

    const service = new CreatorPayoutService(db);
    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000, // $5
      payoutAddress: '0xAlice',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient');
  });

  it('enforces rate limit: 1 per 24h', () => {
    createSettledEarnings(db, 'alice', 50_000_000); // $50

    const service = new CreatorPayoutService(db);

    const result1 = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result1.success).toBe(true);

    const result2 = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('Rate limit');
  });

  describe('KYC enforcement', () => {
    it('allows payout < $100 without KYC', () => {
      createSettledEarnings(db, 'alice', 50_000_000); // $50

      const service = new CreatorPayoutService(db);
      const result = service.requestPayout({
        accountId: 'alice',
        amountMicro: 50_000_000, // $50
        payoutAddress: '0xAlice',
      });

      expect(result.success).toBe(true);
    });

    it('requires basic KYC for $100-$600 cumulative', () => {
      createSettledEarnings(db, 'alice', 200_000_000); // $200

      const service = new CreatorPayoutService(db);
      const result = service.requestPayout({
        accountId: 'alice',
        amountMicro: 150_000_000, // $150 → total > $100
        payoutAddress: '0xAlice',
      });

      expect(result.success).toBe(false);
      expect(result.requiredKycLevel).toBe('basic');
    });

    it('allows payout with sufficient KYC level', () => {
      createSettledEarnings(db, 'alice', 200_000_000);

      const service = new CreatorPayoutService(db);
      service.setKycLevel('alice', 'basic');

      const result = service.requestPayout({
        accountId: 'alice',
        amountMicro: 150_000_000,
        payoutAddress: '0xAlice',
      });

      expect(result.success).toBe(true);
    });

    it('requires enhanced KYC for > $600 cumulative', () => {
      createSettledEarnings(db, 'alice', 1_000_000_000); // $1000

      const service = new CreatorPayoutService(db);
      service.setKycLevel('alice', 'basic');

      const result = service.requestPayout({
        accountId: 'alice',
        amountMicro: 700_000_000, // $700 → total > $600
        payoutAddress: '0xAlice',
      });

      expect(result.success).toBe(false);
      expect(result.requiredKycLevel).toBe('enhanced');
    });

    it('verified KYC passes all thresholds', () => {
      createSettledEarnings(db, 'alice', 2_000_000_000); // $2000

      const service = new CreatorPayoutService(db);
      service.setKycLevel('alice', 'verified');

      const result = service.requestPayout({
        accountId: 'alice',
        amountMicro: 1_000_000_000, // $1000
        payoutAddress: '0xAlice',
      });

      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// Task 9.3: getWithdrawableBalance
// =============================================================================

describe('Task 9.3: getWithdrawableBalance', () => {
  it('returns zero when no settled earnings', () => {
    const service = new CreatorPayoutService(db);
    const balance = service.getWithdrawableBalance('alice');

    expect(balance.settledMicro).toBe(0n);
    expect(balance.escrowMicro).toBe(0n);
    expect(balance.withdrawableMicro).toBe(0n);
  });

  it('returns settled balance as withdrawable', () => {
    createSettledEarnings(db, 'alice', 5_000_000);

    const service = new CreatorPayoutService(db);
    const balance = service.getWithdrawableBalance('alice');

    expect(balance.settledMicro).toBe(5_000_000n);
    expect(balance.withdrawableMicro).toBe(5_000_000n);
  });

  it('excludes escrowed payouts from withdrawable', () => {
    createSettledEarnings(db, 'alice', 10_000_000);

    const service = new CreatorPayoutService(db);

    // Create a payout (which puts funds in escrow)
    service.requestPayout({
      accountId: 'alice',
      amountMicro: 3_000_000,
      payoutAddress: '0xAlice',
    });

    const balance = service.getWithdrawableBalance('alice');
    expect(balance.settledMicro).toBe(10_000_000n);
    expect(balance.escrowMicro).toBe(3_000_000n);
    expect(balance.withdrawableMicro).toBe(7_000_000n);
  });

  it('excludes clawed-back earnings', () => {
    const settlement = new SettlementService(db);

    // Create an earning and claw it back
    const codeId = 'code-claw-wb';
    const regId = 'reg-claw-wb';
    seedAccount(db, 'referee-claw');

    db.prepare(`
      INSERT INTO referral_codes (id, account_id, code, status, created_at)
      VALUES (?, 'alice', 'CLAWWB', 'active', datetime('now'))
    `).run(codeId);

    db.prepare(`
      INSERT INTO referral_registrations
        (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
      VALUES (?, 'referee-claw', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
    `).run(regId, codeId);

    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro, created_at)
      VALUES ('earn-claw-wb', 'alice', 'referee-claw', ?, 'res-claw-wb', 500000, 1000, 5000000, datetime('now', '-24 hours'))
    `).run(regId);

    settlement.clawbackEarning('earn-claw-wb', 'Fraud');

    const service = new CreatorPayoutService(db);
    const balance = service.getWithdrawableBalance('alice');

    // Clawed-back earning should not be in settled balance
    expect(balance.settledMicro).toBe(0n);
  });
});

// =============================================================================
// E2E: Payout Request Lifecycle
// =============================================================================

describe('e2e-payout-service', () => {
  it('full flow: earn → settle → request payout → verify escrow', () => {
    // Create and settle earnings
    createSettledEarnings(db, 'alice', 20_000_000); // $20

    const service = new CreatorPayoutService(db);

    // Step 1: Check balance
    const balanceBefore = service.getWithdrawableBalance('alice');
    expect(balanceBefore.withdrawableMicro).toBe(20_000_000n);

    // Step 2: Request payout
    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 10_000_000, // $10
      payoutAddress: '0xAliceWallet',
      currency: 'usdc',
    });
    expect(result.success).toBe(true);

    // Step 3: Verify balance reduced by escrow
    const balanceAfter = service.getWithdrawableBalance('alice');
    expect(balanceAfter.escrowMicro).toBe(10_000_000n);
    expect(balanceAfter.withdrawableMicro).toBe(10_000_000n);

    // Step 4: Verify payout exists in DB
    const payout = db.prepare(
      `SELECT * FROM payout_requests WHERE id = ?`
    ).get(result.payoutId!) as Record<string, unknown>;
    expect(payout.status).toBe('approved'); // Approved with escrow
    expect(payout.account_id).toBe('alice');
  });

  it('rate limit prevents second payout within 24h', () => {
    createSettledEarnings(db, 'alice', 50_000_000);

    const service = new CreatorPayoutService(db);

    const result1 = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result1.success).toBe(true);

    // Second payout from same account
    const result2 = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('Rate limit');

    // Different account is fine
    createSettledEarnings(db, 'bob', 50_000_000);
    const result3 = service.requestPayout({
      accountId: 'bob',
      amountMicro: 5_000_000,
      payoutAddress: '0xBob',
    });
    expect(result3.success).toBe(true);
  });
});
