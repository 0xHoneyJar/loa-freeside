-- Migration 0004: Audit Trail Hash Chain
-- Sprint 360, Task 3.2a (FR-6)
-- SDD ref: §3.4 (Audit Trail Hash Chain)
--
-- Creates 4 tables: audit_trail (partitioned), audit_trail_chain_links,
-- audit_trail_head, audit_trail_checkpoints.
-- Append-only enforcement via triggers, RLS, and least-privilege roles.
-- PostgreSQL >= 14 required (trigger inheritance on partitions).

-- ============================================================================
-- 1. Database Roles
-- ============================================================================

-- Runtime role: INSERT + SELECT only
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_app') THEN
    CREATE ROLE arrakis_app NOLOGIN;
  END IF;
END $$;

-- Migration role: DDL operations
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_migrator') THEN
    CREATE ROLE arrakis_migrator NOLOGIN;
  END IF;
END $$;

-- Break-glass DBA role (emergency only)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'arrakis_dba') THEN
    CREATE ROLE arrakis_dba NOLOGIN;
  END IF;
END $$;

-- ============================================================================
-- 2. audit_trail — Partitioned by month (RANGE on created_at)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail (
  id           BIGSERIAL,
  entry_id     UUID          NOT NULL,
  domain_tag   TEXT          NOT NULL,
  event_type   TEXT          NOT NULL,
  actor_id     TEXT          NOT NULL,
  payload      JSONB         NOT NULL DEFAULT '{}',
  entry_hash   TEXT          NOT NULL,
  previous_hash TEXT         NOT NULL,
  event_time   TIMESTAMPTZ   NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, created_at),

  CONSTRAINT audit_entry_id_unique UNIQUE (entry_id, created_at),
  CONSTRAINT entry_hash_format
    CHECK (entry_hash ~ '^[a-z0-9-]+:[a-f0-9]+$'),
  CONSTRAINT previous_hash_format
    CHECK (previous_hash ~ '^[a-z0-9-]+:[a-f0-9]+$'),
  CONSTRAINT event_time_skew
    CHECK (event_time BETWEEN NOW() - INTERVAL '5 minutes' AND NOW() + INTERVAL '5 minutes')
) PARTITION BY RANGE (created_at);

-- Default partition — safety net for unmapped months
CREATE TABLE IF NOT EXISTS audit_trail_default
  PARTITION OF audit_trail DEFAULT;

-- Index for chain traversal (domain_tag + created_at DESC)
CREATE INDEX IF NOT EXISTS idx_audit_trail_chain
  ON audit_trail (domain_tag, created_at DESC);

-- Index for entry_id lookups (idempotency)
CREATE INDEX IF NOT EXISTS idx_audit_trail_entry_id
  ON audit_trail (entry_id);

-- ============================================================================
-- 3. audit_trail_chain_links — Global fork prevention
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail_chain_links (
  domain_tag    TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  entry_hash    TEXT NOT NULL,
  entry_id      UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_chain_link UNIQUE (domain_tag, previous_hash)
);

-- ============================================================================
-- 4. audit_trail_head — Chain linearization
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail_head (
  domain_tag   TEXT          PRIMARY KEY,
  current_hash TEXT          NOT NULL,
  current_id   BIGINT        NOT NULL,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. audit_trail_checkpoints — Metadata for pruning & verification
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_trail_checkpoints (
  id                    BIGSERIAL     PRIMARY KEY,
  domain_tag            TEXT          NOT NULL,
  checkpoint_hash       TEXT          NOT NULL,
  checkpoint_entry_id   UUID          NOT NULL,
  entries_before        BIGINT        NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by            TEXT          NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_checkpoints_domain
  ON audit_trail_checkpoints (domain_tag, created_at DESC);

-- ============================================================================
-- 6. Append-Only Enforcement Triggers
-- ============================================================================
-- PostgreSQL >= 14 automatically clones these to each partition.

CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only: % not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TRIGGER audit_trail_no_update
  BEFORE UPDATE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER audit_trail_no_delete
  BEFORE DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ============================================================================
-- 7. Row Level Security
-- ============================================================================

ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail_chain_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail_checkpoints ENABLE ROW LEVEL SECURITY;

-- audit_trail: INSERT + SELECT for app role
CREATE POLICY audit_trail_insert ON audit_trail
  FOR INSERT TO arrakis_app WITH CHECK (true);
CREATE POLICY audit_trail_select ON audit_trail
  FOR SELECT TO arrakis_app USING (true);

-- chain_links: INSERT + SELECT for app role
CREATE POLICY chain_links_insert ON audit_trail_chain_links
  FOR INSERT TO arrakis_app WITH CHECK (true);
CREATE POLICY chain_links_select ON audit_trail_chain_links
  FOR SELECT TO arrakis_app USING (true);

-- head: SELECT + UPDATE + INSERT for app role (UPSERT pattern)
CREATE POLICY head_select ON audit_trail_head
  FOR SELECT TO arrakis_app USING (true);
CREATE POLICY head_insert ON audit_trail_head
  FOR INSERT TO arrakis_app WITH CHECK (true);
CREATE POLICY head_update ON audit_trail_head
  FOR UPDATE TO arrakis_app USING (true);

-- checkpoints: INSERT + SELECT for app role
CREATE POLICY checkpoints_insert ON audit_trail_checkpoints
  FOR INSERT TO arrakis_app WITH CHECK (true);
CREATE POLICY checkpoints_select ON audit_trail_checkpoints
  FOR SELECT TO arrakis_app USING (true);

-- ============================================================================
-- 8. Privilege Grants
-- ============================================================================

-- App role: minimal runtime privileges
GRANT INSERT, SELECT ON audit_trail TO arrakis_app;
GRANT INSERT, SELECT ON audit_trail_chain_links TO arrakis_app;
GRANT SELECT, INSERT, UPDATE ON audit_trail_head TO arrakis_app;
GRANT INSERT, SELECT ON audit_trail_checkpoints TO arrakis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arrakis_app;

-- Explicitly deny dangerous operations to app role
-- (RLS + no policy = implicit deny, but explicit REVOKE for defense-in-depth)
REVOKE DELETE, TRUNCATE ON audit_trail FROM arrakis_app;
REVOKE UPDATE ON audit_trail FROM arrakis_app;
REVOKE DELETE, TRUNCATE ON audit_trail_chain_links FROM arrakis_app;
REVOKE DELETE, TRUNCATE ON audit_trail_checkpoints FROM arrakis_app;

-- ============================================================================
-- 9. Partition Creation Function
-- ============================================================================

CREATE OR REPLACE FUNCTION create_audit_partitions(months_ahead INTEGER DEFAULT 2)
RETURNS TABLE(partition_name TEXT, range_start DATE, range_end DATE) AS $$
DECLARE
  m INTEGER;
  start_date DATE;
  end_date DATE;
  part_name TEXT;
BEGIN
  FOR m IN 0..months_ahead LOOP
    start_date := DATE_TRUNC('month', NOW() + (m || ' months')::INTERVAL);
    end_date := start_date + INTERVAL '1 month';
    part_name := 'audit_trail_' || TO_CHAR(start_date, 'YYYY_MM');

    BEGIN
      EXECUTE FORMAT(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_trail FOR VALUES FROM (%L) TO (%L)',
        part_name,
        start_date,
        end_date
      );
    EXCEPTION WHEN duplicate_table THEN
      -- Idempotent: partition already exists
      NULL;
    END;

    partition_name := part_name;
    range_start := start_date;
    range_end := end_date;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create initial partitions: current month + next 2 months
SELECT * FROM create_audit_partitions(2);
