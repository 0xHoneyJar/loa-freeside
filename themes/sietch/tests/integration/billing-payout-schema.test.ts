/**
 * Treasury & Payout Schema Integration Tests (Sprint 8)
 *
 * Tests migration 045, IPayoutProvider port types, payout state machine
 * transitions, and webhook event storage.
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Tasks 8.1–8.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { PAYOUT_SYSTEM_SQL, PAYOUT_SYSTEM_SEED_SQL } from '../../src/db/migrations/045_payout_system.js';
import { PayoutStateMachine } from '../../src/packages/adapters/billing/PayoutStateMachine.js';
import type { IPayoutProvider, PayoutRequest, PayoutResult, PayoutQuote } from '../../src/packages/core/ports/IPayoutProvider.js';

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
  testDb.exec(PAYOUT_SYSTEM_SQL);
  testDb.exec(PAYOUT_SYSTEM_SEED_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, 'person', ?, datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
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
// Task 8.1: Migration 045 — Payout System
// =============================================================================

describe('Task 8.1: Migration 045', () => {
  it('creates payout_requests table', () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='payout_requests'`
    ).get();
    expect(tables).toBeTruthy();
  });

  it('creates treasury_state table with initial row', () => {
    const row = db.prepare(`SELECT * FROM treasury_state WHERE id = 1`).get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.version).toBe(0);
    expect(row.reserve_balance_micro).toBe(0);
  });

  it('creates webhook_events table', () => {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_events'`
    ).get();
    expect(tables).toBeTruthy();
  });

  it('creates treasury payout account idempotently', () => {
    const account = db.prepare(
      `SELECT * FROM credit_accounts WHERE id = 'sys-treasury-payout'`
    ).get() as Record<string, unknown>;
    expect(account).toBeTruthy();
    expect(account.entity_type).toBe('foundation');
    expect(account.entity_id).toBe('treasury:payout_reserve');

    // Running seed again should not create duplicate
    db.exec(PAYOUT_SYSTEM_SEED_SQL);
    const count = db.prepare(
      `SELECT COUNT(*) as c FROM credit_accounts WHERE entity_id = 'treasury:payout_reserve'`
    ).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('registers pool IDs in billing_config', () => {
    const pending = db.prepare(
      `SELECT value FROM billing_config WHERE key = 'pool:withdrawal:pending'`
    ).get() as { value: string };
    expect(pending.value).toBe('escrow');

    const held = db.prepare(
      `SELECT value FROM billing_config WHERE key = 'pool:reserve:held'`
    ).get() as { value: string };
    expect(held.value).toBe('escrow');
  });

  it('OCC version initializes at 0', () => {
    const state = db.prepare(`SELECT version FROM treasury_state WHERE id = 1`).get() as { version: number };
    expect(state.version).toBe(0);
  });
});

// =============================================================================
// Task 8.2: IPayoutProvider Port
// =============================================================================

describe('Task 8.2: IPayoutProvider Port', () => {
  it('port interface compiles and types are usable', () => {
    // Verify types are importable and structurally correct
    const mockProvider: IPayoutProvider = {
      async createPayout(request: PayoutRequest): Promise<PayoutResult> {
        return {
          providerPayoutId: 'mock-123',
          status: 'waiting',
          amount: request.amount,
          currency: request.currency,
          address: request.address,
          createdAt: new Date(),
        };
      },
      async getPayoutStatus(id: string): Promise<PayoutResult | null> {
        return null;
      },
      async getEstimate(amount: number, currency: string): Promise<PayoutQuote> {
        return {
          feeCrypto: 0.5,
          feeUsdMicro: 500_000,
          currency,
          expiresAt: new Date(Date.now() + 300_000),
        };
      },
    };

    expect(mockProvider).toBeTruthy();
    expect(typeof mockProvider.createPayout).toBe('function');
    expect(typeof mockProvider.getPayoutStatus).toBe('function');
    expect(typeof mockProvider.getEstimate).toBe('function');
  });

  it('PayoutRequest type enforces required fields', () => {
    const request: PayoutRequest = {
      idempotencyKey: 'payout:alice:123',
      amount: 10.0,
      currency: 'usdc',
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD',
    };
    expect(request.idempotencyKey).toBeTruthy();
    expect(request.amount).toBeGreaterThan(0);
  });

  it('PayoutResult includes all status fields', () => {
    const result: PayoutResult = {
      providerPayoutId: 'prov-456',
      status: 'finished',
      amount: 10.0,
      currency: 'usdc',
      address: '0x742d35Cc',
      hash: '0xabc123',
      createdAt: new Date(),
    };
    expect(result.hash).toBeTruthy();
    expect(result.status).toBe('finished');
  });
});

// =============================================================================
// Task 8.4: Payout State Machine
// =============================================================================

describe('Task 8.4: Payout State Machine', () => {
  let sm: PayoutStateMachine;

  beforeEach(() => {
    sm = new PayoutStateMachine(db);
  });

  it('creates payout request in pending state', () => {
    const { payoutId } = sm.createRequest('alice', 1_000_000, 50_000, '0xABC', 'usdc');
    const payout = sm.getPayout(payoutId);
    expect(payout).toBeTruthy();
    expect(payout!.status).toBe('pending');
    expect(payout!.amount_micro).toBe(1_000_000);
    expect(payout!.fee_micro).toBe(50_000);
    expect(payout!.net_amount_micro).toBe(950_000);
  });

  it('transitions pending → approved with escrow', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    const result = sm.approve(payoutId);

    expect(result.success).toBe(true);
    expect(result.fromState).toBe('pending');
    expect(result.toState).toBe('approved');

    // Verify escrow ledger entry
    const escrow = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow:${payoutId}`) as Record<string, unknown>;
    expect(escrow).toBeTruthy();
    expect(escrow.entry_type).toBe('escrow');
    expect(Number(escrow.amount_micro)).toBe(500_000);
  });

  it('transitions approved → processing', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);

    const result = sm.markProcessing(payoutId, 'provider-payout-123');
    expect(result.success).toBe(true);

    const payout = sm.getPayout(payoutId);
    expect(payout!.status).toBe('processing');
    expect(payout!.provider_payout_id).toBe('provider-payout-123');
  });

  it('transitions processing → completed with escrow release', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-123');

    const result = sm.complete(payoutId);
    expect(result.success).toBe(true);
    expect(result.toState).toBe('completed');

    // Verify escrow release
    const release = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow_release:${payoutId}`) as Record<string, unknown>;
    expect(release).toBeTruthy();
    expect(Number(release.amount_micro)).toBe(-500_000);

    // Verify treasury version incremented
    const treasury = db.prepare(`SELECT version FROM treasury_state WHERE id = 1`).get() as { version: number };
    expect(treasury.version).toBe(1);
  });

  it('transitions processing → failed with escrow return', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-456');

    const result = sm.fail(payoutId, 'Insufficient provider balance');
    expect(result.success).toBe(true);

    // Verify escrow return
    const ret = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow_return:${payoutId}`) as Record<string, unknown>;
    expect(ret).toBeTruthy();
    expect(Number(ret.amount_micro)).toBe(-500_000);

    const payout = sm.getPayout(payoutId);
    expect(payout!.error_message).toBe('Insufficient provider balance');
  });

  it('rejects invalid transition pending → completed', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    const result = sm.complete(payoutId);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Invalid transition');
  });

  it('rejects invalid transition completed → processing', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-789');
    sm.complete(payoutId);

    const result = sm.markProcessing(payoutId, 'prov-new');
    expect(result.success).toBe(false);
  });

  it('cancels pending payout', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    const result = sm.cancel(payoutId);
    expect(result.success).toBe(true);
    expect(result.toState).toBe('cancelled');
  });

  it('cancels approved payout with escrow return', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);

    const result = sm.cancel(payoutId);
    expect(result.success).toBe(true);

    // Verify escrow was returned
    const ret = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow_cancel:${payoutId}`) as Record<string, unknown>;
    expect(ret).toBeTruthy();
    expect(Number(ret.amount_micro)).toBe(-500_000);
  });

  it('rejects cancel of processing payout', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-cancel');

    const result = sm.cancel(payoutId);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Cannot cancel');
  });

  it('quarantines payout with unknown provider status', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-q');

    const result = sm.quarantine(payoutId, 'mysterious_status');
    expect(result.success).toBe(true);

    const payout = sm.getPayout(payoutId);
    expect(payout!.status).toBe('quarantined');
    expect(payout!.provider_status).toBe('mysterious_status');
  });

  it('is idempotent — double approve has no effect', () => {
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    const result1 = sm.approve(payoutId);
    expect(result1.success).toBe(true);

    const result2 = sm.approve(payoutId);
    expect(result2.success).toBe(false); // Already approved

    // Only one escrow entry
    const escrows = db.prepare(`
      SELECT COUNT(*) as c FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow:${payoutId}`) as { c: number };
    expect(escrows.c).toBe(1);
  });
});

// =============================================================================
// Task 8.5: Webhook Event Storage
// =============================================================================

describe('Task 8.5: Webhook Event Storage', () => {
  it('stores raw webhook payload', () => {
    const eventId = 'wh-event-123';
    const payload = JSON.stringify({
      payment_id: 'prov-123',
      payment_status: 'finished',
      pay_amount: 10.5,
    });

    db.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, payload)
      VALUES (?, 'nowpayments', 'payout_status', ?)
    `).run(eventId, payload);

    const stored = db.prepare(`SELECT * FROM webhook_events WHERE id = ?`).get(eventId) as Record<string, unknown>;
    expect(stored).toBeTruthy();
    expect(stored.provider).toBe('nowpayments');
    expect(JSON.parse(stored.payload as string).payment_status).toBe('finished');
  });

  it('enforces UNIQUE on provider+id for replay protection', () => {
    db.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, payload)
      VALUES ('wh-dup', 'nowpayments', 'status', '{}')
    `).run();

    // Second insert with same id+provider should fail
    expect(() => {
      db.prepare(`
        INSERT INTO webhook_events (id, provider, event_type, payload)
        VALUES ('wh-dup', 'nowpayments', 'status', '{}')
      `).run();
    }).toThrow();
  });

  it('quarantines unknown provider status', () => {
    const sm = new PayoutStateMachine(db);
    const { payoutId } = sm.createRequest('alice', 500_000, 10_000, '0xABC');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'prov-wh');

    // Simulate unknown status from webhook
    const unknownStatus = 'pending_review';
    const result = sm.quarantine(payoutId, unknownStatus);
    expect(result.success).toBe(true);

    const payout = sm.getPayout(payoutId);
    expect(payout!.status).toBe('quarantined');
    expect(payout!.error_message).toContain('Unknown provider status');
  });
});

// =============================================================================
// E2E: Full Payout Lifecycle
// =============================================================================

describe('e2e-payout', () => {
  it('create → approve → process → complete lifecycle', () => {
    const sm = new PayoutStateMachine(db);

    // Step 1: Create
    const { payoutId } = sm.createRequest('alice', 1_000_000, 50_000, '0xAliceWallet', 'usdc');
    expect(sm.getPayout(payoutId)!.status).toBe('pending');

    // Step 2: Approve (creates escrow)
    sm.approve(payoutId);
    expect(sm.getPayout(payoutId)!.status).toBe('approved');

    // Step 3: Processing (provider API called)
    sm.markProcessing(payoutId, 'nowpay-payout-789');
    expect(sm.getPayout(payoutId)!.status).toBe('processing');

    // Step 4: Complete (escrow released, treasury version bumped)
    sm.complete(payoutId);
    expect(sm.getPayout(payoutId)!.status).toBe('completed');

    // Verify ledger has both hold and release
    const ledgerEntries = db.prepare(`
      SELECT idempotency_key, amount_micro FROM credit_ledger
      WHERE account_id = 'alice' AND pool_id = 'withdrawal:pending'
      ORDER BY entry_seq
    `).all() as Array<{ idempotency_key: string; amount_micro: number }>;

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries[0].amount_micro).toBe(1_000_000);  // hold
    expect(ledgerEntries[1].amount_micro).toBe(-1_000_000); // release

    // Treasury version incremented
    const treasury = db.prepare(`SELECT version FROM treasury_state WHERE id = 1`).get() as { version: number };
    expect(treasury.version).toBe(1);
  });

  it('create → approve → process → fail → escrow returned', () => {
    const sm = new PayoutStateMachine(db);

    const { payoutId } = sm.createRequest('bob', 2_000_000, 100_000, '0xBobWallet');
    sm.approve(payoutId);
    sm.markProcessing(payoutId, 'nowpay-fail-1');
    sm.fail(payoutId, 'Provider error: insufficient funds');

    expect(sm.getPayout(payoutId)!.status).toBe('failed');

    // Escrow returned
    const ret = db.prepare(`
      SELECT * FROM credit_ledger WHERE idempotency_key = ?
    `).get(`escrow_return:${payoutId}`) as Record<string, unknown>;
    expect(ret).toBeTruthy();
    expect(Number(ret.amount_micro)).toBe(-2_000_000);
  });
});
