/**
 * Leaderboard Service Integration Tests (Sprint 5)
 *
 * Tests leaderboard queries, caching, timeframes, creator rank,
 * and edge cases (empty state, ties, pagination).
 *
 * SDD refs: §4.6 LeaderboardService
 * Sprint refs: Tasks 5.1–5.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { LeaderboardService, type LeaderboardTimeframe } from '../../src/packages/adapters/billing/LeaderboardService.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let leaderboard: LeaderboardService;

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

function createReferral(
  referrerId: string,
  refereeId: string,
  codeId: string,
  regId: string,
  daysAgo = 0,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, ?, ?, 'active', datetime('now', '-${daysAgo} days'))
  `).run(codeId, referrerId, `code${codeId.slice(0, 6)}`);

  db.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id,
       created_at, attribution_expires_at)
    VALUES (?, ?, ?, ?, datetime('now', '-${daysAgo} days'), datetime('now', '+12 months'))
  `).run(regId, refereeId, referrerId, codeId);
}

function createEarning(
  referrerId: string,
  refereeId: string,
  regId: string,
  amount: number,
  daysAgo = 0,
): void {
  db.prepare(`
    INSERT INTO referrer_earnings
      (referrer_account_id, referee_account_id, registration_id,
       charge_reservation_id, amount_micro, referrer_bps, source_charge_micro, created_at)
    VALUES (?, ?, ?, ?, ?, 1000, ?, datetime('now', '-${daysAgo} days'))
  `).run(
    referrerId, refereeId, regId,
    `res-${referrerId}-${refereeId}-${Date.now()}`,
    amount, amount * 10,
  );
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  leaderboard = new LeaderboardService(db, 100); // 100ms TTL for testing

  // Create accounts
  for (const id of ['alice', 'bob', 'charlie', 'dave', 'eve',
                     'ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5']) {
    seedAccount(db, id);
  }
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Leaderboard Service (Sprint 5)', () => {
  // ---------------------------------------------------------------------------
  // Task 5.1: LeaderboardService
  // ---------------------------------------------------------------------------

  describe('getLeaderboard', () => {
    it('returns empty array with no referrals', () => {
      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(0);
    });

    it('returns ranked entries ordered by referral count', () => {
      // Alice: 3 referrals, Bob: 1 referral
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('alice', 'ref-2', 'c1', 'r2');
      createReferral('alice', 'ref-3', 'c1', 'r3');
      createReferral('bob', 'ref-4', 'c2', 'r4');

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(2);
      expect(entries[0].accountId).toBe('alice');
      expect(entries[0].rank).toBe(1);
      expect(entries[0].referralCount).toBe(3);
      expect(entries[1].accountId).toBe('bob');
      expect(entries[1].rank).toBe(2);
      expect(entries[1].referralCount).toBe(1);
    });

    it('includes earnings in leaderboard', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createEarning('alice', 'ref-1', 'r1', 100_000);

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(1);
      expect(entries[0].totalEarningsMicro).toBe(100_000n);
    });

    it('anonymizes account IDs in display names', () => {
      seedAccount(db, 'alice-very-long-account-id');
      createReferral('alice-very-long-account-id', 'ref-1', 'c1', 'r1');

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(1);
      expect(entries[0].displayName).toBe('alice-...t-id');
    });

    it('does not anonymize short account IDs', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries[0].displayName).toBe('alice');
    });

    it('respects limit parameter', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('bob', 'ref-2', 'c2', 'r2');
      createReferral('charlie', 'ref-3', 'c3', 'r3');

      const entries = leaderboard.getLeaderboard('all_time', { limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it('respects offset parameter', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('alice', 'ref-2', 'c1', 'r2');
      createReferral('bob', 'ref-3', 'c2', 'r3');
      createReferral('charlie', 'ref-4', 'c3', 'r4');

      const entries = leaderboard.getLeaderboard('all_time', { limit: 2, offset: 1 });
      expect(entries).toHaveLength(2);
      expect(entries[0].rank).toBe(2);
    });

    it('caps limit at 200', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');

      const entries = leaderboard.getLeaderboard('all_time', { limit: 500 });
      // Should not error, just cap internally
      expect(entries).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Timeframe filtering
  // ---------------------------------------------------------------------------

  describe('timeframe-filtering', () => {
    it('daily timeframe only shows last 24h referrals', () => {
      // Recent referral
      createReferral('alice', 'ref-1', 'c1', 'r1', 0);
      // Old referral (2 days ago)
      createReferral('bob', 'ref-2', 'c2', 'r2', 2);

      const daily = leaderboard.getLeaderboard('daily');
      expect(daily).toHaveLength(1);
      expect(daily[0].accountId).toBe('alice');
    });

    it('weekly timeframe shows last 7 days', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1', 3);
      createReferral('bob', 'ref-2', 'c2', 'r2', 10);

      const weekly = leaderboard.getLeaderboard('weekly');
      expect(weekly).toHaveLength(1);
      expect(weekly[0].accountId).toBe('alice');
    });

    it('monthly timeframe shows last 30 days', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1', 15);
      createReferral('bob', 'ref-2', 'c2', 'r2', 45);

      const monthly = leaderboard.getLeaderboard('monthly');
      expect(monthly).toHaveLength(1);
      expect(monthly[0].accountId).toBe('alice');
    });

    it('all_time shows everything', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1', 0);
      createReferral('bob', 'ref-2', 'c2', 'r2', 100);

      const allTime = leaderboard.getLeaderboard('all_time');
      expect(allTime).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache behavior
  // ---------------------------------------------------------------------------

  describe('cache', () => {
    it('returns cached data on second call within TTL', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');

      const first = leaderboard.getLeaderboard('all_time');
      expect(first).toHaveLength(1);

      // Add another referral — should NOT appear (cached)
      createReferral('bob', 'ref-2', 'c2', 'r2');
      const second = leaderboard.getLeaderboard('all_time');
      expect(second).toHaveLength(1); // Still cached
    });

    it('cache expires after TTL', async () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');

      const first = leaderboard.getLeaderboard('all_time');
      expect(first).toHaveLength(1);

      // Wait for TTL to expire (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      createReferral('bob', 'ref-2', 'c2', 'r2');
      const second = leaderboard.getLeaderboard('all_time');
      expect(second).toHaveLength(2); // Fresh data
    });

    it('invalidateCache clears all cached data', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      leaderboard.getLeaderboard('all_time'); // Populate cache

      createReferral('bob', 'ref-2', 'c2', 'r2');

      leaderboard.invalidateCache();
      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(2); // Fresh data after invalidation
    });

    it('different timeframes have separate cache entries', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1', 0);
      createReferral('bob', 'ref-2', 'c2', 'r2', 10); // old

      const daily = leaderboard.getLeaderboard('daily');
      const allTime = leaderboard.getLeaderboard('all_time');

      expect(daily).toHaveLength(1); // Only recent
      expect(allTime).toHaveLength(2); // All
    });
  });

  // ---------------------------------------------------------------------------
  // Task 5.1: getCreatorRank
  // ---------------------------------------------------------------------------

  describe('getCreatorRank', () => {
    it('returns null for non-participating creator', () => {
      const rank = leaderboard.getCreatorRank('alice', 'all_time');
      expect(rank).toBeNull();
    });

    it('returns rank 1 for top creator', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('alice', 'ref-2', 'c1', 'r2');
      createReferral('bob', 'ref-3', 'c2', 'r3');

      const rank = leaderboard.getCreatorRank('alice', 'all_time');
      expect(rank).not.toBeNull();
      expect(rank!.rank).toBe(1);
      expect(rank!.referralCount).toBe(2);
      expect(rank!.totalParticipants).toBe(2);
    });

    it('returns correct rank for non-top creator', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('alice', 'ref-2', 'c1', 'r2');
      createReferral('alice', 'ref-3', 'c1', 'r3');
      createReferral('bob', 'ref-4', 'c2', 'r4');

      const rank = leaderboard.getCreatorRank('bob', 'all_time');
      expect(rank).not.toBeNull();
      expect(rank!.rank).toBe(2);
      expect(rank!.referralCount).toBe(1);
    });

    it('includes earnings in rank info', () => {
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createEarning('alice', 'ref-1', 'r1', 500_000);

      const rank = leaderboard.getCreatorRank('alice', 'all_time');
      expect(rank).not.toBeNull();
      expect(rank!.totalEarningsMicro).toBe(500_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 5.4: E2E Integration
  // ---------------------------------------------------------------------------

  describe('e2e-leaderboard', () => {
    it('create referrals → generate earnings → query leaderboard → verify ordering', () => {
      // Alice: 3 referrals with earnings
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('alice', 'ref-2', 'c1', 'r2');
      createReferral('alice', 'ref-3', 'c1', 'r3');
      createEarning('alice', 'ref-1', 'r1', 100_000);
      createEarning('alice', 'ref-2', 'r2', 200_000);

      // Bob: 2 referrals with earnings
      createReferral('bob', 'ref-4', 'c2', 'r4');
      createReferral('bob', 'ref-5', 'c2', 'r5');
      createEarning('bob', 'ref-4', 'r4', 500_000);

      // Charlie: 1 referral, no earnings (use unique referee)
      seedAccount(db, 'ref-6');
      createReferral('charlie', 'ref-6', 'c3', 'r6');

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(3);

      // Alice has most referrals (3)
      expect(entries[0].accountId).toBe('alice');
      expect(entries[0].referralCount).toBe(3);
      expect(entries[0].totalEarningsMicro).toBe(300_000n);

      // Bob has 2 referrals
      expect(entries[1].accountId).toBe('bob');
      expect(entries[1].referralCount).toBe(2);
      expect(entries[1].totalEarningsMicro).toBe(500_000n);

      // Charlie has 1 referral
      expect(entries[2].accountId).toBe('charlie');
      expect(entries[2].referralCount).toBe(1);
      expect(entries[2].totalEarningsMicro).toBe(0n);

      // Verify ranks
      const aliceRank = leaderboard.getCreatorRank('alice', 'all_time');
      expect(aliceRank!.rank).toBe(1);

      const bobRank = leaderboard.getCreatorRank('bob', 'all_time');
      expect(bobRank!.rank).toBe(2);
    });

    it('tie-breaking: same referral count ordered by earnings', () => {
      // Both have 1 referral
      createReferral('alice', 'ref-1', 'c1', 'r1');
      createReferral('bob', 'ref-2', 'c2', 'r2');

      // Bob has higher earnings
      createEarning('bob', 'ref-2', 'r2', 1_000_000);
      createEarning('alice', 'ref-1', 'r1', 100_000);

      const entries = leaderboard.getLeaderboard('all_time');
      expect(entries).toHaveLength(2);
      // Both have referralCount=1, so ordered by total_earnings DESC
      expect(entries[0].accountId).toBe('bob');
      expect(entries[1].accountId).toBe('alice');
    });
  });
});
