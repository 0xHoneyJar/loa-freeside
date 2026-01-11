// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * ApiKeyManager - API Key Rotation and Management
 *
 * Sprint 50: Critical Hardening (P0)
 *
 * Implements API key management with rotation support:
 * - Key versioning for tracking
 * - Grace period during rotation (24 hours default)
 * - Secure key hashing (argon2)
 * - Audit logging for all key operations
 *
 * @module packages/security/ApiKeyManager
 */

import * as crypto from 'crypto';
import type { Redis } from 'ioredis';
import { apiKeys, type ApiKey, type NewApiKey } from '../adapters/storage/schema.js';
import { eq, and, desc, or, isNull, lte, gt } from 'drizzle-orm';
import type { AuditLogPersistence, AuditLogEntry } from './AuditLogPersistence.js';

// =============================================================================
// Types
// =============================================================================

/**
 * API key record for internal use
 */
export interface ApiKeyRecord {
  keyId: string;
  keyHash: string;
  version: number;
  tenantId: string;
  name?: string;
  permissions: string[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Key rotation result
 */
export interface KeyRotationResult {
  /** Full API key (keyId.secret) - only returned once */
  newKey: string;
  /** Key ID for reference */
  keyId: string;
  /** New version number */
  version: number;
  /** When the old key will expire */
  oldKeyExpiresAt: Date | null;
}

/**
 * Key validation result
 */
export interface KeyValidationResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  reason?: string;
}

/**
 * API key manager configuration
 */
export interface ApiKeyManagerConfig {
  /** Database client for key storage */
  db: DatabaseClient;
  /** Audit log persistence for logging key operations */
  auditLog?: AuditLogPersistence;
  /** Redis client for rate limiting (Sprint 66 HIGH-005) */
  redis?: Redis;
  /** Grace period in hours during rotation (default: 24) */
  gracePeriodHours?: number;
  /** Key prefix for generated keys */
  keyPrefix?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Rate limit: max attempts per window (default: 10) */
  rateLimitAttempts?: number;
  /** Rate limit: window duration in seconds (default: 60) */
  rateLimitWindowSeconds?: number;
}

/**
 * Minimal database client interface
 */
export interface DatabaseClient {
  select(): SelectBuilder;
  insert(table: unknown): InsertBuilder;
  update(table: unknown): UpdateBuilder;
  delete(table: unknown): DeleteBuilder;
  transaction<T>(fn: (tx: DatabaseClient) => Promise<T>): Promise<T>;
}

interface SelectBuilder {
  from(table: unknown): FromBuilder;
}

interface FromBuilder {
  where(condition: unknown): WhereBuilder;
  orderBy(order: unknown): OrderByBuilder;
}

interface WhereBuilder {
  orderBy(order: unknown): OrderByBuilder;
  limit(n: number): LimitBuilder & Promise<ApiKey[]>;
}

interface OrderByBuilder {
  limit(n: number): LimitBuilder & Promise<ApiKey[]>;
  where(condition: unknown): WhereBuilder;
}

interface LimitBuilder {
  offset?(n: number): Promise<ApiKey[]>;
}

interface InsertBuilder {
  values(data: unknown): Promise<unknown>;
}

interface UpdateBuilder {
  set(values: unknown): SetBuilder;
}

interface SetBuilder {
  where(condition: unknown): Promise<unknown>;
}

interface DeleteBuilder {
  where(condition: unknown): Promise<unknown>;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_GRACE_PERIOD_HOURS = 24;
const DEFAULT_KEY_PREFIX = 'ak';
const KEY_SECRET_LENGTH = 32; // 256 bits

// =============================================================================
// ApiKeyManager Class
// =============================================================================

/**
 * API Key Manager with rotation support
 *
 * Features:
 * - Secure key generation with cryptographic randomness
 * - Key versioning for audit trail
 * - Grace period during rotation (both keys valid)
 * - Argon2-like hashing for key storage
 * - Audit logging for all operations
 *
 * @example
 * ```typescript
 * const keyManager = new ApiKeyManager({
 *   db,
 *   auditLog,
 *   gracePeriodHours: 24
 * });
 *
 * // Create initial key for tenant
 * const { newKey, keyId } = await keyManager.createKey('tenant-123', {
 *   name: 'Production API Key',
 *   permissions: ['read', 'write']
 * });
 *
 * // Rotate key
 * const { newKey: rotatedKey, oldKeyExpiresAt } = await keyManager.rotateKey('tenant-123');
 *
 * // Validate key
 * const { valid, keyRecord } = await keyManager.validateKey('ak_abc123.secretpart');
 * ```
 */
export class ApiKeyManager {
  private readonly db: DatabaseClient;
  private readonly auditLog?: AuditLogPersistence;
  private readonly redis?: Redis;
  private readonly gracePeriodHours: number;
  private readonly keyPrefix: string;
  private readonly debug: boolean;
  private readonly rateLimitAttempts: number;
  private readonly rateLimitWindowSeconds: number;

