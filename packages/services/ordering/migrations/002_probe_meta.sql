-- Fulfillment-surface (SDD D1): last raw probe truth per ingredient.
-- Additive + idempotent; legacy rows read as NULL -> {} at the store boundary.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS probe_meta JSONB;
