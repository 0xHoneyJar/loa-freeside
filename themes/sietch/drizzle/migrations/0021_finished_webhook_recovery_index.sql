-- 0021: Index the "signed finished IPN, but the status column was captured by
-- a failure transition" recovery source.
--
-- WHY THIS ROW CLASS EXISTS. The crypto_payments status-monotonicity trigger
-- (migration 0010) ranks finished(5) BELOW expired(6) and failed(7). When a
-- `failed`/`expired` delivery commits before — or after — a signed `finished`
-- IPN for the same payment, the status can never be corrected back to
-- `finished`. The purchase is nonetheless real: `finished` is the provider's
-- statement that the customer paid.
--
-- The reconciliation sweep therefore recovers such payments on the evidence of
-- the durable webhook_events row (`<payment_id>:finished`, written only after
-- HMAC verification) rather than on the status column alone. That arm runs
-- every sweep; without an index it degenerates into a growing full scan + sort
-- over all settled failures.
--
-- Deliberately NOT covering `refunded`: money that was returned is not owed.
CREATE INDEX IF NOT EXISTS idx_crypto_payments_failed_recovery
  ON crypto_payments(updated_at)
  WHERE status IN ('failed', 'expired');

-- The EXISTS probe is `provider = 'nowpayments' AND event_id = <id>:finished`.
-- webhook_events already has UNIQUE (provider, event_id) backing that lookup,
-- so no additional index is required there.

-- ---------------------------------------------------------------------------
-- Outbox drain order: match the sweep's fairness cursor.
-- ---------------------------------------------------------------------------
-- 0020 indexed created_at, which matched a plain FIFO drain. The sweep now
-- orders every arm by "least recently serviced" —
-- COALESCE(last_attempt_at, created_at) — so that a permanently-failing head
-- row rotates to the back instead of re-winning the slot every sweep and
-- blocking the rows behind it (that starves the outbox at batchSize 1, and a
-- plain created_at order cannot prevent it).
--
-- Replaced rather than added-alongside: CREATE INDEX IF NOT EXISTS silently
-- keeps an existing index of the same name with the OLD definition, so the
-- rename below is what guarantees the new order is actually served.
DROP INDEX IF EXISTS idx_pending_redis_adj_pending;

CREATE INDEX IF NOT EXISTS idx_pending_redis_adj_rotation
  ON pending_redis_credit_adjustments((COALESCE(last_attempt_at, created_at)))
  WHERE applied_at IS NULL;

-- The two payment arms need no new index here: their crypto_payments side is
-- already served by idx_crypto_payments_reconciliation (0019, non-terminal),
-- idx_crypto_payments_finished_recovery (0020, finished) and
-- idx_crypto_payments_failed_recovery (above), and their cursor side by
-- idx_crypto_payment_checks_rotation (0020).