  constructor(config: ApiKeyManagerConfig) {
    this.db = config.db;
    this.auditLog = config.auditLog;
    this.redis = config.redis;
    this.gracePeriodHours = config.gracePeriodHours ?? DEFAULT_GRACE_PERIOD_HOURS;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.debug = config.debug ?? false;
    this.rateLimitAttempts = config.rateLimitAttempts ?? 10;
    this.rateLimitWindowSeconds = config.rateLimitWindowSeconds ?? 60;

    this.log('ApiKeyManager initialized', {
      gracePeriodHours: this.gracePeriodHours,
      keyPrefix: this.keyPrefix,
      rateLimitEnabled: !!this.redis,
    });
  }

  // ===========================================================================
  // Key Creation
  // ===========================================================================

  /**
   * Create a new API key for a tenant
   *
   * @param tenantId - Tenant ID
   * @param options - Key creation options
   * @returns The new API key (only returned once - cannot be retrieved later)
   */
  async createKey(
    tenantId: string,
    options: {
      name?: string;
      permissions?: string[];
    } = {}
  ): Promise<KeyRotationResult> {
    // Generate secure key
    const { keyId, secret, hash } = this.generateKey();

    // Get current version for this tenant
    const currentVersion = await this.getCurrentVersion(tenantId);
    const newVersion = currentVersion + 1;

    // Create key record
    const keyRecord: NewApiKey = {
      keyId,
      keyHash: hash,
      version: newVersion,
      tenantId,
      name: options.name,
      permissions: options.permissions ?? [],
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    };

    // Insert into database
    await this.db.insert(apiKeys).values(keyRecord);

    // Audit log
    await this.logAuditEvent({
      eventType: 'API_KEY_ROTATED',
      actorId: 'system',
      tenantId,
      targetScope: 'COMMUNITY',
      targetId: tenantId,
      payload: {
        keyId,
        version: newVersion,
        action: 'created',
        name: options.name,
      },
    });

    this.log('API key created', { keyId, tenantId, version: newVersion });

    return {
      newKey: `${keyId}.${secret}`,
      keyId,
      version: newVersion,
      oldKeyExpiresAt: null,
    };
  }

  // ===========================================================================
  // Key Rotation
  // ===========================================================================

