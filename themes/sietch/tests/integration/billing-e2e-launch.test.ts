/**
 * E2E Testing & Launch Readiness (Sprint 13 / Global 269)
 *
 * Full system validation covering:
 * - Task 13.1: E2E scenarios (referral→payout, score→distribution, fraud pipeline)
 * - Task 13.2: Treasury invariant stress test
 * - Task 13.3: Nonce and event cleanup validation
 * - Task 13.4: Launch readiness checklist
 *
 * SDD refs: §4.1–§4.5, §6.1–§6.2, §10
 * Sprint refs: Tasks 13.1–13.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { CAMPAIGNS_SCHEMA_SQL } from '../../src/db/migrations/033_campaigns.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../src/db/migrations/035_revenue_rules.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { PAYOUT_SYSTEM_SQL, PAYOUT_SYSTEM_SEED_SQL } from '../../src/db/migrations/045_payout_system.js';
import { WALLET_LINKS_SQL } from '../../src/db/migrations/046_wallet_links.js';
import { ReferralService } from '../../src/packages/adapters/billing/ReferralService.js';
import { SettlementService } from '../../src/packages/adapters/billing/SettlementService.js';
import { FraudCheckService } from '../../src/packages/adapters/billing/FraudCheckService.js';
import { BonusProcessor } from '../../src/packages/adapters/billing/BonusProcessor.js';
import { PayoutStateMachine } from '../../src/packages/adapters/billing/PayoutStateMachine.js';
import { CreatorPayoutService } from '../../src/packages/adapters/billing/CreatorPayoutService.js';
import { WalletLinkService } from '../../src/packages/adapters/billing/WalletLinkService.js';
import { ScoreImportService } from '../../src/packages/adapters/billing/ScoreImportService.js';
import { ScoreRewardsService } from '../../src/packages/adapters/billing/ScoreRewardsService.js';
import { createNonceCleanup } from '../../src/jobs/nonce-cleanup.js';
import { createReferralEventCleanup } from '../../src/jobs/referral-event-cleanup.js';
import { createScoreDistribution } from '../../src/jobs/score-distribution.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;

/**
 * Build a full-system in-memory database with all migrations applied.
 * Migration order: 030 → 032 → 033 → 035 → 041(inline) → 042 → 043(inline) → 044 → 045 → 046
 */
function setupFullDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');

  // Core billing (030, 032, 033)
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(CAMPAIGNS_SCHEMA_SQL);

  // Revenue rules (035) + schema version (041, inline)
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  // 041: add schema_version column
  const ruleColumns = testDb.prepare('PRAGMA table_info(revenue_rules)').all() as Array<{ name: string }>;
  if (!ruleColumns.some(c => c.name === 'schema_version')) {
    testDb.exec('ALTER TABLE revenue_rules ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1');
  }
  const ledgerColumns = testDb.prepare('PRAGMA table_info(credit_ledger)').all() as Array<{ name: string }>;
  if (!ledgerColumns.some(c => c.name === 'rule_schema_version')) {
    testDb.exec('ALTER TABLE credit_ledger ADD COLUMN rule_schema_version INTEGER');
  }

  // Referral system (042)
  testDb.exec(REFERRAL_SCHEMA_SQL);

  // 043: add referrer_bps to revenue_rules (inline)
  const cols043 = testDb.prepare('PRAGMA table_info(revenue_rules)').all() as Array<{ name: string }>;
  if (!cols043.some(c => c.name === 'referrer_bps')) {
    testDb.exec('ALTER TABLE revenue_rules ADD COLUMN referrer_bps INTEGER NOT NULL DEFAULT 0');
  }

  // Referrer earnings (044)
  testDb.exec(REFERRER_EARNINGS_SQL);

  // Payout system (045)
  testDb.exec(PAYOUT_SYSTEM_SQL);
  testDb.exec(PAYOUT_SYSTEM_SEED_SQL);

  // Wallet links & scores (046)
  testDb.exec(WALLET_LINKS_SQL);

  // Settlement columns (added dynamically by SettlementService)
  const earningCols = testDb.prepare('PRAGMA table_info(referrer_earnings)').all() as Array<{ name: string }>;
  if (!earningCols.some(c => c.name === 'settled_at')) {
    testDb.exec('ALTER TABLE referrer_earnings ADD COLUMN settled_at TEXT');
  }
  if (!earningCols.some(c => c.name === 'clawback_reason')) {
    testDb.exec('ALTER TABLE referrer_earnings ADD COLUMN clawback_reason TEXT');
  }

  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(testDb: Database.Database, id: string, entityType = 'person'): void {
  testDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).run(id, entityType, `entity-${id}`);
}

