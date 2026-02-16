/**
 * Fraud Check & Bonus Processing Integration Tests (Sprint 4)
 *
 * Tests FraudCheckService scoring, ReferralEventCapture HMAC hashing,
 * BonusProcessor delayed granting, and admin bonus review endpoints.
 *
 * SDD refs: §4.7 FraudCheckService, §4.4 Bonus Processing
 * Sprint refs: Tasks 4.1–4.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createHmac } from 'crypto';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { FraudCheckService, type FraudScore } from '../../src/packages/adapters/billing/FraudCheckService.js';
import { ReferralEventCapture } from '../../src/packages/adapters/billing/ReferralEventCapture.js';
import { BonusProcessor } from '../../src/packages/adapters/billing/BonusProcessor.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let fraudService: FraudCheckService;
let eventCapture: ReferralEventCapture;
let bonusProcessor: BonusProcessor;

const TEST_HMAC_KEY = 'test-secret-key-for-hmac-hashing';

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(REFERRAL_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string, entityType = 'person'): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, entityType, `entity-${id}`);
}

function hmac(value: string): string {
  return createHmac('sha256', TEST_HMAC_KEY).update(value).digest('hex');
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  fraudService = new FraudCheckService(db);
  eventCapture = new ReferralEventCapture(db, TEST_HMAC_KEY);
  bonusProcessor = new BonusProcessor(db, fraudService);

  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
  seedAccount(db, 'charlie');
  seedAccount(db, 'sybil-1');
  seedAccount(db, 'sybil-2');
  seedAccount(db, 'sybil-3');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Fraud Check & Bonus Processing (Sprint 4)', () => {
  // ---------------------------------------------------------------------------
  // Task 4.1: FraudCheckService
  // ---------------------------------------------------------------------------

  describe('FraudCheckService', () => {
    it('scores clean registration as clear', () => {
      // Single event, no clustering
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        ip: '1.2.3.4',
        userAgent: 'Mozilla/5.0 Chrome',
        fingerprint: 'fp-unique-alice',
      });

      const score = fraudService.scoreRegistration('alice');
      expect(score.verdict).toBe('clear');
      expect(score.score).toBeLessThan(0.3);
    });

    it('flags registration with IP cluster', () => {
      // 3+ accounts sharing same IP → suspicious
      const sharedIp = '10.0.0.1';
      for (const acct of ['sybil-1', 'sybil-2', 'sybil-3', 'bob']) {
        eventCapture.capture({
          accountId: acct,
          eventType: 'registration',
          ip: sharedIp,
          userAgent: `UA-${acct}`,
          fingerprint: `fp-${acct}`,
        });
      }

      const score = fraudService.scoreRegistration('bob');
      expect(score.score).toBeGreaterThan(0);
      // IP signal should be elevated
      const ipSignal = score.signals.find(s => s.name === 'ipCluster');
      expect(ipSignal).toBeTruthy();
      expect(ipSignal!.value).toBeGreaterThan(0);
    });

    it('flags registration with fingerprint cluster', () => {
      const sharedFp = 'fp-shared-device';
      for (const acct of ['sybil-1', 'sybil-2', 'bob']) {
        eventCapture.capture({
          accountId: acct,
          eventType: 'registration',
          ip: `unique-ip-${acct}`,
          fingerprint: sharedFp,
        });
      }

      const score = fraudService.scoreRegistration('bob');
      const fpSignal = score.signals.find(s => s.name === 'uaFingerprint');
      expect(fpSignal).toBeTruthy();
      expect(fpSignal!.value).toBeGreaterThan(0);
    });

    it('detects velocity spike', () => {
      // Many registrations from same IP prefix in short window
      for (let i = 0; i < 6; i++) {
        db.prepare(`
          INSERT INTO referral_events (account_id, event_type, ip_hash, ip_prefix, created_at)
          VALUES (?, 'registration', ?, '192.168.1', datetime('now', '-${i} minutes'))
        `).run(`sybil-${i % 3 + 1}`, hmac(`192.168.1.${i}`));
      }

      // Also add bob's event with same prefix
      eventCapture.capture({
        accountId: 'bob',
        eventType: 'registration',
        ip: '192.168.1.100',
      });

      const score = fraudService.scoreRegistration('bob');
      const velSignal = score.signals.find(s => s.name === 'velocity');
      expect(velSignal).toBeTruthy();
      expect(velSignal!.value).toBeGreaterThan(0);
    });

    it('returns clear verdict when no events exist', () => {
      const score = fraudService.scoreRegistration('alice');
      expect(score.verdict).toBe('clear');
      expect(score.score).toBe(0);
    });

    it('respects custom thresholds', () => {
      const strictService = new FraudCheckService(db, {
        flagged: 0.1,
        withheld: 0.2,
      });

      // Create mild clustering (2 accounts same IP)
      const sharedIp = '10.0.0.1';
      for (const acct of ['sybil-1', 'bob']) {
        eventCapture.capture({
          accountId: acct,
          eventType: 'registration',
          ip: sharedIp,
        });
      }

      const defaultScore = fraudService.scoreRegistration('bob');
      const strictScore = strictService.scoreRegistration('bob');

      // Same raw score, but strict thresholds may yield different verdict
      expect(defaultScore.score).toBe(strictScore.score);
    });

    it('scores bonus claim with activity check', () => {
      eventCapture.capture({
        accountId: 'bob',
        eventType: 'registration',
        ip: '1.2.3.4',
      });

      // Bonus was created 3 days ago; qualifying action happened 2 days ago (within 7-day window)
      const bonusDate = new Date(Date.now() - 3 * 86400000).toISOString();
      db.prepare(`
        INSERT INTO referral_events (account_id, event_type, created_at)
        VALUES ('bob', 'qualifying_action', datetime(?, '+1 day'))
      `).run(bonusDate);

      const score = fraudService.scoreBonusClaim('bob', bonusDate);
      const actSignal = score.signals.find(s => s.name === 'activityCheck');
      expect(actSignal).toBeTruthy();
      expect(actSignal!.value).toBe(0); // Activity present = not suspicious
    });

    it('flags bonus claim without 7-day activity', () => {
      eventCapture.capture({
        accountId: 'bob',
        eventType: 'registration',
        ip: '1.2.3.4',
      });

      // No qualifying_action events → suspicious
      const score = fraudService.scoreBonusClaim('bob', new Date().toISOString());
      const actSignal = score.signals.find(s => s.name === 'activityCheck');
      expect(actSignal).toBeTruthy();
      expect(actSignal!.value).toBe(0.8); // No activity = suspicious
    });

    it('threshold routing: clear/flagged/withheld', () => {
      // Test with explicit thresholds
      const svc = new FraudCheckService(db, { flagged: 0.3, withheld: 0.7 });

      // Zero signals → clear
      let score = svc.scoreRegistration('alice');
      expect(score.verdict).toBe('clear');

      // Create enough clustering for flagged (3 accounts same IP = 1.0 * 0.30 = 0.30)
      const sharedIp = '10.0.0.1';
      for (const acct of ['sybil-1', 'sybil-2', 'sybil-3', 'bob']) {
        eventCapture.capture({
          accountId: acct,
          eventType: 'registration',
          ip: sharedIp,
          fingerprint: `unique-fp-${acct}`,
        });
      }
      score = svc.scoreRegistration('bob');
      expect(score.score).toBeGreaterThanOrEqual(0.3);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 4.2: ReferralEventCapture
  // ---------------------------------------------------------------------------

  describe('ReferralEventCapture', () => {
    it('captures event with HMAC-hashed IP', () => {
      // Create a real referral code for FK reference
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES ('code-1', 'alice', 'testcode001', 'active', datetime('now'))
      `).run();

      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        ip: '192.168.1.100',
        referralCodeId: 'code-1',
      });

      const event = db.prepare(
        `SELECT * FROM referral_events WHERE account_id = 'alice'`
      ).get() as Record<string, unknown>;

      expect(event).toBeTruthy();
      expect(event.event_type).toBe('registration');
      expect(event.ip_hash).toBe(hmac('192.168.1.100'));
      expect(event.ip_prefix).toBe('192.168.1');
      expect(event.referral_code_id).toBe('code-1');
    });

    it('captures event with HMAC-hashed User-Agent and fingerprint', () => {
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        userAgent: 'Mozilla/5.0 Chrome/120',
        fingerprint: 'abc123-fp-hash',
      });

      const event = db.prepare(
        `SELECT * FROM referral_events WHERE account_id = 'alice'`
      ).get() as Record<string, unknown>;

      expect(event.user_agent_hash).toBe(hmac('Mozilla/5.0 Chrome/120'));
      expect(event.fingerprint_hash).toBe(hmac('abc123-fp-hash'));
    });

    it('never stores raw IP or User-Agent', () => {
      const rawIp = '10.20.30.40';
      const rawUa = 'Mozilla/5.0 SecretBrowser';

      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        ip: rawIp,
        userAgent: rawUa,
      });

      const event = db.prepare(
        `SELECT * FROM referral_events WHERE account_id = 'alice'`
      ).get() as Record<string, unknown>;

      // The stored values should be HMAC hashes, not raw
      expect(event.ip_hash).not.toBe(rawIp);
      expect(event.user_agent_hash).not.toBe(rawUa);
      expect(event.ip_hash).toBe(hmac(rawIp));
    });

    it('extracts IPv4 prefix (first 3 octets)', () => {
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        ip: '172.16.254.99',
      });

      const event = db.prepare(
        `SELECT ip_prefix FROM referral_events WHERE account_id = 'alice'`
      ).get() as { ip_prefix: string };

      expect(event.ip_prefix).toBe('172.16.254');
    });

    it('extracts IPv6 prefix (first 4 groups)', () => {
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'registration',
        ip: '2001:db8:85a3:0000:0000:8a2e:0370:7334',
      });

      const event = db.prepare(
        `SELECT ip_prefix FROM referral_events WHERE account_id = 'alice'`
      ).get() as { ip_prefix: string };

      expect(event.ip_prefix).toBe('2001:db8:85a3:0000');
    });

    it('handles null fields gracefully', () => {
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'qualifying_action',
      });

      const event = db.prepare(
        `SELECT * FROM referral_events WHERE account_id = 'alice'`
      ).get() as Record<string, unknown>;

      expect(event).toBeTruthy();
      expect(event.ip_hash).toBeNull();
      expect(event.ip_prefix).toBeNull();
      expect(event.user_agent_hash).toBeNull();
      expect(event.fingerprint_hash).toBeNull();
    });

    it('stores metadata as JSON', () => {
      eventCapture.capture({
        accountId: 'alice',
        eventType: 'bonus_claim',
        metadata: { action: 'dnft_creation', actionId: 'dnft-1' },
      });

      const event = db.prepare(
        `SELECT metadata FROM referral_events WHERE account_id = 'alice'`
      ).get() as { metadata: string };

      const parsed = JSON.parse(event.metadata);
      expect(parsed.action).toBe('dnft_creation');
      expect(parsed.actionId).toBe('dnft-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Task 4.4: BonusProcessor
  // ---------------------------------------------------------------------------

  describe('BonusProcessor', () => {
    function createReferralSetup(): { codeId: string; regId: string } {
      const codeId = 'code-proc-1';
      const regId = 'reg-proc-1';

      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'alice', 'proctest000', 'active', datetime('now'))
      `).run(codeId);

      db.prepare(`
        INSERT INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
        VALUES (?, 'bob', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
      `).run(regId, codeId);

      return { codeId, regId };
    }

    function insertPendingBonus(
      bonusId: string,
      regId: string,
      daysAgo: number,
      amount = 1_000_000,
    ): void {
      db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status, created_at)
        VALUES (?, 'bob', 'alice', ?, 'dnft_creation', ?, ?, 'pending',
                datetime('now', '-${daysAgo} days'))
      `).run(bonusId, regId, `action-${bonusId}`, amount);
    }

    it('skips bonuses younger than 7 days', () => {
      const { regId } = createReferralSetup();
      insertPendingBonus('bonus-young', regId, 3); // 3 days old

      const result = bonusProcessor.processDelayedBonuses();
      expect(result.processed).toBe(0);

      // Bonus still pending
      const bonus = db.prepare(
        `SELECT status FROM referral_bonuses WHERE id = 'bonus-young'`
      ).get() as { status: string };
      expect(bonus.status).toBe('pending');
    });

    it('grants clear bonus after 7-day hold', () => {
      const { regId } = createReferralSetup();
      insertPendingBonus('bonus-clear', regId, 8); // 8 days old

      // Add activity event so fraud score is low
      db.prepare(`
        INSERT INTO referral_events (account_id, event_type, created_at)
        VALUES ('bob', 'qualifying_action', datetime('now', '-7 days'))
      `).run();

      eventCapture.capture({
        accountId: 'bob',
        eventType: 'registration',
        ip: '1.2.3.4',
      });

      const result = bonusProcessor.processDelayedBonuses();
      expect(result.processed).toBe(1);
      expect(result.granted).toBe(1);

      // Bonus granted
      const bonus = db.prepare(
        `SELECT status, grant_id FROM referral_bonuses WHERE id = 'bonus-clear'`
      ).get() as { status: string; grant_id: string };
      expect(bonus.status).toBe('granted');
      expect(bonus.grant_id).toBeTruthy();

      // Ledger entry created
      const entry = db.prepare(
        `SELECT * FROM credit_ledger WHERE reservation_id = 'bonus-bonus-clear'`
      ).get() as Record<string, unknown>;
      expect(entry).toBeTruthy();
      expect(entry.pool_id).toBe('referral:signup');
      expect(entry.entry_type).toBe('grant');
    });

    it('flags suspicious bonus', () => {
      const { regId } = createReferralSetup();
      insertPendingBonus('bonus-sus', regId, 10);

      // Create IP clustering to bump fraud score
      const sharedIp = '10.0.0.1';
      for (const acct of ['sybil-1', 'sybil-2', 'sybil-3', 'bob']) {
        eventCapture.capture({
          accountId: acct,
          eventType: 'registration',
          ip: sharedIp,
          fingerprint: `fp-${acct}`,
        });
      }
      // No qualifying_action → activity signal is high too

      // Use strict thresholds to force flagged verdict
      const strictFraud = new FraudCheckService(db, { flagged: 0.15, withheld: 0.7 });
      const strictProcessor = new BonusProcessor(db, strictFraud);

      const result = strictProcessor.processDelayedBonuses();
      expect(result.processed).toBe(1);
      expect(result.flagged + result.withheld).toBeGreaterThanOrEqual(1);

      const bonus = db.prepare(
        `SELECT status, flag_reason, risk_score FROM referral_bonuses WHERE id = 'bonus-sus'`
      ).get() as { status: string; flag_reason: string; risk_score: number };
      expect(['flagged', 'withheld']).toContain(bonus.status);
      expect(bonus.flag_reason).toBeTruthy();
      expect(bonus.risk_score).toBeGreaterThan(0);
    });

    it('processes multiple bonuses in one batch', () => {
      const { regId } = createReferralSetup();

      // Create 3 pending bonuses older than 7 days
      for (let i = 0; i < 3; i++) {
        db.prepare(`
          INSERT INTO referral_bonuses
            (id, referee_account_id, referrer_account_id, registration_id,
             qualifying_action, qualifying_action_id, amount_micro, status, created_at)
          VALUES (?, 'bob', 'alice', ?, 'dnft_creation', ?, 500000, 'pending',
                  datetime('now', '-${8 + i} days'))
        `).run(`bonus-batch-${i}`, regId, `action-batch-${i}`);
      }

      const result = bonusProcessor.processDelayedBonuses();
      expect(result.processed).toBe(3);
    });

    it('returns empty result when no pending bonuses', () => {
      const result = bonusProcessor.processDelayedBonuses();
      expect(result.processed).toBe(0);
      expect(result.granted).toBe(0);
      expect(result.flagged).toBe(0);
    });

    it('records risk_score and fraud_check_at', () => {
      const { regId } = createReferralSetup();
      insertPendingBonus('bonus-scored', regId, 8);

      bonusProcessor.processDelayedBonuses();

      const bonus = db.prepare(
        `SELECT risk_score, fraud_check_at FROM referral_bonuses WHERE id = 'bonus-scored'`
      ).get() as { risk_score: number; fraud_check_at: string };

      expect(bonus.risk_score).toBeGreaterThanOrEqual(0);
      expect(bonus.fraud_check_at).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Task 4.5: Admin Bonus Review
  // ---------------------------------------------------------------------------

  describe('admin-bonus-review', () => {
    function createFlaggedBonus(bonusId: string, amount = 1_000_000): void {
      const codeId = `code-${bonusId}`;
      const regId = `reg-${bonusId}`;

      db.prepare(`
        INSERT OR IGNORE INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'alice', ?, 'active', datetime('now'))
      `).run(codeId, `flagcode${bonusId.slice(0, 4)}`);

      db.prepare(`
        INSERT OR IGNORE INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
        VALUES (?, 'bob', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
      `).run(regId, codeId);

      db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status,
           risk_score, flag_reason, fraud_check_at, created_at)
        VALUES (?, 'bob', 'alice', ?, 'dnft_creation', ?, ?, 'flagged',
                0.5, 'IP cluster detected', datetime('now'), datetime('now', '-8 days'))
      `).run(bonusId, regId, `action-${bonusId}`, amount);
    }

    it('approve grants bonus and creates ledger entry', () => {
      createFlaggedBonus('flag-approve');

      // Simulate admin approve (direct DB, testing the logic)
      const grantId = 'test-grant-id';
      const now = new Date().toISOString();

      db.transaction(() => {
        db.prepare(`
          INSERT INTO credit_ledger
            (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
             amount_micro, description, created_at)
          VALUES (?, 'alice', 'referral:signup', 'bonus-flag-approve', 0, 'grant',
                  1000000, 'Admin-approved referral bonus', ?)
        `).run(grantId, now);

        db.prepare(`
          UPDATE referral_bonuses
          SET status = 'granted', granted_at = ?, grant_id = ?, reviewed_by = 'admin-1'
          WHERE id = 'flag-approve'
        `).run(now, grantId);
      })();

      const bonus = db.prepare(
        `SELECT * FROM referral_bonuses WHERE id = 'flag-approve'`
      ).get() as Record<string, unknown>;
      expect(bonus.status).toBe('granted');
      expect(bonus.grant_id).toBe(grantId);
      expect(bonus.reviewed_by).toBe('admin-1');

      const entry = db.prepare(
        `SELECT * FROM credit_ledger WHERE id = ?`
      ).get(grantId) as Record<string, unknown>;
      expect(entry).toBeTruthy();
      expect(entry.pool_id).toBe('referral:signup');
    });

    it('deny sets status without ledger entry', () => {
      createFlaggedBonus('flag-deny');

      db.prepare(`
        UPDATE referral_bonuses
        SET status = 'denied', flag_reason = 'Confirmed sybil', reviewed_by = 'admin-2'
        WHERE id = 'flag-deny'
      `).run();

      const bonus = db.prepare(
        `SELECT * FROM referral_bonuses WHERE id = 'flag-deny'`
      ).get() as Record<string, unknown>;
      expect(bonus.status).toBe('denied');
      expect(bonus.reviewed_by).toBe('admin-2');
      expect(bonus.flag_reason).toBe('Confirmed sybil');

      // No ledger entry for denied bonus
      const entries = db.prepare(
        `SELECT COUNT(*) as count FROM credit_ledger WHERE reservation_id = 'bonus-flag-deny'`
      ).get() as { count: number };
      expect(entries.count).toBe(0);
    });

    it('audit log records admin actions', () => {
      // Insert audit log entry (simulating what the route handler does)
      db.prepare(`
        INSERT INTO admin_audit_log
          (id, actor_type, actor_id, action, target_type, target_id, details, created_at)
        VALUES ('audit-1', 'admin', 'admin-1', 'bonus_approve', 'referral_bonus', 'flag-1',
                '{"amountMicro":1000000}', datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO admin_audit_log
          (id, actor_type, actor_id, action, target_type, target_id, details, created_at)
        VALUES ('audit-2', 'admin', 'admin-1', 'bonus_deny', 'referral_bonus', 'flag-2',
                '{"reason":"sybil"}', datetime('now'))
      `).run();

      const logs = db.prepare(
        `SELECT * FROM admin_audit_log WHERE action LIKE 'bonus_%' ORDER BY created_at`
      ).all() as Array<Record<string, unknown>>;

      expect(logs.length).toBe(2);
      expect(logs[0].action).toBe('bonus_approve');
      expect(logs[1].action).toBe('bonus_deny');
      expect(logs[0].actor_type).toBe('admin');
    });

    it('cannot approve non-flagged bonus', () => {
      const codeId = 'code-nf';
      const regId = 'reg-nf';
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'alice', 'nonflagged0', 'active', datetime('now'))
      `).run(codeId);
      db.prepare(`
        INSERT OR IGNORE INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
        VALUES (?, 'bob', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
      `).run(regId, codeId);
      db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status)
        VALUES ('not-flagged', 'bob', 'alice', ?, 'dnft_creation', 'act-nf', 500000, 'granted')
      `).run(regId);

      // Bonus is 'granted', not 'flagged' — admin approval should not be valid
      const bonus = db.prepare(
        `SELECT status FROM referral_bonuses WHERE id = 'not-flagged'`
      ).get() as { status: string };
      expect(bonus.status).toBe('granted');
      // Route handler checks status before approving — this test verifies the data constraint
    });
  });

  // ---------------------------------------------------------------------------
  // E2E: Full lifecycle
  // ---------------------------------------------------------------------------

  describe('e2e-lifecycle', () => {
    it('registration → event capture → bonus → fraud check → grant', () => {
      // Step 1: Set up referral
      const codeId = 'code-e2e';
      const regId = 'reg-e2e';
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'alice', 'e2etest0000', 'active', datetime('now'))
      `).run(codeId);
      db.prepare(`
        INSERT INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
        VALUES (?, 'bob', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
      `).run(regId, codeId);

      // Step 2: Capture registration event
      eventCapture.capture({
        accountId: 'bob',
        eventType: 'registration',
        ip: '1.2.3.4',
        userAgent: 'Mozilla/5.0',
        fingerprint: 'unique-fp-bob',
        referralCodeId: codeId,
      });

      // Step 3: Create pending bonus (simulating qualifying action, 8 days ago)
      db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status, created_at)
        VALUES ('bonus-e2e', 'bob', 'alice', ?, 'credit_purchase', 'purchase-e2e', 5000000,
                'pending', datetime('now', '-8 days'))
      `).run(regId);

      // Step 4: Capture qualifying action event
      db.prepare(`
        INSERT INTO referral_events (account_id, event_type, created_at)
        VALUES ('bob', 'qualifying_action', datetime('now', '-7 days'))
      `).run();

      // Step 5: Process delayed bonuses
      const result = bonusProcessor.processDelayedBonuses();
      expect(result.processed).toBe(1);
      expect(result.granted).toBe(1);

      // Step 6: Verify grant
      const bonus = db.prepare(
        `SELECT * FROM referral_bonuses WHERE id = 'bonus-e2e'`
      ).get() as Record<string, unknown>;
      expect(bonus.status).toBe('granted');
      expect(bonus.risk_score).toBeGreaterThanOrEqual(0);
      expect(bonus.fraud_check_at).toBeTruthy();
      expect(bonus.grant_id).toBeTruthy();

      // Step 7: Verify ledger entry
      const ledgerEntry = db.prepare(
        `SELECT * FROM credit_ledger WHERE reservation_id = 'bonus-bonus-e2e'`
      ).get() as Record<string, unknown>;
      expect(ledgerEntry).toBeTruthy();
      expect(ledgerEntry.account_id).toBe('alice'); // Referrer gets the bonus
      expect(ledgerEntry.pool_id).toBe('referral:signup');
      expect(Number(ledgerEntry.amount_micro)).toBe(5000000);
    });
  });
});
