-- =============================================================================
-- Velocity Tables — Sprint 3, Cycle 038 (The Ostrom Protocol)
-- =============================================================================
-- Temporal Dimension: Velocity computation with pre-aggregated hourly rollups.
-- Purpose-agnostic — aggregates total debit micro per community per hour.
--
-- Tables:
--   community_debit_hourly  — Pre-aggregated hourly debit rollup (PK: community_id, hour)
--   community_velocity      — Computed velocity snapshots per community
--
-- @see SDD §4.5 Temporal Dimension
-- @see Sprint 3, Task 3.1
-- =============================================================================

-- =============================================================================
-- 1. Rollup Table: community_debit_hourly (AC-3.1.2)
-- =============================================================================
-- Purpose-agnostic: no purpose dimension (AC-3.1.5).
-- Purpose-segmented analytics are handled by community_purpose_breakdown (Sprint 2).

CREATE TABLE IF NOT EXISTS community_debit_hourly (
    community_id UUID NOT NULL,
    hour TIMESTAMPTZ NOT NULL,
    total_micro BIGINT NOT NULL DEFAULT 0,
    entry_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community_id, hour)
);

-- RLS with missing_ok + COALESCE pattern (AC-3.1.2)
ALTER TABLE community_debit_hourly ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_debit_hourly'
          AND policyname = 'community_debit_hourly_tenant_select'
    ) THEN
        CREATE POLICY community_debit_hourly_tenant_select ON community_debit_hourly
            FOR SELECT
            USING (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_debit_hourly'
          AND policyname = 'community_debit_hourly_tenant_insert'
    ) THEN
        CREATE POLICY community_debit_hourly_tenant_insert ON community_debit_hourly
            FOR INSERT
            WITH CHECK (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_debit_hourly'
          AND policyname = 'community_debit_hourly_tenant_update'
    ) THEN
        CREATE POLICY community_debit_hourly_tenant_update ON community_debit_hourly
            FOR UPDATE
            USING (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON community_debit_hourly TO arrakis_app;

-- =============================================================================
-- 2. Rollup Cursor Table (AC-3.2.3)
-- =============================================================================
-- Stores high-water mark (lot_entries.id) per community for incremental rollup.

CREATE TABLE IF NOT EXISTS community_debit_hourly_cursor (
    community_id UUID PRIMARY KEY,
    last_entry_id UUID NOT NULL,
    last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE community_debit_hourly_cursor ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_debit_hourly_cursor'
          AND policyname = 'cursor_tenant_all'
    ) THEN
        CREATE POLICY cursor_tenant_all ON community_debit_hourly_cursor
            FOR ALL
            USING (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON community_debit_hourly_cursor TO arrakis_app;

-- =============================================================================
-- 3. Velocity Snapshot Table: community_velocity (AC-3.1.1)
-- =============================================================================

CREATE TABLE IF NOT EXISTS community_velocity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_hours INTEGER NOT NULL DEFAULT 24,
    velocity_micro_per_hour BIGINT NOT NULL DEFAULT 0,
    acceleration_micro_per_hour2 BIGINT NOT NULL DEFAULT 0,
    available_balance_micro BIGINT NOT NULL DEFAULT 0,
    estimated_exhaustion_hours BIGINT,
    confidence TEXT NOT NULL DEFAULT 'low'
        CHECK (confidence IN ('high', 'medium', 'low')),
    bucket_count INTEGER NOT NULL DEFAULT 0
);

-- RLS (AC-3.1.1)
ALTER TABLE community_velocity ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_velocity'
          AND policyname = 'community_velocity_tenant_select'
    ) THEN
        CREATE POLICY community_velocity_tenant_select ON community_velocity
            FOR SELECT
            USING (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'community_velocity'
          AND policyname = 'community_velocity_tenant_insert'
    ) THEN
        CREATE POLICY community_velocity_tenant_insert ON community_velocity
            FOR INSERT
            WITH CHECK (community_id = COALESCE(
                NULLIF(current_setting('app.community_id', true), ''),
                '00000000-0000-0000-0000-000000000000'
            )::UUID);
    END IF;
END $$;

GRANT SELECT, INSERT ON community_velocity TO arrakis_app;

-- =============================================================================
-- 4. Indexes (AC-3.1.3)
-- =============================================================================

-- Recent velocity lookups per community
CREATE INDEX IF NOT EXISTS idx_velocity_recent
    ON community_velocity (community_id, computed_at DESC);

-- =============================================================================
-- 5. Pruning Function (AC-3.1.4)
-- =============================================================================
-- Retains 90 days of velocity snapshots. Run daily via EventBridge.

CREATE OR REPLACE FUNCTION app.prune_velocity_snapshots(
    p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM community_velocity
    WHERE computed_at < NOW() - (p_retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;
    RETURN rows_deleted;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION app.prune_velocity_snapshots(INTEGER) TO arrakis_app;

-- Prune old rollup data (keep 90 days)
CREATE OR REPLACE FUNCTION app.prune_debit_hourly(
    p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    rows_deleted INTEGER;
BEGIN
    DELETE FROM community_debit_hourly
    WHERE hour < NOW() - (p_retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS rows_deleted = ROW_COUNT;
    RETURN rows_deleted;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION app.prune_debit_hourly(INTEGER) TO arrakis_app;
