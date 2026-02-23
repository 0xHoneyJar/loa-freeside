-- =============================================================================
-- Migration 0015: Event Sourcing Schema — Enforcement Infrastructure
-- Sprint 4, Task 4.1 (AC-4.1.1 through AC-4.1.7)
--
-- Prerequisites:
--   - 0012 already added: correlation_id, sequence_number, causation_id to lot_entries
--   - 0012 already added: idx_lot_entries_correlation
--
-- This migration adds:
--   1. pgcrypto extension (for gen_random_uuid if not already available)
--   2. community_event_sequences table (per-community monotonic counters)
--   3. enforce_event_sourcing_fields() trigger with conditional enforcement
--   4. lot_entries_lot_id_required CHECK constraint validation
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. pgcrypto Extension (AC-4.1.1)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 2. community_event_sequences Table (AC-4.1.3)
-- =============================================================================
-- Per-community monotonic sequence counter. Used by allocateSequence()
-- to generate gap-free (or gap-tolerant) sequence numbers for lot_entries.
--
-- The last_sequence column tracks the highest allocated sequence number.
-- Range allocation (Tier 3) uses allocated_ranges JSONB for batch reservation.

CREATE TABLE IF NOT EXISTS community_event_sequences (
    community_id UUID PRIMARY KEY,
    last_sequence BIGINT NOT NULL DEFAULT 0,
    allocated_ranges JSONB DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS with missing_ok + COALESCE pattern
ALTER TABLE community_event_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_event_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ces_tenant_select ON community_event_sequences;
CREATE POLICY ces_tenant_select ON community_event_sequences
    FOR SELECT USING (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

DROP POLICY IF EXISTS ces_tenant_insert ON community_event_sequences;
CREATE POLICY ces_tenant_insert ON community_event_sequences
    FOR INSERT WITH CHECK (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

DROP POLICY IF EXISTS ces_tenant_update ON community_event_sequences;
CREATE POLICY ces_tenant_update ON community_event_sequences
    FOR UPDATE
    USING (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    )
    WITH CHECK (
        community_id = COALESCE(
            NULLIF(current_setting('app.community_id', true), ''),
            '00000000-0000-0000-0000-000000000000'
        )::UUID
    );

-- Grant SELECT, INSERT, UPDATE to app role (needs to increment sequences)
GRANT SELECT, INSERT, UPDATE ON community_event_sequences TO arrakis_app;

-- =============================================================================
-- 3. Enforcement Trigger (AC-4.1.4)
-- =============================================================================
-- Conditional enforcement:
--   (a) correlation_id is always non-null (already has DEFAULT gen_random_uuid())
--   (b) sequence_number and causation_id enforced ONLY when sequence_number IS NOT NULL
--       i.e., when the application chose to allocate a sequence
--   (c) Flag-off writes leave sequence_number NULL and pass the trigger
--
-- This allows progressive rollout: existing code without event sourcing
-- can continue inserting lot_entries with NULL sequence_number.

CREATE OR REPLACE FUNCTION app.enforce_event_sourcing_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- (a) correlation_id must always be non-null
    -- The column has DEFAULT gen_random_uuid() so this catches explicit NULLs
    IF NEW.correlation_id IS NULL THEN
        RAISE EXCEPTION 'lot_entries.correlation_id must not be NULL'
            USING ERRCODE = 'check_violation';
    END IF;

    -- (b) When sequence_number is set, enforce additional fields
    IF NEW.sequence_number IS NOT NULL THEN
        -- sequence_number must be positive
        IF NEW.sequence_number <= 0 THEN
            RAISE EXCEPTION 'lot_entries.sequence_number must be positive, got %',
                NEW.sequence_number
                USING ERRCODE = 'check_violation';
        END IF;

        -- causation_id required when sequenced
        IF NEW.causation_id IS NULL THEN
            RAISE EXCEPTION 'lot_entries.causation_id required when sequence_number is set'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Install the trigger (BEFORE INSERT to reject invalid rows before write)
DROP TRIGGER IF EXISTS trg_enforce_event_sourcing ON lot_entries;
CREATE TRIGGER trg_enforce_event_sourcing
    BEFORE INSERT ON lot_entries
    FOR EACH ROW
    EXECUTE FUNCTION app.enforce_event_sourcing_fields();

-- =============================================================================
-- 4. lot_id CHECK Constraint Validation (AC-4.1.6)
-- =============================================================================
-- lot_id already has a NOT NULL + FK constraint from 0009. Add an explicit
-- named CHECK constraint for defense-in-depth and migration tooling.

DO $$
BEGIN
    -- Only add if not already present
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lot_entries_lot_id_required'
        AND conrelid = 'lot_entries'::regclass
    ) THEN
        ALTER TABLE lot_entries
            ADD CONSTRAINT lot_entries_lot_id_required
            CHECK (lot_id IS NOT NULL) NOT VALID;

        ALTER TABLE lot_entries
            VALIDATE CONSTRAINT lot_entries_lot_id_required;
    END IF;
END $$;

-- =============================================================================
-- 5. Updated Timestamp Trigger for community_event_sequences
-- =============================================================================

CREATE OR REPLACE FUNCTION app.update_event_sequences_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_event_sequences_ts ON community_event_sequences;
CREATE TRIGGER trg_update_event_sequences_ts
    BEFORE UPDATE ON community_event_sequences
    FOR EACH ROW
    EXECUTE FUNCTION app.update_event_sequences_timestamp();

COMMIT;
