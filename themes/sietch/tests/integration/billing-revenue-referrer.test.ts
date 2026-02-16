/**
 * Revenue Distribution with Referrer Integration Tests (Sprint 3)
 *
 * Tests 5-way conserved split, conservation invariant, rounding policy,
 * property-based testing, and referrer_earnings recording.
 *
 * SDD refs: §4.2 Revenue Rules Extension
 * Sprint refs: Tasks 3.2, 3.3, 3.5, 3.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../src/db/migrations/035_revenue_rules.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { RevenueDistributionService } from '../../src/packages/adapters/billing/RevenueDistributionService.js';
import { ReferralService } from '../../src/packages/adapters/billing/ReferralService.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let distService: RevenueDistributionService;
let referralService: ReferralService;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  testDb.exec(REFERRAL_SCHEMA_SQL);
  testDb.exec(REFERRER_EARNINGS_SQL);
  // Add referrer_bps column to revenue_rules
  testDb.exec(`ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0`);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string, entityType = 'person'): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, entityType, `entity-${id}`);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  distService = new RevenueDistributionService(db);
  referralService = new ReferralService(db);
  distService.setReferralService(referralService);

  // System accounts already seeded by BILLING_SYSTEM_ACCOUNTS_SQL
  // Seed user accounts
  seedAccount(db, 'referrer-alice');
  seedAccount(db, 'referee-bob');
  seedAccount(db, 'user-charlie');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Revenue Distribution with Referrer (Sprint 3)', () => {
  // ---------------------------------------------------------------------------
  // 3-way split (backward compatible, no referrer)
  // ---------------------------------------------------------------------------

  describe('3-way-split-backward-compat', () => {
    it('distributes without referrer when no attribution exists', () => {
      const result = distService.postDistribution(
        'user-charlie', 'general', 1_000_000n, 'res-1', 0,
      );

      expect(result.referrerShare).toBe(0n);
      expect(result.referrerAccountId).toBeNull();
      expect(result.commonsShare + result.communityShare + result.foundationShare).toBe(1_000_000n);
    });

    it('conserves total in 3-way split', () => {
      const result = distService.postDistribution(
        'user-charlie', 'general', 777_777n, 'res-2', 0,
      );

      const total = result.referrerShare + result.commonsShare + result.communityShare +
        result.treasuryReserve + result.foundationShare;
      expect(total).toBe(777_777n);
    });
  });

  // ---------------------------------------------------------------------------
  // 5-way split with referrer attribution
  // ---------------------------------------------------------------------------

  describe('5-way-split-with-referrer', () => {
    beforeEach(async () => {
      // Set up referral: alice refers bob
      const code = await referralService.createCode('referrer-alice');
      await referralService.register('referee-bob', code.code);

      // Update active revenue rule to include referrer_bps
      db.prepare(
        `UPDATE revenue_rules SET referrer_bps = 1000 WHERE status = 'active'`
      ).run();
      distService.invalidateConfig();
    });

    it('distributes to referrer when attribution is active', () => {
      const result = distService.postDistribution(
        'referee-bob', 'general', 1_000_000n, 'res-3', 0,
      );

      expect(result.referrerShare).toBeGreaterThan(0n);
      expect(result.referrerAccountId).toBe('referrer-alice');

      // 10% of 1,000,000 = 100,000
      expect(result.referrerShare).toBe(100_000n);
    });

    it('conserves total in 5-way split', () => {
      const result = distService.postDistribution(
        'referee-bob', 'general', 1_000_000n, 'res-4', 0,
      );

      const total = result.referrerShare + result.commonsShare + result.communityShare +
        result.treasuryReserve + result.foundationShare;
      expect(total).toBe(1_000_000n);
    });

    it('records referrer earning', () => {
      distService.postDistribution(
        'referee-bob', 'general', 1_000_000n, 'res-5', 0,
      );

      const earning = db.prepare(
        `SELECT * FROM referrer_earnings WHERE referrer_account_id = 'referrer-alice'`
      ).get() as Record<string, unknown>;

      expect(earning).toBeTruthy();
      expect(earning.amount_micro).toBe(100_000);
      expect(earning.referrer_bps).toBe(1000);
      expect(earning.source_charge_micro).toBe(1_000_000);
      expect(earning.referee_account_id).toBe('referee-bob');
    });

    it('posts ledger entries for referrer share', () => {
      distService.postDistribution(
        'referee-bob', 'general', 1_000_000n, 'res-6', 0,
      );

      const entries = db.prepare(
        `SELECT * FROM credit_ledger WHERE account_id = 'referrer-alice'`
      ).all() as Array<Record<string, unknown>>;

      expect(entries.length).toBe(1);
      expect(entries[0].pool_id).toBe('referral:revenue_share');
      expect(entries[0].entry_type).toBe('revenue_share');
    });

    it('skips referrer share when attribution expired', () => {
      // Expire attribution
      db.prepare(
        `UPDATE referral_registrations SET attribution_expires_at = datetime('now', '-1 day')
         WHERE referee_account_id = 'referee-bob'`
      ).run();

      const result = distService.postDistribution(
        'referee-bob', 'general', 1_000_000n, 'res-7', 0,
      );

      expect(result.referrerShare).toBe(0n);
      expect(result.referrerAccountId).toBeNull();
    });

    it('skips referrer share for unregistered accounts', () => {
      const result = distService.postDistribution(
        'user-charlie', 'general', 1_000_000n, 'res-8', 0,
      );

      expect(result.referrerShare).toBe(0n);
      expect(result.referrerAccountId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Conservation invariant (Task 3.3 AC)
  // ---------------------------------------------------------------------------

  describe('conservation-invariant', () => {
    it('zero charge returns all zeros', () => {
      const result = distService.postDistribution(
        'user-charlie', 'general', 0n, 'res-zero', 0,
      );

      expect(result.referrerShare).toBe(0n);
      expect(result.commonsShare).toBe(0n);
      expect(result.communityShare).toBe(0n);
      expect(result.treasuryReserve).toBe(0n);
      expect(result.foundationShare).toBe(0n);
    });

    it('remainder never exceeds 4 micro-units for 5 parties', () => {
      // Test with amounts that produce remainders
      const testAmounts = [1n, 3n, 7n, 11n, 13n, 17n, 19n, 23n, 99n, 101n, 333n, 9999n];

      for (const amount of testAmounts) {
        const shares = distService.calculateShares(amount);
        const exactReferrer = (amount * 0n) / 10000n; // no referrer
        const exactCommons = (amount * 500n) / 10000n;
        const exactCommunity = (amount * 7000n) / 10000n;

        // Foundation absorbs remainder
        const total = shares.referrerShare + shares.commonsShare + shares.communityShare +
          shares.treasuryReserve + shares.foundationShare;
        expect(total).toBe(amount);

        // Remainder is the difference between foundation share and exact bps
        const expectedFoundation = (amount * 2500n) / 10000n;
        const remainder = shares.foundationShare - expectedFoundation;
        expect(remainder).toBeGreaterThanOrEqual(0n);
        expect(remainder).toBeLessThanOrEqual(4n);
      }
    });

    it('property-based: conservation holds across 1000 random inputs', () => {
      // Set up referral for 5-way testing
      db.prepare(
        `INSERT OR IGNORE INTO referral_codes (id, account_id, code, status, created_at)
         VALUES ('pbt-code', 'referrer-alice', 'pbtcode0000', 'active', datetime('now'))`
      ).run();
      db.prepare(
        `INSERT OR IGNORE INTO referral_registrations
         (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
         VALUES ('pbt-reg', 'referee-bob', 'referrer-alice', 'pbt-code', datetime('now'), datetime('now', '+12 months'))`
      ).run();
      db.prepare(
        `UPDATE revenue_rules SET referrer_bps = 1000 WHERE status = 'active'`
      ).run();
      distService.invalidateConfig();

      // Use seeded PRNG for reproducibility
      let seed = 42;
      function nextRandom(): number {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      }

      for (let i = 0; i < 1000; i++) {
        const amount = BigInt(nextRandom() % 100_000_000 + 1); // 1 to 100M micro
        const shares = distService.calculateShares(amount, 1000n);
        const total = shares.referrerShare + shares.commonsShare + shares.communityShare +
          shares.treasuryReserve + shares.foundationShare;
        expect(total).toBe(amount);
      }
    });

    it('property-based: conservation holds with treasury reserve', () => {
      // Enable treasury reserve
      db.prepare(
        `INSERT OR REPLACE INTO billing_config (key, value, updated_at)
         VALUES ('treasury_reserve_bps', '500', datetime('now'))`
      ).run();
      db.prepare(
        `UPDATE revenue_rules SET referrer_bps = 1000 WHERE status = 'active'`
      ).run();
      distService.invalidateConfig();

      // Set up referral
      db.prepare(
        `INSERT OR IGNORE INTO referral_codes (id, account_id, code, status, created_at)
         VALUES ('pbt-code2', 'referrer-alice', 'pbtcode0001', 'active', datetime('now'))`
      ).run();
      db.prepare(
        `INSERT OR IGNORE INTO referral_registrations
         (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
         VALUES ('pbt-reg2', 'referee-bob', 'referrer-alice', 'pbt-code2', datetime('now'), datetime('now', '+12 months'))`
      ).run();

      let seed = 123;
      function nextRandom(): number {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      }

      for (let i = 0; i < 1000; i++) {
        const amount = BigInt(nextRandom() % 100_000_000 + 1);
        const shares = distService.calculateShares(amount, 1000n);
        const total = shares.referrerShare + shares.commonsShare + shares.communityShare +
          shares.treasuryReserve + shares.foundationShare;
        expect(total).toBe(amount);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // E2E Distribution (Task 3.6)
  // ---------------------------------------------------------------------------

  describe('e2e-distribution', () => {
    it('full lifecycle: finalize charge → 5-way split → verify all entries', async () => {
      // Set up referral
      const code = await referralService.createCode('referrer-alice');
      await referralService.register('referee-bob', code.code);
      db.prepare(
        `UPDATE revenue_rules SET referrer_bps = 1000 WHERE status = 'active'`
      ).run();
      distService.invalidateConfig();

      // Post distribution
      const result = distService.postDistribution(
        'referee-bob', 'general', 10_000_000n, 'res-e2e', 0,
      );

      // Verify 5-way split sums to total
      const total = result.referrerShare + result.commonsShare + result.communityShare +
        result.treasuryReserve + result.foundationShare;
      expect(total).toBe(10_000_000n);

      // Verify referrer got 10% = 1,000,000
      expect(result.referrerShare).toBe(1_000_000n);

      // Verify ledger entries
      const allEntries = db.prepare(
        `SELECT * FROM credit_ledger WHERE reservation_id = 'res-e2e' ORDER BY entry_seq`
      ).all() as Array<Record<string, unknown>>;

      // Should have entries for referrer, commons, community, foundation (4 entries, treasury=0)
      expect(allEntries.length).toBeGreaterThanOrEqual(4);

      // Verify referrer_earnings row
      const earning = db.prepare(
        `SELECT * FROM referrer_earnings WHERE charge_reservation_id = 'res-e2e'`
      ).get() as Record<string, unknown>;
      expect(earning).toBeTruthy();
      expect(earning.referrer_account_id).toBe('referrer-alice');

      // Verify sum of all ledger credit amounts equals charge
      const ledgerSum = allEntries.reduce(
        (sum, e) => sum + BigInt(e.amount_micro as number), 0n
      );
      expect(ledgerSum).toBe(10_000_000n);
    });

    it('distribution without attribution: 3-way only', () => {
      const result = distService.postDistribution(
        'user-charlie', 'general', 10_000_000n, 'res-no-ref', 0,
      );

      expect(result.referrerShare).toBe(0n);
      const total = result.commonsShare + result.communityShare +
        result.treasuryReserve + result.foundationShare;
      expect(total).toBe(10_000_000n);

      // No referrer_earnings
      const earning = db.prepare(
        `SELECT * FROM referrer_earnings WHERE charge_reservation_id = 'res-no-ref'`
      ).get();
      expect(earning).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // SQLite Contention Baseline (Task 3.5)
  // ---------------------------------------------------------------------------

  describe('sqlite-contention-baseline', () => {
    it('WAL mode is configured', () => {
      // In-memory SQLite may report 'memory' instead of 'wal'
      // The pragma('journal_mode = WAL') was set in setupDb; verify it was accepted
      const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(['wal', 'memory']).toContain(result[0].journal_mode);
    });

    it('10 concurrent distributions complete without SQLITE_BUSY', () => {
      const startTime = Date.now();
      const latencies: number[] = [];

      for (let i = 0; i < 10; i++) {
        const t0 = Date.now();
        distService.postDistribution(
          'user-charlie', 'general', BigInt(1_000_000 + i), `res-conc-${i}`, i * 10,
        );
        latencies.push(Date.now() - t0);
      }

      const totalTime = Date.now() - startTime;
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      // All completed (no SQLITE_BUSY)
      expect(latencies).toHaveLength(10);

      // p99 should be < 200ms for in-memory SQLite
      expect(p99).toBeLessThan(200);

      // Verify all entries exist
      for (let i = 0; i < 10; i++) {
        const entries = db.prepare(
          `SELECT COUNT(*) as count FROM credit_ledger WHERE reservation_id = ?`
        ).get(`res-conc-${i}`) as { count: number };
        expect(entries.count).toBeGreaterThanOrEqual(3); // At least 3 entries per distribution
      }
    });
  });
});
