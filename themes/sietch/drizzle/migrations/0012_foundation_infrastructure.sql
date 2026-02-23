-- =============================================================================
-- Foundation Infrastructure — Sprint 1, Cycle 038 (The Ostrom Protocol)
-- =============================================================================
-- Cross-cutting DB infrastructure for all Ostrom Protocol features:
--   1. assert_community_scope_set() — fail-fast assertion function (AC-1.1.5)
--   2. insert_lot_entry_fn() — SECURITY DEFINER canonical insert (AC-1.2.8)
--   3. REVOKE INSERT on lot_entries from arrakis_app (AC-1.2.8)
--   4. RLS policy hardening — missing_ok + COALESCE pattern (AC-1.4.1)
--   5. DB role defaults — app.community_id = '' (AC-1.4.2)
--
-- All changes are additive and backwards-compatible with existing code.
-- The REVOKE INSERT is the only destructive change but is gated behind
-- the SECURITY DEFINER function which provides the same INSERT capability.
--
-- @see SDD §4.2 Double-Entry Append-Only Ledger
-- @see Sprint Plan v2.0.0, Sprint 1
-- =============================================================================

-- =============================================================================
-- 1. assert_community_scope_set() — Fail-fast assertion (AC-1.1.5)
-- =============================================================================
-- Called at query boundaries to ensure app.community_id is set.
-- Raises TENANT_CONTEXT_MISSING if unset or empty.
-- Complements app.current_community_id() (migration 0008) which also
-- raises, but this function is intended for assertion-style calls
-- at the application layer (middleware boundaries).

CREATE OR REPLACE FUNCTION app.assert_community_scope_set()
RETURNS VOID AS $$
DECLARE
    scope_val TEXT;
BEGIN
    scope_val := current_setting('app.community_id', true);
    IF scope_val IS NULL OR scope_val = '' THEN
        RAISE EXCEPTION 'TENANT_CONTEXT_MISSING: app.community_id must be set via SET LOCAL before executing tenant-scoped queries'
            USING ERRCODE = 'P0001';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION app.assert_community_scope_set() TO arrakis_app;

-- =============================================================================
-- 2. insert_lot_entry_fn() — SECURITY DEFINER canonical insert (AC-1.2.8)
-- =============================================================================
-- All lot_entries INSERTs MUST go through this function.
-- The function runs as the table owner (SECURITY DEFINER) to bypass
-- the REVOKE INSERT restriction. The calling application connects
-- as arrakis_app which cannot INSERT directly.
--
-- Parameters match all lot_entries columns (except auto-generated id/created_at).
-- correlation_id is mandatory (gen_random_uuid() fallback in application layer).
-- purpose, sequence_number, causation_id are optional (NULL when features disabled).

