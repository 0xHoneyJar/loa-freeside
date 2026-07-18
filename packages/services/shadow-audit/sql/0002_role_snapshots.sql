-- arrakis-7mtwa — shared latest-role-snapshot persistence.
--
-- This table contains member identifiers, wallets, and role IDs. It is private operator data, not an
-- aggregate audit event. The service retains only the newest snapshot per (community, canonical collection)
-- and performs an atomic newest-wins upsert; database exports and backups require the same access controls.

CREATE TABLE IF NOT EXISTS shadow_audit_schema_migrations (
    component  TEXT        NOT NULL,
    version    INTEGER     NOT NULL CHECK (version > 0),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (component, version)
);

CREATE TABLE IF NOT EXISTS shadow_audit_role_snapshots (
    community     TEXT        NOT NULL,
    collection_key TEXT       NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL,
    snapshot      JSONB       NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community, collection_key)
);

INSERT INTO shadow_audit_schema_migrations (component, version)
VALUES ('role-snapshot-store', 1)
ON CONFLICT (component, version) DO NOTHING;
