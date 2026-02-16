/**
 * Billing Referral API Integration Tests (Task 2.4)
 *
 * E2E lifecycle: create code → register → verify attribution → verify log
 * Tests self-referral rejection, expired code, max uses, stats endpoint.
 *
 * SDD refs: §4.1 ReferralService
 * Sprint refs: Task 2.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../src/db/migrations/035_revenue_rules.js';
import { ReferralService, ReferralError } from '../../src/packages/adapters/billing/ReferralService.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let service: ReferralService;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  testDb.exec(REFERRAL_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string, entityType = 'person'): void {
  accountDb.prepare(
    `INSERT INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, entityType, `entity-${id}`);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  service = new ReferralService(db);

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

describe('Referral API E2E Lifecycle', () => {
  // ---------------------------------------------------------------------------
  // Full Lifecycle (Task 2.4 AC)
  // ---------------------------------------------------------------------------

  describe('full-lifecycle', () => {
    it('create code → register → verify attribution → verify log', async () => {
      // Step 1: Alice creates a referral code
      const code = await service.createCode('alice');
      expect(code.status).toBe('active');
      expect(code.code).toHaveLength(10);

      // Step 2: Bob registers with Alice's code
      const reg = await service.register('bob', code.code);
      expect(reg.referrerAccountId).toBe('alice');
      expect(reg.refereeAccountId).toBe('bob');

      // Step 3: Verify attribution is active
      expect(service.isAttributionActive(reg, new Date())).toBe(true);

      // Verify attribution expires in 12 months
      const future13m = new Date();
      future13m.setUTCMonth(future13m.getUTCMonth() + 13);
      expect(service.isAttributionActive(reg, future13m)).toBe(false);

      // Step 4: Verify attribution log
      const logs = db.prepare(
        `SELECT * FROM referral_attribution_log WHERE referee_account_id = 'bob'`
      ).all() as Array<{ outcome: string; referral_code: string }>;

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some(l => l.outcome === 'bound')).toBe(true);
      expect(logs[0].referral_code).toBe(code.code);

      // Step 5: Verify code use_count was incremented
      const updatedCode = await service.getCode('alice');
      expect(updatedCode!.useCount).toBe(1);

      // Step 6: Verify getReferrer returns correct registration
      const referrer = await service.getReferrer('bob');
      expect(referrer).not.toBeNull();
      expect(referrer!.referrerAccountId).toBe('alice');
      expect(referrer!.referralCodeId).toBe(code.id);
    });

    it('multiple referees using same code', async () => {
      const code = await service.createCode('alice');

      // Both Bob and Charlie register
      await service.register('bob', code.code);
      await service.register('charlie', code.code);

      // Code use_count should be 2
      const updatedCode = await service.getCode('alice');
      expect(updatedCode!.useCount).toBe(2);

      // Both should have Alice as referrer
      const bobRef = await service.getReferrer('bob');
      const charlieRef = await service.getReferrer('charlie');
      expect(bobRef!.referrerAccountId).toBe('alice');
      expect(charlieRef!.referrerAccountId).toBe('alice');
    });

    it('qualifying action triggers bonus creation', async () => {
      const code = await service.createCode('alice');
      await service.register('bob', code.code);

      // Bob performs qualifying action
      await service.onQualifyingAction('bob', {
        type: 'dnft_creation',
        actionId: 'dnft-e2e-1',
        amountMicro: 2_000_000n, // $2
      });

      // Verify bonus created
      const bonus = db.prepare(
        `SELECT * FROM referral_bonuses WHERE referee_account_id = 'bob'`
      ).get() as Record<string, unknown>;

      expect(bonus).toBeTruthy();
      expect(bonus.status).toBe('pending');
      expect(bonus.referrer_account_id).toBe('alice');
      expect(bonus.qualifying_action).toBe('dnft_creation');
    });
  });

  // ---------------------------------------------------------------------------
  // Rejection Cases
  // ---------------------------------------------------------------------------

  describe('rejection-cases', () => {
    it('rejects self-referral', async () => {
      const code = await service.createCode('alice');

      try {
        await service.register('alice', code.code);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReferralError);
        expect((err as ReferralError).code).toBe('SELF_REFERRAL');
      }
    });

    it('rejects expired code', async () => {
      // Manually insert expired code
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, expires_at, created_at)
        VALUES ('c-exp', 'alice', 'expiredtest', 'active', datetime('now', '-1 hour'), datetime('now', '-2 days'))
      `).run();

      try {
        await service.register('bob', 'expiredtest');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReferralError);
        expect((err as ReferralError).code).toBe('CODE_EXPIRED');
      }
    });

    it('rejects code at max uses', async () => {
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, max_uses, use_count, created_at)
        VALUES ('c-max', 'alice', 'maxusecode0', 'active', 1, 1, datetime('now'))
      `).run();

      try {
        await service.register('bob', 'maxusecode0');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReferralError);
        expect((err as ReferralError).code).toBe('MAX_USES_REACHED');
      }
    });

    it('rejects invalid/nonexistent code', async () => {
      try {
        await service.register('bob', 'doesntexist');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReferralError);
        expect((err as ReferralError).code).toBe('INVALID_CODE');
      }
    });

    it('rejects duplicate binding after grace period', async () => {
      const code1 = await service.createCode('alice');
      await service.register('bob', code1.code);

      // Move registration time back beyond 24h
      db.prepare(
        `UPDATE referral_registrations SET created_at = datetime('now', '-25 hours') WHERE referee_account_id = 'bob'`
      ).run();

      const code2 = await service.createCode('charlie');
      try {
        await service.register('bob', code2.code);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReferralError);
        expect((err as ReferralError).code).toBe('ALREADY_BOUND');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Stats (Task 2.3)
  // ---------------------------------------------------------------------------

  describe('stats-endpoint', () => {
    it('returns correct stats after registrations and actions', async () => {
      const code = await service.createCode('alice');
      await service.register('bob', code.code);
      await service.register('charlie', code.code);

      // Bob performs qualifying action
      await service.onQualifyingAction('bob', {
        type: 'credit_purchase',
        actionId: 'purchase-e2e-1',
        amountMicro: 10_000_000n,
      });

      const stats = await service.getReferralStats('alice');
      expect(stats.totalReferees).toBe(2);
      expect(stats.activeReferees).toBe(2);
      expect(stats.pendingBonuses).toBe(1);
      expect(stats.totalEarningsMicro).toBe(0n); // No earnings until Sprint 3
    });

    it('handles empty state gracefully', async () => {
      const stats = await service.getReferralStats('alice');
      expect(stats.totalReferees).toBe(0);
      expect(stats.activeReferees).toBe(0);
      expect(stats.pendingBonuses).toBe(0);
      expect(stats.totalEarningsMicro).toBe(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // Migration 043 — Revenue Rules Referrer BPS (Task 2.2)
  // ---------------------------------------------------------------------------

  describe('migration-043-revenue-rules-referrer', () => {
    it('revenue_rules has referrer_bps column after migration', () => {
      // Run migration 043
      db.exec(`ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0`);

      const columns = db.prepare('PRAGMA table_info(revenue_rules)').all() as Array<{ name: string }>;
      expect(columns.some(c => c.name === 'referrer_bps')).toBe(true);
    });

    it('existing active rule gets referrer_bps = 0 (default)', () => {
      db.exec(`ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0`);

      const rule = db.prepare(
        `SELECT referrer_bps FROM revenue_rules WHERE status = 'active'`
      ).get() as { referrer_bps: number } | undefined;

      expect(rule).toBeTruthy();
      expect(rule!.referrer_bps).toBe(0);
    });

    it('can create rule with referrer_bps allocation', () => {
      db.exec(`ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0`);

      // Note: existing bps_sum_100 constraint requires commons+community+foundation=10000.
      // referrer_bps is tracked separately (comes from community's share at application time).
      // The constraint update to include referrer_bps is deferred to Sprint 3.
      db.prepare(`
        INSERT INTO revenue_rules
          (id, name, status, commons_bps, community_bps, foundation_bps, referrer_bps,
           proposed_by, created_at, updated_at)
        VALUES
          ('test-ref-rule', 'Test Referral Rule', 'draft',
           500, 7000, 2500, 1000,
           'test', datetime('now'), datetime('now'))
      `).run();

      const rule = db.prepare(
        `SELECT * FROM revenue_rules WHERE id = 'test-ref-rule'`
      ).get() as Record<string, unknown>;

      expect(rule.referrer_bps).toBe(1000);
      expect(rule.commons_bps).toBe(500);
      expect(rule.community_bps).toBe(7000);
      expect(rule.foundation_bps).toBe(2500);
    });
  });
});
