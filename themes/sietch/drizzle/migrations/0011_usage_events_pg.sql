-- =============================================================================
-- Usage Events — PostgreSQL Immutable Accounting Ledger
-- (Cycle 037, Sprint 0A, Task 0A.1)
-- =============================================================================
-- PostgreSQL equivalent of SQLite migration 067. This is the canonical
-- production schema for the append-only usage events ledger.
--
-- Key differences from SQLite version:
--   - gen_random_uuid() instead of lower(hex(randomblob(16)))
--   - TIMESTAMPTZ DEFAULT NOW() instead of strftime()
--   - PL/pgSQL trigger functions instead of SQLite RAISE(ABORT)
--   - RLS policies for tenant isolation
--
-- All monetary values use BIGINT micro-USD (no floating-point).
--
-- @see SDD §3.4 Budget Finalization
-- @see SDD §5.5 Admin API
-- @see Migration 067 (SQLite equivalent)
-- =============================================================================

CREATE TABLE IF NOT EXISTS usage_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL,
  nft_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  amount_micro BIGINT NOT NULL DEFAULT 0 CHECK (amount_micro >= 0),
  reservation_id TEXT,
  finalization_id TEXT UNIQUE,
  fence_token BIGINT,                       -- Monotonic fencing token (SKP-001)
  conservation_guard_result BOOLEAN,        -- true = pass, false = violation
  conservation_guard_violations JSONB,      -- Structured violation details
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query: admin dashboard by community + time range
CREATE INDEX IF NOT EXISTS idx_usage_events_pg_community_created
  ON usage_events(community_id, created_at);

-- Per-agent usage breakdown
CREATE INDEX IF NOT EXISTS idx_usage_events_pg_nft
  ON usage_events(nft_id, created_at);

-- Per-pool usage breakdown
CREATE INDEX IF NOT EXISTS idx_usage_events_pg_pool
  ON usage_events(pool_id, created_at);

-- Finalization idempotency
CREATE INDEX IF NOT EXISTS idx_usage_events_pg_finalization
  ON usage_events(finalization_id)
  WHERE finalization_id IS NOT NULL;

-- Conservation guard failure alerting
CREATE INDEX IF NOT EXISTS idx_usage_events_pg_guard_failures
  ON usage_events(conservation_guard_result, created_at)
  WHERE conservation_guard_result = false;

-- RLS on usage_events
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

CREATE POLICY usage_events_tenant_select ON usage_events
    FOR SELECT USING (community_id = app.current_community_id());

CREATE POLICY usage_events_tenant_insert ON usage_events
    FOR INSERT WITH CHECK (community_id = app.current_community_id());

-- Append-only: SELECT + INSERT only
GRANT SELECT, INSERT ON usage_events TO arrakis_app;

-- Immutability triggers (reuses prevent_mutation() from migration 0009)
CREATE TRIGGER usage_events_no_update
    BEFORE UPDATE ON usage_events
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER usage_events_no_delete
    BEFORE DELETE ON usage_events
    FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- =============================================================================
-- S2S JWKS Public Keys — PostgreSQL version
-- =============================================================================
-- PostgreSQL equivalent of SQLite migration 061. Stores ES256 public keys
-- for S2S JWT verification between freeside and finn.

CREATE TABLE IF NOT EXISTS s2s_jwks_public_keys (
  kid TEXT PRIMARY KEY,
  kty TEXT NOT NULL DEFAULT 'EC' CHECK (kty = 'EC'),
  crv TEXT NOT NULL DEFAULT 'P-256' CHECK (crv = 'P-256'),
  x TEXT NOT NULL,
  y TEXT NOT NULL,
  issuer TEXT NOT NULL CHECK (issuer IN ('freeside', 'finn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Active keys by issuer (JWKS endpoint query)
CREATE INDEX IF NOT EXISTS idx_s2s_jwks_pg_issuer_active
  ON s2s_jwks_public_keys(issuer, created_at)
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

GRANT SELECT, INSERT, UPDATE ON s2s_jwks_public_keys TO arrakis_app;

-- =============================================================================
-- Reconciliation Cursor — Cursor-Based Reconciliation (SKP-002)
-- =============================================================================
-- Replaces time-window reconciliation with persistent cursor tracking.
-- Each community has a last_processed_event_id that advances monotonically.
--
-- @see SDD §4.4.1 Reconciliation
-- @see Flatline SKP-002: Cursor-based reconciliation

CREATE TABLE IF NOT EXISTS reconciliation_cursor (
  community_id UUID PRIMARY KEY,
  last_processed_event_id UUID,             -- Points to usage_events.event_id
  last_fence_token BIGINT NOT NULL DEFAULT 0,  -- Monotonic fencing (SKP-001)
  last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drift_micro BIGINT NOT NULL DEFAULT 0,    -- Last observed Redis-Postgres drift
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON reconciliation_cursor TO arrakis_app;
