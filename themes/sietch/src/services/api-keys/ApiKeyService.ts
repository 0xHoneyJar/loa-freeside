/**
 * Developer API Key Service — Generation, Validation, and Lifecycle
 * Sprint 6 (319), Task 6.1: API Key Generation + Storage
 *
 * Two-part key format:
 *   lf_live_<12-char base32 prefix>_<32-char base62 secret>
 *   lf_test_<12-char base32 prefix>_<32-char base62 secret>
 *
 * Storage:
 *   key_prefix  = "lf_live_" + base32 portion (used for DB lookup)
 *   key_salt    = random 16-byte hex (per-key)
 *   key_hash    = HMAC-SHA256(PEPPER, salt || secret)
 *   pepper_version = integer tracking which pepper version was used
 *
 * Security:
 *   - Cleartext shown exactly once at creation (never stored or logged)
 *   - Per-key salt prevents rainbow tables even if pepper leaks
 *   - Negative cache for failed prefix lookups (rate-limit invalid key attempts)
 *   - timingSafeEqual for hash comparison
 *
 * SDD refs: §2.2 API Key Authentication
 * PRD refs: FR-5.1 Developer API Access
 *
 * @module services/api-keys/ApiKeyService
 */

import * as crypto from 'crypto';
import { getDatabase } from '../../db/connection.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

/** Base32 alphabet (RFC 4648, no padding) */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base62 alphabet (alphanumeric) */
const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Prefix for live (production) keys */
const LIVE_PREFIX = 'lf_live_';

/** Prefix for test (sandbox) keys */
const TEST_PREFIX = 'lf_test_';

/** Length of the base32 identifier portion */
const PREFIX_ID_LENGTH = 12;

/** Length of the base62 secret portion */
const SECRET_LENGTH = 32;

/** Per-key salt length in bytes (stored as 32-char hex) */
const SALT_BYTES = 16;

/** Maximum active keys per user */
const MAX_ACTIVE_KEYS_PER_USER = 10;

/** Negative cache TTL in milliseconds (5 minutes) */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum negative cache entries before eviction */
const NEGATIVE_CACHE_MAX_SIZE = 10_000;

// =============================================================================
// Types
// =============================================================================

export interface ApiKeyCreateParams {
  userId: string;
  communityId: string;
  name?: string;
  mode: 'live' | 'test';
  /** Custom rate limit: requests per minute */
  rateLimitRpm?: number;
  /** Custom rate limit: tokens per day */
  rateLimitTpd?: number;
}

export interface ApiKeyCreateResult {
  /** Internal database ID */
  id: string;
  /** Full cleartext key — shown exactly once */
  cleartext: string;
  /** The prefix portion for display/identification */
  keyPrefix: string;
  /** Human-readable name */
  name: string;
  /** Key mode (live/test) */
  mode: 'live' | 'test';
  /** Creation timestamp */
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  community_id: string;
  key_prefix: string;
  key_hash: string;
  key_salt: string;
  pepper_version: number;
  name: string;
  scopes: string;
  rate_limit_rpm: number;
  rate_limit_tpd: number;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  reason?: string;
}

export interface ApiKeyListItem {
  id: string;
  keyPrefix: string;
  name: string;
  mode: 'live' | 'test';
  rateLimitRpm: number;
  rateLimitTpd: number;
  lastUsedAt: string | null;
  createdAt: string;
}

// =============================================================================
// Negative Cache — prevents repeated DB lookups for invalid prefixes
// =============================================================================

const negativePrefixCache = new Map<string, number>();

function isNegativelyCached(prefix: string): boolean {
  const cachedAt = negativePrefixCache.get(prefix);
  if (!cachedAt) return false;
  if (Date.now() - cachedAt > NEGATIVE_CACHE_TTL_MS) {
    negativePrefixCache.delete(prefix);
    return false;
  }
  return true;
}

function addToNegativeCache(prefix: string): void {
  // Evict oldest entries if cache is full
  if (negativePrefixCache.size >= NEGATIVE_CACHE_MAX_SIZE) {
    const oldest = negativePrefixCache.entries().next().value;
    if (oldest) negativePrefixCache.delete(oldest[0]);
  }
  negativePrefixCache.set(prefix, Date.now());
}

