-- Public gate-leak ordering lifecycle. Additive and idempotent.

ALTER TABLE order_outbox ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS order_outbox_idempotency_idx
  ON order_outbox (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_write_budget (
  bucket             TEXT NOT NULL,
  window_started_at  TIMESTAMPTZ NOT NULL,
  used               INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (bucket, window_started_at)
);

-- Dedupes subject indexing across distinct journeys while preserving each journey's
-- own order and attention signal. Shadow Audit owns input-specific compute single-flight.
CREATE TABLE IF NOT EXISTS gate_leak_work_claims (
  work_key             TEXT PRIMARY KEY,
  canonical_order_id   TEXT NOT NULL REFERENCES orders(order_id),
  created_at_unix      BIGINT NOT NULL
);

-- Append-only semantic prerequisite. The original order inputs and digest never change.
CREATE TABLE IF NOT EXISTS gate_leak_order_inputs (
  gate_leak_order_id  TEXT NOT NULL REFERENCES orders(order_id),
  input_name          TEXT NOT NULL CHECK (input_name = 'access_started_at'),
  input_value         TEXT NOT NULL,
  supplied_at_unix    BIGINT NOT NULL,
  PRIMARY KEY (gate_leak_order_id, input_name)
);

-- Narrow append-only join. No FK column is added to either immutable order row.
CREATE TABLE IF NOT EXISTS gate_leak_order_joins (
  gate_leak_order_id             TEXT NOT NULL REFERENCES orders(order_id),
  community_onboarding_order_id  TEXT NOT NULL REFERENCES orders(order_id),
  joined_at_unix                 BIGINT NOT NULL,
  PRIMARY KEY (gate_leak_order_id, community_onboarding_order_id)
);
