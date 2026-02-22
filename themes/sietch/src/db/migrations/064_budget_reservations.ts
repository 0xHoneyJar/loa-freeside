/**
 * Migration 064: Budget Reservations + Spend Events (Cycle 036, Task 1.3)
 *
 * Creates budget_reservations and spend_events tables for the budget
 * finalization pipeline. Reservations are created pre-inference and
 * finalized post-inference with actual token counts.
 *
 * Conservation invariant: available + reserved + consumed = original
 * Enforced at the credit_lots level (migration 030).
 *
 * SDD refs: §SS3.1 Budget Engine
 * PRD refs: FR-2.3 Token Budget Management
 */

export const BUDGET_RESERVATIONS_SQL = `
-- =============================================================================
-- budget_reservations: Pre-inference token budget reservations
-- =============================================================================
-- Lifecycle: pending → finalized | expired | cancelled
-- finalization_id is set when the reservation is finalized with actual usage.
-- UNIQUE constraint on finalization_id prevents double-finalization.

CREATE TABLE IF NOT EXISTS budget_reservations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL,
  lot_id TEXT,
  estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens > 0),
  actual_tokens INTEGER,
  estimated_cost_micro INTEGER NOT NULL CHECK (estimated_cost_micro > 0),
  actual_cost_micro INTEGER,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'finalized', 'expired', 'cancelled')),
  finalization_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finalized_at TEXT,
  expires_at TEXT NOT NULL
);

-- Active reservations per account (for budget calculation)
CREATE INDEX IF NOT EXISTS idx_budget_reservations_account_pending
  ON budget_reservations(account_id, status)
  WHERE status = 'pending';

-- Expired reservation cleanup
CREATE INDEX IF NOT EXISTS idx_budget_reservations_expires
  ON budget_reservations(expires_at)
  WHERE status = 'pending';

-- Finalization lookup (idempotency check)
CREATE INDEX IF NOT EXISTS idx_budget_reservations_finalization
  ON budget_reservations(finalization_id)
  WHERE finalization_id IS NOT NULL;

-- =============================================================================
-- spend_events: Atomic spend records for budget accounting
-- =============================================================================
-- Each spend event records a finalized token expenditure against a reservation.
-- Used for budget analytics and audit trail.

CREATE TABLE IF NOT EXISTS spend_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  reservation_id TEXT NOT NULL REFERENCES budget_reservations(id),
  account_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Spend per account (for analytics/reporting)
CREATE INDEX IF NOT EXISTS idx_spend_events_account
  ON spend_events(account_id, created_at);

-- Spend per reservation (for finalization audit)
CREATE INDEX IF NOT EXISTS idx_spend_events_reservation
  ON spend_events(reservation_id);
`;

export const BUDGET_RESERVATIONS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_spend_events_reservation;
DROP INDEX IF EXISTS idx_spend_events_account;
DROP TABLE IF EXISTS spend_events;
DROP INDEX IF EXISTS idx_budget_reservations_finalization;
DROP INDEX IF EXISTS idx_budget_reservations_expires;
DROP INDEX IF EXISTS idx_budget_reservations_account_pending;
DROP TABLE IF EXISTS budget_reservations;
`;