/** Clear negative cache entry when a new key is created with this prefix */
function clearNegativeCache(prefix: string): void {
  negativePrefixCache.delete(prefix);
}

// =============================================================================
// Key Generation Helpers
// =============================================================================

/**
 * Generate a random string from a given alphabet using crypto.randomBytes.
 * Rejection sampling to avoid modulo bias.
 */
function randomFromAlphabet(length: number, alphabet: string): string {
  const maxByte = 256 - (256 % alphabet.length);
  const result: string[] = [];

  while (result.length < length) {
    const bytes = crypto.randomBytes(length * 2); // over-provision for rejection
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      const b = bytes[i]!;
      if (b < maxByte) {
        result.push(alphabet[b % alphabet.length]!);
      }
    }
  }

  return result.join('');
}

/**
 * Generate the two-part key:
 *   prefix: lf_live_<12 base32 chars>  (or lf_test_)
 *   secret: <32 base62 chars>
 *   cleartext: prefix + "_" + secret
 */
function generateKeyParts(mode: 'live' | 'test'): {
  fullPrefix: string;
  secret: string;
  cleartext: string;
} {
  const modePrefix = mode === 'live' ? LIVE_PREFIX : TEST_PREFIX;
  const prefixId = randomFromAlphabet(PREFIX_ID_LENGTH, BASE32_ALPHABET);
  const secret = randomFromAlphabet(SECRET_LENGTH, BASE62_ALPHABET);

  const fullPrefix = `${modePrefix}${prefixId}`;
  const cleartext = `${fullPrefix}_${secret}`;

  return { fullPrefix, secret, cleartext };
}

/**
 * Generate per-key salt (16 random bytes → 32-char hex).
 */
function generateSalt(): string {
  return crypto.randomBytes(SALT_BYTES).toString('hex');
}

/**
 * Compute HMAC-SHA256(pepper, salt || secret) → hex digest.
 */
function computeKeyHash(pepper: string, salt: string, secret: string): string {
  return crypto
    .createHmac('sha256', pepper)
    .update(salt + secret)
    .digest('hex');
}

/**
 * Get current pepper and version from environment.
 * Returns { pepper, version }.
 */
function getCurrentPepper(): { pepper: string; version: number } {
  // Check versioned peppers first (API_KEY_PEPPER_V2, V1, etc.) — highest is primary
  for (let v = 10; v >= 1; v--) {
    const envVar = `API_KEY_PEPPER_V${v}`;
    const pepper = process.env[envVar];
    if (pepper && pepper !== 'CHANGE_ME_IN_PRODUCTION') {
      return { pepper, version: v };
    }
  }

  // Fall back to primary pepper
  const pepper = process.env.API_KEY_PEPPER;
  if (pepper && pepper !== 'CHANGE_ME_IN_PRODUCTION') {
    return { pepper, version: 1 };
  }

  // Development fallback
  if (process.env.NODE_ENV !== 'production') {
    return { pepper: 'CHANGE_ME_IN_PRODUCTION', version: 0 };
  }

  throw new Error('No API_KEY_PEPPER configured. Cannot create or validate API keys.');
}

// =============================================================================
// API Key Service
// =============================================================================

/**
 * Create a new developer API key.
 *
 * Returns the cleartext key exactly once — it is never stored or logged.
 */
