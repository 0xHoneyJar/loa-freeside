-- =============================================================================
-- Purpose Tracking — Sprint 2, Cycle 038 (The Ostrom Protocol)
-- =============================================================================
-- Economic Memory: Purpose classification on all lot_entries.
-- Uses phased online DDL pattern for zero-downtime deployment:
--   Phase 1: CREATE TYPE + ADD COLUMN (nullable, metadata-only)
--   Phase 2: Backfill script (operational, not in migration)
--   Phase 3: SET DEFAULT (metadata-only)
--   Phase 4: ADD CONSTRAINT NOT VALID (metadata-only)
--   Phase 5: VALIDATE CONSTRAINT (ShareUpdateExclusiveLock only)
--
-- NOTE: Sprint 1 migration 0012 already added a TEXT `purpose` column.
-- This migration converts it to the proper ENUM type and adds the
-- breakdown view.
--
-- @see SDD §4.4 Economic Memory
-- @see Sprint 2, Task 2.1
-- =============================================================================

-- =============================================================================
-- 1. CREATE TYPE economic_purpose (AC-2.1.1)
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'economic_purpose') THEN
        CREATE TYPE economic_purpose AS ENUM (
            'agent_inference',
            'agent_training',
            'governance_action',
            'platform_fee',
            'transfer',
            'refund',
            'unclassified'
        );
    END IF;
END $$;

-- =============================================================================
-- 2. Phase 1: Convert purpose column to ENUM (AC-2.1.2)
-- =============================================================================
-- Sprint 1 added purpose as TEXT. Convert to ENUM via:
--   1. Rename old column
--   2. Add new ENUM column
--   3. Copy data with cast
--   4. Drop old column

-- If purpose column already exists as TEXT (from Sprint 1 migration 0012)
DO $$
BEGIN
    -- Check if purpose column exists and is TEXT type
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lot_entries'
          AND column_name = 'purpose'
          AND data_type = 'text'
    ) THEN
        -- Rename existing TEXT column
        ALTER TABLE lot_entries RENAME COLUMN purpose TO purpose_text_legacy;

        -- Add new ENUM column (nullable — Phase 1)
        ALTER TABLE lot_entries ADD COLUMN purpose economic_purpose NULL;

        -- Copy existing values (if any)
        UPDATE lot_entries
        SET purpose = CASE
            WHEN purpose_text_legacy IS NOT NULL AND purpose_text_legacy != ''
            THEN purpose_text_legacy::economic_purpose
            ELSE NULL
        END
        WHERE purpose_text_legacy IS NOT NULL;

        -- Drop legacy column
        ALTER TABLE lot_entries DROP COLUMN purpose_text_legacy;
    ELSIF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lot_entries'
          AND column_name = 'purpose'
    ) THEN
        -- Column doesn't exist at all — add fresh
        ALTER TABLE lot_entries ADD COLUMN purpose economic_purpose NULL;
    END IF;
    -- If column already exists as economic_purpose, do nothing (idempotent)
END $$;

-- =============================================================================
-- 3. Phase 3: SET DEFAULT (AC-2.1.3)
-- =============================================================================
-- Metadata-only operation, no table rewrite

ALTER TABLE lot_entries ALTER COLUMN purpose SET DEFAULT 'unclassified';

-- =============================================================================
-- 4. Phase 4: ADD CONSTRAINT NOT VALID (AC-2.1.4)
-- =============================================================================
-- NOT VALID means PostgreSQL does not scan existing rows.
-- Only new/updated rows are checked. This is fast and non-blocking.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lot_entries_purpose_not_null'
    ) THEN
        ALTER TABLE lot_entries
            ADD CONSTRAINT lot_entries_purpose_not_null
            CHECK (purpose IS NOT NULL) NOT VALID;
    END IF;
END $$;

-- =============================================================================
-- 5. Backfill Procedure (AC-2.1.6)
-- =============================================================================
-- This procedure backfills NULL purpose rows in batches.
-- Run operationally BEFORE Phase 5 VALIDATE.

CREATE OR REPLACE FUNCTION app.backfill_purpose(
    p_batch_size INTEGER DEFAULT 10000
)
RETURNS INTEGER AS $$
DECLARE
    rows_updated INTEGER := 0;
    batch_count INTEGER;
