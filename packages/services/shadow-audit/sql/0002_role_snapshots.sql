-- arrakis-7mtwa — shared latest-role-snapshot persistence.
--
-- This table contains member identifiers, wallets, and role IDs. It is private operator data, not an
-- aggregate audit event. The service retains only the newest snapshot per (community, canonical collection)
-- and performs an atomic newest-wins upsert; database exports and backups require the same access controls.

CREATE TABLE IF NOT EXISTS shadow_audit_role_snapshots (
    community     TEXT        NOT NULL,
    collection_key TEXT       NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL,
    snapshot      JSONB       NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (community, collection_key)
);
