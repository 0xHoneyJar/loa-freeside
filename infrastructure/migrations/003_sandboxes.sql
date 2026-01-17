-- =============================================================================
-- Migration: 003_sandboxes.sql
-- Sprint 84: Discord Server Sandboxes - Foundation
--
-- This migration creates the control plane tables for sandbox management:
-- - sandboxes: Core sandbox metadata and lifecycle state
-- - sandbox_guild_mapping: Routes Discord events to sandboxes
-- - sandbox_audit_log: Tracks sandbox lifecycle events
--
-- Also includes PostgreSQL functions for sandbox schema lifecycle management.
-- =============================================================================

-- =============================================================================
-- SANDBOX STATUS ENUM
-- =============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sandbox_status') THEN
        CREATE TYPE sandbox_status AS ENUM (
            'pending',
            'creating',
            'running',
            'expired',
            'destroying',
            'destroyed'
        );
    END IF;
END $$;

-- =============================================================================
-- SANDBOXES TABLE (Control Plane)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sandboxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    owner VARCHAR(64) NOT NULL,
    status sandbox_status NOT NULL DEFAULT 'pending',
    schema_name VARCHAR(64) NOT NULL,
    discord_token_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    destroyed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT sandboxes_name_unique UNIQUE (name),
    CONSTRAINT sandboxes_schema_name_unique UNIQUE (schema_name)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
CREATE INDEX IF NOT EXISTS idx_sandboxes_owner ON sandboxes(owner);
CREATE INDEX IF NOT EXISTS idx_sandboxes_expires ON sandboxes(expires_at)
    WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_sandboxes_created ON sandboxes(created_at DESC);

COMMENT ON TABLE sandboxes IS 'Control plane table for sandbox metadata. Stored in public schema, not RLS-protected.';
COMMENT ON COLUMN sandboxes.name IS 'Human-readable sandbox name (auto-generated or custom)';
COMMENT ON COLUMN sandboxes.owner IS 'Developer username who created the sandbox';
COMMENT ON COLUMN sandboxes.status IS 'Lifecycle status: pending -> creating -> running -> expired/destroying -> destroyed';
COMMENT ON COLUMN sandboxes.schema_name IS 'PostgreSQL schema name (sandbox_{short_id})';
COMMENT ON COLUMN sandboxes.discord_token_id IS 'NULL = shared token, non-null = dedicated token (future)';
COMMENT ON COLUMN sandboxes.metadata IS 'Additional metadata: description, tags, ttlHours, etc.';

