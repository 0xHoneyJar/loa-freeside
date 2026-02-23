/**
 * JWKS PostgreSQL Service — DB-Backed JWKS Public Key Service
 *
 * PostgreSQL equivalent of themes/sietch/src/services/s2s/JwksService.ts.
 * Reads ES256 public keys from `s2s_jwks_public_keys` table for the
 * /.well-known/jwks.json endpoint. Private keys live only in Secrets Manager.
 *
 * Cache strategy:
 *   - In-memory cache with configurable TTL (default 60s for production)
 *   - Cache-Control: max-age=60 on HTTP response (aligned with key refresh)
 *   - Grace fetch on kid-not-found (immediate cache invalidation + re-query)
 *   - Key rotation overlap: serves both current and previous keys for ≥15 minutes
 *
 * @see SDD §4.3 S2S JWT Contract
 * @see Migration 0011: s2s_jwks_public_keys (PostgreSQL)
 * @see Sprint 0A, Task 0A.3
 * @module packages/services/jwks-pg-service
 */

import type { Pool, PoolClient } from 'pg';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Row shape from s2s_jwks_public_keys table */
interface JwksPublicKeyRow {
  kid: string;
  kty: string;
  crv: string;
  x: string;
  y: string;
  issuer: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** Standard JWK representation (RFC 7517) */
export interface JWK {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid?: string;
  use?: string;
  alg?: string;
}

/** JWKS response format (RFC 7517 §5) */
export interface JwksResponse {
  keys: JWK[];
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Cache TTL in milliseconds — aligned with Cache-Control: max-age=60 */
const CACHE_TTL_MS = 60 * 1000;

/**
 * Key rotation overlap window in milliseconds (15 minutes).
 * During rotation, both old and new keys are served for at least this duration.
 * This ensures finn's JWKS cache (TTL=60s) has time to pick up the new key
 * before the old one stops being used for signing.
 */
const ROTATION_OVERLAP_MS = 15 * 60 * 1000;

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

let cachedJwks: JwksResponse | null = null;
let cacheTimestamp = 0;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Get JWKS public keys from PostgreSQL with in-memory caching.
 * Returns all non-expired, non-revoked keys for the /.well-known/jwks.json endpoint.
 *
 * @param pool - PostgreSQL connection pool
 * @returns JWKS response with active public keys
 */
export async function getJwksFromDb(pool: Pool): Promise<JwksResponse> {
  const now = Date.now();

  if (cachedJwks && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedJwks;
  }

  return refreshJwksCache(pool);
}

/**
 * Force-refresh the JWKS cache from PostgreSQL.
 * Called on kid-not-found (grace fetch) or cache expiry.
 *
 * Returns all keys that are:
 *   - Not revoked (revoked_at IS NULL)
 *   - Not expired (expires_at IS NULL OR expires_at > NOW())
 * Ordered by created_at DESC so the newest key appears first.
 *
 * @param pool - PostgreSQL connection pool
 * @returns Refreshed JWKS response
 */
export async function refreshJwksCache(pool: Pool): Promise<JwksResponse> {
  const result = await pool.query<JwksPublicKeyRow>(
    `SELECT kid, kty, crv, x, y, issuer, created_at, expires_at, revoked_at
     FROM s2s_jwks_public_keys
     WHERE revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`
  );

  const keys: JWK[] = result.rows.map((row) => ({
    kty: row.kty,
    crv: row.crv,
    x: row.x,
    y: row.y,
    kid: row.kid,
    use: 'sig',
    alg: 'ES256',
  }));

  cachedJwks = { keys };
  cacheTimestamp = Date.now();

  return cachedJwks;
}

/**
 * Insert a public key into the s2s_jwks_public_keys table.
 * Used by bootstrap and rotation scripts (programmatic path).
 *
 * Uses ON CONFLICT (kid) DO NOTHING for idempotency — safe to call
 * multiple times with the same key (e.g., on container restart).
 *
 * @param client - PostgreSQL client (within transaction or standalone)
 * @param params - Key parameters
 */
export async function insertPublicKey(
  client: PoolClient | Pool,
  params: {
    kid: string;
    kty: string;
    crv: string;
    x: string;
    y: string;
    issuer: string;
    expiresAt?: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO s2s_jwks_public_keys (kid, kty, crv, x, y, issuer, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kid) DO NOTHING`,
    [
      params.kid,
      params.kty,
      params.crv,
      params.x,
      params.y,
      params.issuer,
      params.expiresAt ?? null,
    ]
  );

  // Invalidate cache so next getJwksFromDb() picks up the new key
  cachedJwks = null;
  cacheTimestamp = 0;
}

/**
 * Revoke a key by setting revoked_at = NOW().
 * The key will be excluded from future JWKS responses but remains in the table
 * for audit purposes.
 *
 * @param client - PostgreSQL client
 * @param kid - Key ID to revoke
 */
export async function revokeKey(
  client: PoolClient | Pool,
  kid: string,
): Promise<void> {
  await client.query(
    `UPDATE s2s_jwks_public_keys SET revoked_at = NOW() WHERE kid = $1`,
    [kid]
  );

  // Invalidate cache
  cachedJwks = null;
  cacheTimestamp = 0;
}

/**
 * Check if a specific kid exists and is active (not expired, not revoked).
 * Used for grace-fetch: if finn requests verification with an unknown kid,
 * force a cache refresh before failing.
 *
 * @param pool - PostgreSQL connection pool
 * @param kid - Key ID to check
 * @returns true if the key is active
 */
export async function isKeyActive(
  pool: Pool,
  kid: string,
): Promise<boolean> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM s2s_jwks_public_keys
     WHERE kid = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [kid]
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Reset the in-memory cache. Used in tests.
 */
export function resetJwksCache(): void {
  cachedJwks = null;
  cacheTimestamp = 0;
}

/**
 * Get the cache TTL for HTTP Cache-Control headers.
 * Returns seconds (not milliseconds).
 */
export function getCacheTtlSeconds(): number {
  return Math.floor(CACHE_TTL_MS / 1000);
}

/**
 * Get the rotation overlap window in milliseconds.
 * Used by key rotation scripts to determine how long to keep old keys.
 */
export function getRotationOverlapMs(): number {
  return ROTATION_OVERLAP_MS;
}