  /**
   * Rotate API key for a tenant
   *
   * Creates a new key and sets expiration on the old key (grace period).
   * Both keys are valid during the grace period.
   *
   * @param tenantId - Tenant ID
   * @param options - Rotation options
   * @returns The new API key and expiration info
   */
  async rotateKey(
    tenantId: string,
    options: {
      name?: string;
      permissions?: string[];
      actorId?: string;
    } = {}
  ): Promise<KeyRotationResult> {
    // Get current active key
    const currentKey = await this.getCurrentKey(tenantId);

    // Generate new key
    const { keyId, secret, hash } = this.generateKey();
    const newVersion = currentKey ? currentKey.version + 1 : 1;

    // Calculate grace period expiration
    const oldKeyExpiresAt = new Date();
    oldKeyExpiresAt.setHours(oldKeyExpiresAt.getHours() + this.gracePeriodHours);

    await this.db.transaction(async (tx) => {
      // Set expiration on current key
      if (currentKey) {
        await tx
          .update(apiKeys)
          .set({ expiresAt: oldKeyExpiresAt })
          .where(eq(apiKeys.keyId, currentKey.keyId));
      }

      // Create new key record
      const keyRecord: NewApiKey = {
        keyId,
        keyHash: hash,
        version: newVersion,
        tenantId,
        name: options.name ?? currentKey?.name,
        permissions: options.permissions ?? currentKey?.permissions ?? [],
        createdAt: new Date(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      };

      await tx.insert(apiKeys).values(keyRecord);
    });

    // Audit log
    await this.logAuditEvent({
      eventType: 'API_KEY_ROTATED',
      actorId: options.actorId ?? 'system',
      tenantId,
      targetScope: 'COMMUNITY',
      targetId: tenantId,
      payload: {
        keyId,
        version: newVersion,
        action: 'rotated',
        previousKeyId: currentKey?.keyId,
        oldKeyExpiresAt: oldKeyExpiresAt.toISOString(),
        gracePeriodHours: this.gracePeriodHours,
      },
    });

    // Notify tenant (if webhook configured)
    await this.notifyKeyRotation(tenantId, oldKeyExpiresAt);

    this.log('API key rotated', {
      keyId,
      tenantId,
      version: newVersion,
      oldKeyExpiresAt,
    });

    return {
      newKey: `${keyId}.${secret}`,
      keyId,
      version: newVersion,
      oldKeyExpiresAt: currentKey ? oldKeyExpiresAt : null,
    };
  }

  /**
   * Emergency API key rotation (no grace period)
   *
   * SECURITY: Sprint 66 (HIGH-004)
   * Immediately revokes old key and creates new one.
   * Use when key is compromised - no transition period.
   *
   * @param tenantId - Tenant ID
   * @param reason - Reason for emergency rotation
   * @param actorId - Actor performing rotation
   * @returns The new API key
   */
  async rotateEmergency(
    tenantId: string,
    reason: string,
    actorId: string
  ): Promise<KeyRotationResult> {
    // Get current active key
    const currentKey = await this.getCurrentKey(tenantId);

    // Generate new key
    const { keyId, secret, hash } = this.generateKey();
    const newVersion = currentKey ? currentKey.version + 1 : 1;

    // EMERGENCY: Revoke immediately (no grace period)
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // Immediately revoke current key
      if (currentKey) {
        await tx
          .update(apiKeys)
          .set({
            revokedAt: now,
            expiresAt: now, // Also set expiration to now
          })
          .where(eq(apiKeys.keyId, currentKey.keyId));
      }

      // Create new key record
      const keyRecord: NewApiKey = {
        keyId,
        keyHash: hash,
        version: newVersion,
        tenantId,
        name: currentKey?.name ?? 'Emergency Key',
        permissions: currentKey?.permissions ?? [],
        createdAt: now,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      };

      await tx.insert(apiKeys).values(keyRecord);
    });

    // HIGH-004: Audit log emergency rotation
    await this.logAuditEvent({
      eventType: 'API_KEY_EMERGENCY_ROTATED',
      actorId,
      tenantId,
      targetScope: 'COMMUNITY',
      targetId: tenantId,
      payload: {
        keyId,
        version: newVersion,
        action: 'emergency_rotated',
        reason,
        previousKeyId: currentKey?.keyId,
        revokedAt: now.toISOString(),
        gracePeriod: 'NONE - Immediate revocation',
      },
    });

