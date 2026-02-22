/**
 * Migration 065: Crypto Payments Extensions (Cycle 036, Task 1.3)
 *
 * Extends crypto_payments with credit minting tracking and status ranking.
 * Additive-only migration (new nullable columns) — safe for zero-downtime deploy.
 *
 * - credits_minted_at: When credits were minted for this payment
 * - credits_mint_event_id: Idempotency key for credit minting (UNIQUE)
 * - status_rank: Numeric rank for status ordering in queries
 *
 * SDD refs: §3.2 Payment→Credit Pipeline
 * PRD refs: FR-3.3 Crypto-to-Credit Conversion
 */

export const CRYPTO_PAYMENTS_EXTENSIONS_SQL = `
-- =============================================================================
-- Migration 065: Extend crypto_payments for credit minting pipeline
-- =============================================================================
-- All columns are nullable (additive-only, zero-downtime safe).
-- credits_mint_event_id UNIQUE prevents double-minting.

-- Add credit minting timestamp
ALTER TABLE crypto_payments ADD COLUMN credits_minted_at TEXT;

-- Add idempotency key for credit minting (prevents double-mint)
ALTER TABLE crypto_payments ADD COLUMN credits_mint_event_id TEXT UNIQUE;

-- Add numeric status rank for efficient ordering
-- waiting=10, confirming=20, confirmed=30, sending=40,
-- partially_paid=50, finished=60, failed=70, refunded=80, expired=90
ALTER TABLE crypto_payments ADD COLUMN status_rank INTEGER;

-- Index for unminted finished payments (credit minting queue)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_unminted
  ON crypto_payments(status, credits_minted_at)
  WHERE status = 'finished' AND credits_minted_at IS NULL;

-- Index for credit mint event lookup (idempotency)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_mint_event
  ON crypto_payments(credits_mint_event_id)
  WHERE credits_mint_event_id IS NOT NULL;
`;

export const CRYPTO_PAYMENTS_EXTENSIONS_ROLLBACK_SQL = `
-- SQLite does not support DROP COLUMN. These columns are nullable and harmless to leave.
-- For a full rollback, use the table recreation pattern from migration 031.
DROP INDEX IF EXISTS idx_crypto_payments_mint_event;
DROP INDEX IF EXISTS idx_crypto_payments_unminted;
-- Note: ALTER TABLE DROP COLUMN not supported in SQLite < 3.35.0
-- Columns credits_minted_at, credits_mint_event_id, status_rank left in place.
`;
