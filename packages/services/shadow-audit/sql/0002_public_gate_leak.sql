-- Public Gate Leak lifecycle — forward migration (cycle: public-gate-leak-lifecycle).
--
-- ADDITIVE + IDEMPOTENT. Never rewrites the aggregate/member-free invariant of 0001.
-- This migration widens the run-event `mode` CHECK so a login-less PUBLIC teaser run
-- (`GET /v1/access-risk`) can be REGISTERED in the same append-only store the authed
-- audit uses — closing the run/feedback-binding gap (a teaser run_id must resolve via
-- getRun so reaction/contact can bind to it). Still aggregate-only: no member columns.
--
-- Mirrors RunModeSchema in packages/services/shadow-audit/src/event-store.ts.
-- Applied idempotently on boot by PostgresEventStore.initialize().

-- 0001 created shadow_audit_run_events with an INLINE, unnamed CHECK (mode = 'dogfood-full').
-- Swap it for a named CHECK that also admits 'public-gate-leak'. The DO block is idempotent:
-- it drops whatever mode-check constraint currently exists on the table (named or the
-- 0001 anonymous one) and installs the widened, named constraint exactly once.
DO $$
DECLARE
    con RECORD;
BEGIN
    -- Only act if the table exists (fresh DBs get the widened CHECK straight from
    -- PostgresEventStore.initialize(), so this migration is a no-op there).
    IF to_regclass('public.shadow_audit_run_events') IS NULL THEN
        RETURN;
    END IF;

    -- Drop any existing CHECK constraint on shadow_audit_run_events that references `mode`.
    FOR con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.shadow_audit_run_events'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%mode%'
    LOOP
        EXECUTE format('ALTER TABLE shadow_audit_run_events DROP CONSTRAINT %I', con.conname);
    END LOOP;

    -- Install the widened, named constraint (guard against a re-run adding it twice).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.shadow_audit_run_events'::regclass
          AND conname = 'shadow_audit_run_events_mode_check'
    ) THEN
        ALTER TABLE shadow_audit_run_events
            ADD CONSTRAINT shadow_audit_run_events_mode_check
            CHECK (mode IN ('dogfood-full', 'public-gate-leak'));
    END IF;
END $$;

-- One semantic registration key per public journey. Backfill DISTINCT keys without
-- deleting any historical append-only rows that predate idempotent registration.
CREATE TABLE IF NOT EXISTS shadow_audit_public_run_registration_keys (
    run_id TEXT PRIMARY KEY
);
INSERT INTO shadow_audit_public_run_registration_keys (run_id)
SELECT DISTINCT run_id FROM shadow_audit_run_events
WHERE mode = 'public-gate-leak' AND reaction IS NULL AND cta_interaction IS NULL
ON CONFLICT (run_id) DO NOTHING;

-- Canonical observed subject. Observation is deliberately not an ownership assertion.
CREATE TABLE IF NOT EXISTS gate_leak_subject (
    subject_chain_id           TEXT        NOT NULL,
    subject_contract_address   TEXT        NOT NULL,
    first_seen_ts              TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (subject_chain_id, subject_contract_address)
);

-- Immutable first submission. A resumed semantic input is appended below; this row and
-- its inputs_hash are never rewritten.
CREATE TABLE IF NOT EXISTS public_gate_leak_runs (
    run_id                     TEXT        PRIMARY KEY,
    journey_token              TEXT        NOT NULL,
    inputs_hash                CHAR(64)    NOT NULL,
    subject_chain_id           TEXT        NOT NULL,
    subject_contract_address   TEXT        NOT NULL,
    threshold                  INTEGER     NOT NULL CHECK (threshold > 0),
    outcome                    TEXT        NOT NULL CHECK (outcome IN (
        'submitted', 'resolving_subject', 'indexing', 'needs_input',
        'computing', 'delivered_e1', 'refused', 'unavailable'
    )),
    refusal_code               TEXT,
    access_started_at          DATE,
    ts                         TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS public_gate_leak_runs_journey_token_idx
    ON public_gate_leak_runs (journey_token);

CREATE TABLE IF NOT EXISTS gate_leak_journey_inputs (
    id                         BIGSERIAL PRIMARY KEY,
    run_id                     TEXT        NOT NULL REFERENCES public_gate_leak_runs(run_id),
    input_name                 TEXT        NOT NULL CHECK (input_name = 'access_started_at'),
    input_value                DATE        NOT NULL,
    ts                         TIMESTAMPTZ NOT NULL,
    UNIQUE (run_id, input_name)
);

CREATE TABLE IF NOT EXISTS gate_leak_journey_events (
    id                         BIGSERIAL PRIMARY KEY,
    run_id                     TEXT        NOT NULL REFERENCES public_gate_leak_runs(run_id),
    outcome                    TEXT        NOT NULL CHECK (outcome IN (
        'submitted', 'resolving_subject', 'indexing', 'needs_input',
        'computing', 'delivered_e1', 'refused', 'unavailable'
    )),
    refusal_code               TEXT,
    ts                         TIMESTAMPTZ NOT NULL,
    UNIQUE (run_id, outcome)
);

-- Privacy-safe attention. UNIQUE(journey_token, kind) separates retry idempotency
-- from distinct-journey demand.
CREATE TABLE IF NOT EXISTS gate_leak_attention (
    id                         BIGSERIAL PRIMARY KEY,
    subject_chain_id           TEXT        NOT NULL,
    subject_contract_address   TEXT        NOT NULL,
    journey_token              TEXT        NOT NULL,
    kind                       TEXT        NOT NULL CHECK (kind IN (
        'submitted', 'delivered_e1', 'needs_input', 'refused', 'enhance_intent', 'feedback'
    )),
    ts                         TIMESTAMPTZ NOT NULL,
    UNIQUE (journey_token, kind)
);

-- Operational distributed single-flight. Unlike the append-only journey ledger, this
-- cache owns a renewable lease and a completed aggregate result; it contains no members.
CREATE TABLE IF NOT EXISTS gate_leak_compute_cache (
    compute_key                CHAR(64)    PRIMARY KEY,
    state                      TEXT        NOT NULL CHECK (state IN ('running', 'complete')),
    owner_token                TEXT        NOT NULL,
    lease_expires_at           TIMESTAMPTZ NOT NULL,
    result                     JSONB,
    updated_at                 TIMESTAMPTZ NOT NULL,
    CHECK ((state = 'complete') = (result IS NOT NULL))
);

-- Deployment-wide anonymous-write budget. Registration and counter consumption
-- happen in the same transaction, so retries never spend the allowance twice.
CREATE TABLE IF NOT EXISTS gate_leak_journey_write_budget (
    bucket                     TEXT        NOT NULL,
    window_started_at          TIMESTAMPTZ NOT NULL,
    used                       INTEGER     NOT NULL CHECK (used >= 0),
    PRIMARY KEY (bucket, window_started_at)
);