CREATE OR REPLACE FUNCTION app.insert_lot_entry_fn(
    p_lot_id UUID,
    p_community_id UUID,
    p_entry_type TEXT,
    p_amount_micro BIGINT,
    p_reservation_id TEXT DEFAULT NULL,
    p_usage_event_id TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_correlation_id UUID DEFAULT gen_random_uuid(),
    p_purpose TEXT DEFAULT NULL,
    p_sequence_number BIGINT DEFAULT NULL,
    p_causation_id UUID DEFAULT NULL,
    p_idempotent BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    -- Validate entry_type
    IF p_entry_type NOT IN ('credit', 'debit', 'expiry', 'credit_back', 'governance_debit', 'governance_credit') THEN
        RAISE EXCEPTION 'Invalid entry_type: %. Must be one of: credit, debit, expiry, credit_back, governance_debit, governance_credit', p_entry_type
            USING ERRCODE = 'P0003';
    END IF;

    -- Validate amount is positive
    IF p_amount_micro <= 0 THEN
        RAISE EXCEPTION 'amount_micro must be positive, got: %', p_amount_micro
            USING ERRCODE = 'P0003';
    END IF;

    -- Validate lot_id is non-null for non-governance entry types
    IF p_lot_id IS NULL AND p_entry_type NOT IN ('governance_debit', 'governance_credit') THEN
        RAISE EXCEPTION 'lot_id is required for entry_type: %', p_entry_type
            USING ERRCODE = 'P0003';
    END IF;

    -- Idempotent mode: ON CONFLICT DO NOTHING for debit/expiry entries
    -- Uses partial unique indexes (idx_lot_entries_reservation_debit, idx_lot_entries_reservation_expiry)
    IF p_idempotent AND p_reservation_id IS NOT NULL AND p_entry_type = 'debit' THEN
        INSERT INTO lot_entries (
            lot_id, community_id, entry_type, amount_micro,
            reservation_id, usage_event_id, reference_id,
            correlation_id, purpose, sequence_number, causation_id
        ) VALUES (
            p_lot_id, p_community_id, p_entry_type, p_amount_micro,
            p_reservation_id, p_usage_event_id, p_reference_id,
            p_correlation_id, p_purpose, p_sequence_number, p_causation_id
        )
        ON CONFLICT (lot_id, reservation_id)
            WHERE reservation_id IS NOT NULL AND entry_type = 'debit'
        DO NOTHING
        RETURNING id INTO new_id;

    ELSIF p_idempotent AND p_reservation_id IS NOT NULL AND p_entry_type = 'expiry' THEN
        INSERT INTO lot_entries (
            lot_id, community_id, entry_type, amount_micro,
            reservation_id, usage_event_id, reference_id,
            correlation_id, purpose, sequence_number, causation_id
        ) VALUES (
            p_lot_id, p_community_id, p_entry_type, p_amount_micro,
            p_reservation_id, p_usage_event_id, p_reference_id,
            p_correlation_id, p_purpose, p_sequence_number, p_causation_id
        )
        ON CONFLICT (lot_id, reservation_id)
            WHERE reservation_id IS NOT NULL AND entry_type = 'expiry'
        DO NOTHING
        RETURNING id INTO new_id;

    ELSE
        -- Standard insert (credit, credit_back, governance_*)
        INSERT INTO lot_entries (
            lot_id, community_id, entry_type, amount_micro,
            reservation_id, usage_event_id, reference_id,
            correlation_id, purpose, sequence_number, causation_id
        ) VALUES (
            p_lot_id, p_community_id, p_entry_type, p_amount_micro,
            p_reservation_id, p_usage_event_id, p_reference_id,
            p_correlation_id, p_purpose, p_sequence_number, p_causation_id
        )
        RETURNING id INTO new_id;
    END IF;

    -- new_id is NULL when idempotent conflict (entry already exists)
    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to app role (this is the ONLY way to insert lot_entries)
GRANT EXECUTE ON FUNCTION app.insert_lot_entry_fn(UUID, UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, UUID, TEXT, BIGINT, UUID, BOOLEAN) TO arrakis_app;

-- =============================================================================
-- 3. Add new columns to lot_entries for future features (nullable, additive)
-- =============================================================================
-- These columns are added now but remain NULL until their respective
-- feature flags are enabled. Application code tolerates their absence
-- via schema detection (AC-1.2.4).

-- correlation_id: links related entries across operations
ALTER TABLE lot_entries ADD COLUMN IF NOT EXISTS correlation_id UUID DEFAULT gen_random_uuid();

-- purpose: economic purpose classification (Sprint 2, F-1)
-- NULL until FEATURE_PURPOSE_TRACKING enabled
ALTER TABLE lot_entries ADD COLUMN IF NOT EXISTS purpose TEXT;

-- sequence_number: monotonic event ordering (Sprint 4, F-3)
-- NULL until FEATURE_EVENT_SOURCING enabled
ALTER TABLE lot_entries ADD COLUMN IF NOT EXISTS sequence_number BIGINT;

-- causation_id: links effect to cause in event chain (Sprint 4, F-3)
-- NULL until FEATURE_EVENT_SOURCING enabled
ALTER TABLE lot_entries ADD COLUMN IF NOT EXISTS causation_id UUID;

-- Index for correlation queries
CREATE INDEX IF NOT EXISTS idx_lot_entries_correlation
    ON lot_entries(correlation_id) WHERE correlation_id IS NOT NULL;

-- =============================================================================
-- 4. REVOKE INSERT on lot_entries from arrakis_app (AC-1.2.8)
-- =============================================================================
-- After this, arrakis_app can only insert via insert_lot_entry_fn().
-- SELECT remains granted (needed for lot_balances view and queries).

REVOKE INSERT ON lot_entries FROM arrakis_app;

-- Verify arrakis_app retains SELECT
GRANT SELECT ON lot_entries TO arrakis_app;

-- =============================================================================
-- 5. Update lot_entries entry_type CHECK to include governance types
-- =============================================================================
-- Drop and recreate the CHECK constraint to add governance entry types
-- needed by Sprint 5.

ALTER TABLE lot_entries DROP CONSTRAINT IF EXISTS lot_entries_entry_type_check;
ALTER TABLE lot_entries ADD CONSTRAINT lot_entries_entry_type_check
    CHECK (entry_type IN (
        'credit', 'debit', 'expiry', 'credit_back',
        'governance_debit', 'governance_credit'
    ));

-- =============================================================================
-- 6. RLS Policy Hardening — missing_ok + COALESCE pattern (AC-1.4.1)
-- =============================================================================
-- Update all existing RLS policies to use the hardened pattern:
--   current_setting('app.community_id', true)  -- missing_ok = true
--   COALESCE(..., '00000000-0000-0000-0000-000000000000')
--
-- The COALESCE to an impossible UUID ensures that if app.community_id is
-- not set, the policy evaluates to FALSE (no rows visible) rather than
-- raising an error or returning NULL (which PostgreSQL treats as FALSE
-- anyway, but the explicit impossible UUID is defense-in-depth).

-- Drop existing policies first (they use app.current_community_id() which RAISES)
-- and replace with COALESCE pattern that silently denies

-- credit_lots policies
DROP POLICY IF EXISTS credit_lots_tenant_select ON credit_lots;
DROP POLICY IF EXISTS credit_lots_tenant_insert ON credit_lots;

CREATE POLICY credit_lots_tenant_select ON credit_lots
    FOR SELECT USING (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

CREATE POLICY credit_lots_tenant_insert ON credit_lots
    FOR INSERT WITH CHECK (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

-- lot_entries policies
DROP POLICY IF EXISTS lot_entries_tenant_select ON lot_entries;
DROP POLICY IF EXISTS lot_entries_tenant_insert ON lot_entries;

CREATE POLICY lot_entries_tenant_select ON lot_entries
    FOR SELECT USING (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

-- lot_entries INSERT policy scoped to SECURITY DEFINER function
-- (arrakis_app can't INSERT directly, but the function runs as owner)
CREATE POLICY lot_entries_tenant_insert ON lot_entries
    FOR INSERT WITH CHECK (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

-- =============================================================================
-- 7. DB Role Default — empty community_id ensures denial (AC-1.4.2)
-- =============================================================================
-- Set default app.community_id to empty string for arrakis_app.
-- This ensures that if SET LOCAL is forgotten, the COALESCE falls through
-- to the impossible UUID and all RLS policies deny access.

ALTER ROLE arrakis_app SET app.community_id = '';

-- =============================================================================
-- 8. Idempotent expiry reservation index (additive)
-- =============================================================================
-- Add partial unique index for expiry entries (complements existing debit index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_entries_reservation_expiry
    ON lot_entries(lot_id, reservation_id)
    WHERE reservation_id IS NOT NULL AND entry_type = 'expiry';
