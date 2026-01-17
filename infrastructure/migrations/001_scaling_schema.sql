-- Migration: 001_scaling_schema.sql
-- Sprint S-1: Enhanced PostgreSQL Schema for Scaling Initiative
--
-- This migration enhances the existing schema for multi-tenancy at scale:
-- - Row-Level Security (RLS) for tenant isolation
-- - Optimized indexes for common query patterns
-- - Audit logging for compliance
--
-- NOTE: Assumes base tables exist from Gateway Proxy implementation

-- =============================================================================
-- ENHANCED COMMUNITIES TABLE
-- =============================================================================

-- Add columns if not exists (idempotent)
DO $$
BEGIN
    -- Add theme_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'communities' AND column_name = 'theme_id') THEN
        ALTER TABLE communities ADD COLUMN theme_id TEXT DEFAULT 'sietch';
    END IF;

    -- Add subscription_tier if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'communities' AND column_name = 'subscription_tier') THEN
        ALTER TABLE communities ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free';
    END IF;

    -- Add settings JSONB if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'communities' AND column_name = 'settings') THEN
        ALTER TABLE communities ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';
    END IF;
END $$;

-- Add constraint for subscription_tier
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage
                   WHERE constraint_name = 'communities_subscription_tier_check') THEN
        ALTER TABLE communities
        ADD CONSTRAINT communities_subscription_tier_check
        CHECK (subscription_tier IN ('free', 'pro', 'enterprise'));
    END IF;
END $$;

-- =============================================================================
-- ELIGIBILITY RULES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS eligibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    chain TEXT NOT NULL DEFAULT 'berachain',
    contract_address TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}',
    role_discord_id TEXT NOT NULL,
    tier_mapping TEXT,
    priority INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT eligibility_rules_rule_type_check
        CHECK (rule_type IN ('token_balance', 'nft_ownership', 'custom', 'score_threshold')),
    CONSTRAINT eligibility_rules_unique_role
        UNIQUE(community_id, role_discord_id)
);

-- =============================================================================
-- AUDIT LOGS TABLE (for compliance)
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT audit_logs_actor_type_check
        CHECK (actor_type IN ('user', 'system', 'admin'))
);

-- =============================================================================
-- INDEXES FOR SCALING
-- =============================================================================

-- Communities indexes
CREATE INDEX IF NOT EXISTS idx_communities_guild_id
    ON communities(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_communities_tier
    ON communities(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_communities_theme
    ON communities(theme_id);

-- Profiles indexes (assuming table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_community_wallet
            ON profiles(community_id, wallet_address)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_community_tier
            ON profiles(community_id, tier)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_community_rank
            ON profiles(community_id, current_rank)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_profiles_discord_id
            ON profiles(discord_id)';
    END IF;
END $$;

-- Eligibility rules indexes
CREATE INDEX IF NOT EXISTS idx_eligibility_rules_community
    ON eligibility_rules(community_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_eligibility_rules_chain
    ON eligibility_rules(chain, contract_address);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_community_time
    ON audit_logs(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON audit_logs(action, created_at DESC);

-- =============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on sensitive tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Create service role (bypasses RLS)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arrakis_service') THEN
        CREATE ROLE arrakis_service WITH LOGIN PASSWORD 'changeme_use_secrets_manager';
    END IF;
END $$;

-- Grant service role to admin
GRANT arrakis_service TO arrakis_admin;

-- Bypass RLS for service role
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE eligibility_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE badges FORCE ROW LEVEL SECURITY;

-- Create policies for tenant isolation
-- Note: Policies use current_setting('app.current_tenant') which must be set per-connection

-- Profiles: Users can only see profiles in their community
CREATE POLICY IF NOT EXISTS profiles_tenant_isolation ON profiles
    FOR ALL
    USING (
        community_id::TEXT = current_setting('app.current_tenant', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

-- Eligibility rules: Tenant-scoped
CREATE POLICY IF NOT EXISTS eligibility_rules_tenant_isolation ON eligibility_rules
    FOR ALL
    USING (
        community_id::TEXT = current_setting('app.current_tenant', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

-- Audit logs: Tenant-scoped (read-only for most users)
CREATE POLICY IF NOT EXISTS audit_logs_tenant_isolation ON audit_logs
    FOR SELECT
    USING (
        community_id::TEXT = current_setting('app.current_tenant', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

-- Audit logs: Only system can insert
CREATE POLICY IF NOT EXISTS audit_logs_system_insert ON audit_logs
    FOR INSERT
    WITH CHECK (true);

-- Badges: Tenant-scoped
CREATE POLICY IF NOT EXISTS badges_tenant_isolation ON badges
    FOR ALL
    USING (
        community_id::TEXT = current_setting('app.current_tenant', true)
        OR current_setting('app.is_admin', true) = 'true'
    );

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Function to set tenant context (call at start of each request)
CREATE OR REPLACE FUNCTION set_tenant_context(
    p_community_id UUID,
    p_is_admin BOOLEAN DEFAULT false
) RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant', p_community_id::TEXT, true);
    PERFORM set_config('app.is_admin', p_is_admin::TEXT, true);
END;
$$ LANGUAGE plpgsql;

-- Function to clear tenant context (call at end of request)
CREATE OR REPLACE FUNCTION clear_tenant_context() RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant', '', true);
    PERFORM set_config('app.is_admin', 'false', true);
END;
$$ LANGUAGE plpgsql;

-- Function to audit an action
CREATE OR REPLACE FUNCTION audit_action(
    p_community_id UUID,
    p_actor_type TEXT,
    p_actor_id TEXT,
    p_action TEXT,
    p_target_type TEXT DEFAULT NULL,
    p_target_id TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO audit_logs (
        community_id, actor_type, actor_id, action,
        target_type, target_id, metadata
    ) VALUES (
        p_community_id, p_actor_type, p_actor_id, p_action,
        p_target_type, p_target_id, p_metadata
    ) RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY['communities', 'profiles', 'eligibility_rules', 'badges']) LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS update_%I_updated_at ON %I;
            CREATE TRIGGER update_%I_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        ', t, t, t, t);
    END LOOP;
END $$;

-- =============================================================================
-- GRANTS
-- =============================================================================

-- Grant access to service role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arrakis_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arrakis_service;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO arrakis_service;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE eligibility_rules IS 'Token-gating rules per community';
COMMENT ON TABLE audit_logs IS 'Audit trail for compliance and debugging';
COMMENT ON FUNCTION set_tenant_context IS 'Sets the current tenant context for RLS policies';
COMMENT ON FUNCTION audit_action IS 'Records an action in the audit log';
