/**
 * Developer API Key Authentication Middleware
 * Sprint 6 (319), Task 6.2: API Key Auth Middleware
 *
 * Validates developer API keys (lf_live_/lf_test_) on inference routes:
 *   Authorization: Bearer lf_live_<prefix>_<secret>
 *
 * Features:
 *   - Extract prefix → DB lookup → HMAC verify with timingSafeEqual
 *   - Per-key rate limiting: configurable RPM and TPD
 *   - last_used_at updated on valid authentication
 *   - Revoked keys return 401
 *   - Response headers: X-RateLimit-Remaining, X-RateLimit-Reset
 *
 * SDD refs: §2.2 API Key Authentication
 * PRD refs: FR-5.2 Developer Key Middleware
 *
 * @module api/middleware/developer-key-auth
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';
import {
  validateApiKey,
  touchKeyUsage,
  type ApiKeyRecord,
} from '../../services/api-keys/ApiKeyService.js';

// =============================================================================
// Types
// =============================================================================

export interface DeveloperKeyRequest extends Request {
  /** Authenticated developer key record */
  developerKey?: ApiKeyRecord;
  /** Whether this is a sandbox (test) key */
  isSandboxKey?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Extract non-secret key prefix for safe logging (never log the secret portion) */
function safeKeyPrefix(token: string): string {
  // Format: lf_live_ABCDEF123456_<secret> — return everything before the last underscore
  const lastUnderscore = token.lastIndexOf('_');
  if (lastUnderscore > 8) {
    return token.slice(0, lastUnderscore);
  }
  return 'invalid';
}

// =============================================================================
// In-Memory Rate Limit Counters
// =============================================================================

interface RateBucket {
  /** Requests in current minute window */
  rpm: number;
  /** Tokens consumed today */
  tpd: number;
  /** Start of current minute window (epoch ms) */
  rpmWindowStart: number;
  /** Start of current day window (epoch ms) */
  tpdWindowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

/** Get or create rate bucket for a key */
function getRateBucket(keyId: string): RateBucket {
  const now = Date.now();
  let bucket = rateBuckets.get(keyId);

  if (!bucket) {
    bucket = { rpm: 0, tpd: 0, rpmWindowStart: now, tpdWindowStart: startOfDay(now) };
    rateBuckets.set(keyId, bucket);
    return bucket;
  }

  // Reset minute window if expired
  if (now - bucket.rpmWindowStart >= 60_000) {
    bucket.rpm = 0;
    bucket.rpmWindowStart = now;
  }

  // Reset daily window if expired
  const dayStart = startOfDay(now);
  if (bucket.tpdWindowStart < dayStart) {
    bucket.tpd = 0;
    bucket.tpdWindowStart = dayStart;
  }

  return bucket;
}

/** Start of UTC day in epoch ms */
function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Record token usage for TPD rate limiting.
 * Call this after inference completes to track token consumption.
 */
export function recordTokenUsage(keyId: string, tokens: number): void {
  const bucket = getRateBucket(keyId);
  bucket.tpd += tokens;
}

// Periodic cleanup of stale buckets (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [keyId, bucket] of rateBuckets) {
    // Remove buckets idle for >1 hour
    if (now - bucket.rpmWindowStart > 3_600_000 && now - bucket.tpdWindowStart > 86_400_000) {
      rateBuckets.delete(keyId);
    }
  }
}, 10 * 60 * 1000).unref();

// =============================================================================
// Middleware
// =============================================================================

/**
 * Developer API Key authentication middleware.
 *
 * Extracts Bearer token, validates the developer key, enforces per-key
 * rate limits (RPM and TPD), and attaches the key record to the request.
 *
 * Usage:
 *   router.use(requireDeveloperKey);
 *   router.post('/inference', (req: DeveloperKeyRequest, res) => {
 *     const key = req.developerKey!;
 *     // key.community_id, key.rate_limit_rpm, etc.
 *   });
 */
export function requireDeveloperKey(
  req: DeveloperKeyRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header required: Bearer <api_key>' });
    return;
  }

  const token = authHeader.slice(7);

  // Quick format check before hitting DB
  if (!token.startsWith('lf_live_') && !token.startsWith('lf_test_')) {
    res.status(401).json({ error: 'Invalid API key format' });
    return;
  }

  // Validate key (DB lookup + HMAC verify via better-sqlite3 — synchronous)
  let result: ReturnType<typeof validateApiKey>;
  try {
    result = validateApiKey(token);
  } catch (err) {
    logger.error({ err }, 'Developer key validation error');
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  if (!result.valid || !result.keyRecord) {
    logger.warn(
      { reason: result.reason, keyPrefix: safeKeyPrefix(token) },
      'Developer key authentication failed',
    );
    res.status(401).json({ error: 'Invalid or revoked API key' });
    return;
  }

  const keyRecord = result.keyRecord;

  // --- Per-key RPM rate limiting ---
  const bucket = getRateBucket(keyRecord.id);
  bucket.rpm += 1;

  const rpmRemaining = Math.max(0, keyRecord.rate_limit_rpm - bucket.rpm);
  const rpmResetMs = bucket.rpmWindowStart + 60_000;

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', String(keyRecord.rate_limit_rpm));
  res.setHeader('X-RateLimit-Remaining', String(rpmRemaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(rpmResetMs / 1000)));

  if (bucket.rpm > keyRecord.rate_limit_rpm) {
    logger.warn(
      { keyId: keyRecord.id, rpm: bucket.rpm, limit: keyRecord.rate_limit_rpm },
      'Developer key RPM rate limit exceeded',
    );
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((rpmResetMs - Date.now()) / 1000),
    });
    return;
  }

  // --- Per-key TPD check (informational — enforcement after inference) ---
  if (bucket.tpd >= keyRecord.rate_limit_tpd) {
    logger.warn(
      { keyId: keyRecord.id, tpd: bucket.tpd, limit: keyRecord.rate_limit_tpd },
      'Developer key TPD rate limit exceeded',
    );
    res.status(429).json({
      error: 'Daily token limit exceeded',
      retryAfter: Math.ceil((startOfDay(Date.now()) + 86_400_000 - Date.now()) / 1000),
    });
    return;
  }

  // Attach key record to request
  req.developerKey = keyRecord;
  req.isSandboxKey = keyRecord.key_prefix.startsWith('lf_test_');

  // Update last_used_at (fire-and-forget)
  touchKeyUsage(keyRecord.id);

  next();
}