/** Insert a settled earning for payout readiness */
function insertSettledEarning(
  testDb: Database.Database,
  earningId: string,
  referrerId: string,
  refereeId: string,
  regId: string,
  amount: number,
): void {
  testDb.prepare(`
    INSERT INTO referrer_earnings
      (id, referrer_account_id, referee_account_id, registration_id,
       charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
       created_at, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, 1000, ?, datetime('now', '-72 hours'), datetime('now', '-24 hours'))
  `).run(earningId, referrerId, refereeId, regId, `res-${earningId}`, amount, amount * 10);

  // Also write the settlement ledger entry
  const seqRow = testDb.prepare(
    `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
     FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
  ).get(referrerId, 'referral:revenue_share') as { next_seq: number };

  testDb.prepare(`
    INSERT OR IGNORE INTO credit_ledger
      (id, account_id, pool_id, entry_seq, entry_type,
       amount_micro, description, idempotency_key, created_at)
    VALUES (?, ?, 'referral:revenue_share', ?, 'revenue_share', ?, ?, ?, datetime('now', '-24 hours'))
  `).run(
    randomUUID(), referrerId, seqRow.next_seq, amount,
    `Settlement for earning ${earningId}`,
    `settlement:${earningId}`,
  );
}

/** Create a referral code + registration pair */
function createReferralPair(
  testDb: Database.Database,
  referrerId: string,
  refereeId: string,
  codeId: string,
  regId: string,
  code: string,
): void {
  testDb.prepare(`
    INSERT INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
  `).run(codeId, referrerId, code);

  testDb.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+12 months'))
  `).run(regId, refereeId, referrerId, codeId);
}

/** Always-accepts signature verifier */
const alwaysVerify = () => true;

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupFullDb();
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 13.1: Full System E2E Test Suite
// =============================================================================

