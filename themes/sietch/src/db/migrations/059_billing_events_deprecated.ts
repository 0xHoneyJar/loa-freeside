/**
 * Migration 059: Add deprecated_at marker to billing_events (Sprint 284, Task 1.5)
 *
 * Adds a nullable `deprecated_at` timestamp column to the `billing_events` table.
 * This column is a future-use deprecation marker — the EventConsolidationAdapter
 * handles dual-write at the application layer (not via DB triggers).
 *
 * The column enables future tooling to mark individual billing_events rows as
 * superseded by their economic_events counterparts during the migration period.
 *
 * NOTE: This migration is defined in Sprint 1 but runs in strict numeric order
 * (after 056-058). The EventConsolidationAdapter does NOT depend on this column
 * existing — it works with or without it.
 *
 * SDD refs: §3.2, §4.5 EventConsolidationAdapter
 * PRD refs: FR-4.6
 * ADR: ADR-009 Event Consolidation
 */

export const BILLING_EVENTS_DEPRECATED_SQL = `
-- =============================================================================
-- billing_events: Add deprecated_at marker for Strangler Fig transition
-- =============================================================================
-- Nullable timestamp marking when this event was superseded by its
-- economic_events counterpart. Used during transition period only.
-- No DB triggers — application-level dual-write via EventConsolidationAdapter.

ALTER TABLE billing_events ADD COLUMN deprecated_at TEXT;
`;

export const BILLING_EVENTS_DEPRECATED_ROLLBACK_SQL = `
-- SQLite does not support DROP COLUMN prior to 3.35.0.
-- For rollback, create a new table without the column and copy data.
-- In practice, this column is nullable and harmless to leave in place.
-- Rollback is a no-op in production.
`;

/**
 * Run migration forward.
 * Safely handles the case where the column already exists.
 */
export function up(db: { exec(sql: string): void; prepare(sql: string): { get(...args: unknown[]): unknown } }): void {
  // Check if column already exists (idempotent)
  const columnExists = db.prepare(
    "SELECT COUNT(*) as count FROM pragma_table_info('billing_events') WHERE name = 'deprecated_at'"
  ).get() as { count: number };

  if (columnExists.count === 0) {
    db.exec(BILLING_EVENTS_DEPRECATED_SQL);
  }
}

/**
 * Rollback migration.
 * No-op: deprecated_at is nullable and harmless to leave in place.
 * SQLite < 3.35.0 does not support DROP COLUMN.
 */
export function down(_db: { exec(sql: string): void }): void {
  // No-op — see BILLING_EVENTS_DEPRECATED_ROLLBACK_SQL comment
}