BEGIN
    LOOP
        UPDATE lot_entries
        SET purpose = 'unclassified'
        WHERE id IN (
            SELECT id FROM lot_entries
            WHERE purpose IS NULL
            LIMIT p_batch_size
            FOR UPDATE SKIP LOCKED
        );

        GET DIAGNOSTICS batch_count = ROW_COUNT;
        rows_updated := rows_updated + batch_count;

        -- Exit when no more NULL rows
        EXIT WHEN batch_count = 0;

        -- Brief pause to avoid holding locks too long
        PERFORM pg_sleep(0.1);
    END LOOP;

    RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION app.backfill_purpose(INTEGER) TO arrakis_app;

-- =============================================================================
-- 6. Phase 5: VALIDATE CONSTRAINT (AC-2.1.5)
-- =============================================================================
-- ShareUpdateExclusiveLock only — does not block reads or writes.
-- Safe to run after backfill completes.
-- If backfill hasn't run yet, this will fail on NULL rows.
-- In production, run backfill_purpose() first, then VALIDATE separately.
-- For development/fresh migrations, we backfill inline and validate.

-- Backfill any remaining NULLs (idempotent)
SELECT app.backfill_purpose();

-- Now validate
ALTER TABLE lot_entries VALIDATE CONSTRAINT lot_entries_purpose_not_null;

-- =============================================================================
-- 7. Update insert_lot_entry_fn to default purpose (AC-2.1.3)
-- =============================================================================
-- Update the SECURITY DEFINER function so p_purpose defaults to 'unclassified'
-- instead of NULL, matching the new column default.

CREATE OR REPLACE FUNCTION app.insert_lot_entry_fn(
    p_lot_id UUID,
    p_community_id UUID,
    p_entry_type TEXT,
    p_amount_micro BIGINT,
    p_reservation_id TEXT DEFAULT NULL,
    p_usage_event_id TEXT DEFAULT NULL,
    p_reference_id TEXT DEFAULT NULL,
    p_correlation_id UUID DEFAULT gen_random_uuid(),
    p_purpose economic_purpose DEFAULT 'unclassified',
    p_sequence_number BIGINT DEFAULT NULL,
    p_causation_id UUID DEFAULT NULL,
    p_idempotent BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    new_id UUID;
BEGIN
    IF p_entry_type NOT IN ('credit', 'debit', 'expiry', 'credit_back', 'governance_debit', 'governance_credit') THEN
        RAISE EXCEPTION 'Invalid entry_type: %. Must be one of: credit, debit, expiry, credit_back, governance_debit, governance_credit', p_entry_type
            USING ERRCODE = 'P0003';
    END IF;

    IF p_amount_micro <= 0 THEN
        RAISE EXCEPTION 'amount_micro must be positive, got: %', p_amount_micro
            USING ERRCODE = 'P0003';
    END IF;

    IF p_lot_id IS NULL AND p_entry_type NOT IN ('governance_debit', 'governance_credit') THEN
        RAISE EXCEPTION 'lot_id is required for entry_type: %', p_entry_type
            USING ERRCODE = 'P0003';
    END IF;

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

    RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update GRANT for new function signature (economic_purpose type instead of TEXT)
GRANT EXECUTE ON FUNCTION app.insert_lot_entry_fn(UUID, UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, UUID, economic_purpose, BIGINT, UUID, BOOLEAN) TO arrakis_app;

-- =============================================================================
-- 8. Purpose Breakdown View (AC-2.4.1)
-- =============================================================================
-- Groups by (community_id, purpose, day) with sum and count.
-- RLS-scoped via community_id matching.

CREATE OR REPLACE VIEW community_purpose_breakdown AS
SELECT
    community_id,
    purpose,
    DATE_TRUNC('day', created_at) AS day,
    SUM(amount_micro) AS total_micro,
    COUNT(*) AS entry_count
FROM lot_entries
WHERE entry_type IN ('debit', 'governance_debit')
GROUP BY community_id, purpose, DATE_TRUNC('day', created_at);

-- Grant access to the view
GRANT SELECT ON community_purpose_breakdown TO arrakis_app;

-- =============================================================================
-- 9. Purpose index for efficient breakdown queries
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_lot_entries_purpose_day
    ON lot_entries(community_id, purpose, created_at)
    WHERE entry_type IN ('debit', 'governance_debit');

-- =============================================================================
-- 10. Verification query (AC-2.1.7)
-- =============================================================================
-- After backfill, this should return 0.

DO $$
DECLARE
    null_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO null_count FROM lot_entries WHERE purpose IS NULL;
    IF null_count > 0 THEN
        RAISE WARNING 'PURPOSE_BACKFILL_INCOMPLETE: % rows still have NULL purpose', null_count;
    END IF;
END $$;
