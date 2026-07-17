-- CR-201A expand: public shared preparation persistence (T1 fixtures only).
-- Expand-only: no destructive DDL. Restricted Discord/identity evidence is CR-201B.

CREATE TABLE IF NOT EXISTS shared_preparation_work (
  work_id                   TEXT PRIMARY KEY,
  work_key_digest           TEXT NOT NULL,
  deployment_set_digest     TEXT NOT NULL,
  capability                TEXT NOT NULL,
  capability_version        TEXT NOT NULL,
  scope_class               TEXT NOT NULL DEFAULT 'deployment',
  scope_digest              TEXT NOT NULL,
  privacy_class             TEXT NOT NULL DEFAULT 'public_chain',
  source_identity           JSONB NOT NULL,
  readiness_policy_version  TEXT NOT NULL,
  evidence_boundary_kind    TEXT NOT NULL,
  evidence_boundary_digest  TEXT,
  adapter_version           TEXT NOT NULL,
  finality_policy_version   TEXT NOT NULL,
  state                     TEXT NOT NULL,
  generation                INTEGER NOT NULL,
  readiness_evidence        JSONB,
  attempt                   INTEGER NOT NULL DEFAULT 0,
  next_attempt_at           TIMESTAMPTZ,
  retry_deadline            TIMESTAMPTZ,
  lease_until               TIMESTAMPTZ,
  lease_epoch               BIGINT NOT NULL DEFAULT 0,
  failure_reason            JSONB,
  sharing_scope_kind        TEXT NOT NULL DEFAULT 'public',
  work_tenant_scope_digest  TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shared_preparation_work_state_check CHECK (
    state IN ('queued', 'preparing', 'retry_wait', 'ready', 'failed', 'abandoned', 'superseded')
  ),
  CONSTRAINT shared_preparation_work_privacy_public_only CHECK (
    privacy_class = 'public_chain'
  ),
  CONSTRAINT shared_preparation_work_sharing_scope_public CHECK (
    sharing_scope_kind = 'public' AND work_tenant_scope_digest IS NULL
  ),
  CONSTRAINT shared_preparation_work_capability_public CHECK (
    capability IN ('collection_identity.v1', 'ownership_index.v1')
  ),
  CONSTRAINT shared_preparation_work_generation_positive CHECK (generation >= 1),
  CONSTRAINT shared_preparation_work_unique_generation UNIQUE (work_key_digest, generation)
);

-- Active is exactly queued/preparing/retry_wait; one active row per work key.
CREATE UNIQUE INDEX IF NOT EXISTS shared_preparation_work_key_active_idx
  ON shared_preparation_work (work_key_digest)
  WHERE state IN ('queued', 'preparing', 'retry_wait');

CREATE INDEX IF NOT EXISTS shared_preparation_work_ready_idx
  ON shared_preparation_work (work_key_digest, generation DESC)
  WHERE state = 'ready';

CREATE TABLE IF NOT EXISTS preparation_work_items (
  work_item_id              TEXT PRIMARY KEY,
  work_id                   TEXT NOT NULL REFERENCES shared_preparation_work (work_id),
  deployment_id             JSONB NOT NULL,
  capability                TEXT NOT NULL,
  adapter_version           TEXT NOT NULL,
  external_job_ref          TEXT,
  state                     TEXT NOT NULL,
  attempt                   INTEGER NOT NULL DEFAULT 0,
  lease_epoch               BIGINT NOT NULL DEFAULT 0,
  evidence_envelope         JSONB,
  failure_reason            JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT preparation_work_items_state_check CHECK (
    state IN ('queued', 'preparing', 'retry_wait', 'ready', 'failed', 'abandoned', 'superseded')
  ),
  CONSTRAINT preparation_work_items_unique_deployment UNIQUE (work_id, deployment_id)
);

CREATE INDEX IF NOT EXISTS preparation_work_items_work_idx
  ON preparation_work_items (work_id);

CREATE TABLE IF NOT EXISTS report_work_links (
  order_id                  TEXT NOT NULL REFERENCES orders (order_id),
  work_id                   TEXT NOT NULL REFERENCES shared_preparation_work (work_id),
  joined_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detached_at               TIMESTAMPTZ,
  generation                INTEGER NOT NULL,
  order_tenant_scope_digest TEXT NOT NULL,
  sharing_scope_kind        TEXT NOT NULL DEFAULT 'public',
  work_tenant_scope_digest  TEXT,
  PRIMARY KEY (order_id, work_id),
  CONSTRAINT report_work_links_public_scope CHECK (
    sharing_scope_kind = 'public' AND work_tenant_scope_digest IS NULL
  )
);

CREATE INDEX IF NOT EXISTS report_work_links_work_active_idx
  ON report_work_links (work_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS report_work_links_order_active_idx
  ON report_work_links (order_id)
  WHERE detached_at IS NULL;
