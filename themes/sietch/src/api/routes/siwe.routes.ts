/**
 * Sprint 6 (319), Task 6.7: SIWE Auth Routes (EIP-4361)
 *
 * Sign-In with Ethereum authentication flow:
 *   GET  /api/v1/siwe/nonce   → Generate nonce (stored in Redis, 5-min TTL)
 *   POST /api/v1/siwe/verify  → Verify SIWE signature → issue session JWT cookie
 *   POST /api/v1/siwe/logout  → Clear session cookie
 *   GET  /api/v1/siwe/session → Check current session status
 */

import { Router, type Request, type Response } from 'express';
import { isAddress, type Hex } from 'viem';
import { SignatureVerifier } from '../../packages/verification/SignatureVerifier.js';
import {
  generateNonce,
  createSessionToken,
  verifySessionToken,
  NONCE_TTL_SECONDS,
  type VerifyOptions,
} from '../auth/siwe-session.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';

export const siweRouter = Router();

const signatureVerifier = new SignatureVerifier();

// ─── Redis nonce store ───────────────────────────────────────────────────────

// In-memory fallback when Redis is unavailable
const nonceStore = new Map<string, { createdAt: number }>();

/**
 * Get Redis client if available. Uses the same pattern as RedisService.
 */
function getRedisClient(): any | null {
  try {
    if (!config.features.redisEnabled || !config.redis.url) return null;
    // Lazy-load to avoid circular dependency
    const { createRequire } = await_import_createRequire();
    return null; // Will be set by setRedisClient
  } catch {
    return null;
  }
}

// Allow server.ts to inject a shared Redis client
let redisClient: any | null = null;
export function setSiweRedisClient(client: any): void {
  redisClient = client;
}

function await_import_createRequire(): never {
  throw new Error('Use setSiweRedisClient to inject Redis');
}

async function storeNonce(nonce: string): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.set(`siwe:nonce:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS);
      return;
    } catch (err) {
      logger.warn({ err }, 'Redis nonce store failed, using in-memory fallback');
    }
  }
  // In-memory fallback
  nonceStore.set(nonce, { createdAt: Date.now() });
}

async function consumeNonce(nonce: string): Promise<boolean> {
  if (redisClient) {
    try {
      // DEL returns 1 if the key existed (single-use enforcement)
      const deleted = await redisClient.del(`siwe:nonce:${nonce}`);
      return deleted === 1;
    } catch (err) {
      logger.warn({ err }, 'Redis nonce consume failed, using in-memory fallback');
    }
  }
  // In-memory fallback with TTL check
  const entry = nonceStore.get(nonce);
  if (!entry) return false;
  nonceStore.delete(nonce);
  const age = Date.now() - entry.createdAt;
  return age < NONCE_TTL_SECONDS * 1000;
}

// Clean stale in-memory nonces every 60s
setInterval(() => {
  const cutoff = Date.now() - NONCE_TTL_SECONDS * 1000;
  for (const [nonce, entry] of nonceStore) {
    if (entry.createdAt < cutoff) nonceStore.delete(nonce);
  }
}, 60_000).unref();

// ─── Session secret configuration ────────────────────────────────────────────

function getSessionSecrets(): { current: string; kid: string; previous?: string; previousKid?: string } {
  const current = process.env.SIWE_SESSION_SECRET;
  if (!current) {
    throw new Error('SIWE_SESSION_SECRET must be set');
  }
  return {
    current,
    kid: process.env.SIWE_SESSION_SECRET_KID || 'v1',
    previous: process.env.SIWE_SESSION_SECRET_PREVIOUS || undefined,
    previousKid: process.env.SIWE_SESSION_SECRET_PREVIOUS_KID || undefined,
  };
}

// ─── Allowed chains ──────────────────────────────────────────────────────────

// Berachain mainnet + testnet
const ALLOWED_CHAIN_IDS = new Set([80084, 80085, 80094, 1, 11155111]);

// ─── Allowed domains ─────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = new Set([
  'api.arrakis.community',
  'arrakis.community',
  'freeside.honeyjar.xyz',
  ...(process.env.NODE_ENV !== 'production' ? ['localhost'] : []),
]);

// ─── SIWE message builder (EIP-4361) ─────────────────────────────────────────

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to Freeside',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expirationTime}`,
  ].join('\n');
}

// ─── Rate limiting (per-IP) ──────────────────────────────────────────────────

const ipNonceRequests = new Map<string, { count: number; resetAt: number }>();
const NONCE_RATE_LIMIT = 20;     // 20 nonces per window
const NONCE_RATE_WINDOW = 300_000; // 5 minutes

function checkNonceRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipNonceRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    ipNonceRequests.set(ip, { count: 1, resetAt: now + NONCE_RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= NONCE_RATE_LIMIT;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /nonce — Generate a SIWE nonce
 */
siweRouter.get('/nonce', async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkNonceRateLimit(ip)) {
    res.status(429).json({ error: 'Too many nonce requests' });
    return;
  }

  const nonce = generateNonce();
  await storeNonce(nonce);

  res.json({ nonce });
});

