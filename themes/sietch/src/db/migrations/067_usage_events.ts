/**
 * Migration 067: Usage Events — Immutable Accounting Ledger (Cycle 036, Sprint 1, Task 1.4)
 *
 * Creates the usage_events table for immutable per-request accounting records.
 * GPT finding F-9: Admin spend breakdown (G-6) and JSONL audit trail (G-7)
 * require durable per-request accounting records.
 *
 * This table is append-only by design — no UPDATE or DELETE operations.
 * Every budget finalization writes one row atomically with the finalization
 * transaction (Sprint 3, Task 3.5).
 *
 * All monetary values use INTEGER (BigInt micro-credits) — no floating-point.
 *
 * Indexed on (community_id, created_at) for admin dashboard queries.
 * finalization_id is UNIQUE to prevent double-write.
 *
 * SDD refs: §3.4 Budget Finalization, §5.5 Admin API
 * PRD refs: G-6 Budget Visibility, G-7 Audit Trail
 *
 * PORTABILITY NOTE (Bridge high-2): This migration uses SQLite-specific syntax.
 * For PostgreSQL (RDS production), equivalent migration required:
 *   - lower(hex(randomblob(16))) → gen_random_uuid()::text
 *   - strftime('%Y-%m-%dT%H:%M:%fZ', 'now') → NOW()
 *   - CREATE TRIGGER ... RAISE(ABORT) → PL/pgSQL trigger function
 * See: themes/sietch/src/db/migrations/README.md for dialect strategy.
 */

export const USAGE_EVENTS_SQL = `
-- =============================================================================
-- usage_events: Immutable per-request accounting ledger
-- =============================================================================
-- Append-only table — no UPDATE or DELETE by application code.
-- One row per budget finalization, written in the same DB transaction.
-- All monetary values are INTEGER micro-credits (BigInt).

CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  community_id TEXT NOT NULL,
  nft_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  amount_micro INTEGER NOT NULL DEFAULT 0 CHECK (amount_micro >= 0),
  reservation_id TEXT,
  finalization_id TEXT UNIQUE,
  conservation_guard_result INTEGER CHECK (conservation_guard_result IN (0, 1)),
  conservation_guard_violations TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Primary query pattern: admin dashboard queries by community + time range
CREATE INDEX IF NOT EXISTS idx_usage_events_community_created
  ON usage_events(community_id, created_at);

-- Query by NFT (for per-agent usage breakdown)
CREATE INDEX IF NOT EXISTS idx_usage_events_nft
  ON usage_events(nft_id, created_at);

-- Query by pool (for per-pool usage breakdown)
CREATE INDEX IF NOT EXISTS idx_usage_events_pool
  ON usage_events(pool_id, created_at);

-- Finalization lookup (idempotency — prevent double-write)
CREATE INDEX IF NOT EXISTS idx_usage_events_finalization
  ON usage_events(finalization_id)
  WHERE finalization_id IS NOT NULL;

-- Conservation guard failures (for alerting queries)
CREATE INDEX IF NOT EXISTS idx_usage_events_guard_failures
  ON usage_events(conservation_guard_result, created_at)
  WHERE conservation_guard_result = 0;

-- Enforce append-only semantics at the DB layer (immutable audit ledger)
CREATE TRIGGER IF NOT EXISTS usage_events_no_update
BEFORE UPDATE ON usage_events
BEGIN
  SELECT RAISE(ABORT, 'usage_events is append-only: UPDATE not permitted');
END;

CREATE TRIGGER IF NOT EXISTS usage_events_no_delete
BEFORE DELETE ON usage_events
BEGIN
  SELECT RAISE(ABORT, 'usage_events is append-only: DELETE not permitted');
END;
`;

export const USAGE_EVENTS_ROLLBACK_SQL = `
DROP TRIGGER IF EXISTS usage_events_no_delete;
DROP TRIGGER IF EXISTS usage_events_no_update;
DROP INDEX IF EXISTS idx_usage_events_guard_failures;
DROP INDEX IF EXISTS idx_usage_events_finalization;
DROP INDEX IF EXISTS idx_usage_events_pool;
DROP INDEX IF EXISTS idx_usage_events_nft;
DROP INDEX IF EXISTS idx_usage_events_community_created;
DROP TABLE IF EXISTS usage_events;
`;
