/**
 * Phase 1A Integration Testing & Fraud Pipeline Validation (Sprint 7)
 *
 * Tests the complete non-withdrawable earnings pipeline end-to-end:
 * - Full lifecycle: referral → bonus → settlement
 * - Fraud pipeline scoring & routing
 * - Conservation invariant across mixed attribution distributions
 * - Treasury invariant check
 * - Observability metrics emission
 * - Referral event cleanup cron
 *
 * SDD refs: §4.3 Phase 1A Validation
 * Sprint refs: Tasks 7.1–7.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { FraudCheckService } from '../../src/packages/adapters/billing/FraudCheckService.js';
import { BonusProcessor } from '../../src/packages/adapters/billing/BonusProcessor.js';
import { SettlementService } from '../../src/packages/adapters/billing/SettlementService.js';
import { RevenueDistributionService } from '../../src/packages/adapters/billing/RevenueDistributionService.js';
import { BillingMetrics } from '../../src/packages/adapters/billing/BillingMetrics.js';
import { createTreasuryInvariantCheck } from '../../src/jobs/treasury-invariant-check.js';
import { createReferralEventCleanup } from '../../src/jobs/referral-event-cleanup.js';

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
  // Add settlement columns
  try { testDb.exec(`ALTER TABLE referrer_earnings ADD COLUMN settled_at TEXT`); } catch {}
  try { testDb.exec(`ALTER TABLE referrer_earnings ADD COLUMN clawback_reason TEXT`); } catch {}
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, 'person', ?, datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
}

function seedReferralCode(accountDb: Database.Database, codeId: string, accountId: string, code: string): void {
  accountDb.prepare(`
    INSERT INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
  `).run(codeId, accountId, code);
}

function seedRegistration(
  accountDb: Database.Database, regId: string,
  refereeId: string, referrerId: string, codeId: string
): void {
  accountDb.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+12 months'))
  `).run(regId, refereeId, referrerId, codeId);
}

function seedBonus(
  accountDb: Database.Database, bonusId: string,
  refereeId: string, referrerId: string, regId: string,
  amount: number, daysAgo: number
): void {
  accountDb.prepare(`
    INSERT INTO referral_bonuses
      (id, referee_account_id, referrer_account_id, registration_id,
       qualifying_action, qualifying_action_id, amount_micro, status, created_at)
    VALUES (?, ?, ?, ?, 'credit_purchase', ?, ?, 'pending', datetime('now', '-${daysAgo} days'))
  `).run(bonusId, refereeId, referrerId, regId, `action-${bonusId}`, amount);
}

function seedEvent(
  accountDb: Database.Database, accountId: string,
  eventType: string, ipHash: string, ipPrefix: string,
  fpHash: string | null, daysAgo: number = 0
): void {
  accountDb.prepare(`
    INSERT INTO referral_events
      (account_id, event_type, ip_hash, ip_prefix, fingerprint_hash, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '-${daysAgo} days'))
  `).run(accountId, eventType, ipHash, ipPrefix, fpHash);
}

function insertEarning(
  accountDb: Database.Database, earningId: string, regId: string,
  referrerAccountId: string, refereeAccountId: string,
  amount: number, hoursAgo: number
): void {
  accountDb.prepare(`
    INSERT INTO referrer_earnings
      (id, referrer_account_id, referee_account_id, registration_id,
       charge_reservation_id, amount_micro, referrer_bps, source_charge_micro, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1000, ?, datetime('now', '-${hoursAgo} hours'))
  `).run(earningId, referrerAccountId, refereeAccountId, regId, `res-${earningId}`, amount, amount * 10);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
  seedAccount(db, 'charlie');
  seedAccount(db, 'dave');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 7.1: Full Lifecycle Integration Test
// =============================================================================

describe('Task 7.1: Full Lifecycle Integration', () => {
  it('referral code → registration → bonus → fraud check → grant → settlement', () => {
    // Step 1: Create referral code
    seedReferralCode(db, 'code-life', 'alice', 'LIFECYCLE1');

    // Step 2: Register referee
    seedRegistration(db, 'reg-life', 'bob', 'alice', 'code-life');

    // Step 3: Seed events for fraud scoring (clean signals)
    seedEvent(db, 'bob', 'registration', 'ip-unique-1', '192.168.1', null);

    // Step 4: Create bonus (8 days ago to pass 7-day hold)
    seedBonus(db, 'bonus-life', 'bob', 'alice', 'reg-life', 500_000, 8);

    // Step 5: Add qualifying action for activity check
    seedEvent(db, 'bob', 'qualifying_action', 'ip-unique-1', '192.168.1', null, 5);

    // Step 6: Process bonus through fraud pipeline
    const fraudService = new FraudCheckService(db);
    const processor = new BonusProcessor(db, fraudService);
    const bonusResult = processor.processDelayedBonuses();

    expect(bonusResult.granted).toBe(1);
    expect(bonusResult.flagged).toBe(0);
    expect(bonusResult.withheld).toBe(0);

    // Step 7: Create referrer earnings (50h ago → eligible for settlement)
    insertEarning(db, 'earn-life', 'reg-life', 'alice', 'bob', 100_000, 50);

    // Step 8: Settle
    const settlement = new SettlementService(db);
    const settleResult = settlement.settleEarnings();
    expect(settleResult.settled).toBe(1);

    // Step 9: Verify settled (non-withdrawable Phase 1A)
    expect(settlement.getSettledBalance('alice')).toBe(100_000n);
    expect(settlement.getPendingBalance('alice')).toBe(0n);

    // Step 10: Clawback rejected (already settled)
    const clawback = settlement.clawbackEarning('earn-life', 'Too late');
    expect(clawback.success).toBe(false);
    expect(clawback.reason).toContain('already settled');
  });

  it('referral → earning → clawback before settlement → earning reversed', () => {
    seedReferralCode(db, 'code-rev', 'alice', 'REVERSE1');
    seedRegistration(db, 'reg-rev', 'charlie', 'alice', 'code-rev');

    // Create two earnings — one young (clawback-eligible), one old
    insertEarning(db, 'earn-young', 'reg-rev', 'alice', 'charlie', 300_000, 24);
    insertEarning(db, 'earn-old', 'reg-rev', 'alice', 'charlie', 200_000, 50);

    const settlement = new SettlementService(db);

    // Clawback the young one
    const clawback = settlement.clawbackEarning('earn-young', 'Refund requested');
    expect(clawback.success).toBe(true);

    // Settle remaining
    const settleResult = settlement.settleEarnings();
    expect(settleResult.settled).toBe(1); // Only earn-old

    // Verify balance excludes clawed-back
    expect(settlement.getSettledBalance('alice')).toBe(200_000n);
    expect(settlement.getPendingBalance('alice')).toBe(0n);

    // Verify compensating ledger entry
    const refund = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = 'clawback:earn-young'
    `).get() as Record<string, unknown>;
    expect(refund).toBeTruthy();
    expect(Number(refund.amount_micro)).toBe(-300_000);
  });
});

// =============================================================================
// Task 7.2: Fraud Pipeline Validation
// =============================================================================

describe('Task 7.2: Fraud Pipeline Validation', () => {
  it('IP cluster > 3 accounts → high IP signal', () => {
    const sharedIp = 'ip-shared-hash';
    const sharedPrefix = '10.0.0';

    // 4 accounts sharing the same IP (> threshold of 3)
    seedEvent(db, 'alice', 'registration', sharedIp, sharedPrefix, null);
    seedEvent(db, 'bob', 'registration', sharedIp, sharedPrefix, null);
    seedEvent(db, 'charlie', 'registration', sharedIp, sharedPrefix, null);
    seedEvent(db, 'dave', 'registration', sharedIp, sharedPrefix, null);

    const fraud = new FraudCheckService(db);
    const score = fraud.scoreRegistration('dave');

    // dave shares IP with 3 others → value = min(3/3, 1.0) = 1.0
    const ipSignal = score.signals.find(s => s.name === 'ipCluster');
    expect(ipSignal!.value).toBe(1.0);
  });

  it('rapid registrations > 5/hr → high velocity signal', () => {
    const prefix = '172.16.0';

    // 6 registrations from same IP prefix within 1 hour
    for (let i = 0; i < 6; i++) {
      seedAccount(db, `rapid-${i}`);
      seedEvent(db, `rapid-${i}`, 'registration', `ip-rapid-${i}`, prefix, null);
    }

    const fraud = new FraudCheckService(db);
    const score = fraud.scoreRegistration('rapid-5');

    const velSignal = score.signals.find(s => s.name === 'velocity');
    expect(velSignal!.value).toBeGreaterThan(0.8);
  });

  it('clear bonus → granted after 7 days', () => {
    seedReferralCode(db, 'code-clear', 'alice', 'CLEAR1');
    seedRegistration(db, 'reg-clear', 'bob', 'alice', 'code-clear');

    // Clean signals — unique IP, no clustering
    seedEvent(db, 'bob', 'registration', 'ip-clean-1', '192.0.2', 'fp-clean-1', 10);
    seedEvent(db, 'bob', 'qualifying_action', 'ip-clean-1', '192.0.2', 'fp-clean-1', 5);

    seedBonus(db, 'bonus-clear', 'bob', 'alice', 'reg-clear', 100_000, 8);

    const fraud = new FraudCheckService(db);
    const processor = new BonusProcessor(db, fraud);
    const result = processor.processDelayedBonuses();

    expect(result.granted).toBe(1);
    expect(result.withheld).toBe(0);
  });

  it('withheld bonus → blocked at high fraud score', () => {
    seedReferralCode(db, 'code-fraud', 'alice', 'FRAUD1');
    seedRegistration(db, 'reg-fraud', 'bob', 'alice', 'code-fraud');

    // Cluster signals — same IP shared by 4+, same fingerprint shared by 3+
    const sharedIp = 'ip-sybil';
    const sharedFp = 'fp-sybil';
    const sharedPrefix = '10.10.10';

    seedEvent(db, 'bob', 'registration', sharedIp, sharedPrefix, sharedFp, 10);
    seedEvent(db, 'charlie', 'registration', sharedIp, sharedPrefix, sharedFp, 10);
    seedEvent(db, 'dave', 'registration', sharedIp, sharedPrefix, sharedFp, 10);
    seedAccount(db, 'eve');
    seedEvent(db, 'eve', 'registration', sharedIp, sharedPrefix, sharedFp, 10);

    // Also add velocity signals
    for (let i = 0; i < 6; i++) {
      seedAccount(db, `vel-${i}`);
      seedEvent(db, `vel-${i}`, 'registration', `ip-vel-${i}`, sharedPrefix, null);
    }

    // No activity (will add 0.8 * 0.20 = 0.16 to score)
    seedBonus(db, 'bonus-fraud', 'bob', 'alice', 'reg-fraud', 100_000, 8);

    const fraud = new FraudCheckService(db);
    const score = fraud.scoreBonusClaim('bob', new Date(Date.now() - 8 * 86400000).toISOString());

    // Should be ≥ 0.7 (withheld threshold)
    expect(score.verdict).toBe('withheld');
    expect(score.score).toBeGreaterThanOrEqual(0.7);

    const processor = new BonusProcessor(db, fraud);
    const result = processor.processDelayedBonuses();

    expect(result.withheld).toBe(1);
    expect(result.granted).toBe(0);
  });

  it('all fraud signals produce expected verdicts', () => {
    const fraud = new FraudCheckService(db, { flagged: 0.3, withheld: 0.7 });

    // Clean account — no events at all → all signals 0
    const cleanScore = fraud.scoreRegistration('alice');
    expect(cleanScore.verdict).toBe('clear');
    expect(cleanScore.score).toBe(0);
  });
});

// =============================================================================
// Task 7.3: Conservation Invariant Validation
// =============================================================================

describe('Task 7.3: Conservation Invariant Validation', () => {
  it('distribution shares sum to charge for referrer-attributed charge', () => {
    const distService = new RevenueDistributionService(db);
    const charges = [999_999n, 1_000_000n, 7_777_777n, 123_456_789n, 1n];

    for (const charge of charges) {
      const shares = distService.calculateShares(charge, 1000n);
      const total = shares.referrerShare + shares.commonsShare +
        shares.communityShare + shares.treasuryReserve + shares.foundationShare;
      expect(total).toBe(charge);
    }
  });

  it('distribution shares sum to charge for non-attributed charge', () => {
    const distService = new RevenueDistributionService(db);
    const charges = [999_999n, 1_000_000n, 7_777_777n, 123_456_789n, 1n];

    for (const charge of charges) {
      const shares = distService.calculateShares(charge, 0n);
      const total = shares.referrerShare + shares.commonsShare +
        shares.communityShare + shares.treasuryReserve + shares.foundationShare;
      expect(total).toBe(charge);
      expect(shares.referrerShare).toBe(0n); // No referrer
    }
  });

  it('mixed attribution across N distributions all conserve', () => {
    const distService = new RevenueDistributionService(db);

    // Mix of attributed and non-attributed
    const scenarios = [
      { charge: 10_000_000n, referrerBps: 1000n },
      { charge: 10_000_000n, referrerBps: 0n },
      { charge: 5_555_555n, referrerBps: 1000n },
      { charge: 5_555_555n, referrerBps: 0n },
      { charge: 33_333n, referrerBps: 1000n },
      { charge: 1n, referrerBps: 1000n },
      { charge: 1n, referrerBps: 0n },
    ];

    for (const { charge, referrerBps } of scenarios) {
      const shares = distService.calculateShares(charge, referrerBps);
      const total = shares.referrerShare + shares.commonsShare +
        shares.communityShare + shares.treasuryReserve + shares.foundationShare;
      expect(total).toBe(charge);
    }
  });

  it('referrer share matches BPS calculation', () => {
    const distService = new RevenueDistributionService(db);
    const charge = 10_000_000n;
    const referrerBps = 1000n; // 10%

    const shares = distService.calculateShares(charge, referrerBps);
    expect(shares.referrerShare).toBe(1_000_000n); // 10% of 10M
  });
});

// =============================================================================
// Task 7.4: Treasury Invariant Check
// =============================================================================

describe('Task 7.4: Treasury Invariant Check', () => {
  it('passes on healthy state (no settled earnings)', () => {
    const check = createTreasuryInvariantCheck({ db });
    const result = check.runOnce();

    expect(result.passed).toBe(true);
    expect(result.unpaidSettledMicro).toBe(0n);
  });

  it('passes when reserve >= unpaid settled', () => {
    // Create treasury ledger entries (simulating reserve)
    db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type,
        amount_micro, description, created_at)
      VALUES ('treas-1', 'sys-foundation', 'treasury', 0, 'revenue_share',
        1000000, 'Treasury reserve', datetime('now'))
    `).run();

    // Create settled earnings less than reserve
    seedReferralCode(db, 'code-treas', 'alice', 'TREAS1');
    seedRegistration(db, 'reg-treas', 'bob', 'alice', 'code-treas');
    insertEarning(db, 'earn-treas', 'reg-treas', 'alice', 'bob', 500_000, 50);

    const settlement = new SettlementService(db);
    settlement.settleEarnings();

    const check = createTreasuryInvariantCheck({ db });
    const result = check.runOnce();

    expect(result.passed).toBe(true);
    expect(result.reserveBalanceMicro).toBe(1_000_000n);
    expect(result.unpaidSettledMicro).toBe(500_000n);
    expect(result.surplusMicro).toBe(500_000n);
  });

  it('fails when reserve < unpaid settled (simulated drift)', () => {
    // Create settled earnings with NO treasury reserve
    seedReferralCode(db, 'code-drift', 'alice', 'DRIFT1');
    seedRegistration(db, 'reg-drift', 'bob', 'alice', 'code-drift');
    insertEarning(db, 'earn-drift', 'reg-drift', 'alice', 'bob', 1_000_000, 50);

    const settlement = new SettlementService(db);
    settlement.settleEarnings();

    const check = createTreasuryInvariantCheck({ db });
    const result = check.runOnce();

    expect(result.passed).toBe(false);
    expect(result.unpaidSettledMicro).toBe(1_000_000n);
    expect(result.reserveBalanceMicro).toBe(0n);
  });
});

// =============================================================================
// Task 7.5: Phase 1A Observability Baseline
// =============================================================================

describe('Task 7.5: Observability Metrics', () => {
  it('emits referral registration metrics', () => {
    const metrics = new BillingMetrics();

    metrics.emitRegistration('accepted');
    metrics.emitRegistration('rejected');

    const events = metrics.getEvents();
    expect(events).toHaveLength(3); // total + total + rejected
    expect(events.filter(e => e.metric === 'referral.registrations.total')).toHaveLength(2);
    expect(events.filter(e => e.metric === 'referral.registrations.rejected')).toHaveLength(1);
  });

  it('emits bonus outcome metrics', () => {
    const metrics = new BillingMetrics();

    metrics.emitBonusOutcome('granted');
    metrics.emitBonusOutcome('flagged');
    metrics.emitBonusOutcome('withheld');

    const events = metrics.getEvents();
    expect(events.filter(e => e.metric === 'referral.bonuses.granted')).toHaveLength(1);
    expect(events.filter(e => e.metric === 'referral.bonuses.flagged')).toHaveLength(1);
    expect(events.filter(e => e.metric === 'referral.bonuses.withheld')).toHaveLength(1);
  });

  it('emits distribution metrics', () => {
    const metrics = new BillingMetrics();
    metrics.emitDistribution(10_000_000n);

    const events = metrics.getEvents();
    expect(events.find(e => e.metric === 'revenue.distribution.count')).toBeTruthy();
    expect(events.find(e => e.metric === 'revenue.distribution.total_micro')?.value).toBe(10_000_000);
  });

  it('emits settlement and clawback metrics', () => {
    const metrics = new BillingMetrics();
    metrics.emitSettlement(5);
    metrics.emitClawback();

    expect(metrics.getEventsByMetric('settlement.settled.count')[0].value).toBe(5);
    expect(metrics.getEventsByMetric('settlement.clawback.count')).toHaveLength(1);
  });

  it('emits fraud score histogram', () => {
    const metrics = new BillingMetrics();
    metrics.emitFraudScore(0.45);

    const events = metrics.getEventsByMetric('fraud.score.histogram');
    expect(events).toHaveLength(1);
    expect(events[0].value).toBe(0.45);
    expect(events[0].unit).toBe('ratio');
  });

  it('emits database write latency', () => {
    const metrics = new BillingMetrics();
    metrics.emitWriteLatency(12.5);

    const events = metrics.getEventsByMetric('sqlite.write_latency_ms');
    expect(events).toHaveLength(1);
    expect(events[0].value).toBe(12.5);
    expect(events[0].unit).toBe('ms');
  });

  it('emits critical alert metrics', () => {
    const metrics = new BillingMetrics();
    metrics.emitTreasuryViolation();
    metrics.emitConservationFailure();
    metrics.emitSqliteBusyTimeout();

    expect(metrics.getEventsByMetric('alert.treasury_invariant_violation')).toHaveLength(1);
    expect(metrics.getEventsByMetric('alert.conservation_assert_failure')).toHaveLength(1);
    expect(metrics.getEventsByMetric('alert.sqlite_busy_timeout')).toHaveLength(1);
  });

  it('reset clears all events', () => {
    const metrics = new BillingMetrics();
    metrics.emitSettlement(1);
    metrics.emitClawback();
    expect(metrics.getEvents()).toHaveLength(2);

    metrics.reset();
    expect(metrics.getEvents()).toHaveLength(0);
  });
});

// =============================================================================
// Task 7.6: Referral Event Cleanup Cron
// =============================================================================

describe('Task 7.6: Referral Event Cleanup', () => {
  it('deletes events older than 90 days', () => {
    // Insert old events (100 days ago)
    for (let i = 0; i < 5; i++) {
      seedEvent(db, 'alice', 'registration', `ip-old-${i}`, '10.0.0', null, 100);
    }

    // Insert recent events (10 days ago)
    for (let i = 0; i < 3; i++) {
      seedEvent(db, 'bob', 'registration', `ip-new-${i}`, '10.0.1', null, 10);
    }

    const cleanup = createReferralEventCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.deletedTotal).toBe(5);
    expect(result.iterations).toBeGreaterThanOrEqual(1);

    // Verify recent events still exist
    const remaining = db.prepare(`SELECT COUNT(*) as count FROM referral_events`).get() as { count: number };
    expect(remaining.count).toBe(3);
  });

  it('retains events within 90-day window', () => {
    // Insert events 80 days ago (within retention)
    for (let i = 0; i < 5; i++) {
      seedEvent(db, 'alice', 'registration', `ip-recent-${i}`, '10.0.0', null, 80);
    }

    const cleanup = createReferralEventCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.deletedTotal).toBe(0);

    const remaining = db.prepare(`SELECT COUNT(*) as count FROM referral_events`).get() as { count: number };
    expect(remaining.count).toBe(5);
  });

  it('handles empty table gracefully', () => {
    const cleanup = createReferralEventCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.deletedTotal).toBe(0);
    expect(result.iterations).toBe(1);
  });

  it('idempotent on re-run', () => {
    for (let i = 0; i < 3; i++) {
      seedEvent(db, 'alice', 'registration', `ip-idem-${i}`, '10.0.0', null, 100);
    }

    const cleanup = createReferralEventCleanup({ db });

    const result1 = cleanup.runOnce();
    expect(result1.deletedTotal).toBe(3);

    const result2 = cleanup.runOnce();
    expect(result2.deletedTotal).toBe(0);
  });
});
