-- =============================================================================
-- Global User Registry Schema (Sprint 176)
-- Append-only, event-sourced identity store
-- =============================================================================
--
-- This migration creates:
-- 1. user_identities - Current state cache for user identities
-- 2. identity_events - Append-only event log (immutable)
-- 3. identity_wallets - Verified wallet mappings
--
-- Security Features:
-- - DELETE prevention triggers on identity_events
-- - UPDATE prevention triggers on identity_events
-- - Financial-grade audit trail
-- =============================================================================

-- T-1: User identities (current state cache)
-- This table holds the computed current state of each identity.
-- The source of truth is the identity_events table.
CREATE TABLE IF NOT EXISTS user_identities (
  identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Discord identity (primary for now)
  discord_id VARCHAR(32) UNIQUE NOT NULL,
  discord_username VARCHAR(100),
  discord_discriminator VARCHAR(4),
  discord_avatar_hash VARCHAR(64),

  -- Primary wallet (convenience field)
  primary_wallet VARCHAR(42),

  -- Future social identities (nullable until implemented)
  twitter_handle VARCHAR(50),
  telegram_id VARCHAR(32),

  -- Status management
  status VARCHAR(20) DEFAULT 'active' NOT NULL
    CHECK (status IN ('active', 'suspended', 'deleted')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Version for optimistic locking
  version INTEGER DEFAULT 1 NOT NULL
);

-- T-2: Identity events (append-only audit log)
-- SOURCE OF TRUTH - Never modify or delete
CREATE TABLE IF NOT EXISTS identity_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to identity
  identity_id UUID NOT NULL REFERENCES user_identities(identity_id),

  -- Event metadata
  event_type VARCHAR(50) NOT NULL
    CHECK (event_type IN (
      'IDENTITY_CREATED',
      'DISCORD_LINKED',
      'DISCORD_UPDATED',
      'WALLET_VERIFIED',
      'WALLET_REMOVED',
      'WALLET_SET_PRIMARY',
      'TWITTER_LINKED',
      'TELEGRAM_LINKED',
      'PROFILE_UPDATED',
      'IDENTITY_SUSPENDED',
      'IDENTITY_RESTORED',
      'IDENTITY_DELETED'
    )),

  -- Event payload (varies by event_type)
  event_data JSONB NOT NULL,

  -- Audit fields
  occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  source VARCHAR(50) NOT NULL,  -- 'discord_verification', 'admin_dashboard', 'admin_api', 'oauth_flow', 'system'
  actor_id VARCHAR(100),        -- Who triggered: discord_id, admin_id, 'system'

  -- Request metadata for debugging
  request_id VARCHAR(64),       -- Correlation ID
  ip_address INET,              -- Client IP (optional)
  user_agent TEXT               -- Client info (optional)
);

-- Prevent DELETE on events (financial-grade audit requirement)
CREATE OR REPLACE FUNCTION prevent_identity_event_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'DELETE not allowed on identity_events - append-only table';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_delete_identity_events ON identity_events;
CREATE TRIGGER no_delete_identity_events
  BEFORE DELETE ON identity_events
  FOR EACH ROW EXECUTE FUNCTION prevent_identity_event_delete();

-- Prevent UPDATE on events (immutability)
CREATE OR REPLACE FUNCTION prevent_identity_event_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'UPDATE not allowed on identity_events - immutable table';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_identity_events ON identity_events;
CREATE TRIGGER no_update_identity_events
  BEFORE UPDATE ON identity_events
  FOR EACH ROW EXECUTE FUNCTION prevent_identity_event_update();

-- T-3: Identity wallets (verified wallet mapping)
CREATE TABLE IF NOT EXISTS identity_wallets (
  wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to identity
  identity_id UUID NOT NULL REFERENCES user_identities(identity_id),

  -- Wallet details
  address VARCHAR(42) NOT NULL,
  chain_id INTEGER DEFAULT 80094 NOT NULL,  -- Berachain by default

  -- Verification metadata
  is_primary BOOLEAN DEFAULT false NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  verification_source VARCHAR(50) NOT NULL,  -- 'sietch', 'gaib_web', 'migration', etc.
  verification_signature TEXT,               -- EIP-191 signature
  verification_message TEXT,                 -- Signed message

  -- Status
  status VARCHAR(20) DEFAULT 'active' NOT NULL
    CHECK (status IN ('active', 'removed')),
  removed_at TIMESTAMPTZ,
  removed_reason TEXT
);

-- Unique constraint: one active wallet address globally
-- This ensures a wallet can only be linked to one identity at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_wallets_unique_active_address
  ON identity_wallets(address)
  WHERE status = 'active';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_identities_discord ON user_identities(discord_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_primary_wallet ON user_identities(primary_wallet) WHERE primary_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_identities_status ON user_identities(status);

CREATE INDEX IF NOT EXISTS idx_identity_events_identity ON identity_events(identity_id);
CREATE INDEX IF NOT EXISTS idx_identity_events_type ON identity_events(event_type);
CREATE INDEX IF NOT EXISTS idx_identity_events_occurred ON identity_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_identity_events_source ON identity_events(source);

CREATE INDEX IF NOT EXISTS idx_identity_wallets_identity ON identity_wallets(identity_id);
CREATE INDEX IF NOT EXISTS idx_identity_wallets_address ON identity_wallets(address) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_identity_wallets_verification_source ON identity_wallets(verification_source);

-- =============================================================================
-- Migration complete
-- =============================================================================
