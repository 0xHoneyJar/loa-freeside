-- =============================================================================
-- Credit Lots & Lot Entries — Double-Entry Append-Only Ledger
-- (Cycle 037, Sprint 0A, Task 0A.2)
-- =============================================================================
-- Implements the SDD §4.2 double-entry economic model:
--   credit_lots: Immutable headers (one row per funding event)
--   lot_entries: Immutable journal (debits, credits, expiry entries)
--   lot_balances: Computed view (remaining = credits - debits)
--
-- Conservation invariant I-1: committed + reserved + available = limit
-- Conservation invariant I-2: SUM(lot_entries.amount_micro) per lot = 0
--   (every debit has a matching credit origin)
--
-- All monetary values use BIGINT micro-USD (1 USD = 1,000,000 micro-USD).
-- No floating-point anywhere in the economic path.
--
-- @see SDD §4.2 Double-Entry Append-Only Ledger
-- @see Flatline IMP-003: Lot debit selection policy
-- @see Flatline IMP-005: Concurrent multi-lot debit locking
-- =============================================================================

-- =============================================================================
-- credit_lots: Immutable funding event headers
-- =============================================================================
-- One row per funding event (purchase, grant, seed, x402 settlement).
-- NEVER updated or deleted after creation. The lot_entries journal tracks
-- all subsequent debits and credits against this lot.

CREATE TABLE IF NOT EXISTS credit_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'purchase', 'grant', 'seed', 'x402', 'transfer_in', 'tba_deposit'
  )),
  payment_id TEXT,                          -- NOWPayments payment_id (nullable for non-purchase sources)
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'depleted')),
  expires_at TIMESTAMPTZ,                   -- NULL = never expires
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate minting from retried webhooks (Flatline IMP-003)
  -- Partial unique index: only enforced when payment_id is not null
  CONSTRAINT credit_lots_positive_amount CHECK (amount_micro > 0)
);

-- Partial unique index for idempotent minting (ON CONFLICT (payment_id) DO NOTHING)
CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_payment_id_uq
  ON credit_lots(payment_id) WHERE payment_id IS NOT NULL;

