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
--
-- THREAT BOUNDARY (tenant isolation). Both tables keep forced RLS with tenant
-- policies keyed on app.current_community_id() — nothing here weakens RLS.
--   * WRITES are always tenant-scoped. The cursor stamp is grouped by community
--     and each group runs inside withCommunityScope; each outbox apply/ack runs
--     inside the adjustment's own community scope; the outbox INSERT runs in the
--     mint transaction, which now SET LOCALs the payment's community. A
--     cross-tenant write is therefore impossible by construction.
--   * READS for candidate enumeration are cross-community by nature (the sweep
--     is a maintenance job) and run on the same connection as the sweep's
--     pre-existing cross-community reads of crypto_payments and credit_lots —
--     i.e. a deliberately privileged maintenance connection. Enumeration is
--     read-only; every mutation it leads to is re-scoped per community above.

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

-- RLS mirrors crypto_payments (same tenant policies + app grant). The sweep
-- writes this table on the same connection it uses to update crypto_payments
-- unscoped/cross-community, so that connection already bypasses RLS; the tenant
-- policies are inert under bypass but let a community-scoped connection (e.g.
-- the withCommunityScope PG-only mint path) write its own row.
ALTER TABLE crypto_payment_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_payment_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY crypto_payment_checks_tenant_select ON crypto_payment_checks
    FOR SELECT USING (community_id = app.current_community_id());
CREATE POLICY crypto_payment_checks_tenant_insert ON crypto_payment_checks
    FOR INSERT WITH CHECK (community_id = app.current_community_id());
CREATE POLICY crypto_payment_checks_tenant_update ON crypto_payment_checks
    FOR UPDATE
    USING (community_id = app.current_community_id())
    WITH CHECK (community_id = app.current_community_id());

GRANT SELECT, INSERT, UPDATE ON crypto_payment_checks TO arrakis_app;

-- ---------------------------------------------------------------------------
-- (A2) Index for the missed-mint recovery arm.
-- ---------------------------------------------------------------------------
-- That arm runs every sweep and scans `status = 'finished'` ordered by
-- updated_at to find rows lacking a credit lot. The 0019 reconciliation index
-- is partial over NON-terminal statuses and cannot serve it, and the remaining
-- crypto_payments indexes are keyed by community or payment_id — so as
-- completed-payment history grows this becomes an increasingly expensive full
-- scan + sort on a five-minute cadence.
CREATE INDEX IF NOT EXISTS idx_crypto_payments_finished_recovery
  ON crypto_payments(updated_at)
  WHERE status = 'finished';

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

-- Drain order: least-recently-serviced first. Superseded by the expression
-- index in migration 0021 — see the rationale there. Partial index keeps only
-- unresolved rows hot.
CREATE INDEX IF NOT EXISTS idx_pending_redis_adj_pending
  ON pending_redis_credit_adjustments(created_at)
  WHERE applied_at IS NULL;

-- RLS mirrors credit_lots EXACTLY. This row is inserted in the SAME transaction,
-- on the SAME connection, with the SAME community_id as the credit_lots mint
-- (see processPaymentForLedger). Identical tenant policies therefore guarantee
-- the outbox insert succeeds precisely when the co-transactional credit_lots
-- insert does — a divergent posture (e.g. no policy) could default-deny the
-- outbox insert under a scoped app role and roll the whole mint back.
ALTER TABLE pending_redis_credit_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_redis_credit_adjustments FORCE ROW LEVEL SECURITY;

CREATE POLICY pending_redis_adj_tenant_select ON pending_redis_credit_adjustments
    FOR SELECT USING (community_id = app.current_community_id());
CREATE POLICY pending_redis_adj_tenant_insert ON pending_redis_credit_adjustments
    FOR INSERT WITH CHECK (community_id = app.current_community_id());
CREATE POLICY pending_redis_adj_tenant_update ON pending_redis_credit_adjustments
    FOR UPDATE
    USING (community_id = app.current_community_id())
    WITH CHECK (community_id = app.current_community_id());

GRANT SELECT, INSERT, UPDATE ON pending_redis_credit_adjustments TO arrakis_app;
