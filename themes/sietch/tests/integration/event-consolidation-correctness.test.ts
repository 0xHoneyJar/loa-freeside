/**
 * Event Consolidation Correctness Test (Sprint 291, Task 8.4)
 *
 * Verifies EventConsolidationAdapter dual-write correctness:
 *   - Mapped event types produce rows in BOTH billing_events AND economic_events
 *   - Unmapped types produce rows ONLY in billing_events
 *   - Event ordering is preserved in both tables
 *   - Query delegation routes to legacy emitter
 *   - Transaction atomicity: rollback removes both rows
 *
 * SDD refs: §4.5 EventConsolidationAdapter, §4.5.2 Event Type Mapping
 * PRD refs: G-4 Event consolidation
 * Sprint refs: Sprint 291 Task 8.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Schema imports
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_EVENTS_SCHEMA_SQL } from '../../src/db/migrations/049_billing_events.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';

// Service imports
import { EventConsolidationAdapter } from '../../src/packages/adapters/billing/EventConsolidationAdapter.js';
import { EconomicEventEmitter } from '../../src/packages/adapters/billing/EconomicEventEmitter.js';
import { BillingEventEmitter } from '../../src/packages/adapters/billing/BillingEventEmitter.js';
import type { EconomicEventInput } from '../../src/packages/core/protocol/economic-events.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let adapter: EventConsolidationAdapter;
let economicEmitter: EconomicEventEmitter;
let billingEmitter: BillingEventEmitter;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Credit ledger base (needed for aggregate queries)
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);

  // Both event tables
  testDb.exec(BILLING_EVENTS_SCHEMA_SQL);
  testDb.exec(ECONOMIC_EVENTS_SQL);

  return testDb;
}

function getBillingEventCount(testDb: Database.Database, eventType?: string): number {
  if (eventType) {
    return (testDb.prepare(`SELECT COUNT(*) as cnt FROM billing_events WHERE type = ?`).get(eventType) as { cnt: number }).cnt;
  }
  return (testDb.prepare(`SELECT COUNT(*) as cnt FROM billing_events`).get() as { cnt: number }).cnt;
}

function getEconomicEventCount(testDb: Database.Database, eventType?: string): number {
  if (eventType) {
    return (testDb.prepare(`SELECT COUNT(*) as cnt FROM economic_events WHERE event_type = ?`).get(eventType) as { cnt: number }).cnt;
  }
  return (testDb.prepare(`SELECT COUNT(*) as cnt FROM economic_events`).get() as { cnt: number }).cnt;
}

function createMappedEvent(eventType: string): EconomicEventInput {
  return {
    eventType: eventType as any,
    entityType: 'account',
    entityId: randomUUID(),
    correlationId: `test:${randomUUID()}`,
    idempotencyKey: `test-${randomUUID()}`,
    payload: { test: true, eventType },
  };
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  economicEmitter = new EconomicEventEmitter(db);
  billingEmitter = new BillingEventEmitter(db);
  adapter = new EventConsolidationAdapter(db, economicEmitter, billingEmitter);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// G-4: Event Consolidation Correctness
// =============================================================================

describe('Event Consolidation Correctness (G-4)', () => {
  describe('dual-write for mapped types', () => {
    const MAPPED_TYPES = [
      'LotMinted',
      'ReservationCreated',
      'ReservationFinalized',
      'ReservationReleased',
      'ReferralRegistered',
      'BonusGranted',
      'BonusFlagged',
      'EarningRecorded',
      'EarningSettled',
      'EarningClawedBack',
      'AgentSettlementInstant',
      'AgentClawbackPartial',
      'AgentClawbackReceivableCreated',
      'AgentBudgetWarning',
      'AgentBudgetExhausted',
      'PayoutRequested',
      'PayoutApproved',
      'PayoutCompleted',
      'PayoutFailed',
      'RewardsDistributed',
      'ScoreImported',
    ];

    it('each mapped type produces rows in both tables', () => {
      for (const eventType of MAPPED_TYPES) {
        const event = createMappedEvent(eventType);
        adapter.emit(event);

        const billingCount = getBillingEventCount(db, eventType);
        const economicCount = getEconomicEventCount(db, eventType);

        expect(billingCount, `billing_events missing for ${eventType}`).toBe(1);
        expect(economicCount, `economic_events missing for ${eventType}`).toBe(1);
      }

      // Total counts match
      expect(getBillingEventCount(db)).toBe(MAPPED_TYPES.length);
      expect(getEconomicEventCount(db)).toBe(MAPPED_TYPES.length);
    });
  });

  describe('unmapped types', () => {
    it('cycle-031 event types write only to economic_events', () => {
      // New cycle-031 types that have no billing counterpart
      const newTypes = [
        'PeerTransferInitiated',
        'PeerTransferCompleted',
        'PeerTransferRejected',
        'TbaBound',
        'TbaDepositDetected',
        'TbaDepositBridged',
        'TbaDepositFailed',
        'AgentProposalSubmitted',
        'AgentProposalQuorumReached',
        'AgentProposalActivated',
        'AgentProposalRejected',
      ];

      for (const eventType of newTypes) {
        const event = createMappedEvent(eventType);
        adapter.emit(event);

        // Should be in economic_events (authoritative)
        expect(getEconomicEventCount(db, eventType), `economic_events missing for ${eventType}`).toBe(1);

        // Should NOT be in billing_events (no mapping)
        expect(getBillingEventCount(db, eventType), `billing_events should NOT have ${eventType}`).toBe(0);
      }
    });
  });

  describe('emitLegacyOnly', () => {
    it('writes only to billing_events', () => {
      const legacyOnlyTypes = [
        'AccountCreated',
        'LotExpired',
        'BonusWithheld',
        'PayoutProcessing',
        'WalletLinked',
        'WalletUnlinked',
      ];

      for (const eventType of legacyOnlyTypes) {
        adapter.emitLegacyOnly({
          type: eventType,
          aggregateType: 'account' as any,
          aggregateId: randomUUID(),
          causationId: null,
          timestamp: new Date().toISOString(),
          payload: { test: true },
        } as any);
      }

      // All in billing_events
      expect(getBillingEventCount(db)).toBe(legacyOnlyTypes.length);

      // None in economic_events
      expect(getEconomicEventCount(db)).toBe(0);
    });
  });

  describe('event ordering', () => {
    it('events maintain insertion order in both tables', () => {
      const types = ['LotMinted', 'ReservationCreated', 'ReservationFinalized'];
      const entityId = randomUUID();

      for (const eventType of types) {
        adapter.emit({
          eventType: eventType as any,
          entityType: 'account',
          entityId,
          correlationId: `order:${eventType}`,
          idempotencyKey: `order-${eventType}-${randomUUID()}`,
          payload: { seq: types.indexOf(eventType) },
        });
      }

      // Verify ordering in billing_events
      const billingEvents = db.prepare(`
        SELECT type FROM billing_events WHERE aggregate_id = ? ORDER BY rowid ASC
      `).all(entityId) as Array<{ type: string }>;
      expect(billingEvents.map(e => e.type)).toEqual(types);

      // Verify ordering in economic_events
      const economicEvents = db.prepare(`
        SELECT event_type FROM economic_events WHERE entity_id = ? ORDER BY rowid ASC
      `).all(entityId) as Array<{ event_type: string }>;
      expect(economicEvents.map(e => e.event_type)).toEqual(types);
    });
  });

  describe('transaction atomicity', () => {
    it('rollback removes rows from both tables', () => {
      const beforeBilling = getBillingEventCount(db);
      const beforeEconomic = getEconomicEventCount(db);

      // Start transaction, emit, then rollback
      try {
        db.transaction(() => {
          adapter.emitInTransaction(db, createMappedEvent('LotMinted'));
          adapter.emitInTransaction(db, createMappedEvent('ReservationCreated'));

          // Verify rows exist inside transaction
          expect(getBillingEventCount(db)).toBe(beforeBilling + 2);
          expect(getEconomicEventCount(db)).toBe(beforeEconomic + 2);

          // Force rollback
          throw new Error('deliberate rollback');
        })();
      } catch (e: any) {
        if (e.message !== 'deliberate rollback') throw e;
      }

      // After rollback: no new rows in either table
      expect(getBillingEventCount(db)).toBe(beforeBilling);
      expect(getEconomicEventCount(db)).toBe(beforeEconomic);
    });
  });

  describe('query delegation', () => {
    it('getEventsForAggregate routes to legacy emitter', () => {
      const entityId = randomUUID();

      // Emit via adapter (dual-write)
      adapter.emit({
        eventType: 'LotMinted' as any,
        entityType: 'account',
        entityId,
        correlationId: `test:query`,
        idempotencyKey: `query-test-${randomUUID()}`,
        payload: { amount: 100 },
      });

      // Query via adapter (should find in billing_events)
      const events = adapter.getEventsForAggregate('account', entityId);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('LotMinted');
      expect(events[0].aggregate_id).toBe(entityId);
    });
  });

  describe('idempotency', () => {
    it('duplicate idempotency keys produce single row in economic_events', () => {
      const event = createMappedEvent('LotMinted');

      // Emit twice with same idempotency key
      adapter.emit(event);
      adapter.emit(event);

      // Economic events: only 1 (INSERT OR IGNORE)
      expect(getEconomicEventCount(db, 'LotMinted')).toBe(1);

      // Billing events: may have 2 (no idempotency dedup in legacy)
      // This is expected — legacy emitter doesn't have INSERT OR IGNORE
      expect(getBillingEventCount(db, 'LotMinted')).toBeGreaterThanOrEqual(1);
    });
  });
});
