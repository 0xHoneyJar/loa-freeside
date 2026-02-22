/**
 * Migration 062: API Keys (Cycle 036, Task 1.3)
 *
 * Creates the api_keys table for developer API key management.
 * Keys are hashed with HMAC-SHA256 using a rotating pepper. Only the
 * key_prefix (first 8 chars) is stored in cleartext for identification.
 *
 * SDD refs: §2.2 API Key Authentication
 * PRD refs: FR-3.1 Developer API Access
 */

export const API_KEYS_SQL = `
-- =============================================================================
-- api_keys: Developer API key registry with hashed storage
-- =============================================================================
-- Key format: ak_live_<random32> or ak_test_<random32>
-- Only key_prefix stored in cleartext. Full key hashed with pepper.
-- Pepper rotation: pepper_version tracks which pepper was used for hashing.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_salt TEXT NOT NULL,
  pepper_version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'Default',
  scopes TEXT NOT NULL DEFAULT '[]',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  rate_limit_tpd INTEGER NOT NULL DEFAULT 10000,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT
);

-- Lookup by prefix (used during key validation)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys(key_prefix);

-- Active keys per user
CREATE INDEX IF NOT EXISTS idx_api_keys_user_active
  ON api_keys(user_id, is_active)
  WHERE is_active = 1 AND revoked_at IS NULL;

-- Active keys per community
CREATE INDEX IF NOT EXISTS idx_api_keys_community
  ON api_keys(community_id);

-- Hash lookup (for validation)
CREATE INDEX IF NOT EXISTS idx_api_keys_hash
  ON api_keys(key_hash);
`;

export const API_KEYS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_api_keys_hash;
DROP INDEX IF EXISTS idx_api_keys_community;
DROP INDEX IF EXISTS idx_api_keys_user_active;
DROP INDEX IF EXISTS idx_api_keys_prefix;
DROP TABLE IF EXISTS api_keys;
`;