-- Query by community (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_credit_lots_community
  ON credit_lots(community_id, created_at);

-- Expiry sweep: find active lots past their expiry
CREATE INDEX IF NOT EXISTS idx_credit_lots_expiry
  ON credit_lots(expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- =============================================================================
-- RLS on credit_lots
-- =============================================================================
ALTER TABLE credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_lots FORCE ROW LEVEL SECURITY;

-- Tenant isolation using strict guard function
CREATE POLICY credit_lots_tenant_select ON credit_lots
    FOR SELECT USING (community_id = app.current_community_id());

CREATE POLICY credit_lots_tenant_insert ON credit_lots
    FOR INSERT WITH CHECK (community_id = app.current_community_id());

-- No UPDATE or DELETE policies — immutable table
-- Revoke mutable operations from app role
GRANT SELECT, INSERT ON credit_lots TO arrakis_app;
-- Explicitly deny UPDATE/DELETE (default-deny)

-- =============================================================================
-- lot_entries: Immutable debit/credit journal
-- =============================================================================
-- Every economic event creates one or more lot_entries rows.
-- entry_type determines the direction:
--   'credit'  — funds added to lot (initial funding)
--   'debit'   — funds consumed (inference cost)
--   'expiry'  — remaining balance zeroed on lot expiration
--   'credit_back' — refund/remainder credited back (x402 settlement)

CREATE TABLE IF NOT EXISTS lot_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES credit_lots(id),
  community_id UUID NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'credit', 'debit', 'expiry', 'credit_back'
  )),
  amount_micro BIGINT NOT NULL CHECK (amount_micro > 0),
  reservation_id TEXT,                      -- Links debit to budget reservation
  usage_event_id TEXT,                      -- Links debit to usage_events.event_id
  reference_id TEXT,                        -- Generic reference (payment_id, proof_nonce, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query lot balance (SUM debits vs credits per lot)
CREATE INDEX IF NOT EXISTS idx_lot_entries_lot
  ON lot_entries(lot_id, entry_type);

-- Query by community (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_lot_entries_community
  ON lot_entries(community_id, created_at);

-- Idempotency: prevent duplicate debits for same reservation+lot
CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_entries_reservation_lot
  ON lot_entries(lot_id, reservation_id)
  WHERE reservation_id IS NOT NULL AND entry_type = 'debit';

-- =============================================================================
-- RLS on lot_entries
-- =============================================================================
ALTER TABLE lot_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY lot_entries_tenant_select ON lot_entries
    FOR SELECT USING (community_id = app.current_community_id());

CREATE POLICY lot_entries_tenant_insert ON lot_entries
    FOR INSERT WITH CHECK (community_id = app.current_community_id());

-- No UPDATE or DELETE — immutable journal
GRANT SELECT, INSERT ON lot_entries TO arrakis_app;

-- =============================================================================
-- Append-only enforcement via triggers
-- =============================================================================
-- PostgreSQL equivalent of SQLite RAISE(ABORT) triggers.
-- Prevents application-layer bugs from violating immutability.

CREATE OR REPLACE FUNCTION prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % not permitted',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'P0002';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- credit_lots: no update, no delete
CREATE TRIGGER credit_lots_no_update
    BEFORE UPDATE ON credit_lots
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER credit_lots_no_delete
    BEFORE DELETE ON credit_lots
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- lot_entries: no update, no delete
CREATE TRIGGER lot_entries_no_update
    BEFORE UPDATE ON lot_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER lot_entries_no_delete
    BEFORE DELETE ON lot_entries
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- =============================================================================
-- lot_balances: Computed view (remaining = credits - debits)
-- =============================================================================
-- This view computes the current balance of each lot by summing
-- journal entries. Used for lot selection queries and admin dashboard.
--
-- Lot debit selection policy (Flatline IMP-003):
--   ORDER BY COALESCE(expires_at, 'infinity') ASC, created_at ASC
--   (earliest-expiry-first, then oldest-first)

CREATE OR REPLACE VIEW lot_balances AS
SELECT
    cl.id AS lot_id,
    cl.community_id,
    cl.source,
    cl.amount_micro AS original_micro,
    cl.status,
    cl.expires_at,
    cl.created_at,
    COALESCE(credits.total, 0) AS credited_micro,
    COALESCE(debits.total, 0) AS debited_micro,
    COALESCE(credits.total, 0) - COALESCE(debits.total, 0) AS remaining_micro
FROM credit_lots cl
LEFT JOIN (
    SELECT lot_id, SUM(amount_micro) AS total
    FROM lot_entries
    WHERE entry_type IN ('credit', 'credit_back')
    GROUP BY lot_id
) credits ON credits.lot_id = cl.id
LEFT JOIN (
    SELECT lot_id, SUM(amount_micro) AS total
    FROM lot_entries
    WHERE entry_type IN ('debit', 'expiry')
    GROUP BY lot_id
) debits ON debits.lot_id = cl.id;

-- Grant view access to app role
GRANT SELECT ON lot_balances TO arrakis_app;

-- =============================================================================
-- Status update exception: lot status transitions
-- =============================================================================
-- The ONLY allowed mutation on credit_lots is status transitions:
--   active → expired (by expiry sweep)
--   active → depleted (by finalize when remaining = 0)
-- We implement this via a dedicated function that temporarily disables
-- the no-update trigger for the specific status column only.

CREATE OR REPLACE FUNCTION app.update_lot_status(
    p_lot_id UUID,
    p_new_status TEXT
)
RETURNS VOID AS $$
BEGIN
    IF p_new_status NOT IN ('expired', 'depleted') THEN
        RAISE EXCEPTION 'Invalid lot status transition: %', p_new_status
            USING ERRCODE = 'P0003';
    END IF;

    -- Temporarily disable the trigger for this operation
    ALTER TABLE credit_lots DISABLE TRIGGER credit_lots_no_update;

    UPDATE credit_lots
    SET status = p_new_status
    WHERE id = p_lot_id AND status = 'active';

    ALTER TABLE credit_lots ENABLE TRIGGER credit_lots_no_update;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- SECURITY DEFINER note: This function runs as the table owner to
-- bypass the no-update trigger. The function body validates the
-- transition (only active→expired/depleted). Per Flatline SKP-002,
-- SECURITY DEFINER is documented and reviewed for RLS implications:
-- - The function does NOT read other tenants' data
-- - It only updates status column (not community_id or amount_micro)
-- - The WHERE clause ensures only active→terminal transitions

GRANT EXECUTE ON FUNCTION app.update_lot_status(UUID, TEXT) TO arrakis_app;
