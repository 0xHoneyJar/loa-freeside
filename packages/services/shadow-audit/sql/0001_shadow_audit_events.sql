-- Shadow Access Audit — append-only event store (FR-5 / SDD §2, §6).
--
-- The ONLY persistence in the audit (NFR-1). These tables hold AGGREGATE
-- run-events + CONSENTED contact only. Member holdings / scores / roles are
-- NEVER stored here. Append-only by convention: the application issues no
-- UPDATE/DELETE; a retention job prunes rows older than the stated window.
--
-- Mirrors RunEventSchema / ContactRecordSchema in
-- packages/services/shadow-audit/src/event-store.ts. Wired to postgres at the
-- worker (drizzle-orm + postgres).

CREATE TABLE IF NOT EXISTS shadow_audit_run_events (
    id                       BIGSERIAL PRIMARY KEY,
    run_id                   TEXT        NOT NULL,
    mode                     TEXT        NOT NULL CHECK (mode = 'dogfood-full'),
    inputs_hash              CHAR(64)    NOT NULL,
    -- aggregate cohort size only — never a member list
    stale_set_size           INTEGER     NOT NULL CHECK (stale_set_size >= 0),
    time_on_stale_section_ms INTEGER     CHECK (time_on_stale_section_ms >= 0),
    reruns                   INTEGER     NOT NULL DEFAULT 0 CHECK (reruns >= 0),
    reaction                 TEXT        CHECK (reaction IN ('worse', 'expected', 'surprised')),
    cta_interaction          TEXT        CHECK (cta_interaction IN ('product', 'conversation')),
    ts                       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS shadow_audit_run_events_run_id_idx ON shadow_audit_run_events (run_id);
CREATE INDEX IF NOT EXISTS shadow_audit_run_events_ts_idx ON shadow_audit_run_events (ts);

CREATE TABLE IF NOT EXISTS shadow_audit_contacts (
    id       BIGSERIAL PRIMARY KEY,
    run_id   TEXT        NOT NULL,
    contact  TEXT        NOT NULL,
    -- consent is required; a non-consented row cannot exist
    consent  BOOLEAN     NOT NULL CHECK (consent = TRUE),
    ts       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS shadow_audit_contacts_run_id_idx ON shadow_audit_contacts (run_id);
