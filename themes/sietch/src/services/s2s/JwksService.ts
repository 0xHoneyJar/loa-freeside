/**
 * JwksService — DB-Backed JWKS Public Key Service (Cycle 036, Task 2.1)
 *
 * Reads public ES256 keys from `s2s_jwks_public_keys` table for the
 * /.well-known/jwks.json endpoint. Private keys live only in Secrets Manager.
 *
 * Cache strategy:
 *   - In-memory cache with 5-minute TTL
 *   - Cache-Control: max-age=300 on HTTP response
 *   - Grace fetch on kid-not-found (immediate cache invalidation + re-query)
 *
 * @see SDD §1.9 Security Architecture
 * @see SDD §5.3 JWKS Endpoint
 * @see Migration 061: s2s_jwks_public_keys table
 */

import type { JWK } from 'jose';
import { getDatabase } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

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
  created_at: string;
  expires_at: string | null;
}

/** JWKS response format (RFC 7517 §5) */
export interface JwksResponse {
  keys: JWK[];
}

// --------------------------------------------------------------------------
// JwksService
// --------------------------------------------------------------------------

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedJwks: JwksResponse | null = null;
let cacheTimestamp = 0;

/**
 * Get JWKS public keys from database with in-memory caching.
 * Returns all non-expired keys for the /.well-known/jwks.json endpoint.
 */
export function getJwksFromDb(): JwksResponse {
  const now = Date.now();

  if (cachedJwks && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedJwks;
  }

  return refreshJwksCache();
}

/**
 * Force-refresh the JWKS cache from database.
 * Called on kid-not-found (grace fetch) or cache expiry.
 */
export function refreshJwksCache(): JwksResponse {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT kid, kty, crv, x, y, issuer, created_at, expires_at
    FROM s2s_jwks_public_keys
    WHERE expires_at IS NULL
       OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY created_at DESC
  `).all() as JwksPublicKeyRow[];

  const keys: JWK[] = rows.map((row) => ({
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

  logger.debug({ keyCount: keys.length }, 'JWKS cache refreshed from database');

  return cachedJwks;
}

/**
 * Insert a public key into the s2s_jwks_public_keys table.
 * Used by bootstrap and rotation scripts (programmatic path).
 */
export function insertPublicKey(params: {
  kid: string;
  kty: string;
  crv: string;
  x: string;
  y: string;
  issuer: string;
  expiresAt?: string;
}): void {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO s2s_jwks_public_keys (kid, kty, crv, x, y, issuer, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
  `).run(
    params.kid,
    params.kty,
    params.crv,
    params.x,
    params.y,
    params.issuer,
    params.expiresAt ?? null,
  );

  // Invalidate cache so next getJwksFromDb() picks up the new key
  cachedJwks = null;
  cacheTimestamp = 0;

  logger.info({ kid: params.kid, issuer: params.issuer }, 'Public key inserted into s2s_jwks_public_keys');
}

/**
 * Reset the in-memory cache. Used in tests.
 */
export function resetJwksCache(): void {
  cachedJwks = null;
  cacheTimestamp = 0;
}
