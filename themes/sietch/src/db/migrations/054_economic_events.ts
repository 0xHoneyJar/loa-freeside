/**
 * Migration 054: Economic Events Outbox (Sprint 282, Task 8.1)
 *
 * Creates the economic_events outbox table for unified event publication.
 * Events are written within the same transaction as the primary write (dual-write).
 * Async dispatcher claims and publishes events to external consumers.
 *
 * Claim protocol: SELECT unclaimed → UPDATE with worker ID → process → mark published.
 * Stale claims recovered after 60 seconds.
 *
 * SDD refs: §SS3.1, §SS4.3
 * PRD refs: FR-7, FR-8
 */

export const ECONOMIC_EVENTS_SQL = `
-- =============================================================================
-- economic_events: Unified event outbox for all billing operations
-- =============================================================================
-- Dual-write pattern: events inserted within the same transaction as the
-- primary monetary write. Async dispatcher claims and publishes.

CREATE TABLE IF NOT EXISTS economic_events (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  correlation_id TEXT,
  idempotency_key TEXT UNIQUE,
  config_version INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  claimed_by TEXT,
  claimed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Dispatchable events: unclaimed and unpublished, ordered by insertion
CREATE INDEX IF NOT EXISTS idx_economic_events_dispatchable
  ON economic_events(rowid) WHERE published_at IS NULL AND claimed_by IS NULL;

-- Stale claim recovery: claimed but not published within timeout
CREATE INDEX IF NOT EXISTS idx_economic_events_stale_claims
  ON economic_events(claimed_at) WHERE claimed_by IS NOT NULL AND published_at IS NULL;

-- Per-entity event ordering
CREATE INDEX IF NOT EXISTS idx_economic_events_entity
  ON economic_events(entity_id, rowid);
`;

export const ECONOMIC_EVENTS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_economic_events_entity;
DROP INDEX IF EXISTS idx_economic_events_stale_claims;
DROP INDEX IF EXISTS idx_economic_events_dispatchable;
DROP TABLE IF EXISTS economic_events;
`;
