/**
 * Migration 061: S2S JWKS Public Keys (Cycle 036, Task 1.3)
 *
 * Creates the s2s_jwks_public_keys table for storing ES256 (P-256) public keys
 * used in service-to-service JWT verification between loa-freeside and loa-finn.
 *
 * Each service publishes its public key at /.well-known/jwks.json. The peer
 * service fetches and caches these keys for JWT signature verification.
 *
 * SDD refs: §1.3 S2S Trust Model
 * PRD refs: FR-2.1 S2S Authentication
 */

export const S2S_JWKS_PUBLIC_KEYS_SQL = `
-- =============================================================================
-- s2s_jwks_public_keys: ES256 public key registry for S2S JWT verification
-- =============================================================================
-- Keys are published at /.well-known/jwks.json and cached locally.
-- kid format: <service>-<timestamp>-<random> (e.g., "finn-1708444800-a1b2c3")
-- Key rotation: new key added → both valid → old key expires

CREATE TABLE IF NOT EXISTS s2s_jwks_public_keys (
  kid TEXT PRIMARY KEY,
  kty TEXT NOT NULL DEFAULT 'EC' CHECK (kty = 'EC'),
  crv TEXT NOT NULL DEFAULT 'P-256' CHECK (crv = 'P-256'),
  x TEXT NOT NULL,
  y TEXT NOT NULL,
  issuer TEXT NOT NULL CHECK (issuer IN ('freeside', 'finn')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  revoked_at TEXT
);

-- Find active keys for a specific issuer
CREATE INDEX IF NOT EXISTS idx_s2s_jwks_issuer_active
  ON s2s_jwks_public_keys(issuer, created_at)
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

export const S2S_JWKS_PUBLIC_KEYS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_s2s_jwks_issuer_active;
DROP TABLE IF EXISTS s2s_jwks_public_keys;
`;
