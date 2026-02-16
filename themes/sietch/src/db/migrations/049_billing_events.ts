/**
 * Migration 049 — Billing Events (Append-Only Event Log)
 *
 * Creates the `billing_events` table for unified event stream.
 * All monetary operations emit events into this table within the
 * same transaction as the primary write (dual-write pattern).
 *
 * Append-only: UPDATE and DELETE are blocked by trigger.
 *
 * SDD refs: §3 Data Architecture, §13 Key Decisions (ADR-014)
 * Sprint refs: Task 18.2
 *
 * @module db/migrations/049_billing_events
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const BILLING_EVENTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    causation_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-entity timeline queries: "show me all events for account X"
  CREATE INDEX IF NOT EXISTS idx_billing_events_aggregate
    ON billing_events (aggregate_type, aggregate_id, created_at);

  -- Event-type filtering: "show me all PayoutCompleted events"
  CREATE INDEX IF NOT EXISTS idx_billing_events_type
    ON billing_events (type, created_at);

  -- Append-only enforcement: block UPDATE
  CREATE TRIGGER IF NOT EXISTS trg_billing_events_no_update
    BEFORE UPDATE ON billing_events
    BEGIN
      SELECT RAISE(ABORT, 'billing_events is append-only: UPDATE not allowed');
    END;

  -- Append-only enforcement: block DELETE
  CREATE TRIGGER IF NOT EXISTS trg_billing_events_no_delete
    BEFORE DELETE ON billing_events
    BEGIN
      SELECT RAISE(ABORT, 'billing_events is append-only: DELETE not allowed');
    END;
`;

export function up(db: Database.Database): void {
  logger.info({ msg: 'Running migration 049_billing_events: Creating billing_events table' });

  // Check if table already exists
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='billing_events'"
  ).get();

  if (!exists) {
    db.exec(BILLING_EVENTS_SCHEMA_SQL);
  }

  logger.info({ msg: 'Migration 049_billing_events completed' });
}