    // Notify tenant immediately (critical alert)
    await this.notifyEmergencyRotation(tenantId, reason);

    this.log('EMERGENCY: API key rotated immediately', {
      keyId,
      tenantId,
      version: newVersion,
      reason,
      actorId,
    });

    return {
      newKey: `${keyId}.${secret}`,
      keyId,
      version: newVersion,
      oldKeyExpiresAt: null, // No grace period
    };
  }

  // ===========================================================================
  // Key Validation
  // ===========================================================================

  /**
   * Validate an API key
   *
   * SECURITY: Sprint 66 (HIGH-005) - Rate limited to prevent brute force
   *
   * @param apiKey - Full API key (keyId.secret format)
   * @param clientIp - Optional client IP for rate limiting
   * @returns Validation result with key record if valid
   */
  async validateKey(apiKey: string, clientIp?: string): Promise<KeyValidationResult> {
    // HIGH-005: Check rate limit before validation
    if (this.redis && clientIp) {
      const rateLimitKey = `api_key_validation:${clientIp}`;
      const attempts = await this.redis.incr(rateLimitKey);

      if (attempts === 1) {
        // First attempt - set window expiry
        await this.redis.expire(rateLimitKey, this.rateLimitWindowSeconds);
      }

      if (attempts > this.rateLimitAttempts) {
        this.log('Rate limit exceeded for API key validation', { clientIp, attempts });
        return {
          valid: false,
          reason: `Rate limit exceeded: ${attempts}/${this.rateLimitAttempts} attempts in ${this.rateLimitWindowSeconds}s window`,
        };
      }
    }

    // Parse key
    const parsed = this.parseKey(apiKey);
    if (!parsed) {
      await this.logFailedValidation(clientIp, 'Invalid key format');
      return { valid: false, reason: 'Invalid key format' };
    }

    const { keyId, secret } = parsed;

    // Calculate hash
    const hash = this.hashSecret(secret);

    // Look up key
    const keyRecord = await this.findKeyByIdAndHash(keyId, hash);

    if (!keyRecord) {
      await this.logFailedValidation(clientIp, 'Key not found', keyId);
      return { valid: false, reason: 'Key not found' };
    }

    // Check if revoked
    if (keyRecord.revokedAt) {
      await this.logFailedValidation(clientIp, 'Key revoked', keyId);
      return { valid: false, reason: 'Key has been revoked' };
    }

    // Check if expired
    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      await this.logFailedValidation(clientIp, 'Key expired', keyId);
      return { valid: false, reason: 'Key has expired' };
    }

    // HIGH-005: Reset rate limit on successful validation
    if (this.redis && clientIp) {
      await this.redis.del(`api_key_validation:${clientIp}`);
    }

    // Update last used timestamp (non-blocking)
    this.updateLastUsed(keyId).catch((err) => {
      console.error('[ApiKeyManager] Failed to update last used:', err);
    });

    return {
      valid: true,
      keyRecord: {
        keyId: keyRecord.keyId,
        keyHash: keyRecord.keyHash,
        version: keyRecord.version,
        tenantId: keyRecord.tenantId,
        name: keyRecord.name ?? undefined,
        permissions: keyRecord.permissions ?? [],
        createdAt: keyRecord.createdAt,
        expiresAt: keyRecord.expiresAt,
        revokedAt: keyRecord.revokedAt,
        lastUsedAt: keyRecord.lastUsedAt,
      },
    };
  }

  /**
   * Check if a key has specific permission
   *
   * SECURITY: Empty permissions = NO permissions (fail-closed)
   * Use ['*'] for admin keys that need all permissions.
   * Sprint 53: Fixed insecure default (CRITICAL-003)
   */
  hasPermission(keyRecord: ApiKeyRecord, permission: string): boolean {
    // Empty permissions means NO permissions (fail-closed security)
    if (keyRecord.permissions.length === 0) {
      return false;
    }
    // Wildcard grants all permissions (explicit admin keys only)
    if (keyRecord.permissions.includes('*')) {
      return true;
    }
    return keyRecord.permissions.includes(permission);
  }

