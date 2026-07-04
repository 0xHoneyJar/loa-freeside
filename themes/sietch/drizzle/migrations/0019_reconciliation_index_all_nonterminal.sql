-- 0019: Reconciliation sweep index covers every swept non-terminal status.
--
-- The sweep (packages/services/reconciliation-sweep.ts) queries
--   status IN ('waiting','confirming','confirmed','sending','partially_paid')
-- but the 0010 partial index only covered ('waiting','confirming'), so the
-- other statuses scanned the table. partially_paid in particular can still
-- receive a delayed `finished` webhook that the freshness gate quarantines;
-- the sweep is its only recovery path.

DROP INDEX IF EXISTS idx_crypto_payments_reconciliation;

CREATE INDEX IF NOT EXISTS idx_crypto_payments_reconciliation
  ON crypto_payments(status, created_at)
  WHERE status IN ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid');