export function createApiKey(params: ApiKeyCreateParams): ApiKeyCreateResult {
  const db = getDatabase();
  const { userId, communityId, name = 'Default', mode, rateLimitRpm, rateLimitTpd } = params;

  // Enforce max active keys per user
  const activeCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM api_keys
     WHERE user_id = ? AND is_active = 1 AND revoked_at IS NULL`,
  ).get(userId) as { cnt: number };

  if (activeCount.cnt >= MAX_ACTIVE_KEYS_PER_USER) {
    throw new ApiKeyLimitError(
      `Maximum ${MAX_ACTIVE_KEYS_PER_USER} active API keys per user. Revoke unused keys first.`,
    );
  }

  // Insert with retry on UNIQUE constraint collision (rare but possible)
  const rpm = rateLimitRpm ?? (mode === 'test' ? 10 : 60);
  const tpd = rateLimitTpd ?? (mode === 'test' ? 10_000 : 100_000);

  const stmt = db.prepare(`
    INSERT INTO api_keys (user_id, community_id, key_prefix, key_hash, key_salt,
                          pepper_version, name, rate_limit_rpm, rate_limit_tpd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const { pepper, version: pepperVersion } = getCurrentPepper();
  const MAX_COLLISION_RETRIES = 5;

  let result: ReturnType<typeof stmt.run> | null = null;
  let fullPrefix = '';
  let cleartext = '';

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const parts = generateKeyParts(mode);
    fullPrefix = parts.fullPrefix;
    cleartext = parts.cleartext;
    const salt = generateSalt();
    const keyHash = computeKeyHash(pepper, salt, parts.secret);

    try {
      result = stmt.run(
        userId, communityId, fullPrefix, keyHash, salt,
        pepperVersion, name, rpm, tpd,
      );
      break;
    } catch (err: unknown) {
      const msg = String((err as Error)?.message || '');
      if (msg.includes('UNIQUE constraint failed: api_keys.key_prefix')) {
        continue;
      }
      throw err;
    }
  }

  if (!result) {
    throw new Error('Failed to generate unique API key prefix after multiple attempts.');
  }

  // Get the inserted record's ID
  const inserted = db.prepare(
    `SELECT id, created_at FROM api_keys WHERE rowid = ?`,
  ).get(result.lastInsertRowid) as { id: string; created_at: string };

  // Clear any negative cache for this prefix
  clearNegativeCache(fullPrefix);

  logger.info(
    { keyPrefix: fullPrefix, userId, communityId, mode, pepperVersion },
    'API key created',
  );

  return {
    id: inserted.id,
    cleartext,
    keyPrefix: fullPrefix,
    name,
    mode,
    createdAt: inserted.created_at,
  };
}

/**
 * Validate a cleartext API key.
 *
 * Parses the key format, looks up by prefix, computes HMAC and compares.
 * Uses negative cache for failed prefix lookups.
 */
export function validateApiKey(cleartextKey: string): ApiKeyValidationResult {
  // Parse key format: lf_live_<12 base32>_<32 base62>  or  lf_test_<12 base32>_<32 base62>
  const match = cleartextKey.match(
    /^(lf_(?:live|test)_[A-Z2-7]{12})_([A-Za-z0-9]{32})$/,
  );

  if (!match) {
    return { valid: false, reason: 'Invalid key format' };
  }

  const prefix = match[1]!;
  const secret = match[2]!;

  // Check negative cache
  if (isNegativelyCached(prefix)) {
    return { valid: false, reason: 'Unknown key' };
  }

  const db = getDatabase();
  const row = db.prepare(
    `SELECT * FROM api_keys WHERE key_prefix = ?`,
  ).get(prefix) as ApiKeyRecord | undefined;

  if (!row) {
    addToNegativeCache(prefix);
    return { valid: false, reason: 'Unknown key' };
  }

  // Check revocation / active status
  if (!row.is_active || row.revoked_at) {
    return { valid: false, reason: 'Key revoked' };
  }

  // Try stored pepper version first, then fall back to all versions
  const versionsToTry: Array<{ pepper: string; version: number }> = [];
  const DEV_FALLBACK_PEPPER = 'CHANGE_ME_IN_PRODUCTION';

  // Add stored version — version 0 means dev fallback was used at creation time
  const storedPepperEnv = row.pepper_version === 0
    ? (process.env.NODE_ENV !== 'production' ? DEV_FALLBACK_PEPPER : undefined)
    : process.env[`API_KEY_PEPPER_V${row.pepper_version}`] ?? process.env.API_KEY_PEPPER;

  if (storedPepperEnv) {
    versionsToTry.push({ pepper: storedPepperEnv, version: row.pepper_version });
  }

  // Add current pepper if different
  try {
    const current = getCurrentPepper();
    if (current.version !== row.pepper_version) {
      versionsToTry.push(current);
    }
  } catch {
    // No pepper available — skip
  }

  // Development fallback
  if (versionsToTry.length === 0 && process.env.NODE_ENV !== 'production') {
    versionsToTry.push({ pepper: 'CHANGE_ME_IN_PRODUCTION', version: 0 });
  }

  for (const { pepper } of versionsToTry) {
    const candidateHash = computeKeyHash(pepper, row.key_salt, secret);

    // Constant-time comparison
    if (candidateHash.length === row.key_hash.length) {
      try {
        const matches = crypto.timingSafeEqual(
          Buffer.from(candidateHash, 'hex'),
          Buffer.from(row.key_hash, 'hex'),
        );
        if (matches) {
          return { valid: true, keyRecord: row };
        }
      } catch {
        // Length mismatch — continue
      }
    }
  }

  return { valid: false, reason: 'Invalid secret' };
}

