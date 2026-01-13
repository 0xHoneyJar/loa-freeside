-- Migration: Row-Level Security Policies
--
-- Sprint 39: RLS Implementation
--
-- Enables Row-Level Security on all tenant-scoped tables.
-- Policy: community_id = current_setting('app.current_tenant')::UUID
--
-- IMPORTANT:
-- - RLS is NOT enabled on communities table (lookup before tenant context)
-- - App user (arrakis_app) is subject to RLS
-- - Admin user (arrakis_admin) has BYPASSRLS capability
--
-- Usage:
--   SET app.current_tenant = 'uuid-here';  -- Set tenant context
--   SELECT * FROM profiles;                 -- Returns only tenant's profiles
--   RESET app.current_tenant;               -- Clear tenant context

-- =============================================================================
-- STEP 1: Grant table permissions to app role
-- =============================================================================

-- Grant SELECT, INSERT, UPDATE, DELETE on all tables to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON communities TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON badges TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON manifests TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shadow_states TO arrakis_app;

-- Grant ALL to admin role (includes BYPASSRLS)
GRANT ALL ON communities TO arrakis_admin;
GRANT ALL ON profiles TO arrakis_admin;
GRANT ALL ON badges TO arrakis_admin;
GRANT ALL ON manifests TO arrakis_admin;
GRANT ALL ON shadow_states TO arrakis_admin;

-- =============================================================================
-- STEP 2: Enable Row-Level Security on tenant-scoped tables
-- =============================================================================

-- Enable RLS on profiles table
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on badges table
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Enable RLS on manifests table
ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;

-- Enable RLS on shadow_states table
ALTER TABLE shadow_states ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 3: Create tenant isolation policies
-- =============================================================================

-- Profiles: tenant isolation policy
-- Returns rows where community_id matches the current tenant setting
-- If app.current_tenant is not set, coalesce returns a UUID that matches nothing
CREATE POLICY tenant_isolation_select ON profiles
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_insert ON profiles
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_update ON profiles
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_delete ON profiles
    FOR DELETE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

-- Badges: tenant isolation policy
CREATE POLICY tenant_isolation_select ON badges
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_insert ON badges
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_update ON badges
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_delete ON badges
    FOR DELETE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

-- Manifests: tenant isolation policy
CREATE POLICY tenant_isolation_select ON manifests
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_insert ON manifests
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_update ON manifests
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_delete ON manifests
    FOR DELETE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

-- Shadow States: tenant isolation policy
CREATE POLICY tenant_isolation_select ON shadow_states
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_insert ON shadow_states
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_update ON shadow_states
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

CREATE POLICY tenant_isolation_delete ON shadow_states
    FOR DELETE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    ));

-- =============================================================================
-- STEP 4: Create helper functions for tenant context management
-- =============================================================================

-- Function to set tenant context
-- Usage: SELECT set_tenant_context('uuid-here');
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get current tenant context
-- Usage: SELECT get_tenant_context();
CREATE OR REPLACE FUNCTION get_tenant_context()
RETURNS UUID AS $$
DECLARE
    tenant_id TEXT;
BEGIN
    tenant_id := current_setting('app.current_tenant', true);
    IF tenant_id IS NULL OR tenant_id = '' THEN
        RETURN NULL;
    END IF;
    RETURN tenant_id::UUID;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clear tenant context
-- Usage: SELECT clear_tenant_context();
CREATE OR REPLACE FUNCTION clear_tenant_context()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', '', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute on helper functions to app role
GRANT EXECUTE ON FUNCTION set_tenant_context(UUID) TO arrakis_app;
GRANT EXECUTE ON FUNCTION get_tenant_context() TO arrakis_app;
GRANT EXECUTE ON FUNCTION clear_tenant_context() TO arrakis_app;

-- =============================================================================
-- STEP 5: Force RLS for table owner
-- =============================================================================

-- Force RLS even for table owner on all tenant tables
-- This ensures superusers still see RLS behavior (except BYPASSRLS roles)
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE badges FORCE ROW LEVEL SECURITY;
ALTER TABLE manifests FORCE ROW LEVEL SECURITY;
ALTER TABLE shadow_states FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- Notes for production deployment:
-- =============================================================================
--
-- 1. Application should connect as arrakis_app role
-- 2. Before each request, call: SELECT set_tenant_context('community-uuid');
-- 3. After request completes, call: SELECT clear_tenant_context();
-- 4. For admin operations, use connection as arrakis_admin (bypasses RLS)
-- 5. Monitor pg_stat_user_tables for RLS policy evaluation performance
--
-- Security guarantees:
-- - Cross-tenant queries return empty results (not errors)
-- - Tenant context not set = no rows visible
-- - INSERT/UPDATE with wrong community_id = permission denied
-- - Admin role can see all data (for migrations, support)
