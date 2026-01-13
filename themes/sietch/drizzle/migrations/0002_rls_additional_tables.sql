-- Migration: Row-Level Security Policies for Additional Tables
--
-- Sprint 70: PostgreSQL + RLS Migration (CRIT-1)
--
-- Extends RLS coverage to all tenant-scoped tables added in Sprints 50-64.
-- This complements 0001_rls_policies.sql which covers base tables.
--
-- Tables with RLS enabled by this migration:
-- - audit_logs (tenant_id)
-- - api_keys (tenant_id)
-- - incumbent_configs (community_id)
-- - migration_states (community_id)
-- - shadow_member_states (community_id)
-- - shadow_divergences (community_id)
-- - shadow_predictions (community_id)
-- - parallel_role_configs (community_id)
-- - parallel_roles (community_id)
-- - parallel_member_assignments (community_id)
-- - parallel_channel_configs (community_id)
-- - parallel_channels (community_id)
-- - parallel_channel_access (community_id)
-- - incumbent_health_checks (community_id)

-- =============================================================================
-- STEP 1: Grant table permissions to app role
-- =============================================================================

-- Sprint 50 tables
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO arrakis_app;
GRANT ALL ON audit_logs TO arrakis_admin;
GRANT ALL ON api_keys TO arrakis_admin;

-- Sprint 56 tables (Coexistence)
GRANT SELECT, INSERT, UPDATE, DELETE ON incumbent_configs TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON migration_states TO arrakis_app;
GRANT ALL ON incumbent_configs TO arrakis_admin;
GRANT ALL ON migration_states TO arrakis_admin;

-- Sprint 57 tables (Shadow Mode)
GRANT SELECT, INSERT, UPDATE, DELETE ON shadow_member_states TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shadow_divergences TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shadow_predictions TO arrakis_app;
GRANT ALL ON shadow_member_states TO arrakis_admin;
GRANT ALL ON shadow_divergences TO arrakis_admin;
GRANT ALL ON shadow_predictions TO arrakis_admin;

-- Sprint 58 tables (Parallel Mode Roles)
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_role_configs TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_roles TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_member_assignments TO arrakis_app;
GRANT ALL ON parallel_role_configs TO arrakis_admin;
GRANT ALL ON parallel_roles TO arrakis_admin;
GRANT ALL ON parallel_member_assignments TO arrakis_admin;

-- Sprint 59 tables (Parallel Mode Channels)
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_channel_configs TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_channels TO arrakis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_channel_access TO arrakis_app;
GRANT ALL ON parallel_channel_configs TO arrakis_admin;
GRANT ALL ON parallel_channels TO arrakis_admin;
GRANT ALL ON parallel_channel_access TO arrakis_admin;

-- Sprint 64 tables (Health Monitoring)
GRANT SELECT, INSERT, UPDATE, DELETE ON incumbent_health_checks TO arrakis_app;
GRANT ALL ON incumbent_health_checks TO arrakis_admin;

-- =============================================================================
-- STEP 2: Enable Row-Level Security on tenant-scoped tables
-- =============================================================================

-- Sprint 50 tables
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Sprint 56 tables
ALTER TABLE incumbent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_states ENABLE ROW LEVEL SECURITY;

-- Sprint 57 tables
ALTER TABLE shadow_member_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_divergences ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_predictions ENABLE ROW LEVEL SECURITY;

-- Sprint 58 tables
ALTER TABLE parallel_role_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_member_assignments ENABLE ROW LEVEL SECURITY;

-- Sprint 59 tables
ALTER TABLE parallel_channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_channel_access ENABLE ROW LEVEL SECURITY;

-- Sprint 64 tables
ALTER TABLE incumbent_health_checks ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 3: Create tenant isolation policies
-- =============================================================================

