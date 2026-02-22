/**
 * Sprint 6 (319), Task 6.7: SIWE Session Token (HS256 JWT)
 *
 * Minimal JWT implementation using Node.js crypto for HS256.
 * No external JWT library needed — HS256 is HMAC-SHA256 over base64url-encoded header.payload.
 *
 * Features:
 * - Dual-secret validation for rotation (current + previous)
 * - `kid` header for secret version routing
 * - `origin` claim for cross-origin request binding
 * - 1h TTL with explicit `exp` claim
 */

import { createHmac, randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SiweSessionPayload {
  /** Wallet address (checksummed) */
  sub: string;
  /** Origin that initiated the session */
  origin: string;
  /** Issued-at (seconds since epoch) */
  iat: number;
  /** Expiration (seconds since epoch) */
  exp: number;
  /** Chain ID */
  chainId: number;
}

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
  kid: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 3600; // 1 hour
const NONCE_TTL_SECONDS = 300;    // 5 minutes
const NONCE_BYTES = 16;

// ─── Base64url helpers ───────────────────────────────────────────────────────

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buf.toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

// ─── HMAC-SHA256 ─────────────────────────────────────────────────────────────

function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

// ─── JWT Create ──────────────────────────────────────────────────────────────

export function createSessionToken(
  walletAddress: string,
  origin: string,
  chainId: number,
  secret: string,
  kid: string
): string {
  const now = Math.floor(Date.now() / 1000);

  const header: JwtHeader = { alg: 'HS256', typ: 'JWT', kid };
  const payload: SiweSessionPayload = {
    sub: walletAddress,
    origin,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    chainId,
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = hmacSha256(secret, `${headerB64}.${payloadB64}`);

  return `${headerB64}.${payloadB64}.${signature}`;
}

// ─── JWT Verify ──────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  payload?: SiweSessionPayload;
  error?: string;
}

export interface VerifyOptions {
  previousSecret?: string;
  expectedOrigin?: string;
  currentKid?: string;
  previousKid?: string;
}

/**
 * Verify a session token with kid-based secret routing and origin binding.
 *
 * - Decodes JWT header and validates alg=HS256, typ=JWT
 * - Routes to correct secret via `kid` header (falls back to try-both for legacy)
 * - Validates exp as exclusive upper bound, checks numeric types
 * - Validates origin claim if expectedOrigin provided
 */
export function verifySessionToken(
  token: string,
  currentSecret: string,
  options: VerifyOptions = {}
): VerifyResult {
  const { previousSecret, expectedOrigin, currentKid, previousKid } = options;

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token format' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode and validate header before selecting secret
  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecode(headerB64!)) as JwtHeader;
  } catch {
    return { valid: false, error: 'Invalid header' };
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return { valid: false, error: 'Invalid header' };
  }

  // kid-based secret routing for rotation
  const secretsToTry: Array<{ secret: string; label: 'current' | 'previous' }> = [];

  if (header.kid && currentKid && header.kid === currentKid) {
    secretsToTry.push({ secret: currentSecret, label: 'current' });
  } else if (header.kid && previousKid && previousSecret && header.kid === previousKid) {
    secretsToTry.push({ secret: previousSecret, label: 'previous' });
  } else if (!header.kid || !currentKid) {
    // Fallback for tokens without kid or deployments not yet using kid routing
    secretsToTry.push({ secret: currentSecret, label: 'current' });
    if (previousSecret) secretsToTry.push({ secret: previousSecret, label: 'previous' });
  } else {
    return { valid: false, error: 'Unknown kid' };
  }

  let sigValid = false;
  for (const { secret, label } of secretsToTry) {
    const expectedSig = hmacSha256(secret, `${headerB64}.${payloadB64}`);
    if (timingSafeEqual(signatureB64!, expectedSig)) {
      sigValid = true;
      if (label === 'previous') {
        logger.info('Session token verified with previous secret (rotation in progress)');
      }
      break;
    }
  }

  if (!sigValid) {
    return { valid: false, error: 'Invalid signature' };
  }

  // Decode and validate payload
  let payload: SiweSessionPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64!)) as SiweSessionPayload;
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }

  // Validate numeric types
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    return { valid: false, error: 'Invalid payload' };
  }

  // Check expiration (exclusive upper bound)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { valid: false, error: 'Token expired' };
  }

  // Origin binding
  if (expectedOrigin && payload.origin !== expectedOrigin) {
    return { valid: false, error: 'Invalid origin' };
  }

  return { valid: true, payload };
}

// ─── Timing-safe comparison ──────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  try {
    return require('crypto').timingSafeEqual(bufA, bufB);
  } catch {
    // Fallback — still constant-time for equal lengths
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i]! ^ bufB[i]!;
    }
    return result === 0;
  }
}

// ─── Nonce Generation ────────────────────────────────────────────────────────

export function generateNonce(): string {
  return randomBytes(NONCE_BYTES).toString('hex');
}

export { SESSION_TTL_SECONDS, NONCE_TTL_SECONDS };
