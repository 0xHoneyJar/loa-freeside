-- =============================================================================
-- Tenant Context Guard Function (Cycle 037, Sprint 0A, Task 0A.2)
-- =============================================================================
-- Replaces the COALESCE/nil-UUID pattern with a strict guard that RAISES
-- when tenant context is missing. This prevents silent RLS bypass.
--
-- The sprint plan (SKP-002, SKP-003) requires:
--   1. app.current_community_id() that raises on NULL
--   2. Default-deny privileges for app_role
--   3. RLS policies that use the guard function
--
-- Existing RLS policies (migration 0001) use COALESCE with nil UUID fallback.
-- New economic tables will use the strict guard. Existing tables remain
-- unchanged to avoid breaking deployed code (migrated in a future sprint).
--
-- @see SDD §3.1.1 Tenant Context Enforcement
-- @see Flatline SKP-002: RLS fragility across pooling/jobs
-- @see Flatline SKP-003: jti fail-open as auth bypass
-- =============================================================================

-- Create the app schema if it doesn't exist (for namespacing guard functions)
CREATE SCHEMA IF NOT EXISTS app;

-- =============================================================================
-- Guard Function: app.current_community_id()
-- =============================================================================
-- Returns the current tenant UUID. RAISES if not set.
-- Used in RLS policies for economic tables (credit_lots, lot_entries, etc.)
--
-- SECURITY NOTE: This is NOT SECURITY DEFINER. It runs as the calling role,
-- which means it respects the role's permissions. The Flatline review
-- (SKP-002) explicitly prohibits SECURITY DEFINER unless reviewed.

CREATE OR REPLACE FUNCTION app.current_community_id()
RETURNS UUID AS $$
DECLARE
    tenant_id TEXT;
BEGIN
    tenant_id := current_setting('app.community_id', true);
    IF tenant_id IS NULL OR tenant_id = '' THEN
        RAISE EXCEPTION 'TENANT_CONTEXT_MISSING: app.community_id must be set via SET LOCAL before accessing tenant-scoped tables'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN tenant_id::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute to app role
GRANT USAGE ON SCHEMA app TO arrakis_app;
GRANT EXECUTE ON FUNCTION app.current_community_id() TO arrakis_app;

-- =============================================================================
-- Helper: set_community_context() — for middleware/connection setup
-- =============================================================================
-- Wrapper around SET LOCAL that also validates the UUID format.
-- SET LOCAL scopes to the current transaction (works with PgBouncer
-- transaction mode per SDD §3.1.2).

CREATE OR REPLACE FUNCTION app.set_community_context(community_uuid UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.community_id', community_uuid::TEXT, true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION app.set_community_context(UUID) TO arrakis_app;

-- =============================================================================
-- Notes for production deployment:
-- =============================================================================
--
-- 1. Every request handler MUST call: SELECT app.set_community_context($1)
--    inside a BEGIN/COMMIT block before accessing economic tables.
--
-- 2. SET LOCAL ensures context is transaction-scoped (safe with PgBouncer
--    transaction mode). If the transaction is rolled back, context is cleared.
--
-- 3. Cron tasks and reconciliation jobs MUST also set context. The guard
--    function will catch missing context as a runtime error.
--
-- 4. For admin operations that span tenants, connect as arrakis_admin
--    which has BYPASSRLS capability.
