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
