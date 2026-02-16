/**
 * Settlement Hardening & KYC Integration Tests (Sprint 272, Tasks 16.1–16.5)
 *
 * Validates:
 * - Task 16.1: settle_after pre-computation and deterministic settlement
 * - Task 16.2: KYC progressive disclosure with threshold warnings
 * - Task 16.3: Startup environment validation
 * - Task 16.4: EIP-55 checksum validation
 * - Task 16.5: Settlement hardening regression tests
 *
 * SDD refs: §4.3 SettlementService, §4.4 PayoutService
 * Sprint refs: Tasks 16.1–16.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Create referrer_earnings table with settle_after column
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS referrer_earnings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      referrer_account_id TEXT NOT NULL,
      referee_account_id TEXT NOT NULL,
      registration_id TEXT NOT NULL,
      charge_reservation_id TEXT NOT NULL,
      earning_lot_id TEXT,
      amount_micro INTEGER NOT NULL,
      referrer_bps INTEGER NOT NULL,
      source_charge_micro INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT,
      clawback_reason TEXT,
      settle_after TEXT
    )
  `);

  // Create index for settlement queries
  testDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_referrer_earnings_settle_after
      ON referrer_earnings (settle_after)
      WHERE settled_at IS NULL
  `);

  // Create referral_registrations for distribution service
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS referral_registrations (
      id TEXT PRIMARY KEY,
      referrer_account_id TEXT NOT NULL,
      referee_account_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create payout_requests for KYC tests
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS payout_requests (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount_micro INTEGER NOT NULL,
      fee_micro INTEGER NOT NULL DEFAULT 0,
      net_micro INTEGER NOT NULL,
      payout_address TEXT NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      completed_at TEXT
    )
  `);

  // Create treasury_state for payout service
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS treasury_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      balance_micro INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  testDb.exec(`INSERT OR IGNORE INTO treasury_state (id) VALUES (1)`);

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
// Task 16.1: Settlement Hardening — settle_after Column
// =============================================================================

describe('Task 16.1: settle_after Pre-computation', () => {
  it('migration 048 SQL adds settle_after column and backfills', async () => {
    // Create a temporary DB without settle_after
    const tempDb = new Database(':memory:');
    tempDb.exec(`
      CREATE TABLE referrer_earnings (
        id TEXT PRIMARY KEY,
        referrer_account_id TEXT,
        referee_account_id TEXT,
        registration_id TEXT,
        charge_reservation_id TEXT,
        amount_micro INTEGER,
        referrer_bps INTEGER,
        source_charge_micro INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        settled_at TEXT,
        clawback_reason TEXT
      )
    `);
    // Insert a row without settle_after
    tempDb.prepare(`
      INSERT INTO referrer_earnings (id, referrer_account_id, referee_account_id,
        registration_id, charge_reservation_id, amount_micro, referrer_bps,
        source_charge_micro, created_at)
      VALUES ('e1', 'acct1', 'acct2', 'reg1', 'charge1', 1000000, 500, 10000000,
              datetime('now', '-72 hours'))
    `).run();

    // Run migration
    const { up } = await import('../../src/db/migrations/048_settlement_settle_after.js');
    up(tempDb);

    // Verify settle_after was added and backfilled
    const row = tempDb.prepare('SELECT settle_after, created_at FROM referrer_earnings WHERE id = ?')
      .get('e1') as { settle_after: string; created_at: string };
    expect(row.settle_after).not.toBeNull();
    // settle_after should be created_at + 48 hours
    expect(row.settle_after > row.created_at).toBe(true);

    tempDb.close();
  });
});

// =============================================================================
// Task 16.2: KYC Progressive Disclosure
// =============================================================================

describe('Task 16.2: KYC Status & Threshold Warnings', () => {
  it('returns warning at 80% of $100 threshold', async () => {
    const { CreatorPayoutService } = await import(
      '../../src/packages/adapters/billing/CreatorPayoutService.js'
    );
    const payout = new CreatorPayoutService(db);

    // Create account
    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('creator-1', 'person', 'creator-1')`).run();

    // Simulate $85 cumulative payouts (85_000_000 micro)
    db.prepare(`
      INSERT INTO payout_requests (id, account_id, amount_micro, net_micro, payout_address, status)
      VALUES ('p1', 'creator-1', 85000000, 85000000, '0xabc', 'completed')
    `).run();

    const status = payout.getKycStatus('creator-1');
    expect(status.currentLevel).toBe('none');
    expect(status.cumulativePayoutsMicro).toBe(85000000n);
    expect(status.nextThreshold).toBe(100_000_000); // $100
    expect(status.nextThresholdLevel).toBe('basic');
    expect(status.percentToNextThreshold).toBe(85);
    expect(status.warning).not.toBeNull();
    expect(status.warning).toContain('Verify your identity');
    expect(status.warning).toContain('$100');
  });

  it('no warning below 80% threshold', async () => {
    const { CreatorPayoutService } = await import(
      '../../src/packages/adapters/billing/CreatorPayoutService.js'
    );
    const payout = new CreatorPayoutService(db);

    // Create account
    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('creator-2', 'person', 'creator-2')`).run();

    // Simulate $50 cumulative payouts (50%)
    db.prepare(`
      INSERT INTO payout_requests (id, account_id, amount_micro, net_micro, payout_address, status)
      VALUES ('p2', 'creator-2', 50000000, 50000000, '0xabc', 'completed')
    `).run();

    const status = payout.getKycStatus('creator-2');
    expect(status.percentToNextThreshold).toBe(50);
    expect(status.warning).toBeNull();
  });

  it('returns warning at 80% of $600 enhanced threshold', async () => {
    const { CreatorPayoutService } = await import(
      '../../src/packages/adapters/billing/CreatorPayoutService.js'
    );
    const payout = new CreatorPayoutService(db);

    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('creator-3', 'person', 'creator-3')`).run();

    // Simulate $500 cumulative payouts (83% of $600)
    db.prepare(`
      INSERT INTO payout_requests (id, account_id, amount_micro, net_micro, payout_address, status)
      VALUES ('p3', 'creator-3', 500000000, 500000000, '0xabc', 'completed')
    `).run();

    const status = payout.getKycStatus('creator-3');
    expect(status.nextThreshold).toBe(600_000_000); // $600
    expect(status.nextThresholdLevel).toBe('enhanced');
    expect(status.percentToNextThreshold).toBe(83);
    expect(status.warning).toContain('enhanced');
  });

  it('no next threshold when past all thresholds', async () => {
    const { CreatorPayoutService } = await import(
      '../../src/packages/adapters/billing/CreatorPayoutService.js'
    );
    const payout = new CreatorPayoutService(db);

    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('creator-4', 'person', 'creator-4')`).run();

    db.prepare(`
      INSERT INTO payout_requests (id, account_id, amount_micro, net_micro, payout_address, status)
      VALUES ('p4', 'creator-4', 700000000, 700000000, '0xabc', 'completed')
    `).run();

    const status = payout.getKycStatus('creator-4');
    expect(status.nextThreshold).toBeNull();
    expect(status.nextThresholdLevel).toBeNull();
    expect(status.percentToNextThreshold).toBe(100);
    expect(status.warning).toBeNull();
  });
});

// =============================================================================
// Task 16.3: Startup Environment Validation
// =============================================================================

describe('Task 16.3: Startup Environment Validation', () => {
  it('passes when all required env vars are set', async () => {
    const { validateStartupConfig } = await import(
      '../../src/packages/adapters/billing/startup-validation.js'
    );

    const original = { ...process.env };
    process.env.NOWPAYMENTS_API_KEY = 'test-key';
    process.env.NOWPAYMENTS_IPN_SECRET = 'test-secret';
    process.env.BILLING_ADMIN_JWT_SECRET = 'test-jwt';
    process.env.TRUST_PROXY = '1';

    const result = validateStartupConfig({ requirePayments: true });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Restore
    Object.keys(process.env).forEach(k => {
      if (!(k in original)) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('errors on missing NOWPAYMENTS keys when payments required', async () => {
    const { validateStartupConfig } = await import(
      '../../src/packages/adapters/billing/startup-validation.js'
    );

    const original = { ...process.env };
    delete process.env.NOWPAYMENTS_API_KEY;
    delete process.env.NOWPAYMENTS_IPN_SECRET;

    const result = validateStartupConfig({ requirePayments: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('NOWPAYMENTS_API_KEY'))).toBe(true);
    expect(result.errors.some(e => e.includes('NOWPAYMENTS_IPN_SECRET'))).toBe(true);

    Object.keys(process.env).forEach(k => {
      if (!(k in original)) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('warns (not errors) when payments not required', async () => {
    const { validateStartupConfig } = await import(
      '../../src/packages/adapters/billing/startup-validation.js'
    );

    const original = { ...process.env };
    delete process.env.NOWPAYMENTS_API_KEY;
    delete process.env.BILLING_ADMIN_JWT_SECRET;
    delete process.env.TRUST_PROXY;

    const result = validateStartupConfig({ requirePayments: false });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);

    Object.keys(process.env).forEach(k => {
      if (!(k in original)) delete process.env[k];
      else process.env[k] = original[k];
    });
  });
});

// =============================================================================
// Task 16.4: EIP-55 Checksum Validation
// =============================================================================

describe('Task 16.4: EIP-55 Checksum Validation', () => {
  it('accepts valid all-lowercase address', async () => {
    const { validateEIP55Checksum } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    expect(validateEIP55Checksum('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(true);
  });

  it('accepts valid EIP-55 checksummed address', async () => {
    const { validateEIP55Checksum } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    // viem's getAddress produces correct EIP-55 checksums
    const { getAddress } = await import('viem');
    const checksummed = getAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    expect(validateEIP55Checksum(checksummed)).toBe(true);
  });

  it('rejects invalid mixed-case address', async () => {
    const { validateEIP55Checksum } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    // Deliberately wrong mixed-case (swap a single character)
    const invalid = '0xD8Da6bf26964af9d7eed9e03e53415d37aa96045'; // D uppercase is wrong
    // Get the correct checksum to verify we're actually testing different casing
    const { getAddress } = await import('viem');
    const correct = getAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    if (invalid !== correct) {
      expect(validateEIP55Checksum(invalid)).toBe(false);
    }
  });

  it('rejects non-hex characters', async () => {
    const { validateEIP55Checksum } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    expect(validateEIP55Checksum('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
  });

  it('rejects wrong length', async () => {
    const { validateEIP55Checksum } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    expect(validateEIP55Checksum('0xd8da6bf26964')).toBe(false);
    expect(validateEIP55Checksum('')).toBe(false);
  });

  it('normalizeAddress returns lowercase for valid address', async () => {
    const { normalizeAddress } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    const { getAddress } = await import('viem');
    const checksummed = getAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    const normalized = normalizeAddress(checksummed);
    expect(normalized).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  });

  it('normalizeAddress returns null for invalid address', async () => {
    const { normalizeAddress } = await import(
      '../../src/packages/adapters/billing/protocol/eip55.js'
    );
    expect(normalizeAddress('not-an-address')).toBeNull();
  });
});

// =============================================================================
// Task 16.5: Settlement Hardening Regression Tests
// =============================================================================

describe('Task 16.5: Settlement Hardening Regression', () => {
  it('settle_after = created_at + 48h when inserted', () => {
    // Insert earning with settle_after computed
    const createdAt = '2026-02-10 12:00:00';
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         created_at, settle_after)
      VALUES ('e1', 'acct1', 'acct2', 'reg1', 'charge1', 1000000, 500, 10000000,
              ?, datetime(?, '+48 hours'))
    `).run(createdAt, createdAt);

    const row = db.prepare('SELECT settle_after FROM referrer_earnings WHERE id = ?')
      .get('e1') as { settle_after: string };

    expect(row.settle_after).toBe('2026-02-12 12:00:00');
  });

  it('settleEarnings({ asOf: T+47h }) settles 0 rows', async () => {
    const { SettlementService } = await import(
      '../../src/packages/adapters/billing/SettlementService.js'
    );

    // Create account
    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('acct1', 'person', 'acct1')`).run();

    // Insert earning at T
    const T = '2026-02-10 12:00:00';
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         created_at, settle_after)
      VALUES ('e2', 'acct1', 'acct2', 'reg1', 'charge1', 5000000, 500, 50000000,
              ?, datetime(?, '+48 hours'))
    `).run(T, T);

    const settlement = new SettlementService(db);

    // At T+47h: should NOT settle
    const result47 = settlement.settleEarnings({ asOf: '2026-02-12 11:00:00' });
    expect(result47.settled).toBe(0);
  });

  it('settleEarnings({ asOf: T+49h }) settles 1 row', async () => {
    const { SettlementService } = await import(
      '../../src/packages/adapters/billing/SettlementService.js'
    );

    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('acct1', 'person', 'acct1')`).run();

    const T = '2026-02-10 12:00:00';
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         created_at, settle_after)
      VALUES ('e3', 'acct1', 'acct2', 'reg1', 'charge1', 5000000, 500, 50000000,
              ?, datetime(?, '+48 hours'))
    `).run(T, T);

    const settlement = new SettlementService(db);

    // At T+49h: SHOULD settle
    const result49 = settlement.settleEarnings({ asOf: '2026-02-12 13:00:00' });
    expect(result49.settled).toBe(1);

    // Verify settled_at is set
    const row = db.prepare('SELECT settled_at FROM referrer_earnings WHERE id = ?')
      .get('e3') as { settled_at: string };
    expect(row.settled_at).not.toBeNull();
  });

  it('batch settlement processes exactly rows with settle_after <= asOf', async () => {
    const { SettlementService } = await import(
      '../../src/packages/adapters/billing/SettlementService.js'
    );

    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('acct1', 'person', 'acct1')`).run();

    // Insert 3 earnings with different settle_after times
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         created_at, settle_after)
      VALUES
        ('batch1', 'acct1', 'acct2', 'reg1', 'c1', 1000000, 500, 10000000,
         '2026-02-08 12:00:00', '2026-02-10 12:00:00'),
        ('batch2', 'acct1', 'acct2', 'reg1', 'c2', 2000000, 500, 20000000,
         '2026-02-09 12:00:00', '2026-02-11 12:00:00'),
        ('batch3', 'acct1', 'acct2', 'reg1', 'c3', 3000000, 500, 30000000,
         '2026-02-10 12:00:00', '2026-02-12 12:00:00')
    `).run();

    const settlement = new SettlementService(db);

    // At 2026-02-11 00:00 — only batch1 should be settled (settle_after = 2026-02-10 12:00)
    const result1 = settlement.settleEarnings({ asOf: '2026-02-11 00:00:00' });
    expect(result1.settled).toBe(1);

    // At 2026-02-13 00:00 — batch2 and batch3 should be settled
    const result2 = settlement.settleEarnings({ asOf: '2026-02-13 00:00:00' });
    expect(result2.settled).toBe(2);
  });

  it('asOf defaults to current time when omitted (backward compatibility)', async () => {
    const { SettlementService } = await import(
      '../../src/packages/adapters/billing/SettlementService.js'
    );

    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES ('acct1', 'person', 'acct1')`).run();

    // Insert earning with settle_after far in the past
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         created_at, settle_after)
      VALUES ('old1', 'acct1', 'acct2', 'reg1', 'c1', 1000000, 500, 10000000,
              '2025-01-01 00:00:00', '2025-01-03 00:00:00')
    `).run();

    const settlement = new SettlementService(db);

    // Call without asOf — should default to now and settle old earnings
    const result = settlement.settleEarnings();
    expect(result.settled).toBe(1);
  });

  it('new earnings have settle_after populated via INSERT', () => {
    // Simulating what RevenueDistributionService.recordReferrerEarning() does
    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
         settle_after)
      VALUES ('new1', 'acct1', 'acct2', 'reg1', 'c1', 1000000, 500, 10000000,
              datetime('now', '+48 hours'))
    `).run();

    const row = db.prepare('SELECT settle_after FROM referrer_earnings WHERE id = ?')
      .get('new1') as { settle_after: string };
    expect(row.settle_after).not.toBeNull();
    expect(row.settle_after.length).toBeGreaterThan(0);
  });
});