/**
 * POST /verify — Verify SIWE signature and issue session cookie
 *
 * Body: { message: string, signature: string }
 *   message: The full SIWE message that was signed
 *   signature: The EIP-191 signature (0x-prefixed hex)
 */
siweRouter.post('/verify', async (req: Request, res: Response) => {
  try {
    const { message, signature } = req.body as { message?: string; signature?: string };

    if (!message || !signature) {
      res.status(400).json({ error: 'message and signature are required' });
      return;
    }

    // Parse SIWE message fields
    const parsed = parseSiweMessage(message);
    if (!parsed) {
      res.status(400).json({ error: 'Invalid SIWE message format' });
      return;
    }

    // Validate domain
    if (!ALLOWED_DOMAINS.has(parsed.domain)) {
      res.status(400).json({ error: 'Invalid domain' });
      return;
    }

    // Validate chain ID
    if (!ALLOWED_CHAIN_IDS.has(parsed.chainId)) {
      res.status(400).json({ error: 'Unsupported chain' });
      return;
    }

    // Validate address format
    if (!isAddress(parsed.address, { strict: false })) {
      res.status(400).json({ error: 'Invalid address' });
      return;
    }

    // Check expiration time
    const expTime = new Date(parsed.expirationTime);
    if (isNaN(expTime.getTime()) || expTime.getTime() < Date.now()) {
      res.status(400).json({ error: 'Message expired' });
      return;
    }

    // Consume nonce (single-use)
    const nonceValid = await consumeNonce(parsed.nonce);
    if (!nonceValid) {
      res.status(400).json({ error: 'Invalid or expired nonce' });
      return;
    }

    // Verify EIP-191 signature
    const verifyResult = await signatureVerifier.verifyAddress(
      message,
      signature as Hex,
      parsed.address as `0x${string}`
    );

    if (!verifyResult.valid) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Issue session token
    const secrets = getSessionSecrets();
    const origin = req.headers.origin || parsed.domain;
    const token = createSessionToken(
      parsed.address,
      origin,
      parsed.chainId,
      secrets.current,
      secrets.kid
    );

    // Set HttpOnly, Secure, SameSite=Strict cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('freeside_session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 3600_000, // 1 hour in ms
      path: '/',
    });

    logger.info(
      { address: parsed.address, chainId: parsed.chainId },
      'SIWE session created'
    );

    res.json({
      success: true,
      address: parsed.address,
      chainId: parsed.chainId,
      expiresIn: 3600,
    });
  } catch (err) {
    logger.error({ err }, 'SIWE verify error');
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /logout — Clear session cookie
 */
siweRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('freeside_session', { path: '/' });
  res.json({ success: true });
});

/**
 * GET /session — Check current session status
 */
siweRouter.get('/session', (req: Request, res: Response) => {
  const token = req.cookies?.freeside_session;
  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  try {
    const secrets = getSessionSecrets();
    const verifyOpts: VerifyOptions = {
      previousSecret: secrets.previous,
      currentKid: secrets.kid,
      previousKid: secrets.previousKid,
    };
    const result = verifySessionToken(token, secrets.current, verifyOpts);

    if (!result.valid || !result.payload) {
      res.json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      address: result.payload.sub,
      chainId: result.payload.chainId,
      expiresAt: result.payload.exp,
    });
  } catch {
    res.json({ authenticated: false });
  }
});

// ─── SIWE Message Parser ─────────────────────────────────────────────────────

interface ParsedSiweMessage {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

function parseSiweMessage(message: string): ParsedSiweMessage | null {
  try {
    const lines = message.split('\n');

    // Line 0: "{domain} wants you to sign in with your Ethereum account:"
    const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in with your Ethereum account:$/);
    if (!domainMatch) return null;

    // Line 1: Address
    const address = lines[1]?.trim();
    if (!address) return null;

    // Parse key-value fields
    const fields: Record<string, string> = {};
    for (const line of lines) {
      const kv = line.match(/^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time): (.+)$/);
      if (kv) {
        fields[kv[1]!] = kv[2]!;
      }
    }

    if (!fields['URI'] || !fields['Chain ID'] || !fields['Nonce'] || !fields['Issued At'] || !fields['Expiration Time']) {
      return null;
    }

    const chainId = parseInt(fields['Chain ID']!, 10);
    if (isNaN(chainId)) return null;

    return {
      domain: domainMatch[1]!,
      address,
      uri: fields['URI']!,
      chainId,
      nonce: fields['Nonce']!,
      issuedAt: fields['Issued At']!,
      expirationTime: fields['Expiration Time']!,
    };
  } catch {
    return null;
  }
}

export { buildSiweMessage, parseSiweMessage as _parseSiweMessageForTesting };
