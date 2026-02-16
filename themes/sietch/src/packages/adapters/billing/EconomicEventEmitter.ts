/**
 * EconomicEventEmitter — Outbox-backed event emitter
 *
 * Writes economic events to the `economic_events` outbox table.
 * Supports dual-write (emitInTransaction) for atomic co-insertion
 * with primary monetary writes, and standalone emit for non-financial events.
 *
 * Idempotency: INSERT OR IGNORE on UNIQUE idempotency_key prevents
 * duplicate events on retry.
 *
 * SDD refs: §SS4.3
 * Sprint refs: Task 8.3
 *
 * @module adapters/billing/EconomicEventEmitter
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';
import type { EconomicEventInput } from '../../core/protocol/economic-events.js';

// =============================================================================
// EconomicEventEmitter
// =============================================================================

export class EconomicEventEmitter implements IEconomicEventEmitter {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  emitInTransaction(tx: { prepare(sql: string): any }, event: EconomicEventInput): void {
    const eventId = randomUUID();
    const now = sqliteTimestamp();

    const result = tx.prepare(`
      INSERT OR IGNORE INTO economic_events
        (event_id, event_type, entity_type, entity_id, correlation_id,
         idempotency_key, config_version, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      event.eventType,
      event.entityType,
      event.entityId,
      event.correlationId ?? null,
      event.idempotencyKey ?? null,
      event.configVersion ?? null,
      JSON.stringify(event.payload),
      now,
    );

    if (result.changes === 0) {
      logger.debug({
        event: 'economic_event.duplicate',
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey,
      }, 'Duplicate economic event skipped');
    }
  }

  emit(event: EconomicEventInput): void {
    this.db.transaction(() => {
      this.emitInTransaction(this.db, event);
    })();
  }
}