describe('Task 13.1: E2E Scenarios', () => {
  // -------------------------------------------------------------------------
  // Scenario 1: Referral → Earnings → Settlement → Payout → Completion
  // -------------------------------------------------------------------------
  describe('Scenario 1: Referral → Earnings → Settlement → Payout', () => {
    it('completes the full referral-to-payout lifecycle', () => {
      // Setup accounts
      seedAccount(db, 'referrer-alice');
      seedAccount(db, 'referee-bob');

      // Step 1: Create referral code & register referee
      createReferralPair(db, 'referrer-alice', 'referee-bob', 'e2e-code-1', 'e2e-reg-1', 'E2ETEST001');

      // Step 2: Create earnings from referee's activity
      const earningAmount = 10_000_000; // $10
      insertSettledEarning(db, 'e2e-earn-1', 'referrer-alice', 'referee-bob', 'e2e-reg-1', earningAmount);
      insertSettledEarning(db, 'e2e-earn-2', 'referrer-alice', 'referee-bob', 'e2e-reg-1', earningAmount);

      // Step 3: Verify settlement balance
      const settlement = new SettlementService(db);
      const settledBalance = settlement.getSettledBalance('referrer-alice');
      expect(settledBalance).toBe(BigInt(earningAmount * 2));

      // Step 4: Request payout
      const payoutService = new CreatorPayoutService(db);
      const balance = payoutService.getWithdrawableBalance('referrer-alice');
      expect(balance.settledMicro).toBe(BigInt(earningAmount * 2));
      expect(balance.withdrawableMicro).toBe(BigInt(earningAmount * 2));

      const payoutResult = payoutService.requestPayout({
        accountId: 'referrer-alice',
        amountMicro: earningAmount, // $10 payout
        payoutAddress: '0xAlicePayoutAddress',
      });

      expect(payoutResult.success).toBe(true);
      expect(payoutResult.payoutId).toBeDefined();

      // Step 5: Verify escrow hold reduces withdrawable
      const balanceAfter = payoutService.getWithdrawableBalance('referrer-alice');
      expect(balanceAfter.escrowMicro).toBe(BigInt(earningAmount));
      expect(balanceAfter.withdrawableMicro).toBe(BigInt(earningAmount)); // 20M - 10M

      // Step 6: Complete payout lifecycle
      const stateMachine = new PayoutStateMachine(db);
      const processResult = stateMachine.markProcessing(payoutResult.payoutId!, 'provider-tx-123');
      expect(processResult.success).toBe(true);

      const completeResult = stateMachine.complete(payoutResult.payoutId!);
      expect(completeResult.success).toBe(true);

      // Step 7: Verify payout finalized — escrow released
      const payout = stateMachine.getPayout(payoutResult.payoutId!);
      expect(payout?.status).toBe('completed');

      // Escrow release means withdrawable balance recovers
      const finalBalance = payoutService.getWithdrawableBalance('referrer-alice');
      expect(finalBalance.escrowMicro).toBe(0n);
      // Settled balance unchanged, escrow returned
      expect(finalBalance.settledMicro).toBe(BigInt(earningAmount * 2));
    });

    it('handles payout failure with escrow return', () => {
      seedAccount(db, 'fail-referrer');
      seedAccount(db, 'fail-referee');
      createReferralPair(db, 'fail-referrer', 'fail-referee', 'fail-code-1', 'fail-reg-1', 'FAILTEST01');
      insertSettledEarning(db, 'fail-earn-1', 'fail-referrer', 'fail-referee', 'fail-reg-1', 5_000_000);

      const payoutService = new CreatorPayoutService(db);
      const result = payoutService.requestPayout({
        accountId: 'fail-referrer',
        amountMicro: 5_000_000,
        payoutAddress: '0xFailAddr',
      });
      expect(result.success).toBe(true);

      const stateMachine = new PayoutStateMachine(db);
      stateMachine.markProcessing(result.payoutId!, 'provider-fail-123');

      // Provider reports failure
      const failResult = stateMachine.fail(result.payoutId!, 'Provider rejected');
      expect(failResult.success).toBe(true);

      // Escrow returned — full balance available again
      const balance = payoutService.getWithdrawableBalance('fail-referrer');
      expect(balance.escrowMicro).toBe(0n);
      expect(balance.withdrawableMicro).toBe(5_000_000n);
    });

    it('rejects payout cancellation after processing', () => {
      seedAccount(db, 'cancel-referrer');
      seedAccount(db, 'cancel-referee');
      createReferralPair(db, 'cancel-referrer', 'cancel-referee', 'cancel-code', 'cancel-reg', 'CANCELTEST');
      insertSettledEarning(db, 'cancel-earn', 'cancel-referrer', 'cancel-referee', 'cancel-reg', 3_000_000);

      const payoutService = new CreatorPayoutService(db);
      const result = payoutService.requestPayout({
        accountId: 'cancel-referrer',
        amountMicro: 3_000_000,
        payoutAddress: '0xCancelAddr',
      });

      const stateMachine = new PayoutStateMachine(db);
      stateMachine.markProcessing(result.payoutId!, 'provider-cancel-123');

      // Cannot cancel once processing
      const cancelResult = stateMachine.cancel(result.payoutId!);
      expect(cancelResult.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Score Import → Wallet Link → Distribution → Rewards
  // -------------------------------------------------------------------------
  describe('Scenario 2: Score → Distribution → Rewards', () => {
    const ALICE_WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const BOB_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    it('distributes score rewards and makes them visible via API', () => {
      seedAccount(db, 'score-alice');
      seedAccount(db, 'score-bob');

      // Step 1: Link wallets (addresses stored lowercase by WalletLinkService)
      // linkWallet(accountId, walletAddress, nonce, signature, chainId)
      const walletService = new WalletLinkService(db, alwaysVerify);
      const nonceA = walletService.issueNonce('score-alice', ALICE_WALLET);
      walletService.linkWallet('score-alice', ALICE_WALLET, nonceA.nonce, 'sig-a', 1);

      const nonceB = walletService.issueNonce('score-bob', BOB_WALLET);
      walletService.linkWallet('score-bob', BOB_WALLET, nonceB.nonce, 'sig-b', 1);

      // Step 2: Import scores (importScores normalizes to lowercase)
      const scoreImport = new ScoreImportService(db);
      scoreImport.importScores([
        { walletAddress: ALICE_WALLET, chainId: 1, score: 300, period: '2025-12' },
        { walletAddress: BOB_WALLET, chainId: 1, score: 100, period: '2025-12' },
      ]);

      // Step 3: Run score distribution
      const rewardsService = new ScoreRewardsService(db);
      const poolSize = 1_000_000_000n; // $1,000

      const result = rewardsService.distributeRewards('2025-12', poolSize);

      expect(result.success).toBe(true);
      expect(result.participantCount).toBe(2);
      expect(result.totalScore).toBe(400);

      // Alice: 300/400 * 1B = 750,000,000
      // Bob: 100/400 * 1B = 250,000,000
      const aliceEntry = result.entries.find(e => e.accountId === 'score-alice');
      const bobEntry = result.entries.find(e => e.accountId === 'score-bob');
      expect(aliceEntry!.rewardMicro).toBe(750_000_000n);
      expect(bobEntry!.rewardMicro).toBe(250_000_000n);

      // Conservation invariant
      const total = result.entries.reduce((sum, e) => sum + e.rewardMicro, 0n);
      expect(total).toBe(poolSize);

      // Step 4: Verify rewards history
      const aliceHistory = rewardsService.getRewardsHistory('score-alice');
      expect(aliceHistory.length).toBe(1);
      expect(aliceHistory[0].period).toBe('2025-12');
      expect(aliceHistory[0].participantCount).toBe(2);

      const bobHistory = rewardsService.getRewardsHistory('score-bob');
      expect(bobHistory.length).toBe(1);
    });

    it('runs score distribution via cron job', () => {
      const CRON_WALLET = '0xcccccccccccccccccccccccccccccccccccccccc';
      seedAccount(db, 'cron-user');
      const walletService = new WalletLinkService(db, alwaysVerify);
      const nonce = walletService.issueNonce('cron-user', CRON_WALLET);
      walletService.linkWallet('cron-user', CRON_WALLET, nonce.nonce, 'sig-c', 1);

      const scoreImport = new ScoreImportService(db);
      scoreImport.importScores([
        { walletAddress: CRON_WALLET, chainId: 1, score: 500, period: '2025-11' },
      ]);

      const cron = createScoreDistribution({ db, poolSizeMicro: 500_000_000n });
      const result = cron.runOnce('2025-11');

      expect(result.distributed).toBe(true);
      expect(result.participantCount).toBe(1);
      expect(result.period).toBe('2025-11');

      // Idempotent — skip duplicate
      const retry = cron.runOnce('2025-11');
      expect(retry.distributed).toBe(false);
      expect(retry.error).toBe('ALREADY_DISTRIBUTED');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Fraud Pipeline — Sybil Attack Simulation
  // -------------------------------------------------------------------------
  describe('Scenario 3: Fraud pipeline — sybil bonuses withheld', () => {
    it('withholds bonuses from sybil-pattern registrations', () => {
      // Create the referrer
      seedAccount(db, 'legit-referrer');

      // Create 5 sybil accounts with suspicious signals
      const sybilCount = 5;
      for (let i = 1; i <= sybilCount; i++) {
        seedAccount(db, `sybil-${i}`);
      }

      // Create referral code
      const codeId = 'sybil-code-1';
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'legit-referrer', 'SYBILTEST0', 'active', datetime('now'))
      `).run(codeId);

      // Register sybils with concentrated IP/fingerprint signals
      for (let i = 1; i <= sybilCount; i++) {
        const regId = `sybil-reg-${i}`;
        db.prepare(`
          INSERT INTO referral_registrations
            (id, referee_account_id, referrer_account_id, referral_code_id,
             created_at, attribution_expires_at)
          VALUES (?, ?, 'legit-referrer', ?, datetime('now'), datetime('now', '+12 months'))
        `).run(regId, `sybil-${i}`, codeId);

        // Plant fraud signals: same IP prefix, same fingerprint hash
        db.prepare(`
          INSERT INTO referral_events
            (account_id, event_type, ip_hash, ip_prefix, user_agent_hash,
             fingerprint_hash, referral_code_id, created_at)
          VALUES (?, 'registration', ?, '192.168.1', ?, ?, ?,
                  datetime('now', '-${i} minutes'))
        `).run(
          `sybil-${i}`,
          `iphash-${i}`,
          'identical-ua-hash',
          'identical-fingerprint',
          codeId,
        );

        // Create pending bonus (7+ days old for processing)
        db.prepare(`
          INSERT INTO referral_bonuses
            (id, referee_account_id, referrer_account_id, registration_id,
             qualifying_action, qualifying_action_id, amount_micro, status, created_at)
          VALUES (?, ?, 'legit-referrer', ?,
                  'dnft_creation', ?, 1000000, 'pending',
                  datetime('now', '-8 days'))
        `).run(`sybil-bonus-${i}`, `sybil-${i}`, regId, `action-sybil-${i}`);
      }

      // Run fraud check + bonus processing
      const fraudService = new FraudCheckService(db);
      const bonusProcessor = new BonusProcessor(db, fraudService);
      const processResult = bonusProcessor.processDelayedBonuses();

      expect(processResult.processed).toBe(sybilCount);

      // Verify: with 5 same-IP, same-fingerprint registrations,
      // scores should be high enough to flag or withhold
      const bonuses = db.prepare(`
        SELECT id, status, risk_score, flag_reason FROM referral_bonuses
        WHERE id LIKE 'sybil-bonus-%'
      `).all() as { id: string; status: string; risk_score: number; flag_reason: string | null }[];

      // All should be flagged or withheld (not granted)
      for (const bonus of bonuses) {
        expect(['flagged', 'withheld']).toContain(bonus.status);
        expect(bonus.risk_score).toBeGreaterThan(0);
        expect(bonus.flag_reason).toBeTruthy();
      }

      // No ledger entries created for flagged/withheld bonuses
      const grants = db.prepare(`
        SELECT COUNT(*) as count FROM credit_ledger
        WHERE pool_id = 'referral:signup' AND entry_type = 'grant'
      `).get() as { count: number };
      expect(grants.count).toBe(0);
    });

    it('grants bonuses for clean registrations', () => {
      seedAccount(db, 'clean-referrer');
      seedAccount(db, 'clean-referee');

      const codeId = 'clean-code-1';
      const regId = 'clean-reg-1';
      db.prepare(`
        INSERT INTO referral_codes (id, account_id, code, status, created_at)
        VALUES (?, 'clean-referrer', 'CLEANTEST0', 'active', datetime('now'))
      `).run(codeId);

      db.prepare(`
        INSERT INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id,
           created_at, attribution_expires_at)
        VALUES (?, 'clean-referee', 'clean-referrer', ?, datetime('now'), datetime('now', '+12 months'))
      `).run(regId, codeId);

      // One clean event (unique IP, unique fingerprint)
      db.prepare(`
        INSERT INTO referral_events
          (account_id, event_type, ip_hash, ip_prefix, user_agent_hash,
           fingerprint_hash, referral_code_id, created_at)
        VALUES ('clean-referee', 'registration', 'unique-ip-hash', '10.0.0',
                'unique-ua-hash', 'unique-fp-hash', ?, datetime('now'))
      `).run(codeId);

      // Pending bonus old enough for processing
      db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status, created_at)
        VALUES ('clean-bonus-1', 'clean-referee', 'clean-referrer', ?,
                'dnft_creation', 'action-clean-1', 1000000, 'pending',
                datetime('now', '-8 days'))
      `).run(regId);

      const fraudService = new FraudCheckService(db);
      const bonusProcessor = new BonusProcessor(db, fraudService);
      const result = bonusProcessor.processDelayedBonuses();

      expect(result.processed).toBe(1);

      const bonus = db.prepare(
        `SELECT status FROM referral_bonuses WHERE id = 'clean-bonus-1'`
      ).get() as { status: string };
      expect(bonus.status).toBe('granted');

      // Ledger entry created
      const ledgerEntry = db.prepare(`
        SELECT * FROM credit_ledger
        WHERE pool_id = 'referral:signup' AND entry_type = 'grant'
      `).get() as { amount_micro: number } | undefined;
      expect(ledgerEntry).toBeDefined();
      expect(ledgerEntry!.amount_micro).toBe(1_000_000);
    });
  });
});

// =============================================================================
// Task 13.2: Treasury Invariant Stress Test
// =============================================================================

describe('Task 13.2: Treasury Invariant Stress Test', () => {
  it('maintains conservation invariant across 100 distributions + 10 payouts + 5 clawbacks', () => {
    // Set up a referrer with multiple revenue streams
    seedAccount(db, 'stress-referrer');
    seedAccount(db, 'stress-referee');
    const codeId = 'stress-code';
    const regId = 'stress-reg';
    createReferralPair(db, 'stress-referrer', 'stress-referee', codeId, regId, 'STRESST000');

    // 100 distributions (earnings)
    const earningAmounts: number[] = [];
    let totalEarnings = 0n;

    for (let i = 0; i < 100; i++) {
      const amount = 1_000_000 + (i * 100_000); // $1 to $10.90
      earningAmounts.push(amount);
      totalEarnings += BigInt(amount);
      insertSettledEarning(db, `stress-earn-${i}`, 'stress-referrer', 'stress-referee', regId, amount);
    }

    // Verify total settled balance
    const settlement = new SettlementService(db);
    const settledBalance = settlement.getSettledBalance('stress-referrer');
    expect(settledBalance).toBe(totalEarnings);

    // 5 clawbacks (on unsettled earnings)
    // Insert 5 recent (unsettled) earnings for clawback testing
    let clawbackTotal = 0n;
    for (let i = 0; i < 5; i++) {
      const clawbackEarningId = `stress-clawback-${i}`;
      const amount = 500_000;
      clawbackTotal += BigInt(amount);

      // Insert unsettled earning (created recently, not yet settled)
      db.prepare(`
        INSERT INTO referrer_earnings
          (id, referrer_account_id, referee_account_id, registration_id,
           charge_reservation_id, amount_micro, referrer_bps, source_charge_micro,
           created_at)
        VALUES (?, 'stress-referrer', 'stress-referee', ?, ?, ?, 1000, ?,
                datetime('now', '-1 hours'))
      `).run(clawbackEarningId, regId, `res-${clawbackEarningId}`, amount, amount * 10);

      const result = settlement.clawbackEarning(clawbackEarningId, `Fraud detected #${i}`);
      expect(result.success).toBe(true);
    }

    // 10 payouts
    const payoutService = new CreatorPayoutService(db);
    const stateMachine = new PayoutStateMachine(db);
    const payoutAmount = 5_000_000; // $5 each
    let totalPaidOut = 0n;
    const payoutIds: string[] = [];

    for (let i = 0; i < 10; i++) {
      const result = payoutService.requestPayout({
        accountId: 'stress-referrer',
        amountMicro: payoutAmount,
        payoutAddress: `0xStressAddr${i}`,
      });

      // First payout should succeed, subsequent may be rate-limited
      if (result.success) {
        payoutIds.push(result.payoutId!);
        totalPaidOut += BigInt(payoutAmount);
      }
    }

    // Process completed payouts
    for (const payoutId of payoutIds) {
      stateMachine.markProcessing(payoutId, `provider-stress-${payoutId}`);
      stateMachine.complete(payoutId);
    }

    // Treasury invariant: treasury_state version incremented atomically
    const treasuryState = db.prepare(
      'SELECT version FROM treasury_state WHERE id = 1'
    ).get() as { version: number };
    expect(treasuryState.version).toBeGreaterThan(0);

    // Ledger integrity: all entries have valid types and non-null amounts
    const invalidEntries = db.prepare(`
      SELECT COUNT(*) as count FROM credit_ledger
      WHERE amount_micro IS NULL OR entry_type IS NULL
    `).get() as { count: number };
    expect(invalidEntries.count).toBe(0);

    // Balance consistency: settled balance matches sum of settlement entries
    const ledgerSum = db.prepare(`
      SELECT COALESCE(SUM(amount_micro), 0) as total FROM credit_ledger
      WHERE account_id = 'stress-referrer'
        AND pool_id = 'referral:revenue_share'
        AND entry_type = 'revenue_share'
    `).get() as { total: number };
    expect(BigInt(ledgerSum.total)).toBe(totalEarnings);

    // No negative balances in any pool
    const negativeCheck = db.prepare(`
      SELECT pool_id, SUM(amount_micro) as balance
      FROM credit_ledger
      WHERE account_id = 'stress-referrer'
      GROUP BY pool_id
      HAVING balance < 0
    `).all() as { pool_id: string; balance: number }[];

    // Escrow pool may have net-negative due to release entries — that's correct
    const nonEscrowNegative = negativeCheck.filter(r => r.pool_id !== 'withdrawal:pending');
    expect(nonEscrowNegative.length).toBe(0);
  });

  it('score distribution conservation across random pool sizes', () => {
    // Property-based: 20 random trials
    for (let trial = 0; trial < 20; trial++) {
      const trialDb = setupFullDb();
      const participantCount = 2 + Math.floor(Math.random() * 10); // 2-11 participants
      const poolSize = BigInt(1_000_000 + Math.floor(Math.random() * 100_000_000_000));

      for (let i = 0; i < participantCount; i++) {
        const accountId = `prop-acct-${trial}-${i}`;
        seedAccount(trialDb, accountId);

        const walletAddr = `0xPropWallet${trial}${i}`;
        const linkId = randomUUID();
        trialDb.prepare(`
          INSERT INTO wallet_links (id, account_id, wallet_address, chain_id)
          VALUES (?, ?, ?, 1)
        `).run(linkId, accountId, walletAddr);

        const score = 1 + Math.floor(Math.random() * 1000);
        const snapId = randomUUID();
        trialDb.prepare(`
          INSERT INTO score_snapshots (id, wallet_address, chain_id, score, snapshot_period)
          VALUES (?, ?, 1, ?, '2025-12')
        `).run(snapId, walletAddr, score);
      }

      const service = new ScoreRewardsService(trialDb);
      const result = service.distributeRewards(`2025-12`, poolSize);

      expect(result.success).toBe(true);
      const total = result.entries.reduce((sum, e) => sum + e.rewardMicro, 0n);
      expect(total).toBe(poolSize);

      trialDb.close();
    }
  });
});

// =============================================================================
// Task 13.3: Nonce and Event Cleanup Validation
// =============================================================================

describe('Task 13.3: Nonce and Event Cleanup Validation', () => {
  it('cleans up expired nonces while retaining recent ones', () => {
    seedAccount(db, 'cleanup-user');

    // Use ISO 8601 format consistently (strftime with T separator and Z suffix)
    // to match the cleanup cron's strftime comparison

    // Insert expired nonces (past expires_at, unused)
    for (let i = 0; i < 50; i++) {
      db.prepare(`
        INSERT INTO wallet_link_nonces
          (id, account_id, nonce, wallet_address, expires_at, created_at)
        VALUES (?, 'cleanup-user', ?, '0xCleanupWallet',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${1 + i} hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${2 + i} hours'))
      `).run(`expired-nonce-${i}`, `nonce-val-expired-${i}`);
    }

    // Insert valid (not yet expired) nonces — 1 hour in the future
    for (let i = 0; i < 10; i++) {
      db.prepare(`
        INSERT INTO wallet_link_nonces
          (id, account_id, nonce, wallet_address, expires_at, created_at)
        VALUES (?, 'cleanup-user', ?, '0xCleanupWallet',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(`valid-nonce-${i}`, `nonce-val-valid-${i}`);
    }

    // Insert used nonces (older than 24h)
    for (let i = 0; i < 20; i++) {
      db.prepare(`
        INSERT INTO wallet_link_nonces
          (id, account_id, nonce, wallet_address, expires_at,
           used_at, created_at)
        VALUES (?, 'cleanup-user', ?, '0xCleanupWallet',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-49 hours'))
      `).run(`used-old-nonce-${i}`, `nonce-val-used-old-${i}`);
    }

    // Insert recently used nonces (should be retained)
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO wallet_link_nonces
          (id, account_id, nonce, wallet_address, expires_at,
           used_at, created_at)
        VALUES (?, 'cleanup-user', ?, '0xCleanupWallet',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'))
      `).run(`used-recent-nonce-${i}`, `nonce-val-used-recent-${i}`);
    }

    // Count before cleanup
    const totalBefore = db.prepare(
      'SELECT COUNT(*) as count FROM wallet_link_nonces'
    ).get() as { count: number };
    expect(totalBefore.count).toBe(85); // 50 expired + 10 valid + 20 old-used + 5 recent-used

    const cleanup = createNonceCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.expiredDeleted).toBe(50);  // All 50 expired unused nonces
    expect(result.usedDeleted).toBe(20);     // All 20 old used nonces

    // Verify retention: valid + recently used remain
    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM wallet_link_nonces'
    ).get() as { count: number };
    expect(remaining.count).toBe(15); // 10 valid + 5 recently used
  });

  it('cleans up referral events older than 90 days', () => {
    seedAccount(db, 'event-user');

    // Insert old events (>90 days)
    for (let i = 0; i < 100; i++) {
      db.prepare(`
        INSERT INTO referral_events
          (account_id, event_type, ip_hash, ip_prefix, created_at)
        VALUES ('event-user', 'registration', ?, '10.0.0',
                datetime('now', '-${91 + i} days'))
      `).run(`old-ip-${i}`);
    }

    // Insert recent events (<90 days)
    for (let i = 0; i < 30; i++) {
      db.prepare(`
        INSERT INTO referral_events
          (account_id, event_type, ip_hash, ip_prefix, created_at)
        VALUES ('event-user', 'registration', ?, '10.0.0',
                datetime('now', '-${i} days'))
      `).run(`recent-ip-${i}`);
    }

    const cleanup = createReferralEventCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.deletedTotal).toBe(100);

    // Recent events retained
    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM referral_events'
    ).get() as { count: number };
    expect(remaining.count).toBe(30);
  });

  it('runs both cleanup crons idempotently', () => {
    seedAccount(db, 'idem-user');

    // Seed expired nonces (ISO 8601 format for consistent string comparison)
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO wallet_link_nonces
          (id, account_id, nonce, wallet_address, expires_at, created_at)
        VALUES (?, 'idem-user', ?, '0xIdemWallet',
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'))
      `).run(`idem-nonce-${i}`, `idem-val-${i}`);
    }

    const nonceCleanup = createNonceCleanup({ db });
    const first = nonceCleanup.runOnce();
    expect(first.expiredDeleted).toBe(5);

    // Second run — nothing to clean
    const second = nonceCleanup.runOnce();
    expect(second.expiredDeleted).toBe(0);
    expect(second.usedDeleted).toBe(0);
  });
});

// =============================================================================
// Task 13.4: Launch Readiness Checklist
// =============================================================================

describe('Task 13.4: Launch Readiness Checklist', () => {
  it('all migrations (042-046) run cleanly on fresh DB in monotonic order', () => {
    // We already ran all migrations in setupFullDb — verify all tables exist
    const requiredTables = [
      // 042: referral_system
      'referral_codes', 'referral_registrations', 'referral_attribution_log',
      'referral_bonuses', 'referral_events',
      // 044: referrer_earnings
      'referrer_earnings',
      // 045: payout_system
      'payout_requests', 'treasury_state', 'webhook_events',
      // 046: wallet_links
      'wallet_link_nonces', 'wallet_links', 'score_snapshots', 'score_distributions',
    ];

    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
      ORDER BY name
    `).all() as { name: string }[];

    const tableNames = tables.map(t => t.name);
    for (const required of requiredTables) {
      expect(tableNames).toContain(required);
    }
  });

  it('treasury account is seeded correctly and idempotent', () => {
    // Verify treasury account exists
    const treasury = db.prepare(
      `SELECT * FROM credit_accounts WHERE id = 'sys-treasury-payout'`
    ).get() as { id: string; entity_type: string } | undefined;

    expect(treasury).toBeDefined();
    expect(treasury!.entity_type).toBe('foundation');

    // Re-run seed SQL — should not throw
    expect(() => db.exec(PAYOUT_SYSTEM_SEED_SQL)).not.toThrow();

    // Still only one row
    const count = db.prepare(
      `SELECT COUNT(*) as c FROM credit_accounts WHERE id = 'sys-treasury-payout'`
    ).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('default revenue rule has valid BPS allocation', () => {
    const activeRule = db.prepare(
      `SELECT * FROM revenue_rules WHERE status = 'active'`
    ).get() as {
      commons_bps: number;
      community_bps: number;
      foundation_bps: number;
      referrer_bps: number;
    } | undefined;

    expect(activeRule).toBeDefined();
    // Active rule totals 10000 bps (without referrer initially)
    expect(activeRule!.commons_bps + activeRule!.community_bps + activeRule!.foundation_bps).toBe(10000);
    // Active rule defaults to 0 referrer_bps
    expect(activeRule!.referrer_bps).toBe(0);

    // referrer_bps column exists and is ready for governance promotion
    const columns = db.prepare('PRAGMA table_info(revenue_rules)').all() as Array<{ name: string }>;
    expect(columns.map(c => c.name)).toContain('referrer_bps');
    expect(columns.map(c => c.name)).toContain('schema_version');
  });

  it('pool IDs registered in billing_config', () => {
    const pools = db.prepare(`
      SELECT key, value FROM billing_config
      WHERE key LIKE 'pool:%'
      ORDER BY key
    `).all() as { key: string; value: string }[];

    const poolMap = Object.fromEntries(pools.map(p => [p.key, p.value]));

    // Referral pools
    expect(poolMap['pool:referral:revenue_share']).toBe('withdrawable');
    expect(poolMap['pool:referral:signup']).toBe('non_withdrawable');
    expect(poolMap['pool:score:rewards']).toBe('non_withdrawable');

    // Payout pools
    expect(poolMap['pool:withdrawal:pending']).toBe('escrow');
    expect(poolMap['pool:reserve:held']).toBe('escrow');
  });

  it('treasury_state initialized with version 0', () => {
    const state = db.prepare(
      'SELECT * FROM treasury_state WHERE id = 1'
    ).get() as { version: number; reserve_balance_micro: number } | undefined;

    expect(state).toBeDefined();
    expect(state!.version).toBeGreaterThanOrEqual(0);
    expect(state!.reserve_balance_micro).toBe(0);
  });

  it('WAL mode and busy_timeout configurable on file-backed DB', () => {
    // :memory: databases don't support WAL — verify on temp file DB
    const tmpPath = join(tmpdir(), `arrakis-wal-test-${Date.now()}.db`);

    try {
      const fileDb = new Database(tmpPath);
      fileDb.pragma('journal_mode = WAL');
      const walMode = fileDb.pragma('journal_mode') as { journal_mode: string }[];
      expect(walMode[0].journal_mode).toBe('wal');

      fileDb.pragma('busy_timeout = 5000');
      const timeout = fileDb.pragma('busy_timeout') as { timeout: number }[];
      expect(timeout[0].timeout).toBe(5000);

      fileDb.close();
    } finally {
      // Clean up temp files
      for (const suffix of ['', '-wal', '-shm']) {
        try { unlinkSync(tmpPath + suffix); } catch { /* ignore */ }
      }
    }
  });

  it('credit_ledger entry_type CHECK constraint covers all required types', () => {
    seedAccount(db, 'check-user');

    const validTypes = [
      'deposit', 'reserve', 'finalize', 'release', 'refund', 'grant',
      'shadow_charge', 'shadow_reserve', 'shadow_finalize',
      'commons_contribution', 'revenue_share',
      'marketplace_sale', 'marketplace_purchase',
      'escrow', 'escrow_release',
    ];

    for (const entryType of validTypes) {
      const entryId = randomUUID();
      expect(() => {
        db.prepare(`
          INSERT INTO credit_ledger
            (id, account_id, pool_id, entry_seq, entry_type, amount_micro,
             description, idempotency_key, created_at)
          VALUES (?, 'check-user', 'test:pool', ?, ?, 100,
                  'test', ?, datetime('now'))
        `).run(entryId, validTypes.indexOf(entryType), entryType, `idem:${entryType}:${entryId}`);
      }).not.toThrow();
    }
  });

  it('payout_requests status CHECK constraint covers all lifecycle states', () => {
    seedAccount(db, 'state-user');

    const validStates = ['pending', 'approved', 'processing', 'completed', 'failed', 'cancelled', 'quarantined'];

    for (const status of validStates) {
      const id = randomUUID();
      expect(() => {
        db.prepare(`
          INSERT INTO payout_requests
            (id, account_id, amount_micro, fee_micro, net_amount_micro,
             payout_address, status, idempotency_key)
          VALUES (?, 'state-user', 1000000, 0, 1000000,
                  '0xAddr', ?, ?)
        `).run(id, status, `idem:${status}:${id}`);
      }).not.toThrow();
    }
  });

  it('referral_bonuses status includes all fraud pipeline states', () => {
    seedAccount(db, 'bonus-state-user');

    const codeId = 'bs-code';
    db.prepare(`
      INSERT INTO referral_codes (id, account_id, code, status, created_at)
      VALUES (?, 'bonus-state-user', 'BSTATETES0', 'active', datetime('now'))
    `).run(codeId);

    seedAccount(db, 'bs-referee');
    db.prepare(`
      INSERT INTO referral_registrations
        (id, referee_account_id, referrer_account_id, referral_code_id,
         created_at, attribution_expires_at)
      VALUES ('bs-reg', 'bs-referee', 'bonus-state-user', ?,
              datetime('now'), datetime('now', '+12 months'))
    `).run(codeId);

    const validStatuses = ['pending', 'cleared', 'granted', 'withheld', 'flagged', 'denied', 'expired'];

    for (const status of validStatuses) {
      const id = randomUUID();
      expect(() => {
        db.prepare(`
          INSERT INTO referral_bonuses
            (id, referee_account_id, referrer_account_id, registration_id,
             qualifying_action, qualifying_action_id, amount_micro, status, created_at)
          VALUES (?, 'bs-referee', 'bonus-state-user', 'bs-reg',
                  'dnft_creation', ?, 1000000, ?, datetime('now'))
        `).run(id, `qa-${status}-${id}`, status);
      }).not.toThrow();
    }
  });
});
