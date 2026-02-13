/**
 * BYOK Manager — Bring Your Own Key Management
 * Sprint 3, Task 3.2: Envelope encryption, LRU cache, circuit breaker
 *
 * Manages community provider API keys with envelope encryption:
 * - Generate DEK → AES-256-GCM encrypt key → KMS wrap DEK
 * - In-process LRU cache for decrypted keys (60s TTL, 100 max)
 * - KMS circuit breaker (3 failures/30s → open 60s → fail-closed)
 *
 * @see SDD §3.4.2 BYOK Manager
 * @see PRD FR-4 BYOK Key Management
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import { RedisCircuitBreaker } from './redis-circuit-breaker.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** KMS adapter interface — abstracts AWS KMS or mock */
export interface KMSAdapter {
  /** Encrypt a DEK with the master key */
  encrypt(plaintext: Buffer): Promise<Buffer>;
  /** Decrypt a wrapped DEK */
  decrypt(ciphertext: Buffer): Promise<Buffer>;
}

/** Database adapter for BYOK key storage */
export interface BYOKStore {
  /** Insert a new key record */
  insert(record: BYOKKeyRecord): Promise<void>;
  /** Find active (non-revoked) key for community+provider */
  findActive(communityId: string, provider: string): Promise<BYOKKeyRecord | null>;
  /** List all keys for a community (active + revoked) */
  listByCommunity(communityId: string): Promise<BYOKKeyRecord[]>;
  /** Mark a key as revoked */
  revoke(id: string): Promise<void>;
  /** Atomically revoke old key and insert new key (for rotation) */
  rotateAtomic(revokeId: string, newRecord: BYOKKeyRecord): Promise<void>;
}

/** Database record shape */
export interface BYOKKeyRecord {
  id: string;
  communityId: string;
  provider: string;
  keyCiphertext: Buffer;
  keyNonce: Buffer;
  dekCiphertext: Buffer;
  keyLast4: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
  revokedAt?: Date | null;
}

/** Public key info (safe to return to clients) */
export interface BYOKKeyInfo {
  id: string;
  provider: string;
  keyLast4: string;
  createdAt: Date;
  revokedAt: Date | null;
}

/** BYOK Manager configuration */
export interface BYOKManagerConfig {
  /** LRU cache max entries (default: 100) */
  cacheMaxSize?: number;
  /** LRU cache TTL in ms (default: 60_000) */
  cacheTtlMs?: number;
  /** Circuit breaker failure threshold (default: 3) */
  cbFailureThreshold?: number;
  /** Circuit breaker window in ms (default: 30_000) */
  cbWindowMs?: number;
  /** Circuit breaker reset timeout in ms (default: 60_000) */
  cbResetMs?: number;
}

// --------------------------------------------------------------------------
// LRU Cache with Buffer wipe on eviction
// --------------------------------------------------------------------------

interface CacheEntry {
  key: Buffer;
  expiresAt: number;
}

class SecureLRUCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(cacheKey: string): Buffer | null {
    const entry = this.map.get(cacheKey);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.evict(cacheKey);
      return null;
    }

    // Move to end (most recently used)
    this.map.delete(cacheKey);
    this.map.set(cacheKey, entry);
    return entry.key;
  }

  set(cacheKey: string, key: Buffer): void {
    // Evict if at capacity
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value!;
      this.evict(oldest);
    }

    // Evict existing entry if present
    if (this.map.has(cacheKey)) {
      this.evict(cacheKey);
    }

    this.map.set(cacheKey, {
      key: Buffer.from(key), // Copy to prevent external mutation
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Wipe key material and remove entry */
  private evict(cacheKey: string): void {
    const entry = this.map.get(cacheKey);
    if (entry) {
      entry.key.fill(0); // Zero out key material (AC-4.15)
      this.map.delete(cacheKey);
    }
  }

  /** Wipe all entries */
  clear(): void {
    for (const [key] of this.map) {
      this.evict(key);
    }
  }
}

// --------------------------------------------------------------------------
// BYOK Manager
// --------------------------------------------------------------------------

export class BYOKManager {
  private readonly kms: KMSAdapter;
  private readonly store: BYOKStore;
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly cache: SecureLRUCache;
  private readonly cb: RedisCircuitBreaker;

  constructor(
    kms: KMSAdapter,
    store: BYOKStore,
    redis: Redis,
    logger: Logger,
    config?: BYOKManagerConfig,
  ) {
    this.kms = kms;
    this.store = store;
    this.redis = redis;
    this.logger = logger;
    this.cache = new SecureLRUCache(
      config?.cacheMaxSize ?? 100,
      config?.cacheTtlMs ?? 60_000,
    );
    this.cb = new RedisCircuitBreaker(redis, 'kms', logger, {
      failureThreshold: config?.cbFailureThreshold ?? 3,
      windowMs: config?.cbWindowMs ?? 30_000,
      resetMs: config?.cbResetMs ?? 60_000,
    });
  }

  /**
   * Store a new API key with envelope encryption.
   * 1. Generate random DEK (32 bytes)
   * 2. Encrypt key with DEK (AES-256-GCM)
   * 3. Wrap DEK with KMS master key
   * 4. Store ciphertext + wrapped DEK in database
   * 5. Set Redis routing flag
   */
  async storeKey(
    communityId: string,
    provider: string,
    apiKey: Buffer,
    createdBy: string,
  ): Promise<BYOKKeyInfo> {
    await this.assertCircuitClosed('storeKey');

    // Generate DEK
    const dek = randomBytes(32);
    const nonce = randomBytes(12);

    try {
      // Encrypt API key with DEK (AES-256-GCM)
      const cipher = createCipheriv('aes-256-gcm', dek, nonce);
      const encrypted = Buffer.concat([cipher.update(apiKey), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const keyCiphertext = Buffer.concat([encrypted, authTag]); // ciphertext || 16-byte auth tag

      // Wrap DEK with KMS
      const dekCiphertext = await this.kmsEncrypt(dek);

      // Extract last 4 chars for display (from original key)
      const keyLast4 = apiKey.subarray(-4).toString('utf8');

      // Zero out DEK and plaintext key immediately
      dek.fill(0);
      apiKey.fill(0);

      const id = crypto.randomUUID();
      const record: BYOKKeyRecord = {
        id,
        communityId,
        provider,
        keyCiphertext,
        keyNonce: nonce,
        dekCiphertext,
        keyLast4,
        createdBy,
      };

      await this.store.insert(record);

      // Set Redis routing flag
      await this.redis.set(`agent:byok:exists:${communityId}:${provider}`, '1');

      this.logger.info({ communityId, provider, keyId: id }, 'BYOK key stored');

      return {
        id,
        provider,
        keyLast4,
        createdAt: new Date(),
        revokedAt: null,
      };
    } catch (err) {
      dek.fill(0);
      apiKey.fill(0);
      throw err;
    }
  }

  /**
   * Decrypt and return the API key for a community+provider.
   * Checks in-process LRU cache first, then decrypts from DB.
   */
  async getDecryptedKey(communityId: string, provider: string): Promise<Buffer | null> {
    const cacheKey = `${communityId}:${provider}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) return Buffer.from(cached); // Return copy

    // Load from DB
    const record = await this.store.findActive(communityId, provider);
    if (!record) return null;

    // Decrypt DEK via KMS
    const dek = await this.kmsDecrypt(record.dekCiphertext);

    try {
      // Decrypt API key with DEK
      const authTagStart = record.keyCiphertext.length - 16;
      const encrypted = record.keyCiphertext.subarray(0, authTagStart);
      const authTag = record.keyCiphertext.subarray(authTagStart);

      const decipher = createDecipheriv('aes-256-gcm', dek, record.keyNonce);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      // Cache the decrypted key
      this.cache.set(cacheKey, decrypted);

      // Zero out DEK
      dek.fill(0);

      return decrypted;
    } catch (err) {
      dek.fill(0);
      throw err;
    }
  }

  /**
   * List keys for a community (returns only safe info, never plaintext).
   * AC-4.3: Only last 4 chars of key returned.
   */
  async listKeys(communityId: string): Promise<BYOKKeyInfo[]> {
    const records = await this.store.listByCommunity(communityId);
    return records.map((r) => ({
      id: r.id,
      provider: r.provider,
      keyLast4: r.keyLast4,
      createdAt: r.createdAt ?? new Date(),
      revokedAt: r.revokedAt ?? null,
    }));
  }

  /**
   * Revoke a key (soft delete).
   * Clears cache and Redis routing flag.
   */
  async revokeKey(communityId: string, keyId: string): Promise<void> {
    const records = await this.store.listByCommunity(communityId);
    const record = records.find((r) => r.id === keyId);
    if (!record) throw new BYOKManagerError('KEY_NOT_FOUND', 'Key not found', 404);

    await this.store.revoke(keyId);

    // Clear cache and Redis routing flag
    this.cache.clear(); // Conservative: clear all to avoid stale entries
    await this.redis.del(`agent:byok:exists:${communityId}:${record.provider}`);

    this.logger.info({ communityId, keyId, provider: record.provider }, 'BYOK key revoked');
  }

  /**
   * Rotate a key atomically: revoke old + store new in single transaction.
   * AC-4.9: Atomic rotation (new DEK, old key invalidated).
   */
  async rotateKey(
    communityId: string,
    keyId: string,
    newApiKey: Buffer,
    createdBy: string,
  ): Promise<BYOKKeyInfo> {
    await this.assertCircuitClosed('rotateKey');

    // Verify old key exists and get provider
    const records = await this.store.listByCommunity(communityId);
    const oldRecord = records.find((r) => r.id === keyId && r.revokedAt == null);
    if (!oldRecord) throw new BYOKManagerError('KEY_NOT_FOUND', 'Active key not found', 404);

    // Generate new DEK and encrypt new key
    const dek = randomBytes(32);
    const nonce = randomBytes(12);

    try {
      const cipher = createCipheriv('aes-256-gcm', dek, nonce);
      const encrypted = Buffer.concat([cipher.update(newApiKey), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const keyCiphertext = Buffer.concat([encrypted, authTag]);

      const dekCiphertext = await this.kmsEncrypt(dek);
      const keyLast4 = newApiKey.subarray(-4).toString('utf8');

      dek.fill(0);
      newApiKey.fill(0);

      const newId = crypto.randomUUID();
      const newRecord: BYOKKeyRecord = {
        id: newId,
        communityId,
        provider: oldRecord.provider,
        keyCiphertext,
        keyNonce: nonce,
        dekCiphertext,
        keyLast4,
        createdBy,
      };

      // Atomic rotation: revoke old + insert new
      await this.store.rotateAtomic(keyId, newRecord);

      // Clear cache (old key evicted, new key will be cached on next access)
      this.cache.clear();

      this.logger.info(
        { communityId, oldKeyId: keyId, newKeyId: newId, provider: oldRecord.provider },
        'BYOK key rotated',
      );

      return {
        id: newId,
        provider: oldRecord.provider,
        keyLast4,
        createdAt: new Date(),
        revokedAt: null,
      };
    } catch (err) {
      dek.fill(0);
      newApiKey.fill(0);
      throw err;
    }
  }

  /**
   * Fast check if a community has a BYOK key for a provider (Redis-backed).
   */
  async hasBYOKKey(communityId: string, provider: string): Promise<boolean> {
    const exists = await this.redis.exists(`agent:byok:exists:${communityId}:${provider}`);
    return exists === 1;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private async kmsEncrypt(plaintext: Buffer): Promise<Buffer> {
    if (!(await this.cb.isAllowed())) {
      throw new BYOKManagerError('KMS_CIRCUIT_OPEN', 'KMS circuit breaker is open', 503);
    }

    try {
      const result = await this.kms.encrypt(plaintext);
      await this.cb.onSuccess();
      return result;
    } catch (err) {
      await this.cb.onFailure();
      const state = await this.cb.getState();
      this.logger.error({ err, state }, 'KMS encrypt failed');
      throw err;
    }
  }

  private async kmsDecrypt(ciphertext: Buffer): Promise<Buffer> {
    if (!(await this.cb.isAllowed())) {
      throw new BYOKManagerError('KMS_CIRCUIT_OPEN', 'KMS circuit breaker is open', 503);
    }

    try {
      const result = await this.kms.decrypt(ciphertext);
      await this.cb.onSuccess();
      return result;
    } catch (err) {
      await this.cb.onFailure();
      const state = await this.cb.getState();
      this.logger.error({ err, state }, 'KMS decrypt failed');
      throw err;
    }
  }

  private async assertCircuitClosed(operation: string): Promise<void> {
    if (!(await this.cb.isAllowed())) {
      throw new BYOKManagerError(
        'KMS_CIRCUIT_OPEN',
        `KMS circuit breaker is open — ${operation} rejected (fail-closed)`,
        503,
      );
    }
  }
}

// --------------------------------------------------------------------------
// Error
// --------------------------------------------------------------------------

export class BYOKManagerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BYOKManagerError';
  }
}
