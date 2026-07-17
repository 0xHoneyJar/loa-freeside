-- CR-201C expand: atomic admission capacity reservation (three ledgers).
-- Expand-only: no destructive DDL. No separate pre-admission reservation state —
-- capacity consumption commits in the same transaction as order + work links.

CREATE TABLE IF NOT EXISTS admission_capacity_pools (
  pool_id           TEXT PRIMARY KEY,
  ledger_kind       TEXT NOT NULL,
  network_ref       TEXT NOT NULL DEFAULT '',
  capability        TEXT NOT NULL DEFAULT '',
  community_ref     TEXT,
  limit_units       BIGINT NOT NULL,
  consumed_units    BIGINT NOT NULL DEFAULT 0,
  version           BIGINT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admission_capacity_pools_ledger_check CHECK (
    ledger_kind IN ('admission_rate', 'queued_work', 'active_execution')
  ),
  CONSTRAINT admission_capacity_pools_nonneg CHECK (
    limit_units >= 0 AND consumed_units >= 0 AND consumed_units <= limit_units
  ),
  CONSTRAINT admission_capacity_pools_scope_unique UNIQUE (
    ledger_kind, network_ref, capability, community_ref
  )
);

CREATE INDEX IF NOT EXISTS admission_capacity_pools_ledger_idx
  ON admission_capacity_pools (ledger_kind);

CREATE TABLE IF NOT EXISTS admission_capacity_reservations (
  reservation_id    TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders (order_id),
  pool_id           TEXT NOT NULL REFERENCES admission_capacity_pools (pool_id),
  ledger_kind       TEXT NOT NULL,
  quantity          BIGINT NOT NULL,
  reservation_version BIGINT NOT NULL DEFAULT 1,
  state             TEXT NOT NULL,
  identity_digest   TEXT NOT NULL,
  work_key_digest   TEXT,
  lease_until       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at       TIMESTAMPTZ,
  CONSTRAINT admission_capacity_reservations_ledger_check CHECK (
    ledger_kind IN ('admission_rate', 'queued_work', 'active_execution')
  ),
  CONSTRAINT admission_capacity_reservations_state_check CHECK (
    state IN ('held', 'released', 'transferred', 'expired')
  ),
  CONSTRAINT admission_capacity_reservations_qty_positive CHECK (quantity > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS admission_capacity_reservations_order_ledger_held_idx
  ON admission_capacity_reservations (order_id, ledger_kind)
  WHERE state = 'held' AND ledger_kind IN ('admission_rate', 'queued_work');

CREATE INDEX IF NOT EXISTS admission_capacity_reservations_work_held_idx
  ON admission_capacity_reservations (work_key_digest)
  WHERE state = 'held' AND ledger_kind = 'queued_work';

CREATE INDEX IF NOT EXISTS admission_capacity_reservations_lease_idx
  ON admission_capacity_reservations (lease_until)
  WHERE state = 'held' AND ledger_kind = 'active_execution';

CREATE TABLE IF NOT EXISTS admission_capacity_transfer_log (
  event_id          TEXT PRIMARY KEY,
  reservation_id    TEXT NOT NULL REFERENCES admission_capacity_reservations (reservation_id),
  from_state        TEXT NOT NULL,
  to_state          TEXT NOT NULL,
  reason            TEXT NOT NULL,
  event_version     BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admission_capacity_transfer_log_version_unique UNIQUE (reservation_id, event_version)
);

CREATE TABLE IF NOT EXISTS order_admission_idempotency (
  requester_subject TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  body_digest       TEXT NOT NULL,
  order_id          TEXT NOT NULL REFERENCES orders (order_id),
  reservation_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  stored_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (requester_subject, client_request_id)
);

CREATE INDEX IF NOT EXISTS order_admission_idempotency_stored_idx
  ON order_admission_idempotency (stored_at);
