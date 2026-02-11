-- =============================================================================
-- BYOK Key Storage — Hounfour Endgame (Sprint 3, cycle-015)
-- =============================================================================
-- Stores community provider API keys with envelope encryption.
-- Keys are encrypted with a per-row DEK (AES-256-GCM), which is itself
-- wrapped by AWS KMS. Only ciphertext + wrapped DEK stored in DB.
--
-- @see SDD §3.4.1 BYOK Database Schema
-- @see PRD FR-4 BYOK Key Management
-- =============================================================================

CREATE TABLE IF NOT EXISTS community_byok_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolation: community owning this key
  community_id TEXT NOT NULL,

  -- Provider identifier (e.g., 'openai', 'anthropic')
  provider TEXT NOT NULL,

  -- Envelope encryption fields
  key_ciphertext BYTEA NOT NULL,        -- AES-256-GCM encrypted API key
  key_nonce BYTEA NOT NULL,             -- 12-byte GCM nonce (unique per encryption)
  dek_ciphertext BYTEA NOT NULL,        -- KMS-wrapped Data Encryption Key

  -- Last 4 characters of the plaintext key (for display in admin UI)
  key_last4 TEXT NOT NULL,

  -- Lifecycle timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,               -- NULL = active, non-NULL = revoked

  -- Audit trail
  created_by TEXT NOT NULL              -- User/wallet who stored the key
);

-- Partial unique index: only one active key per community+provider
-- Revoked keys (revoked_at IS NOT NULL) are excluded, allowing re-registration
CREATE UNIQUE INDEX IF NOT EXISTS idx_byok_community_provider_active
  ON community_byok_keys (community_id, provider)
  WHERE revoked_at IS NULL;

-- Lookup index for BYOK routing check (community_id → has active key?)
CREATE INDEX IF NOT EXISTS idx_byok_community_active
  ON community_byok_keys (community_id)
  WHERE revoked_at IS NULL;

-- Comment for documentation
COMMENT ON TABLE community_byok_keys IS 'Stores community BYOK provider API keys with envelope encryption (AES-256-GCM + KMS-wrapped DEK)';