-- =============================================================================
-- SANDBOX GUILD MAPPING TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS sandbox_guild_mapping (
    guild_id VARCHAR(20) PRIMARY KEY,
    sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_guild_mapping_sandbox ON sandbox_guild_mapping(sandbox_id);

COMMENT ON TABLE sandbox_guild_mapping IS 'Maps Discord guild_id to sandbox for event routing. One guild can only be mapped to one sandbox.';

-- =============================================================================
-- SANDBOX AUDIT LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS sandbox_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL,
    actor VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_audit_log_sandbox_time
    ON sandbox_audit_log(sandbox_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sandbox_audit_log_type
    ON sandbox_audit_log(event_type);

COMMENT ON TABLE sandbox_audit_log IS 'Audit trail for sandbox lifecycle events';
COMMENT ON COLUMN sandbox_audit_log.event_type IS 'Event types: sandbox_created, sandbox_destroying, sandbox_destroyed, guild_registered, guild_unregistered, ttl_extended, status_changed';

-- =============================================================================
-- SANDBOX SCHEMA MANAGEMENT FUNCTIONS
-- =============================================================================

-- Create sandbox schema with tenant tables
CREATE OR REPLACE FUNCTION create_sandbox_schema(p_sandbox_id TEXT)
RETURNS VOID AS $$
DECLARE
    v_schema_name TEXT := 'sandbox_' || p_sandbox_id;
BEGIN
    -- Create schema
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema_name);

    -- Create tenant-scoped tables in sandbox schema
    -- These mirror the public schema tables but are isolated per sandbox

    -- Communities table
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.communities (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            theme_id TEXT NOT NULL DEFAULT ''basic'',
            subscription_tier TEXT NOT NULL DEFAULT ''free'',
            discord_guild_id TEXT UNIQUE,
            telegram_chat_id TEXT UNIQUE,
            is_active BOOLEAN NOT NULL DEFAULT true,
            settings JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )', v_schema_name);

    -- Profiles table
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            community_id UUID NOT NULL REFERENCES %I.communities(id) ON DELETE CASCADE,
            discord_id TEXT,
            telegram_id TEXT,
            wallet_address TEXT,
            tier TEXT,
            current_rank INTEGER,
            activity_score INTEGER NOT NULL DEFAULT 0,
            conviction_score INTEGER NOT NULL DEFAULT 0,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            first_claim_at TIMESTAMPTZ,
            metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (community_id, discord_id),
            UNIQUE (community_id, telegram_id)
        )', v_schema_name, v_schema_name);

    -- Badges table
    EXECUTE format('
        CREATE TABLE IF NOT EXISTS %I.badges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            community_id UUID NOT NULL REFERENCES %I.communities(id) ON DELETE CASCADE,
            profile_id UUID NOT NULL REFERENCES %I.profiles(id) ON DELETE CASCADE,
            badge_type TEXT NOT NULL,
            awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            awarded_by UUID REFERENCES %I.profiles(id) ON DELETE SET NULL,
            revoked_at TIMESTAMPTZ,
            metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (community_id, profile_id, badge_type)
        )', v_schema_name, v_schema_name, v_schema_name, v_schema_name);

    -- Create indexes for the sandbox schema tables
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_profiles_community ON %I.profiles(community_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_profiles_wallet ON %I.profiles(wallet_address)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_badges_profile ON %I.badges(profile_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_badges_type ON %I.badges(community_id, badge_type)', v_schema_name);

    -- Grant permissions to app role (if exists)
    BEGIN
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO arrakis_app', v_schema_name);
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO arrakis_app', v_schema_name);
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO arrakis_app', v_schema_name);
    EXCEPTION WHEN undefined_object THEN
        -- arrakis_app role doesn't exist, skip grants
        NULL;
    END;

    RAISE NOTICE 'Created sandbox schema: %', v_schema_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_sandbox_schema(TEXT) IS 'Creates a new PostgreSQL schema for a sandbox with all tenant-scoped tables (communities, profiles, badges)';

-- Drop sandbox schema (idempotent)
CREATE OR REPLACE FUNCTION drop_sandbox_schema(p_sandbox_id TEXT)
RETURNS VOID AS $$
DECLARE
    v_schema_name TEXT := 'sandbox_' || p_sandbox_id;
BEGIN
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema_name);
    RAISE NOTICE 'Dropped sandbox schema: %', v_schema_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION drop_sandbox_schema(TEXT) IS 'Drops a sandbox schema and all its contents. Idempotent - safe to call multiple times.';

-- Check if sandbox schema exists
CREATE OR REPLACE FUNCTION sandbox_schema_exists(p_sandbox_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_schema_name TEXT := 'sandbox_' || p_sandbox_id;
    v_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata
        WHERE schema_name = v_schema_name
    ) INTO v_exists;
    RETURN v_exists;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sandbox_schema_exists(TEXT) IS 'Returns true if a sandbox schema exists';

-- Get sandbox schema statistics
CREATE OR REPLACE FUNCTION get_sandbox_schema_stats(p_sandbox_id TEXT)
RETURNS TABLE (
    table_name TEXT,
    row_count BIGINT
) AS $$
DECLARE
    v_schema_name TEXT := 'sandbox_' || p_sandbox_id;
    v_table_name TEXT;
BEGIN
    FOR v_table_name IN
        SELECT t.table_name
        FROM information_schema.tables t
        WHERE t.table_schema = v_schema_name
        AND t.table_type = 'BASE TABLE'
    LOOP
        table_name := v_table_name;
        EXECUTE format('SELECT COUNT(*) FROM %I.%I', v_schema_name, v_table_name) INTO row_count;
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_sandbox_schema_stats(TEXT) IS 'Returns table names and row counts for a sandbox schema';
