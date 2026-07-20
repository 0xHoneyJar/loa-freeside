-- CR-204A harden: durable dispatch ledger + kitchen coords on work items.
-- Expand-only: no destructive DDL.

ALTER TABLE preparation_work_items
  ADD COLUMN IF NOT EXISTS kitchen_target JSONB;

CREATE TABLE IF NOT EXISTS public_prep_dispatch (
  command_inbox_key       TEXT PRIMARY KEY,
  work_item_id            TEXT NOT NULL,
  work_id                 TEXT NOT NULL REFERENCES shared_preparation_work (work_id),
  lease_epoch             BIGINT NOT NULL DEFAULT 0,
  external_job_ref        TEXT,
  dispatched_at           TIMESTAMPTZ,
  acked_at                TIMESTAMPTZ,
  lost_response           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS public_prep_dispatch_pending_idx
  ON public_prep_dispatch (dispatched_at)
  WHERE acked_at IS NULL AND dispatched_at IS NOT NULL;
