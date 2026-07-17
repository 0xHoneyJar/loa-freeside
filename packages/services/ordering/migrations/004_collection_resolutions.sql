-- CR-006 expand: durable collection resolution sessions (Ordering SoR).
-- Expand-only: never drop legacy tables. Sonar never reads these tables.
-- Stores the sealed ConfirmedResolutionRecord JSON plus an idempotency ledger
-- that replays historical sealed responses (never rolls current truth back).

CREATE TABLE IF NOT EXISTS collection_resolutions (
  resolution_id TEXT PRIMARY KEY,
  requester_subject TEXT NOT NULL,
  confirmation_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS collection_resolutions_subject_idx
  ON collection_resolutions (requester_subject);

CREATE INDEX IF NOT EXISTS collection_resolutions_expires_idx
  ON collection_resolutions (expires_at);

CREATE TABLE IF NOT EXISTS collection_resolution_idempotency (
  operation TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_digest TEXT NOT NULL,
  accepted_digest TEXT,
  resolution_id TEXT NOT NULL,
  stored_at_unix_ms BIGINT NOT NULL,
  response_confirmation_version INTEGER NOT NULL,
  response_snapshot JSONB NOT NULL,
  response_selection_stale JSONB,
  PRIMARY KEY (operation, subject_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS collection_resolution_idempotency_stored_idx
  ON collection_resolution_idempotency (stored_at_unix_ms);
