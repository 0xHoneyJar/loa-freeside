/**
 * IEconomicEventEmitter — Economic Event Emitter Port
 *
 * Emits economic events to the outbox table. Supports both
 * in-transaction emission (for dual-write) and standalone emission.
 *
 * SDD refs: §SS4.3
 * PRD refs: FR-7
 *
 * @module core/ports/IEconomicEventEmitter
 */

import type { EconomicEventInput } from '../protocol/economic-events.js';

export interface IEconomicEventEmitter {
  /**
   * Emit an event within an external transaction (dual-write pattern).
   * The event row shares the caller's BEGIN IMMEDIATE transaction.
   */
  emitInTransaction(tx: { prepare(sql: string): any }, event: EconomicEventInput): void;

  /**
   * Emit an event with its own transaction.
   * Used for non-financial events that don't need external atomicity.
   */
  emit(event: EconomicEventInput): void;
}
