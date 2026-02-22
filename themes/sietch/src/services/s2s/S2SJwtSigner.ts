/**
 * S2SJwtSigner — ES256 JWT Signing for Service-to-Service Communication
 * Cycle 036, Sprint 1 (326), Task 1.3
 *
 * Signs JWTs for authenticated communication between loa-freeside and loa-finn.
 * Private keys are loaded from environment (Secrets Manager in production) or
 * generated ephemerally for local development.
 *
 * JWT claims: iss, aud, iat, exp, nft_id, tier, community_id, budget_reservation_id
 * Algorithm: ES256 (P-256 / secp256r1)
 * TTL: 60 seconds
 *
 * @see SDD §1.9 Security Architecture
 * @see SDD §5.2 S2S Contract
 */

import * as jose from 'jose';
import { logger } from '../../utils/logger.js';
import { insertPublicKey, resetJwksCache } from './JwksService.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** JWT issuer claim */
const JWT_ISSUER = 'loa-freeside';

/** JWT audience claim */
const JWT_AUDIENCE = 'loa-finn';

/** JWT time-to-live in seconds */
const JWT_TTL_SECONDS = 60;

/** Algorithm for ES256 (P-256 curve) */
const JWT_ALGORITHM = 'ES256' as const;

/** How often to refresh the signing key from environment (ms) */
const KEY_REFRESH_INTERVAL_MS = 60 * 1000;

/** KID prefix for locally-generated ephemeral keys */
const EPHEMERAL_KID_PREFIX = 'freeside-ephemeral-';

/** KID prefix for production keys from Secrets Manager */
const PRODUCTION_KID_PREFIX = 'freeside-';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** S2S JWT custom claims (beyond standard iss/aud/iat/exp) */
export interface S2SJwtClaims {
  /** NFT token ID for personality routing */
  nft_id: string;
  /** Tier from conviction scoring (e.g., "diamond", "gold") */
  tier: string;
  /** Community identifier */
  community_id: string;
  /** Budget reservation ID for finalization tracking */
  budget_reservation_id: string;
}

