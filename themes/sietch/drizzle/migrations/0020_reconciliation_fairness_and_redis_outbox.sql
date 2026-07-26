-- 0020: Reconciliation durability — fair rotation + Redis-adjustment outbox.
--
-- Two related durability gaps in the NOWPayments reconciliation sweep
-- (packages/services/reconciliation-sweep.ts):
--
-- (A) Starvation. The non-terminal arm is capped at ceil(batchSize/2) rows
--     ORDER BY created_at ASC. A persistent backlog of the OLDEST stuck rows
--     refills that half-batch every sweep, so newer non-terminal payments are
--     never polled. Fix: crypto_payment_checks records a per-payment
--     last_checked_at; the sweep orders least-recently-checked first and a
--     polled row rotates to the back.
--
-- (B) Lost Redis credit. When a credit lot is minted but the Redis budget
--     INCRBY fails (or the mint is Postgres-only because Redis was down), the
--     lot now exists so the missed-mint arm (WHERE credit_lots IS NULL) never
--     revisits it — the purchased credit is permanently absent from Redis.
--     Fix: pending_redis_credit_adjustments is a durable transactional outbox
--     written in the SAME transaction as the lot; the sweep drains it with an
--     idempotent (exactly-once) Redis apply until the adjustment lands.
--
-- Both are trigger-free sidecar tables: the crypto_payments status-monotonicity
-- guard (migration 0010) rejects same-status writes, so a check timestamp or
-- adjustment marker cannot live on crypto_payments without tripping it.

-- ---------------------------------------------------------------------------
-- (A) Fair-rotation cursor for the non-terminal arm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crypto_payment_checks (
  payment_id TEXT PRIMARY KEY,              -- FK-by-value to crypto_payments.payment_id
  community_id UUID NOT NULL,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_payment_checks_rotation
  ON crypto_payment_checks(last_checked_at);

-- System-level table (mirrors webhook_events): the reconciliation sweep writes
-- it cross-community from a privileged, RLS-bypassing connection — the same
-- connection that mints credit_lots and updates crypto_payments unscoped. A
-- tenant current_community_id() predicate would have nothing to satisfy on that
-- unscoped batch write, so no such policy is defined; RLS+FORCE default-denies
-- non-privileged roles, and admin/app grants match webhook_events.
ALTER TABLE crypto_payment_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_payment_checks FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON crypto_payment_checks TO arrakis_app;
GRANT ALL ON crypto_payment_checks TO arrakis_admin;

-- ---------------------------------------------------------------------------
-- (B) Durable outbox for Redis budget-limit adjustments.
-- ---------------------------------------------------------------------------
-- One row per minted purchase lot. applied_at IS NULL means the Redis
-- INCRBY has not yet landed; the sweep retries until it does. Exactly-once is
-- guaranteed by the processed:mint:{lot_id} idempotency marker, set atomically
-- with the INCRBY (see nowpayments-handler applyRedisCreditAdjustment).
CREATE TABLE IF NOT EXISTS pending_redis_credit_adjustments (
  lot_id UUID PRIMARY KEY,                   -- credit_lots.id
  community_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  applied_at TIMESTAMPTZ,                     -- NULL = still pending
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drain order: least-recently-attempted (never-attempted first) among pending.
-- Drain order: oldest-created first (created_at ASC), so a sustained stream of
-- fresh never-attempted rows can never starve older failed rows — see the sweep
-- drain query. Partial index keeps only unresolved rows hot.
CREATE INDEX IF NOT EXISTS idx_pending_redis_adj_pending
  ON pending_redis_credit_adjustments(created_at)
  WHERE applied_at IS NULL;

-- System-level table (mirrors webhook_events / crypto_payment_checks above):
-- written cross-community by the privileged webhook-mint and sweep connections.
ALTER TABLE pending_redis_credit_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_redis_credit_adjustments FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON pending_redis_credit_adjustments TO arrakis_app;
GRANT ALL ON pending_redis_credit_adjustments TO arrakis_admin;