-- Helper function for coalesced tenant check
-- Returns the current tenant or a null UUID that matches nothing
CREATE OR REPLACE FUNCTION current_tenant_or_null() RETURNS UUID AS $$
BEGIN
    RETURN COALESCE(
        NULLIF(current_setting('app.current_tenant', true), '')::UUID,
        '00000000-0000-0000-0000-000000000000'::UUID
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- audit_logs: Special case - tenant_id can be NULL for global events
-- Platform admins see global events, tenants see their own
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON audit_logs
    FOR SELECT
    USING (
        tenant_id IS NULL  -- Global events visible to all authenticated users
        OR tenant_id = current_tenant_or_null()
    );

CREATE POLICY tenant_isolation_insert ON audit_logs
    FOR INSERT
    WITH CHECK (
        tenant_id IS NULL  -- Allow global events
        OR tenant_id = current_tenant_or_null()
    );

CREATE POLICY tenant_isolation_update ON audit_logs
    FOR UPDATE
    USING (tenant_id = current_tenant_or_null())
    WITH CHECK (tenant_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON audit_logs
    FOR DELETE
    USING (tenant_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- api_keys: tenant_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON api_keys
    FOR SELECT
    USING (tenant_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON api_keys
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON api_keys
    FOR UPDATE
    USING (tenant_id = current_tenant_or_null())
    WITH CHECK (tenant_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON api_keys
    FOR DELETE
    USING (tenant_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- incumbent_configs: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON incumbent_configs
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON incumbent_configs
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON incumbent_configs
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON incumbent_configs
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- migration_states: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON migration_states
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON migration_states
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON migration_states
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON migration_states
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- shadow_member_states: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON shadow_member_states
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON shadow_member_states
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON shadow_member_states
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON shadow_member_states
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- shadow_divergences: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON shadow_divergences
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON shadow_divergences
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON shadow_divergences
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON shadow_divergences
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- shadow_predictions: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON shadow_predictions
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON shadow_predictions
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON shadow_predictions
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON shadow_predictions
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_role_configs: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_role_configs
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_role_configs
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_role_configs
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_role_configs
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_roles: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_roles
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_roles
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_roles
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_roles
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_member_assignments: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_member_assignments
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_member_assignments
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_member_assignments
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_member_assignments
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_channel_configs: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_channel_configs
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_channel_configs
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_channel_configs
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_channel_configs
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_channels: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_channels
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_channels
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_channels
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_channels
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- parallel_channel_access: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON parallel_channel_access
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON parallel_channel_access
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON parallel_channel_access
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON parallel_channel_access
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- -----------------------------------------------------------------------------
-- incumbent_health_checks: community_id column
-- -----------------------------------------------------------------------------
CREATE POLICY tenant_isolation_select ON incumbent_health_checks
    FOR SELECT
    USING (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_insert ON incumbent_health_checks
    FOR INSERT
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_update ON incumbent_health_checks
    FOR UPDATE
    USING (community_id = current_tenant_or_null())
    WITH CHECK (community_id = current_tenant_or_null());

CREATE POLICY tenant_isolation_delete ON incumbent_health_checks
    FOR DELETE
    USING (community_id = current_tenant_or_null());

-- =============================================================================
-- STEP 4: Force RLS for table owner
-- =============================================================================

-- Force RLS even for table owner on all new tenant tables
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE incumbent_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE migration_states FORCE ROW LEVEL SECURITY;
ALTER TABLE shadow_member_states FORCE ROW LEVEL SECURITY;
ALTER TABLE shadow_divergences FORCE ROW LEVEL SECURITY;
ALTER TABLE shadow_predictions FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_role_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_member_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_channel_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_channel_access FORCE ROW LEVEL SECURITY;
ALTER TABLE incumbent_health_checks FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 5: Grant execute on helper function
-- =============================================================================

GRANT EXECUTE ON FUNCTION current_tenant_or_null() TO arrakis_app;

-- =============================================================================
-- Summary: 14 tables now have RLS enabled
-- =============================================================================
--
-- Total RLS-protected tables after this migration:
-- Base tables (0001_rls_policies.sql):
--   1. profiles
--   2. badges
--   3. manifests
--   4. shadow_states
--
-- Additional tables (this migration):
--   5. audit_logs
--   6. api_keys
--   7. incumbent_configs
--   8. migration_states
--   9. shadow_member_states
--   10. shadow_divergences
--   11. shadow_predictions
--   12. parallel_role_configs
--   13. parallel_roles
--   14. parallel_member_assignments
--   15. parallel_channel_configs
--   16. parallel_channels
--   17. parallel_channel_access
--   18. incumbent_health_checks
--
-- Tables WITHOUT RLS (intentional):
--   - communities (root tenant table, lookup before context set)