/** Internal signing key state */
interface SigningKeyState {
  /** Key ID */
  kid: string;
  /** Private key for signing (jose KeyLike) */
  privateKey: jose.KeyLike;
  /** Public key for JWKS (jose KeyLike) */
  publicKey: jose.KeyLike;
  /** When this key was loaded */
  loadedAt: number;
  /** Whether this is an ephemeral key */
  ephemeral: boolean;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Validate and extract required EC public JWK fields.
 * Throws if any required field (kty, crv, x, y) is missing.
 * Prevents invalid JWKS entries from being inserted into the database.
 */
function requireEcPublicJwk(jwk: jose.JWK): { kty: string; crv: string; x: string; y: string } {
  const kty = jwk.kty;
  const crv = (jwk as jose.JWK).crv;
  const x = (jwk as jose.JWK).x;
  const y = (jwk as jose.JWK).y;

  if (!kty || !crv || !x || !y) {
    throw new Error(`Invalid EC public JWK: missing fields (kty=${kty}, crv=${crv}, x=${!!x}, y=${!!y})`);
  }

  return { kty, crv, x, y };
}

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

let activeSigningKey: SigningKeyState | null = null;

// --------------------------------------------------------------------------
// Key Loading
// --------------------------------------------------------------------------

/**
 * Load signing key from environment variable.
 * In production, Secrets Manager populates S2S_SIGNING_KEY_PRIVATE with PEM.
 * Returns null if not configured (will fall back to ephemeral).
 */
async function loadKeyFromEnvironment(): Promise<SigningKeyState | null> {
  const privatePem = process.env.S2S_SIGNING_KEY_PRIVATE;
  const kid = process.env.S2S_SIGNING_KEY_KID;

  if (!privatePem || !kid) {
    return null;
  }

  try {
    const privateKey = await jose.importPKCS8(privatePem, JWT_ALGORITHM);
    // Export the public key from the private key by round-tripping through JWK
    const privateJwk = await jose.exportJWK(privateKey);
    // Remove the private 'd' component to get just the public key
    const { d: _d, ...publicJwk } = privateJwk;
    publicJwk.kid = kid;
    publicJwk.use = 'sig';
    publicJwk.alg = JWT_ALGORITHM;
    const publicKey = await jose.importJWK(publicJwk, JWT_ALGORITHM);

    logger.info({ kid }, 'S2S signing key loaded from environment');

    return {
      kid,
      privateKey,
      publicKey,
      loadedAt: Date.now(),
      ephemeral: false,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to load S2S signing key from environment');
    return null;
  }
}

/**
 * Generate an ephemeral ES256 keypair for local development.
 * The public key is automatically registered in the JWKS table.
 */
async function generateEphemeralKey(): Promise<SigningKeyState> {
  const { publicKey, privateKey } = await jose.generateKeyPair(JWT_ALGORITHM, {
    extractable: true,
  });

  const kid = `${EPHEMERAL_KID_PREFIX}${Date.now()}`;

  // Export public key as JWK and register in the JWKS table
  const publicJwk = await jose.exportJWK(publicKey);

  try {
    const { kty, crv, x, y } = requireEcPublicJwk(publicJwk);
    insertPublicKey({
      kid,
      kty,
      crv,
      x,
      y,
      issuer: JWT_ISSUER,
    });
    resetJwksCache();
  } catch (err) {
    // DB might not be initialized yet in some test scenarios
    logger.warn({ err, kid }, 'Failed to insert ephemeral public key into JWKS table');
  }

  logger.info({ kid }, 'Ephemeral ES256 keypair generated for local development');

  return {
    kid,
    privateKey,
    publicKey,
    loadedAt: Date.now(),
    ephemeral: true,
  };
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Initialize the S2S JWT signer. Must be called once at startup.
 *
 * 1. Tries to load from S2S_SIGNING_KEY_PRIVATE env var (production)
 * 2. Falls back to ephemeral keypair generation (development)
 *
 * Registers the public key in the JWKS table for both paths.
 */
export async function initS2SJwtSigner(): Promise<void> {
  // Try environment/Secrets Manager first
  const envKey = await loadKeyFromEnvironment();

  if (envKey) {
    activeSigningKey = envKey;

    // Register the public key in the JWKS table
    const publicJwk = await jose.exportJWK(envKey.publicKey);
    try {
      const { kty, crv, x, y } = requireEcPublicJwk(publicJwk);
      insertPublicKey({
        kid: envKey.kid,
        kty,
        crv,
        x,
        y,
        issuer: JWT_ISSUER,
      });
      resetJwksCache();
    } catch (err) {
      // Key might already exist from a previous run
      logger.debug({ err, kid: envKey.kid }, 'Public key may already exist in JWKS table');
    }

    return;
  }

  // Fall back to ephemeral key for development
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'S2S_SIGNING_KEY_PRIVATE and S2S_SIGNING_KEY_KID must be set in production. ' +
      'Configure via Secrets Manager: arrakis-{env}/s2s-signing-keys',
    );
  }

  logger.warn('No S2S signing key configured. Generating ephemeral keypair for local dev.');
  activeSigningKey = await generateEphemeralKey();
}

/**
 * Refresh the signing key from environment if the cached key is stale.
 * Called periodically (every 60s) to pick up rotated keys from Secrets Manager.
 */
export async function refreshSigningKeyIfStale(): Promise<void> {
  if (!activeSigningKey) return;
  if (activeSigningKey.ephemeral) return; // Ephemeral keys don't refresh

  const age = Date.now() - activeSigningKey.loadedAt;
  if (age < KEY_REFRESH_INTERVAL_MS) return;

  const newKey = await loadKeyFromEnvironment();
  if (newKey && newKey.kid !== activeSigningKey.kid) {
    logger.info(
      { oldKid: activeSigningKey.kid, newKid: newKey.kid },
      'S2S signing key rotated',
    );
    activeSigningKey = newKey;

    // Register new public key
    const publicJwk = await jose.exportJWK(newKey.publicKey);
    try {
      const { kty, crv, x, y } = requireEcPublicJwk(publicJwk);
      insertPublicKey({
        kid: newKey.kid,
        kty,
        crv,
        x,
        y,
        issuer: JWT_ISSUER,
      });
      resetJwksCache();
    } catch (err) {
      // Key might already exist
      logger.debug({ err, kid: newKey.kid }, 'Public key may already exist in JWKS table');
    }
  } else if (newKey) {
    // Same kid, just update loadedAt
    activeSigningKey.loadedAt = Date.now();
  }
}

/**
 * Sign an S2S JWT with ES256 for communication with loa-finn.
 *
 * @param claims - Custom claims (nft_id, tier, community_id, budget_reservation_id)
 * @returns Signed compact JWT string
 * @throws Error if signer is not initialized
 *
 * @example
 * ```ts
 * const jwt = await signS2SJwt({
 *   nft_id: '42',
 *   tier: 'diamond',
 *   community_id: 'comm_xyz',
 *   budget_reservation_id: 'res_abc123',
 * });
 * // Use in Authorization header: `Bearer ${jwt}`
 * ```
 */
export async function signS2SJwt(claims: S2SJwtClaims): Promise<string> {
  // Refresh key if stale (non-blocking for most calls)
  await refreshSigningKeyIfStale();

  if (!activeSigningKey) {
    throw new Error('S2S JWT signer not initialized. Call initS2SJwtSigner() first.');
  }

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({
    nft_id: claims.nft_id,
    tier: claims.tier,
    community_id: claims.community_id,
    budget_reservation_id: claims.budget_reservation_id,
  })
    .setProtectedHeader({
      alg: JWT_ALGORITHM,
      kid: activeSigningKey.kid,
      typ: 'JWT',
    })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .sign(activeSigningKey.privateKey);

  return jwt;
}

/**
 * Get the current signing key's public key as JWK.
 * Used for local JWKS endpoint and testing.
 */
export async function getSigningPublicKeyJwk(): Promise<jose.JWK | null> {
  if (!activeSigningKey) return null;
  const jwk = await jose.exportJWK(activeSigningKey.publicKey);
  jwk.kid = activeSigningKey.kid;
  jwk.use = 'sig';
  jwk.alg = JWT_ALGORITHM;
  return jwk;
}

/**
 * Get the active signing key ID.
 */
export function getActiveKid(): string | null {
  return activeSigningKey?.kid ?? null;
}

/**
 * Check if the signer is initialized and ready.
 */
export function isSignerReady(): boolean {
  return activeSigningKey !== null;
}

/**
 * Reset the signer state. Used in tests.
 */
export function resetSigner(): void {
  activeSigningKey = null;
  resetJwksCache();
}
