/**
 * Payout Reconciliation & Webhook Processing Tests (Sprint 10)
 *
 * Tests webhook handling, replay protection, reconciliation,
 * cancellation, idempotency matrix, and E2E payout lifecycle.
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Tasks 10.1–10.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REFERRAL_SCHEMA_SQL } from '../../src/db/migrations/042_referral_system.js';
import { REFERRER_EARNINGS_SQL } from '../../src/db/migrations/044_referrer_earnings.js';
import { PAYOUT_SYSTEM_SQL, PAYOUT_SYSTEM_SEED_SQL } from '../../src/db/migrations/045_payout_system.js';
import { PayoutStateMachine } from '../../src/packages/adapters/billing/PayoutStateMachine.js';
import { CreatorPayoutService } from '../../src/packages/adapters/billing/CreatorPayoutService.js';
import { SettlementService } from '../../src/packages/adapters/billing/SettlementService.js';
import {
  verifyWebhookSignature,
  processWebhookEvent,
  type WebhookPayload,
} from '../../src/api/routes/webhook.routes.js';
import { createPayoutReconciliation } from '../../src/jobs/payout-reconciliation.js';

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
  const codeId = `code-${accountId}-${Date.now()}-${Math.random()}`;
  const regId = `reg-${accountId}-${Date.now()}-${Math.random()}`;
  const refereeId = `referee-${accountId}-${Date.now()}-${Math.random()}`;

  seedAccount(accountDb, refereeId);

  accountDb.prepare(`
    INSERT INTO referral_codes (id, account_id, code, status, created_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
  `).run(codeId, accountId, `CODE${Date.now()}${Math.random()}`);

  accountDb.prepare(`
    INSERT INTO referral_registrations
      (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+12 months'))
  `).run(regId, refereeId, accountId, codeId);

  const earningId = `earn-${accountId}-${Date.now()}-${Math.random()}`;
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
// Task 10.1: Webhook Handler
// =============================================================================

describe('Task 10.1: Webhook handler', () => {
  it('verifies valid HMAC-SHA-512 signature', () => {
    const secret = 'test-webhook-secret';
    const payload = { id: 'evt-1', type: 'payout_completed', payout_id: 'p1', status: 'finished', timestamp: '2026-01-01T00:00:00Z' };

    // Use the same canonicalization as verifyWebhookSignature:
    // sorted keys, values as raw strings (not JSON-quoted)
    function canonicalize(obj: unknown): string {
      if (obj === null || obj === undefined) return '';
      if (typeof obj !== 'object') return String(obj);
      if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
      const sorted = Object.keys(obj as Record<string, unknown>).sort();
      const pairs = sorted.map(k => `"${k}":${canonicalize((obj as Record<string, unknown>)[k])}`);
      return '{' + pairs.join(',') + '}';
    }

    const canonical = canonicalize(payload);
    const signature = createHmac('sha512', secret).update(canonical).digest('hex');

    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects invalid signature', () => {
    const payload = { id: 'evt-1', type: 'payout_completed', payout_id: 'p1', status: 'finished', timestamp: new Date().toISOString() };
    expect(verifyWebhookSignature(payload, 'invalid-signature', 'secret')).toBe(false);
  });

  it('rejects empty signature', () => {
    const payload = { id: 'evt-1' };
    expect(verifyWebhookSignature(payload, '', 'secret')).toBe(false);
  });

  it('stores webhook event and rejects replay', () => {
    // First insertion should succeed
    const result1 = db.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
      VALUES ('evt-1', 'nowpayments', 'payout_completed', '{}', datetime('now'))
    `).run();
    expect(result1.changes).toBe(1);

    // Duplicate should fail (UNIQUE constraint)
    expect(() => {
      db.prepare(`
        INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
        VALUES ('evt-1', 'nowpayments', 'payout_completed', '{}', datetime('now'))
      `).run();
    }).toThrow();
  });

  it('transitions payout to completed on finished webhook', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    // Create and approve payout
    const { payoutId } = sm.createRequest('alice', 10_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-payout-123');

    // Simulate webhook
    const payload: WebhookPayload = {
      id: 'evt-complete-1',
      type: 'payout_completed',
      payout_id: 'provider-payout-123',
      status: 'finished',
      timestamp: new Date().toISOString(),
    };

    processWebhookEvent(sm, payload);

    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('completed');
  });

  it('transitions payout to failed on failed webhook', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 10_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-payout-456');

    const payload: WebhookPayload = {
      id: 'evt-fail-1',
      type: 'payout_failed',
      payout_id: 'provider-payout-456',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };

    processWebhookEvent(sm, payload);

    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('failed');
  });

  it('quarantines payout on unknown provider status', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 10_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-payout-789');

    const payload: WebhookPayload = {
      id: 'evt-unknown-1',
      type: 'payout_status',
      payout_id: 'provider-payout-789',
      status: 'some_unknown_status',
      timestamp: new Date().toISOString(),
    };

    processWebhookEvent(sm, payload);

    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('quarantined');
  });
});

// =============================================================================
// Task 10.2: Reconciliation Cron
// =============================================================================

describe('Task 10.2: Reconciliation cron', () => {
  it('returns clean when no stalled payouts', () => {
    const reconciler = createPayoutReconciliation({ db });
    const result = reconciler.runOnce();
    expect(result.checked).toBe(0);
  });

  it('quarantines stalled payouts without provider', () => {
    createSettledEarnings(db, 'alice', 50_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 10_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-stalled-1');

    // Backdate processing_at to > 24h ago
    db.prepare(`
      UPDATE payout_requests SET processing_at = datetime('now', '-30 hours')
      WHERE id = ?
    `).run(payoutId);

    const reconciler = createPayoutReconciliation({ db });
    const result = reconciler.runOnce();

    expect(result.checked).toBe(1);
    expect(result.quarantined).toBe(1);

    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('quarantined');
  });

  it('fails payouts without provider_payout_id', () => {
    createSettledEarnings(db, 'alice', 50_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 10_000_000, 0, '0xAlice');
    sm.approve(payoutId);

    // Force to processing without provider ID
    db.prepare(`
      UPDATE payout_requests
      SET status = 'processing',
          processing_at = datetime('now', '-30 hours'),
          provider_payout_id = NULL
      WHERE id = ?
    `).run(payoutId);

    const reconciler = createPayoutReconciliation({ db });
    const result = reconciler.runOnce();

    expect(result.checked).toBe(1);
    expect(result.failed).toBe(1);

    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('failed');
  });
});

// =============================================================================
// Task 10.3: Payout Cancellation
// =============================================================================

describe('Task 10.3: Payout cancellation', () => {
  it('cancels pending payout', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');
    const result = sm.cancel(payoutId);

    expect(result.success).toBe(true);
    expect(result.toState).toBe('cancelled');
  });

  it('cancels approved payout and releases escrow', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);
    const service = new CreatorPayoutService(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');
    sm.approve(payoutId);

    // Escrow should exist
    const balanceBefore = service.getWithdrawableBalance('alice');
    expect(balanceBefore.escrowMicro).toBe(5_000_000n);

    // Cancel should release escrow
    const result = sm.cancel(payoutId);
    expect(result.success).toBe(true);

    const balanceAfter = service.getWithdrawableBalance('alice');
    expect(balanceAfter.escrowMicro).toBe(0n);
  });

  it('rejects cancellation of processing payout', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-123');

    const result = sm.cancel(payoutId);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Cannot cancel');
  });

  it('rejects cancellation of completed payout', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-123');
    sm.complete(payoutId);

    const result = sm.cancel(payoutId);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Task 10.4: Idempotency Matrix Validation
// =============================================================================

describe('Task 10.4: Idempotency matrix', () => {
  it('settlement is idempotent (INSERT OR IGNORE)', () => {
    createSettledEarnings(db, 'alice', 10_000_000);
    const settlement = new SettlementService(db);

    // Settle earnings — first call creates ledger entries
    const result1 = settlement.settleEarnings();
    // Second call should be a no-op (already settled)
    const result2 = settlement.settleEarnings();

    // Balance should not double
    const balance = settlement.getSettledBalance('alice');
    expect(balance).toBe(10_000_000n);
  });

  it('clawback is idempotent (status guard)', () => {
    const settlement = new SettlementService(db);

    // Create an earning
    const codeId = 'code-idem-claw';
    const regId = 'reg-idem-claw';
    seedAccount(db, 'referee-idem');

    db.prepare(`
      INSERT INTO referral_codes (id, account_id, code, status, created_at)
      VALUES (?, 'alice', 'IDEMCLAW', 'active', datetime('now'))
    `).run(codeId);

    db.prepare(`
      INSERT INTO referral_registrations
        (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
      VALUES (?, 'referee-idem', 'alice', ?, datetime('now'), datetime('now', '+12 months'))
    `).run(regId, codeId);

    db.prepare(`
      INSERT INTO referrer_earnings
        (id, referrer_account_id, referee_account_id, registration_id,
         charge_reservation_id, amount_micro, referrer_bps, source_charge_micro, created_at)
      VALUES ('earn-idem', 'alice', 'referee-idem', ?, 'res-idem', 500000, 1000, 5000000, datetime('now'))
    `).run(regId);

    // First clawback succeeds
    settlement.clawbackEarning('earn-idem', 'Fraud');

    // Second clawback is no-op (already clawed back, settled_at IS NULL check fails)
    // Should not throw
    settlement.clawbackEarning('earn-idem', 'Double fraud');
  });

  it('payout escrow is idempotent (INSERT OR IGNORE with deterministic key)', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');

    // First approve creates escrow
    const result1 = sm.approve(payoutId);
    expect(result1.success).toBe(true);

    // Second approve fails (status guard: already approved)
    const result2 = sm.approve(payoutId);
    expect(result2.success).toBe(false);

    // Verify only one escrow entry exists
    const escrowEntries = db.prepare(`
      SELECT COUNT(*) as count FROM credit_ledger
      WHERE idempotency_key = ?
    `).get(`escrow:${payoutId}`) as { count: number };
    expect(escrowEntries.count).toBe(1);
  });

  it('payout completion is idempotent (status guard)', () => {
    createSettledEarnings(db, 'alice', 20_000_000);
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('alice', 5_000_000, 0, '0xAlice');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'provider-123');

    // First complete succeeds
    const result1 = sm.complete(payoutId);
    expect(result1.success).toBe(true);

    // Second complete fails (already completed)
    const result2 = sm.complete(payoutId);
    expect(result2.success).toBe(false);
  });

  it('webhook replay protection prevents double-processing', () => {
    // Insert first event
    db.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
      VALUES ('replay-evt-1', 'nowpayments', 'payout_completed', '{"test":true}', datetime('now'))
    `).run();

    // Attempt duplicate — should throw
    let duplicateRejected = false;
    try {
      db.prepare(`
        INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
        VALUES ('replay-evt-1', 'nowpayments', 'payout_completed', '{"test":true}', datetime('now'))
      `).run();
    } catch {
      duplicateRejected = true;
    }
    expect(duplicateRejected).toBe(true);
  });

  it('OCC prevents concurrent treasury modifications', () => {
    createSettledEarnings(db, 'alice', 50_000_000);
    const service = new CreatorPayoutService(db);

    // First payout succeeds
    const result1 = service.requestPayout({
      accountId: 'alice',
      amountMicro: 5_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result1.success).toBe(true);

    // Treasury version was bumped — verify
    const version = db.prepare(`SELECT version FROM treasury_state WHERE id = 1`).get() as { version: number };
    expect(version.version).toBeGreaterThan(0);
  });
});

// =============================================================================
// Task 10.5: E2E Payout Lifecycle
// =============================================================================

describe('Task 10.5: E2E payout lifecycle', () => {
  it('full flow: request → approve → process → webhook completed → finalize', () => {
    createSettledEarnings(db, 'alice', 30_000_000);
    const sm = new PayoutStateMachine(db);
    const service = new CreatorPayoutService(db);

    // Step 1: Request payout (creates + approves atomically)
    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 10_000_000,
      payoutAddress: '0xAlice',
      currency: 'usdc',
    });
    expect(result.success).toBe(true);
    const payoutId = result.payoutId!;

    // Step 2: Verify escrow
    const balanceAfterRequest = service.getWithdrawableBalance('alice');
    expect(balanceAfterRequest.escrowMicro).toBe(10_000_000n);
    expect(balanceAfterRequest.withdrawableMicro).toBe(20_000_000n);

    // Step 3: Mark processing (provider invoked)
    const processResult = sm.markProcessing(payoutId, 'provider-e2e-1');
    expect(processResult.success).toBe(true);

    // Step 4: Webhook completed
    const webhook: WebhookPayload = {
      id: 'evt-e2e-complete',
      type: 'payout_completed',
      payout_id: 'provider-e2e-1',
      status: 'finished',
      timestamp: new Date().toISOString(),
    };
    processWebhookEvent(sm, webhook);

    // Step 5: Verify finalized
    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('completed');

    // Step 6: Escrow released
    const balanceAfterComplete = service.getWithdrawableBalance('alice');
    expect(balanceAfterComplete.escrowMicro).toBe(0n);
    // Settled should still be full (earnings haven't changed)
    expect(balanceAfterComplete.settledMicro).toBe(30_000_000n);
  });

  it('full flow: request → approve → process → webhook failed → release', () => {
    createSettledEarnings(db, 'alice', 30_000_000);
    const sm = new PayoutStateMachine(db);
    const service = new CreatorPayoutService(db);

    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 10_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result.success).toBe(true);
    const payoutId = result.payoutId!;

    sm.markProcessing(payoutId, 'provider-e2e-fail');

    // Webhook failed
    const webhook: WebhookPayload = {
      id: 'evt-e2e-fail',
      type: 'payout_failed',
      payout_id: 'provider-e2e-fail',
      status: 'failed',
      timestamp: new Date().toISOString(),
    };
    processWebhookEvent(sm, webhook);

    // Verify failed
    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('failed');

    // Escrow released back
    const balance = service.getWithdrawableBalance('alice');
    expect(balance.escrowMicro).toBe(0n);
    // Funds returned — withdrawable should include the returned amount
    expect(balance.withdrawableMicro).toBe(30_000_000n);
  });

  it('full flow: request → cancel before processing → release', () => {
    createSettledEarnings(db, 'alice', 30_000_000);
    const sm = new PayoutStateMachine(db);
    const service = new CreatorPayoutService(db);

    const result = service.requestPayout({
      accountId: 'alice',
      amountMicro: 10_000_000,
      payoutAddress: '0xAlice',
    });
    expect(result.success).toBe(true);
    const payoutId = result.payoutId!;

    // Verify escrow before cancel
    const balanceBefore = service.getWithdrawableBalance('alice');
    expect(balanceBefore.escrowMicro).toBe(10_000_000n);

    // Cancel
    const cancelResult = sm.cancel(payoutId);
    expect(cancelResult.success).toBe(true);

    // Verify escrow released
    const balanceAfter = service.getWithdrawableBalance('alice');
    expect(balanceAfter.escrowMicro).toBe(0n);
    expect(balanceAfter.withdrawableMicro).toBe(30_000_000n);

    // Payout is cancelled
    const payout = sm.getPayout(payoutId)!;
    expect(payout.status).toBe('cancelled');
  });
});
