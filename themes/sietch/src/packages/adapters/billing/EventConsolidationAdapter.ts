/**
 * EventConsolidationAdapter — Strangler Fig Dual-Write Bridge
 *
 * Application-level adapter that ensures every economic event is written to
 * BOTH the authoritative `economic_events` outbox AND the legacy
 * `billing_events` table within a single SQLite transaction.
 *
 * Authoritative path: EconomicEventEmitter → economic_events
 * Legacy compatibility: BillingEventEmitter → billing_events
 *
 * Query delegation: getEventsForAggregate() and getBalanceAtTime() route
 * to the legacy BillingEventEmitter (unchanged during transition).
 *
 * Event type mapping: 21 billing types map 1:1 to economic event types.
 * 6 billing-only types (AccountCreated, LotExpired, BonusWithheld,
 * PayoutProcessing, WalletLinked, WalletUnlinked) have no economic
 * counterpart and are written to billing_events only via emitLegacyOnly().
 *
 * SDD refs: §4.5 EventConsolidationAdapter, §4.5.2 Event Type Mapping
 * PRD refs: FR-4.1, FR-4.2, FR-4.3, FR-4.4, FR-4.5, FR-4.6
 * ADR: ADR-009 Event Consolidation
 *
 * @module adapters/billing/EventConsolidationAdapter
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';
import type { EconomicEventInput, EconomicEventType } from '../../core/protocol/economic-events.js';
import type { EconomicEventEmitter } from './EconomicEventEmitter.js';
import type { BillingEventEmitter } from './BillingEventEmitter.js';
import type { BillingEvent, AggregateType } from './protocol/billing-events.js';
import { sqliteTimestamp } from './protocol/timestamps.js';

// =============================================================================
// Event Type Mapping (SDD §4.5.2)
// =============================================================================

/**
 * Economic event types that have a 1:1 billing_events counterpart.
 * These types exist in both ECONOMIC_EVENT_TYPES and BILLING_EVENT_TYPES.
 */
const MAPPED_EVENT_TYPES: ReadonlySet<string> = new Set([
  // Lot operations
  'LotMinted',
  // Reservation operations
  'ReservationCreated',
  'ReservationFinalized',
  'ReservationReleased',
  // Referral operations
  'ReferralRegistered',
  'BonusGranted',
  'BonusFlagged',
  // Earning operations
  'EarningRecorded',
  'EarningSettled',
  'EarningClawedBack',
  // Agent settlement
  'AgentSettlementInstant',
  'AgentClawbackPartial',
  'AgentClawbackReceivableCreated',
  // Budget operations
  'AgentBudgetWarning',
  'AgentBudgetExhausted',
  // Payout operations
  'PayoutRequested',
  'PayoutApproved',
  'PayoutCompleted',
  'PayoutFailed',
  // Score/rewards
  'RewardsDistributed',
  'ScoreImported',
]);

// =============================================================================
// EventConsolidationAdapter
// =============================================================================

export class EventConsolidationAdapter implements IEconomicEventEmitter {
  private db: Database.Database;
  private economicEmitter: EconomicEventEmitter;
  private legacyEmitter: BillingEventEmitter;

  constructor(
    db: Database.Database,
    economicEmitter: EconomicEventEmitter,
    legacyEmitter: BillingEventEmitter,
  ) {
    this.db = db;
    this.economicEmitter = economicEmitter;
    this.legacyEmitter = legacyEmitter;
  }

  /**
   * Emit an economic event within an external transaction (dual-write).
   *
   * 1. Writes to economic_events (authoritative) via EconomicEventEmitter
   * 2. If the event type has a billing counterpart, also writes to
   *    billing_events (legacy compat) via BillingEventEmitter
   *
   * Both writes share the caller's BEGIN IMMEDIATE transaction.
   * If the transaction rolls back, both rows are rolled back.
   */
  emitInTransaction(tx: { prepare(sql: string): any }, event: EconomicEventInput): void {
    // 1. Authoritative: economic_events outbox
    this.economicEmitter.emitInTransaction(tx, event);

    // 2. Legacy compatibility: billing_events (only for mapped types)
    if (MAPPED_EVENT_TYPES.has(event.eventType)) {
      const billingEvent = this.toBillingEvent(event);
      this.legacyEmitter.emit(billingEvent, { db: tx as unknown as Database.Database });
    }
  }

  /**
   * Emit an economic event with its own transaction (dual-write).
   * Creates a BEGIN IMMEDIATE transaction around both writes.
   */
  emit(event: EconomicEventInput): void {
    this.db.transaction(() => {
      this.emitInTransaction(this.db, event);
    })();
  }

  /**
   * Emit a legacy billing-only event (no economic counterpart).
   *
   * Used for the 6 unmapped types: AccountCreated, LotExpired,
   * BonusWithheld, PayoutProcessing, WalletLinked, WalletUnlinked.
   *
   * These events write ONLY to billing_events — they have no
   * representation in the economic_events outbox.
   */
  emitLegacyOnly(event: BillingEvent, opts?: { db: Database.Database }): void {
    this.legacyEmitter.emit(event, opts);
  }

  // ---------------------------------------------------------------------------
  // Query Delegation (legacy path — unchanged during transition)
  // ---------------------------------------------------------------------------

  /**
   * Query events for an aggregate. Delegates to legacy BillingEventEmitter.
   * Consumer migration to economic_events queries happens in a future cycle.
   */
  getEventsForAggregate(
    aggregateType: string,
    aggregateId: string,
    opts?: { before?: string; types?: string[] },
  ): Array<{
    id: string;
    type: string;
    aggregate_id: string;
    aggregate_type: string;
    payload: string;
    causation_id: string | null;
    created_at: string;
  }> {
    return this.legacyEmitter.getEventsForAggregate(aggregateType, aggregateId, opts);
  }

  /**
   * Temporal balance query. Delegates to legacy BillingEventEmitter.
   */
  getBalanceAtTime(accountId: string, poolId: string, asOf: string): bigint {
    return this.legacyEmitter.getBalanceAtTime(accountId, poolId, asOf);
  }

  // ---------------------------------------------------------------------------
  // Internal: Event Type Mapping
  // ---------------------------------------------------------------------------

  /**
   * Convert an EconomicEventInput to a BillingEvent for legacy dual-write.
   *
   * Field mapping:
   *   eventType    → type
   *   entityType   → aggregateType
   *   entityId     → aggregateId
   *   correlationId → causationId
   *   payload      → payload
   */
  private toBillingEvent(event: EconomicEventInput): BillingEvent {
    return {
      type: event.eventType,
      aggregateType: event.entityType as AggregateType,
      aggregateId: event.entityId,
      causationId: event.correlationId ?? null,
      timestamp: sqliteTimestamp(),
      payload: event.payload,
    } as BillingEvent;
  }
}
