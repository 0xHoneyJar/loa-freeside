-- =============================================================================
-- Migration 0018: Admin Audit Log
-- Sprint 5, Task 5.2 (AC-5.2.1 through AC-5.2.4)
--
-- Creates a platform-level append-only audit log for admin bypass operations.
-- No RLS — access is restricted via DB role privileges (INSERT-only for app_role).
-- UPDATE/DELETE blocked by immutability trigger.
-- =============================================================================

-- AC-5.2.1: admin_audit_log table (SKP-007)
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    community_id UUID,
    resource_type TEXT,
    target_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for audit queries by actor
CREATE INDEX idx_admin_audit_actor
    ON admin_audit_log (actor_id, created_at DESC);

-- Index for audit queries by community
CREATE INDEX idx_admin_audit_community
    ON admin_audit_log (community_id, created_at DESC)
    WHERE community_id IS NOT NULL;

-- AC-5.2.2: Strict role privileges — INSERT only for app_role
-- No RLS on admin_audit_log — it's a platform-level audit trail.
-- app_role can WRITE audit entries but CANNOT READ them (prevents cross-tenant exposure).
REVOKE ALL ON TABLE admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE admin_audit_log FROM app_role;
GRANT INSERT ON TABLE admin_audit_log TO app_role;

-- AC-5.2.3: prevent_mutation() — blocks UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mutations (UPDATE/DELETE) are not permitted on %', TG_TABLE_NAME;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_immutable
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_mutation();
