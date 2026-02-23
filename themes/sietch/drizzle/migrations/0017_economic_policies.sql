-- =============================================================================
-- Migration 0017: Economic Policies & Governance Outbox
-- Sprint 5, Task 5.1 (AC-5.1.1 through AC-5.1.6)
--
-- Creates the governance infrastructure: policy state machine, partial unique
-- indexes for single-active-policy enforcement, immutability triggers for
-- audit fields, and transactional outbox for conservation guard propagation.
-- =============================================================================

-- AC-5.1.1: Policy enforcement state ENUM
CREATE TYPE policy_enforcement_state AS ENUM (
    'proposed',
    'active',
    'pending_enforcement',
    'superseded',
    'rejected',
    'expired'
);

-- AC-5.1.1: economic_policies table with all columns from SDD
CREATE TABLE IF NOT EXISTS economic_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id),
    policy_type TEXT NOT NULL,
    policy_value JSONB NOT NULL,
    state policy_enforcement_state NOT NULL DEFAULT 'proposed',
    policy_version INTEGER NOT NULL DEFAULT 1,
    proposed_by UUID NOT NULL,
    conviction_score NUMERIC,
    approved_at TIMESTAMPTZ,
    approved_by UUID,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    superseded_by UUID REFERENCES economic_policies(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AC-5.1.2: RLS with missing_ok + COALESCE pattern
ALTER TABLE economic_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY economic_policies_select
    ON economic_policies
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY economic_policies_insert
    ON economic_policies
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY economic_policies_update
    ON economic_policies
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

-- AC-5.1.3: Partial unique index — one active/pending policy per (community, type)
CREATE UNIQUE INDEX idx_one_active_policy
    ON economic_policies (community_id, policy_type)
    WHERE state IN ('active', 'pending_enforcement');

-- AC-5.1.4: Active policy lookup (fast path)
-- Note: Cannot use NOW() in partial index predicate (non-immutable).
-- Filter effective_until at query time instead.
CREATE INDEX idx_active_policies
    ON economic_policies (community_id, policy_type)
    WHERE state = 'active'
      AND superseded_by IS NULL;

-- Audit log index
CREATE INDEX idx_policies_audit
    ON economic_policies (community_id, created_at DESC);

-- AC-5.1.5: prevent_policy_field_mutation() trigger
-- Immutability: prevent mutation of identity/audit fields; once-set guard on approval fields
CREATE OR REPLACE FUNCTION prevent_policy_field_mutation()
RETURNS TRIGGER AS $$
BEGIN
    -- Immutable identity/audit fields
    IF OLD.community_id IS DISTINCT FROM NEW.community_id THEN
        RAISE EXCEPTION 'Cannot mutate community_id on economic_policies';
    END IF;
    IF OLD.policy_type IS DISTINCT FROM NEW.policy_type THEN
        RAISE EXCEPTION 'Cannot mutate policy_type on economic_policies';
    END IF;
    IF OLD.policy_value IS DISTINCT FROM NEW.policy_value THEN
        RAISE EXCEPTION 'Cannot mutate policy_value on economic_policies';
    END IF;
    IF OLD.policy_version IS DISTINCT FROM NEW.policy_version THEN
        RAISE EXCEPTION 'Cannot mutate policy_version on economic_policies';
    END IF;
    IF OLD.proposed_by IS DISTINCT FROM NEW.proposed_by THEN
        RAISE EXCEPTION 'Cannot mutate proposed_by on economic_policies';
    END IF;
    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Cannot mutate created_at on economic_policies';
    END IF;
    IF OLD.effective_from IS DISTINCT FROM NEW.effective_from THEN
        RAISE EXCEPTION 'Cannot mutate effective_from on economic_policies';
    END IF;

    -- Once-set fields (can be set once, then locked)
    IF OLD.approved_at IS NOT NULL AND OLD.approved_at IS DISTINCT FROM NEW.approved_at THEN
        RAISE EXCEPTION 'Cannot mutate approved_at once set on economic_policies';
    END IF;
    IF OLD.approved_by IS NOT NULL AND OLD.approved_by IS DISTINCT FROM NEW.approved_by THEN
        RAISE EXCEPTION 'Cannot mutate approved_by once set on economic_policies';
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER economic_policies_immutable_fields
    BEFORE UPDATE ON economic_policies
    FOR EACH ROW
    EXECUTE FUNCTION prevent_policy_field_mutation();

-- =============================================================================
-- AC-5.1.6: Governance Outbox (transactional outbox for conservation guard)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id),
    policy_id UUID NOT NULL REFERENCES economic_policies(id),
    policy_version INTEGER NOT NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE governance_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY governance_outbox_select
    ON governance_outbox
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY governance_outbox_insert
    ON governance_outbox
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY governance_outbox_update
    ON governance_outbox
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

-- Index for outbox worker polling (unprocessed rows oldest-first)
CREATE INDEX idx_governance_outbox_pending
    ON governance_outbox (created_at ASC)
    WHERE processed_at IS NULL;

-- AC-5.4.8: Unique constraint prevents duplicate limit changes
CREATE UNIQUE INDEX idx_governance_outbox_dedup
    ON governance_outbox (policy_id, policy_version);

-- =============================================================================
-- Governance Outbox DLQ (AC-5.4.6)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance_outbox_dlq (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_outbox_id UUID NOT NULL,
    community_id UUID NOT NULL,
    policy_id UUID NOT NULL,
    policy_version INTEGER NOT NULL,
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL,
    last_error TEXT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE governance_outbox_dlq ENABLE ROW LEVEL SECURITY;

CREATE POLICY governance_outbox_dlq_select
    ON governance_outbox_dlq
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY governance_outbox_dlq_insert
    ON governance_outbox_dlq
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY governance_outbox_dlq_update
    ON governance_outbox_dlq
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

-- =============================================================================
-- Verification Jobs table (for events/verify endpoint)
-- =============================================================================

CREATE TABLE IF NOT EXISTS community_verification_jobs (
    job_id TEXT PRIMARY KEY,
    community_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

ALTER TABLE community_verification_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_verification_jobs_select
    ON community_verification_jobs
    FOR SELECT
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY community_verification_jobs_insert
    ON community_verification_jobs
    FOR INSERT
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE POLICY community_verification_jobs_update
    ON community_verification_jobs
    FOR UPDATE
    USING (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ))
    WITH CHECK (community_id = COALESCE(
        NULLIF(current_setting('app.community_id', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    ));

CREATE INDEX idx_verification_jobs_community
    ON community_verification_jobs (community_id, created_at DESC);
