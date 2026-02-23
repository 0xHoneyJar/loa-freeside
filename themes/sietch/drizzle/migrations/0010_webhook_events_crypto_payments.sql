-- =============================================================================
-- Webhook Events & Crypto Payments — Revenue Tables
-- (Cycle 037, Sprint 0A, Task 0A.2)
-- =============================================================================
-- webhook_events: Generic dedup table for all inbound webhooks.
-- crypto_payments: State machine for outbound payment creation.
--
-- The webhook_events table uses a provider-agnostic schema:
--   UNIQUE(provider, event_id) supports both 'nowpayments' and 'x402'
--   (Flatline sprint review iteration 2 fix)
--
-- @see SDD §4.4 Webhook Processing
-- @see SDD §7.2 Webhook Security
-- @see Flatline IMP-003: Webhook rate limiting
-- @see Flatline IMP-009: Payment creation flow
-- =============================================================================

-- =============================================================================
-- webhook_events: Idempotent dedup for all webhook providers
-- =============================================================================
-- INSERT ... ON CONFLICT (provider, event_id) DO NOTHING
-- If the INSERT returns no rows, the webhook was already processed.

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('nowpayments', 'x402')),
  event_id TEXT NOT NULL,                   -- payment_id for nowpayments, proof_nonce for x402
  payload JSONB NOT NULL DEFAULT '{}',      -- Raw webhook payload (for audit/debugging)
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Generic dedup: one entry per provider+event_id combination
  CONSTRAINT webhook_events_provider_event_uq UNIQUE (provider, event_id)
);

-- Query by provider (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider
  ON webhook_events(provider, processed_at);

-- RLS on webhook_events
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

-- Webhook events are system-level (not tenant-scoped) because webhooks
-- arrive without tenant context. Admin role handles these.
-- App role gets read-only access for dashboard queries.
GRANT SELECT, INSERT ON webhook_events TO arrakis_app;
GRANT ALL ON webhook_events TO arrakis_admin;

-- No tenant isolation policy — webhooks are processed before tenant context
-- is established. The handler looks up community_id from the payment record.

-- Append-only: no updates or deletes
CREATE TRIGGER webhook_events_no_update
    BEFORE UPDATE ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER webhook_events_no_delete
    BEFORE DELETE ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- =============================================================================
-- crypto_payments: Outbound payment state machine
-- =============================================================================
-- Tracks the lifecycle of crypto payment requests:
--   waiting → confirming → finished (success path)
--   waiting → expired (timeout path)
--   waiting → failed (error path)
--
-- The payment creation flow (Flatline IMP-009):
--   POST /payments/nowpayments → creates crypto_payments row (status=waiting)
--   → calls NOWPayments Create Payment API → stores checkout URL
--   → webhook handler only processes payments with existing row
--
-- @see SDD §4.4.1 Reconciliation

CREATE TABLE IF NOT EXISTS crypto_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL,
  payment_id TEXT UNIQUE,                   -- NOWPayments payment_id (set after API call)
  provider TEXT NOT NULL DEFAULT 'nowpayments' CHECK (provider IN ('nowpayments')),
  amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
  amount_crypto NUMERIC(24, 8),             -- Crypto amount (set by provider)
  currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN (
    'waiting', 'confirming', 'confirmed', 'sending', 'finished',
    'partially_paid', 'expired', 'failed', 'refunded'
  )),
  status_rank INTEGER NOT NULL DEFAULT 0,   -- Monotonic status ordering (prevents backwards)
  checkout_url TEXT,                         -- NOWPayments checkout URL for client
  credits_minted_at TIMESTAMPTZ,            -- When credit_lots row was created
  credits_mint_lot_id UUID,                 -- FK to credit_lots.id (set after minting)
  metadata JSONB NOT NULL DEFAULT '{}',     -- Provider-specific metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query by community (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_community
  ON crypto_payments(community_id, created_at);

-- Reconciliation sweep: find stuck payments
CREATE INDEX IF NOT EXISTS idx_crypto_payments_reconciliation
  ON crypto_payments(status, created_at)
  WHERE status IN ('waiting', 'confirming');

-- Payment ID lookup (webhook handler)
CREATE INDEX IF NOT EXISTS idx_crypto_payments_payment_id
  ON crypto_payments(payment_id)
  WHERE payment_id IS NOT NULL;

-- RLS on crypto_payments
ALTER TABLE crypto_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY crypto_payments_tenant_select ON crypto_payments
    FOR SELECT USING (community_id = app.current_community_id());

CREATE POLICY crypto_payments_tenant_insert ON crypto_payments
    FOR INSERT WITH CHECK (community_id = app.current_community_id());

CREATE POLICY crypto_payments_tenant_update ON crypto_payments
    FOR UPDATE
    USING (community_id = app.current_community_id())
    WITH CHECK (community_id = app.current_community_id());

GRANT SELECT, INSERT, UPDATE ON crypto_payments TO arrakis_app;

-- =============================================================================
-- Status monotonicity enforcement
-- =============================================================================
-- Prevents status from going backwards (e.g., finished → waiting).
-- Uses status_rank as a monotonically increasing integer.

CREATE OR REPLACE FUNCTION enforce_payment_status_monotonicity()
RETURNS TRIGGER AS $$
DECLARE
    rank_map JSONB := '{
        "waiting": 0,
        "confirming": 1,
        "confirmed": 2,
        "sending": 3,
        "partially_paid": 4,
        "finished": 5,
        "expired": 6,
        "failed": 7,
        "refunded": 8
    }'::JSONB;
    new_rank INTEGER;
BEGIN
    new_rank := (rank_map ->> NEW.status)::INTEGER;
    IF new_rank IS NULL THEN
        RAISE EXCEPTION 'Unknown payment status: %', NEW.status
            USING ERRCODE = 'P0004';
    END IF;

    IF TG_OP = 'UPDATE' AND new_rank <= OLD.status_rank THEN
        RAISE EXCEPTION 'Payment status cannot go backwards: % → %',
            OLD.status, NEW.status
            USING ERRCODE = 'P0005';
    END IF;

    NEW.status_rank := new_rank;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crypto_payments_status_monotonicity
    BEFORE INSERT OR UPDATE ON crypto_payments
    FOR EACH ROW EXECUTE FUNCTION enforce_payment_status_monotonicity();
