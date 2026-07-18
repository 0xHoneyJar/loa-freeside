-- Deployment-wide budget for the unauthenticated access-risk reconstruction path.
--
-- Every application replica atomically upserts the same (namespace, limiter_key)
-- row. The service uses database time, so replica clocks cannot split a window.

CREATE TABLE IF NOT EXISTS shadow_audit_rate_limits (
    namespace         TEXT        NOT NULL,
    limiter_key       TEXT        NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    request_count     INTEGER     NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (namespace, limiter_key)
);

INSERT INTO shadow_audit_schema_migrations (component, version)
VALUES ('role-snapshot-store', 2)
ON CONFLICT (component, version) DO NOTHING;