/**
 * Update last_used_at for a key (fire-and-forget, non-blocking).
 */
export function touchKeyUsage(keyId: string): void {
  try {
    const db = getDatabase();
    db.prepare(
      `UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ).run(keyId);
  } catch (err) {
    logger.warn({ err, keyId }, 'Failed to update last_used_at');
  }
}

/**
 * List active API keys for a user (no secrets exposed).
 */
export function listApiKeys(userId: string): ApiKeyListItem[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT id, key_prefix, name, rate_limit_rpm, rate_limit_tpd,
            last_used_at, created_at
     FROM api_keys
     WHERE user_id = ? AND is_active = 1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
  ).all(userId) as Array<{
    id: string;
    key_prefix: string;
    name: string;
    rate_limit_rpm: number;
    rate_limit_tpd: number;
    last_used_at: string | null;
    created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    keyPrefix: r.key_prefix,
    name: r.name,
    mode: r.key_prefix.startsWith(TEST_PREFIX) ? 'test' as const : 'live' as const,
    rateLimitRpm: r.rate_limit_rpm,
    rateLimitTpd: r.rate_limit_tpd,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }));
}

/**
 * Revoke (soft-delete) an API key.
 * Returns true if the key was found and revoked, false if not found or already revoked.
 */
export function revokeApiKey(keyId: string, userId: string): boolean {
  const db = getDatabase();
  const result = db.prepare(
    `UPDATE api_keys
     SET is_active = 0,
         revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND is_active = 1 AND revoked_at IS NULL`,
  ).run(keyId, userId);

  if (result.changes > 0) {
    // Clear negative cache — the prefix is now invalid
    const row = db.prepare(`SELECT key_prefix FROM api_keys WHERE id = ?`).get(keyId) as
      | { key_prefix: string }
      | undefined;
    if (row) clearNegativeCache(row.key_prefix);

    logger.info({ keyId, userId }, 'API key revoked');
    return true;
  }

  return false;
}

/**
 * Rotate an API key: revoke the old one and create a new one with the same config.
 */
export function rotateApiKey(
  keyId: string,
  userId: string,
): ApiKeyCreateResult | null {
  const db = getDatabase();

  // Get existing key details
  const existing = db.prepare(
    `SELECT user_id, community_id, key_prefix, name, rate_limit_rpm, rate_limit_tpd
     FROM api_keys
     WHERE id = ? AND user_id = ? AND is_active = 1 AND revoked_at IS NULL`,
  ).get(keyId, userId) as {
    user_id: string;
    community_id: string;
    key_prefix: string;
    name: string;
    rate_limit_rpm: number;
    rate_limit_tpd: number;
  } | undefined;

  if (!existing) return null;

  // Determine mode from old prefix
  const mode = existing.key_prefix.startsWith(TEST_PREFIX) ? 'test' as const : 'live' as const;

  // Revoke old key
  revokeApiKey(keyId, userId);

  // Create new key with same config
  return createApiKey({
    userId: existing.user_id,
    communityId: existing.community_id,
    name: `${existing.name} (rotated)`,
    mode,
    rateLimitRpm: existing.rate_limit_rpm,
    rateLimitTpd: existing.rate_limit_tpd,
  });
}

/**
 * Get a key by ID (for admin viewing — no secret exposed).
 */
export function getApiKeyById(keyId: string): ApiKeyRecord | undefined {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(keyId) as
    | ApiKeyRecord
    | undefined;
}

// =============================================================================
// Error classes
// =============================================================================

export class ApiKeyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyLimitError';
  }
}
