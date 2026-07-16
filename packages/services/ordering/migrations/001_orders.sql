CREATE TABLE IF NOT EXISTS orders (
  order_id            TEXT PRIMARY KEY,
  product             TEXT NOT NULL,
  placed_by           TEXT NOT NULL,
  inputs              JSONB NOT NULL,
  inputs_digest       TEXT NOT NULL,
  state               TEXT NOT NULL,
  placed_at_unix      BIGINT NOT NULL,
  created_at_unix     BIGINT NOT NULL,
  updated_at_unix     BIGINT NOT NULL,
  recipe_id           TEXT,
  resolved_buildings  JSONB,
  result_ref          TEXT,
  output              JSONB,
  output_digest       TEXT,
  refusal             JSONB,
  ingredients         JSONB,
  fulfillment         JSONB,
  ingredient_jobs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  operator_audit      JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS orders_producing_idx ON orders (state) WHERE state = 'producing';

CREATE TABLE IF NOT EXISTS order_outbox (
  seq         BIGSERIAL PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  subject     TEXT NOT NULL,
  payload     JSONB NOT NULL,
  idempotency_key TEXT,
  published   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS order_outbox_pending_idx ON order_outbox (published) WHERE published = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS order_outbox_idempotency_idx
  ON order_outbox (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_write_budget (
  bucket             TEXT NOT NULL,
  window_started_at  TIMESTAMPTZ NOT NULL,
  used               INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (bucket, window_started_at)
);