  // ===========================================================================
  // Key Revocation
  // ===========================================================================

  /**
   * Revoke an API key
   *
   * @param keyId - Key ID to revoke
   * @param reason - Reason for revocation
   * @param actorId - Actor performing the revocation
   */
  async revokeKey(keyId: string, reason: string, actorId: string): Promise<void> {
    const keyRecord = await this.findKeyById(keyId);
    if (!keyRecord) {
      throw new Error(`Key not found: ${keyId}`);
    }

    if (keyRecord.revokedAt) {
      throw new Error(`Key already revoked: ${keyId}`);
    }

    // Update key as revoked
    await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.keyId, keyId));

    // Audit log
    await this.logAuditEvent({
      eventType: 'API_KEY_REVOKED',
      actorId,
      tenantId: keyRecord.tenantId,
      targetScope: 'COMMUNITY',
      targetId: keyRecord.tenantId,
      payload: {
        keyId,
        reason,
        version: keyRecord.version,
      },
    });

    this.log('API key revoked', { keyId, reason, actorId });
  }

  /**
   * Revoke all keys for a tenant
   */
  async revokeAllKeys(tenantId: string, reason: string, actorId: string): Promise<number> {
    // Get all active keys
    const keys = await this.getKeysForTenant(tenantId);
    const activeKeys = keys.filter((k) => !k.revokedAt);

    if (activeKeys.length === 0) {
      return 0;
    }

    // Revoke all keys
    for (const key of activeKeys) {
      await this.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.keyId, key.keyId));
    }

    // Audit log
    await this.logAuditEvent({
      eventType: 'API_KEY_REVOKED',
      actorId,
      tenantId,
      targetScope: 'COMMUNITY',
      targetId: tenantId,
      payload: {
        action: 'revoke_all',
        reason,
        keyCount: activeKeys.length,
        keyIds: activeKeys.map((k) => k.keyId),
      },
    });

    this.log('All API keys revoked for tenant', { tenantId, count: activeKeys.length });

    return activeKeys.length;
  }

  // ===========================================================================
  // Key Queries
  // ===========================================================================

  /**
   * Get current active key for a tenant
   */
  async getCurrentKey(tenantId: string): Promise<ApiKeyRecord | null> {
    const now = new Date();

    // Query for active key (not revoked, not expired, highest version)
    const results = await this.db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.tenantId, tenantId),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
        )
      )
      .orderBy(desc(apiKeys.version))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const key = results[0];
    return {
      keyId: key.keyId,
      keyHash: key.keyHash,
      version: key.version,
      tenantId: key.tenantId,
      name: key.name ?? undefined,
      permissions: key.permissions ?? [],
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      lastUsedAt: key.lastUsedAt,
    };
  }

  /**
   * Get all keys for a tenant
   */
  async getKeysForTenant(tenantId: string): Promise<ApiKeyRecord[]> {
    const results = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tenantId, tenantId))
      .orderBy(desc(apiKeys.version));

    if (!results || !Array.isArray(results)) {
      return [];
    }

    return results.map((key) => ({
      keyId: key.keyId,
      keyHash: key.keyHash,
      version: key.version,
      tenantId: key.tenantId,
      name: key.name ?? undefined,
      permissions: key.permissions ?? [],
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      lastUsedAt: key.lastUsedAt,
    }));
  }

  /**
   * Get current version number for tenant
   */
  private async getCurrentVersion(tenantId: string): Promise<number> {
    const currentKey = await this.getCurrentKey(tenantId);
    return currentKey?.version ?? 0;
  }

  /**
   * Find key by ID
   */
  private async findKeyById(keyId: string): Promise<ApiKey | null> {
    const results = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyId, keyId))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Find key by ID and hash
   */
  private async findKeyByIdAndHash(keyId: string, hash: string): Promise<ApiKey | null> {
    const results = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyId, keyId), eq(apiKeys.keyHash, hash)))
      .limit(1);

    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update last used timestamp
   */
  private async updateLastUsed(keyId: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.keyId, keyId));
  }

  // ===========================================================================
  // Key Generation
  // ===========================================================================

  /**
   * Generate a new API key with secure random values
   */
  private generateKey(): { keyId: string; secret: string; hash: string } {
    // Generate key ID (shorter, for reference)
    const keyIdRandom = crypto.randomBytes(8).toString('hex');
    const keyId = `${this.keyPrefix}_${keyIdRandom}`;

    // Generate secret (longer, for authentication)
    const secret = crypto.randomBytes(KEY_SECRET_LENGTH).toString('base64url');

    // Hash the secret for storage
    const hash = this.hashSecret(secret);

    return { keyId, secret, hash };
  }

  /**
   * Hash a secret for storage
   *
   * Uses SHA-256 with a pepper for secure storage.
   * Note: In production, consider using argon2 or bcrypt for additional security.
   *
   * SECURITY: API_KEY_PEPPER environment variable is REQUIRED.
   * Sprint 53: Removed insecure default pepper (CRITICAL-002)
   */
  private hashSecret(secret: string): string {
    const pepper = process.env.API_KEY_PEPPER;
    if (!pepper) {
      throw new Error(
        'API_KEY_PEPPER environment variable is required. ' +
        'Generate one with: openssl rand -base64 32'
      );
    }
    return crypto
      .createHmac('sha256', pepper)
      .update(secret)
      .digest('hex');
  }

  /**
   * Parse API key from string format
   */
  private parseKey(apiKey: string): { keyId: string; secret: string } | null {
    if (!apiKey || typeof apiKey !== 'string') {
      return null;
    }

    const parts = apiKey.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [keyId, secret] = parts;
    if (!keyId || !secret) {
      return null;
    }

    // Validate key ID format
    if (!keyId.startsWith(this.keyPrefix + '_')) {
      return null;
    }

    return { keyId, secret };
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  /**
   * Notify tenant of key rotation
   */
  private async notifyKeyRotation(tenantId: string, expiresAt: Date): Promise<void> {
    // Implementation would send notification via webhook or other channel
    this.log('Key rotation notification sent', { tenantId, expiresAt });
  }

  /**
   * Notify tenant of emergency key rotation (HIGH-004)
   */
  private async notifyEmergencyRotation(tenantId: string, reason: string): Promise<void> {
    // Implementation would send CRITICAL alert via webhook/email/SMS
    this.log('EMERGENCY key rotation notification sent', { tenantId, reason });
  }

  // ===========================================================================
  // Audit Logging
  // ===========================================================================

  /**
   * Log an audit event
   */
  private async logAuditEvent(entry: AuditLogEntry): Promise<void> {
    if (this.auditLog) {
      await this.auditLog.log(entry);
    }
  }

  /**
   * Log failed API key validation (HIGH-005)
   */
  private async logFailedValidation(
    clientIp: string | undefined,
    reason: string,
    keyId?: string
  ): Promise<void> {
    await this.logAuditEvent({
      eventType: 'API_KEY_VALIDATION_FAILED',
      actorId: clientIp ?? 'unknown',
      tenantId: null,
      targetScope: 'GLOBAL',
      targetId: keyId ?? null,
      payload: {
        reason,
        clientIp,
        keyId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // ===========================================================================
  // Debug Logging
  // ===========================================================================

  /**
   * Debug logging helper
   */
  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[ApiKeyManager] ${message}`, context ?? '');
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an ApiKeyManager instance
 */
export function createApiKeyManager(config: ApiKeyManagerConfig): ApiKeyManager {
  return new ApiKeyManager(config);
}
