/**
 * Event Stream Foundation Tests (Sprint 274, Tasks 18.1–18.4)
 *
 * Validates:
 * - Task 18.1: Event type vocabulary compiles and covers all operations
 * - Task 18.2: billing_events table, indexes, append-only triggers
 * - Task 18.3: BillingEventEmitter dual-write with transaction atomicity
 * - Task 18.4: Temporal balance query (getBalanceAtTime) with cross-validation
 *
 * SDD refs: §3 Data Architecture, §13 Key Decisions (ADR-014)
 * Sprint refs: Tasks 18.1–18.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_EVENTS_SCHEMA_SQL } from '../../src/db/migrations/049_billing_events.js';
import { BillingEventEmitter } from '../../src/packages/adapters/billing/BillingEventEmitter.js';
import type {
  BillingEvent,
  LotMinted,
  ReservationFinalized,
  EarningRecorded,
  EarningSettled,
  PayoutRequested,
  AccountCreated,
  BillingEventType,
} from '../../src/packages/adapters/billing/protocol/billing-events.js';
import { BILLING_EVENT_TYPES } from '../../src/packages/adapters/billing/protocol/billing-events.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_EVENTS_SCHEMA_SQL);
  return testDb;
}

beforeEach(() => {
  db = setupDb();
});

afterEach(() => {
  db?.close();
});

// =============================================================================
// Task 18.1: Event Type Vocabulary
// =============================================================================

describe('Task 18.1: Event Type Vocabulary', () => {
  it('BILLING_EVENT_TYPES contains all 22 event types', () => {
    expect(BILLING_EVENT_TYPES).toHaveLength(22);
    expect(BILLING_EVENT_TYPES).toContain('AccountCreated');
    expect(BILLING_EVENT_TYPES).toContain('LotMinted');
    expect(BILLING_EVENT_TYPES).toContain('LotExpired');
    expect(BILLING_EVENT_TYPES).toContain('ReservationCreated');
    expect(BILLING_EVENT_TYPES).toContain('ReservationFinalized');
    expect(BILLING_EVENT_TYPES).toContain('ReservationReleased');
    expect(BILLING_EVENT_TYPES).toContain('ReferralRegistered');
    expect(BILLING_EVENT_TYPES).toContain('BonusGranted');
    expect(BILLING_EVENT_TYPES).toContain('BonusFlagged');
    expect(BILLING_EVENT_TYPES).toContain('BonusWithheld');
    expect(BILLING_EVENT_TYPES).toContain('EarningRecorded');
    expect(BILLING_EVENT_TYPES).toContain('EarningSettled');
    expect(BILLING_EVENT_TYPES).toContain('EarningClawedBack');
    expect(BILLING_EVENT_TYPES).toContain('PayoutRequested');
    expect(BILLING_EVENT_TYPES).toContain('PayoutApproved');
    expect(BILLING_EVENT_TYPES).toContain('PayoutProcessing');
    expect(BILLING_EVENT_TYPES).toContain('PayoutCompleted');
    expect(BILLING_EVENT_TYPES).toContain('PayoutFailed');
    expect(BILLING_EVENT_TYPES).toContain('RewardsDistributed');
    expect(BILLING_EVENT_TYPES).toContain('ScoreImported');
    expect(BILLING_EVENT_TYPES).toContain('WalletLinked');
    expect(BILLING_EVENT_TYPES).toContain('WalletUnlinked');
  });

  it('every ledger operation has a corresponding event type', () => {
    // Map of existing ledger/service operations → required event types
    const operationCoverage: Record<string, BillingEventType> = {
      'CreditLedgerAdapter.createAccount': 'AccountCreated',
      'CreditLedgerAdapter.mintLot': 'LotMinted',
      'CreditLedgerAdapter.expireLot': 'LotExpired',
      'CreditLedgerAdapter.createReservation': 'ReservationCreated',
      'CreditLedgerAdapter.finalizeReservation': 'ReservationFinalized',
      'CreditLedgerAdapter.releaseReservation': 'ReservationReleased',
      'ReferralService.register': 'ReferralRegistered',
      'BonusProcessor.grant': 'BonusGranted',
      'FraudCheckService.flag': 'BonusFlagged',
      'FraudCheckService.withhold': 'BonusWithheld',
      'RevenueDistribution.recordEarning': 'EarningRecorded',
      'SettlementService.settle': 'EarningSettled',
      'SettlementService.clawback': 'EarningClawedBack',
      'CreatorPayoutService.request': 'PayoutRequested',
      'CreatorPayoutService.approve': 'PayoutApproved',
      'CreatorPayoutService.process': 'PayoutProcessing',
      'CreatorPayoutService.complete': 'PayoutCompleted',
      'CreatorPayoutService.fail': 'PayoutFailed',
      'ScoreRewardsService.distribute': 'RewardsDistributed',
      'ScoreRewardsService.importScores': 'ScoreImported',
      'WalletLinkService.link': 'WalletLinked',
      'WalletLinkService.unlink': 'WalletUnlinked',
    };

    for (const [operation, eventType] of Object.entries(operationCoverage)) {
      expect(BILLING_EVENT_TYPES, `Missing event type for ${operation}`).toContain(eventType);
    }
  });

  it('event types are compile-time safe (discriminated union)', () => {
    // Type-level test: constructing a valid event should compile
    const event: LotMinted = {
      type: 'LotMinted',
      timestamp: '2026-02-16 03:30:00',
      aggregateId: 'lot-1',
      aggregateType: 'lot',
      causationId: 'charge-1',
      payload: {
        accountId: 'acct-1',
        poolId: 'pool-1',
        sourceType: 'purchase',
        sourceId: 'src-1',
        amountMicro: '1000000',
      },
    };

    // Verify the event satisfies BillingEvent union
    const asUnion: BillingEvent = event;
    expect(asUnion.type).toBe('LotMinted');
  });
});

// =============================================================================
// Task 18.2: billing_events Table
// =============================================================================

describe('Task 18.2: billing_events Table', () => {
  it('billing_events table exists with correct columns', () => {
    const cols = db.prepare('PRAGMA table_info(billing_events)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('type');
    expect(colNames).toContain('aggregate_id');
    expect(colNames).toContain('aggregate_type');
    expect(colNames).toContain('payload');
    expect(colNames).toContain('causation_id');
    expect(colNames).toContain('created_at');
  });

  it('indexes exist for aggregate and type queries', () => {
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='billing_events'"
    ).all() as Array<{ name: string }>;
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_billing_events_aggregate');
    expect(indexNames).toContain('idx_billing_events_type');
  });

  it('trigger blocks UPDATE on billing_events', () => {
    // Insert a row
    db.prepare(`
      INSERT INTO billing_events (id, type, aggregate_id, aggregate_type, payload, created_at)
      VALUES ('evt-1', 'AccountCreated', 'acct-1', 'account', '{}', '2026-02-16 03:30:00')
    `).run();

    // Attempt UPDATE — should fail
    expect(() => {
      db.prepare(`UPDATE billing_events SET type = 'LotMinted' WHERE id = 'evt-1'`).run();
    }).toThrow('billing_events is append-only: UPDATE not allowed');
  });

  it('trigger blocks DELETE on billing_events', () => {
    db.prepare(`
      INSERT INTO billing_events (id, type, aggregate_id, aggregate_type, payload, created_at)
      VALUES ('evt-2', 'AccountCreated', 'acct-1', 'account', '{}', '2026-02-16 03:30:00')
    `).run();

    expect(() => {
      db.prepare(`DELETE FROM billing_events WHERE id = 'evt-2'`).run();
    }).toThrow('billing_events is append-only: DELETE not allowed');
  });

  it('INSERT succeeds normally', () => {
    db.prepare(`
      INSERT INTO billing_events (id, type, aggregate_id, aggregate_type, payload, created_at)
      VALUES ('evt-3', 'LotMinted', 'lot-1', 'lot', '{"amountMicro":"1000"}', '2026-02-16 03:30:00')
    `).run();

    const row = db.prepare('SELECT * FROM billing_events WHERE id = ?').get('evt-3') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.type).toBe('LotMinted');
    expect(row.aggregate_id).toBe('lot-1');
  });
});

// =============================================================================
// Task 18.3: BillingEventEmitter
// =============================================================================

describe('Task 18.3: BillingEventEmitter', () => {
  it('emits event into billing_events table', () => {
    const emitter = new BillingEventEmitter(db);

    const event: AccountCreated = {
      type: 'AccountCreated',
      timestamp: '2026-02-16 03:30:00',
      aggregateId: 'acct-1',
      aggregateType: 'account',
      causationId: null,
      payload: { entityType: 'person', entityId: 'user-1' },
    };

    emitter.emit(event);

    const rows = db.prepare('SELECT * FROM billing_events WHERE type = ?').all('AccountCreated') as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].aggregate_id).toBe('acct-1');
    expect(rows[0].aggregate_type).toBe('account');
    const payload = JSON.parse(rows[0].payload as string);
    expect(payload.entityType).toBe('person');
  });

  it('emits event within transaction — committed', () => {
    const emitter = new BillingEventEmitter(db);

    const txn = db.transaction(() => {
      emitter.emit({
        type: 'LotMinted',
        timestamp: '2026-02-16 03:30:00',
        aggregateId: 'lot-tx-1',
        aggregateType: 'lot',
        causationId: 'charge-1',
        payload: {
          accountId: 'acct-1',
          poolId: 'pool-1',
          sourceType: 'purchase',
          sourceId: 'src-1',
          amountMicro: '5000000',
        },
      } as LotMinted, { db });
    });

    txn();

    const rows = db.prepare('SELECT * FROM billing_events WHERE aggregate_id = ?').all('lot-tx-1');
    expect(rows).toHaveLength(1);
  });

  it('atomicity: rollback after emit means no event row exists', () => {
    const emitter = new BillingEventEmitter(db);

    try {
      const txn = db.transaction(() => {
        emitter.emit({
          type: 'EarningRecorded',
          timestamp: '2026-02-16 03:30:00',
          aggregateId: 'earning-rollback',
          aggregateType: 'earning',
          causationId: 'charge-99',
          payload: {
            referrerAccountId: 'ref-1',
            refereeAccountId: 'ree-1',
            amountMicro: '1000',
            referrerBps: 1000,
            sourceChargeMicro: '10000',
            settleAfter: '2026-02-18 03:30:00',
            earningLotId: 'lot-99',
          },
        } as EarningRecorded, { db });

        // Force rollback
        throw new Error('Intentional rollback');
      });

      txn();
    } catch {
      // Expected
    }

    const rows = db.prepare('SELECT * FROM billing_events WHERE aggregate_id = ?').all('earning-rollback');
    expect(rows).toHaveLength(0);
  });

  it('getEventsForAggregate returns events in chronological order', () => {
    const emitter = new BillingEventEmitter(db);

    emitter.emit({
      type: 'EarningRecorded',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'earning-1',
      aggregateType: 'earning',
      causationId: null,
      payload: {
        referrerAccountId: 'ref-1', refereeAccountId: 'ree-1',
        amountMicro: '1000', referrerBps: 1000,
        sourceChargeMicro: '10000', settleAfter: '2026-02-18 01:00:00',
        earningLotId: 'lot-1',
      },
    } as EarningRecorded);

    emitter.emit({
      type: 'EarningSettled',
      timestamp: '2026-02-18 02:00:00',
      aggregateId: 'earning-1',
      aggregateType: 'earning',
      causationId: 'settlement-batch-1',
      payload: {
        referrerAccountId: 'ref-1',
        amountMicro: '1000',
        earningLotId: 'lot-1',
      },
    } as EarningSettled);

    const events = emitter.getEventsForAggregate('earning', 'earning-1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('EarningRecorded');
    expect(events[1].type).toBe('EarningSettled');
  });

  it('getEventsForAggregate filters by type', () => {
    const emitter = new BillingEventEmitter(db);

    emitter.emit({
      type: 'PayoutRequested',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'payout-1',
      aggregateType: 'payout',
      causationId: null,
      payload: { accountId: 'acct-1', amountMicro: '50000', walletAddress: '0xabc', chainId: 1 },
    } as PayoutRequested);

    emitter.emit({
      type: 'PayoutApproved',
      timestamp: '2026-02-16 02:00:00',
      aggregateId: 'payout-1',
      aggregateType: 'payout',
      causationId: null,
      payload: { approvedBy: 'admin-1' },
    } as BillingEvent);

    const approved = emitter.getEventsForAggregate('payout', 'payout-1', { types: ['PayoutApproved'] });
    expect(approved).toHaveLength(1);
    expect(approved[0].type).toBe('PayoutApproved');
  });

  it('getEventsForAggregate filters by before timestamp', () => {
    const emitter = new BillingEventEmitter(db);

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-time-1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId: 'acct-1', poolId: 'p1', sourceType: 'purchase', sourceId: null, amountMicro: '1000' },
    } as LotMinted);

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 05:00:00',
      aggregateId: 'lot-time-1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId: 'acct-1', poolId: 'p1', sourceType: 'purchase', sourceId: null, amountMicro: '2000' },
    } as LotMinted);

    const before = emitter.getEventsForAggregate('lot', 'lot-time-1', { before: '2026-02-16 03:00:00' });
    expect(before).toHaveLength(1);
  });
});

// =============================================================================
// Task 18.4: Temporal Balance Query (getBalanceAtTime)
// =============================================================================

describe('Task 18.4: Temporal Balance Query', () => {
  it('deterministic fixture: LotMinted(+1000) at T1, LotMinted(+2000) at T2, ReservationFinalized(-500) at T3', () => {
    const emitter = new BillingEventEmitter(db);
    const accountId = 'acct-temporal';
    const poolId = 'pool-temporal';

    // T1: LotMinted +1000
    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-t1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '1000' },
    } as LotMinted);

    // T2: LotMinted +2000
    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 02:00:00',
      aggregateId: 'lot-t2',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '2000' },
    } as LotMinted);

    // T3: ReservationFinalized -500
    emitter.emit({
      type: 'ReservationFinalized',
      timestamp: '2026-02-16 03:00:00',
      aggregateId: 'res-t3',
      aggregateType: 'reservation',
      causationId: null,
      payload: { accountId, amountMicro: '500', lotId: 'lot-t1', deltaMicro: '-500', poolId },
    } as ReservationFinalized);

    // Query at T2: should be 1000 + 2000 = 3000
    const balanceAtT2 = emitter.getBalanceAtTime(accountId, poolId, '2026-02-16 02:00:00');
    expect(balanceAtT2).toBe(3000n);

    // Query at T3: should be 1000 + 2000 - 500 = 2500
    const balanceAtT3 = emitter.getBalanceAtTime(accountId, poolId, '2026-02-16 03:00:00');
    expect(balanceAtT3).toBe(2500n);
  });

  it('query at T1 returns only first lot', () => {
    const emitter = new BillingEventEmitter(db);
    const accountId = 'acct-t1only';
    const poolId = 'pool-t1';

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-a1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '5000' },
    } as LotMinted);

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 05:00:00',
      aggregateId: 'lot-a2',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '3000' },
    } as LotMinted);

    const balance = emitter.getBalanceAtTime(accountId, poolId, '2026-02-16 03:00:00');
    expect(balance).toBe(5000n);
  });

  it('cross-validation: event-derived balance matches credit_ledger query', () => {
    const emitter = new BillingEventEmitter(db);
    const accountId = 'acct-xval';
    const poolId = 'pool-xval';

    // Set up credit_accounts
    db.prepare(`INSERT INTO credit_accounts (id, entity_type, entity_id) VALUES (?, 'person', ?)`).run(accountId, accountId);

    // Insert credit_lots matching the events
    db.prepare(`
      INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro, created_at)
      VALUES ('lot-xv1', ?, ?, 'purchase', 1000, 1000, 0, 0, '2026-02-16 01:00:00')
    `).run(accountId, poolId);

    db.prepare(`
      INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro, created_at)
      VALUES ('lot-xv2', ?, ?, 'purchase', 2000, 2000, 0, 0, '2026-02-16 02:00:00')
    `).run(accountId, poolId);

    // Emit matching events
    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-xv1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '1000' },
    } as LotMinted);

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 02:00:00',
      aggregateId: 'lot-xv2',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId, sourceType: 'purchase', sourceId: null, amountMicro: '2000' },
    } as LotMinted);

    // Event-derived balance
    const eventBalance = emitter.getBalanceAtTime(accountId, poolId, '2026-02-16 03:00:00');

    // Direct ledger query
    const ledgerResult = db.prepare(`
      SELECT COALESCE(SUM(available_micro), 0) as balance
      FROM credit_lots
      WHERE account_id = ? AND pool_id = ?
    `).get(accountId, poolId) as { balance: number };

    expect(eventBalance).toBe(BigInt(ledgerResult.balance));
  });

  it('returns 0n for account with no events', () => {
    const emitter = new BillingEventEmitter(db);
    const balance = emitter.getBalanceAtTime('nonexistent', 'pool-1', '2026-02-16 03:00:00');
    expect(balance).toBe(0n);
  });

  it('filters by pool — events for different pool are excluded', () => {
    const emitter = new BillingEventEmitter(db);
    const accountId = 'acct-pool-filter';

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-p1',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId: 'pool-A', sourceType: 'purchase', sourceId: null, amountMicro: '1000' },
    } as LotMinted);

    emitter.emit({
      type: 'LotMinted',
      timestamp: '2026-02-16 01:00:00',
      aggregateId: 'lot-p2',
      aggregateType: 'lot',
      causationId: null,
      payload: { accountId, poolId: 'pool-B', sourceType: 'purchase', sourceId: null, amountMicro: '9999' },
    } as LotMinted);

    const balanceA = emitter.getBalanceAtTime(accountId, 'pool-A', '2026-02-16 02:00:00');
    expect(balanceA).toBe(1000n);

    const balanceB = emitter.getBalanceAtTime(accountId, 'pool-B', '2026-02-16 02:00:00');
    expect(balanceB).toBe(9999n);
  });
});
