/**
 * AdminApiKeyService - Bcrypt-based API Key Hashing and Validation
 *
 * Sprint 73: API Key Security (HIGH-1)
 *
 * Implements secure API key handling:
 * - Bcrypt hashing with 12 rounds (constant-time comparison)
 * - Async validation to prevent timing attacks
 * - Key hint generation for audit logs
 * - Migration support for existing plaintext keys
 *
 * @module services/security/AdminApiKeyService
 */

import bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Admin API key record
 */
export interface AdminApiKeyRecord {
  /** Key identifier (first 8 chars for logging) */
  keyHint: string;
  /** Bcrypt hash of the API key */
  keyHash: string;
  /** Admin name associated with the key */
  adminName: string;
  /** When the key was created */
  createdAt: Date;
  /** When the key expires (null = never) */
  expiresAt: Date | null;
}

/**
 * Key validation result
 */
export interface AdminKeyValidationResult {
  valid: boolean;
  adminName?: string;
  keyHint?: string;
  reason?: string;
}

/**
 * Key generation result (returned only once during creation)
 */
export interface AdminKeyGenerationResult {
  /** Full plaintext API key (only returned once) */
  apiKey: string;
  /** Key hint for reference */
  keyHint: string;
  /** Bcrypt hash for storage */
  keyHash: string;
  /** Admin name */
  adminName: string;
}

/**
 * Service configuration
 */
export interface AdminApiKeyServiceConfig {
  /** Bcrypt rounds (default: 12) */
  bcryptRounds?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BCRYPT_ROUNDS = 12;
const KEY_LENGTH_BYTES = 32; // 256 bits
const KEY_PREFIX = 'ak_';

// =============================================================================
// AdminApiKeyService Class
// =============================================================================

/**
 * Admin API Key Service with Bcrypt Hashing
 *
 * Addresses HIGH-1 vulnerability: API keys stored/compared in plaintext.
 *
 * Security Features:
 * - Bcrypt hashing with 12 rounds (OWASP recommended)
 * - Constant-time comparison via bcrypt.compare()
 * - Cryptographically secure key generation
 * - Key hints for safe logging (never log full keys)
 *
 * @example
 * ```typescript
 * const keyService = new AdminApiKeyService({ bcryptRounds: 12 });
 *
 * // Generate new key
 * const { apiKey, keyHash, keyHint, adminName } = await keyService.generateKey('admin1');
 * // Store keyHash in env/config, give apiKey to admin (once!)
 *
 * // Validate key (async - constant time)
 * const result = await keyService.validateKey(providedKey, storedHash, 'admin1');
 * if (result.valid) {
 *   console.log(`Valid key for ${result.adminName}`);
 * }
 * ```
 */
export class AdminApiKeyService {
  private readonly bcryptRounds: number;
  private readonly debug: boolean;

  constructor(config: AdminApiKeyServiceConfig = {}) {
    this.bcryptRounds = config.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS;
    this.debug = config.debug ?? false;

    this.log('AdminApiKeyService initialized', { bcryptRounds: this.bcryptRounds });
  }

  // ===========================================================================
  // Key Generation
  // ===========================================================================

  /**
   * Generate a new secure API key
   *
   * SECURITY: The plaintext key is returned ONLY during generation.
   * It cannot be retrieved later - store it securely!
   *
   * @param adminName - Admin name to associate with the key
   * @returns Generation result with plaintext key and hash
   */
  async generateKey(adminName: string): Promise<AdminKeyGenerationResult> {
    // Generate cryptographically secure random key
    const randomBytes = crypto.randomBytes(KEY_LENGTH_BYTES);
    const apiKey = `${KEY_PREFIX}${randomBytes.toString('base64url')}`;

    // Hash with bcrypt
    const keyHash = await bcrypt.hash(apiKey, this.bcryptRounds);

    // Generate hint (first 8 chars after prefix)
    const keyHint = this.getKeyHint(apiKey);

    this.log('API key generated', { adminName, keyHint });

    return {
      apiKey,
      keyHint,
      keyHash,
      adminName,
    };
  }

  /**
   * Hash an existing plaintext key (for migration)
   *
   * @param plaintextKey - Plaintext API key to hash
   * @returns Bcrypt hash
   */
  async hashKey(plaintextKey: string): Promise<string> {
    return bcrypt.hash(plaintextKey, this.bcryptRounds);
  }

  // ===========================================================================
  // Key Validation
  // ===========================================================================

  /**
   * Validate an API key against a stored hash
   *
   * SECURITY: Uses bcrypt.compare() for constant-time comparison.
   * This prevents timing attacks that could leak information about the key.
   *
   * @param providedKey - The API key to validate
   * @param storedHash - The bcrypt hash from storage
   * @param adminName - Expected admin name
   * @returns Validation result
   */
  async validateKey(
    providedKey: string,
    storedHash: string,
    adminName: string
  ): Promise<AdminKeyValidationResult> {
    // Basic format validation
    if (!providedKey || typeof providedKey !== 'string') {
      return { valid: false, reason: 'Invalid key format' };
    }

    // Constant-time comparison via bcrypt
    try {
      const isValid = await bcrypt.compare(providedKey, storedHash);

      if (isValid) {
        const keyHint = this.getKeyHint(providedKey);
        this.log('API key validated successfully', { adminName, keyHint });
        return {
          valid: true,
          adminName,
          keyHint,
        };
      } else {
        const keyHint = this.getKeyHint(providedKey);
        this.log('API key validation failed', { keyHint });
        return {
          valid: false,
          keyHint,
          reason: 'Invalid API key',
        };
      }
    } catch (error) {
      logger.error({ error }, 'API key validation error');
      return {
        valid: false,
        reason: 'Validation error',
      };
    }
  }

  /**
   * Validate a key against multiple stored key records
   *
   * Useful when multiple admin keys are configured.
   * Checks each key in sequence (bcrypt is designed for this use case).
   *
   * @param providedKey - The API key to validate
   * @param keyRecords - Array of stored key records
   * @returns Validation result with matching admin name
   */
  async validateKeyAgainstRecords(
    providedKey: string,
    keyRecords: AdminApiKeyRecord[]
  ): Promise<AdminKeyValidationResult> {
    // Basic format validation
    if (!providedKey || typeof providedKey !== 'string') {
      return { valid: false, reason: 'Invalid key format' };
    }

    const keyHint = this.getKeyHint(providedKey);
    const now = new Date();

    // Check against each stored key
    for (const record of keyRecords) {
      // Skip expired keys
      if (record.expiresAt && record.expiresAt < now) {
        continue;
      }

      try {
        const isValid = await bcrypt.compare(providedKey, record.keyHash);
        if (isValid) {
          this.log('API key validated successfully', {
            adminName: record.adminName,
            keyHint,
          });
          return {
            valid: true,
            adminName: record.adminName,
            keyHint,
          };
        }
      } catch {
        // Continue to next key on error
        continue;
      }
    }

    this.log('API key validation failed - no matching key', { keyHint });
    return {
      valid: false,
      keyHint,
      reason: 'Invalid API key',
    };
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Get a safe key hint for logging
   *
   * SECURITY: Never log full API keys. Use hints for audit trails.
   *
   * @param apiKey - Full API key
   * @returns First 8 characters after prefix for identification
   */
  getKeyHint(apiKey: string): string {
    if (!apiKey || apiKey.length < 12) {
      return 'invalid';
    }

    // If key has prefix, use chars after prefix
    if (apiKey.startsWith(KEY_PREFIX)) {
      return apiKey.substring(KEY_PREFIX.length, KEY_PREFIX.length + 8);
    }

    // Otherwise use first 8 chars
    return apiKey.substring(0, 8);
  }

  /**
   * Check if a string looks like a bcrypt hash
   *
   * @param str - String to check
   * @returns True if string appears to be a bcrypt hash
   */
  isBcryptHash(str: string): boolean {
    // Bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 chars
    return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(str);
  }

  /**
   * Parse legacy plaintext key format: "key:name,key:name"
   *
   * Used during migration to identify plaintext keys.
   *
   * @param envValue - Environment variable value
   * @returns Map of key -> admin name (for migration only)
   */
  parseLegacyFormat(envValue: string): Map<string, string> {
    const keys = new Map<string, string>();

    if (!envValue) return keys;

    for (const pair of envValue.split(',')) {
      const [key, name] = pair.split(':');
      if (key && name) {
        keys.set(key.trim(), name.trim());
      }
    }

    return keys;
  }

  /**
   * Parse hashed key format: "hash:name,hash:name"
   *
   * New format where keys are stored as bcrypt hashes.
   *
   * @param envValue - Environment variable value
   * @returns Array of key records
   */
  parseHashedFormat(envValue: string): AdminApiKeyRecord[] {
    const records: AdminApiKeyRecord[] = [];

    if (!envValue) return records;

    for (const pair of envValue.split(',')) {
      const colonIndex = pair.lastIndexOf(':');
      if (colonIndex === -1) continue;

      const keyOrHash = pair.substring(0, colonIndex).trim();
      const name = pair.substring(colonIndex + 1).trim();

      if (!keyOrHash || !name) continue;

      records.push({
        keyHint: this.isBcryptHash(keyOrHash) ? 'hashed' : keyOrHash.substring(0, 8),
        keyHash: keyOrHash,
        adminName: name,
        createdAt: new Date(),
        expiresAt: null,
      });
    }

    return records;
  }

  // ===========================================================================
  // Debug Logging
  // ===========================================================================

  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      logger.debug({ ...context }, `[AdminApiKeyService] ${message}`);
    }
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let serviceInstance: AdminApiKeyService | null = null;

/**
 * Create or get AdminApiKeyService instance
 */
export function getAdminApiKeyService(
  config?: AdminApiKeyServiceConfig
): AdminApiKeyService {
  if (!serviceInstance) {
    serviceInstance = new AdminApiKeyService(config);
  }
  return serviceInstance;
}

/**
 * Reset service instance (for testing)
 */
export function resetAdminApiKeyService(): void {
  serviceInstance = null;
}

// =============================================================================
// API Key Usage Audit (Sprint 73 - TASK-73.4)
// =============================================================================

/**
 * API key usage audit entry
 */
export interface ApiKeyUsageEntry {
  /** Key hint (first 8 chars) */
  keyHint: string;
  /** Admin name if validation succeeded */
  adminName?: string;
  /** Request endpoint */
  endpoint: string;
  /** HTTP method */
  method: string;
  /** Client IP address */
  ipAddress: string;
  /** User agent string */
  userAgent?: string;
  /** Whether validation succeeded */
  success: boolean;
  /** Failure reason if validation failed */
  failureReason?: string;
}

/**
 * Database handle type for dependency injection
 */
type DbHandle = {
  insert(table: unknown): {
    values(data: Record<string, unknown>): Promise<void>;
  };
} | null;

/**
 * API Key Usage Audit Logger
 *
 * Sprint 73 (TASK-73.4): Logs all API key validation attempts
 * to the api_key_usage table for security monitoring.
 *
 * Features:
 * - Non-blocking audit logging (fire and forget)
 * - Dual logging: structured logger + PostgreSQL persistence
 * - IP tracking for security investigations
 * - Failure reason tracking for debugging
 * - 90-day retention policy support
 */
export class ApiKeyUsageAuditLogger {
  private readonly debug: boolean;
  private db: DbHandle = null;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Set the database handle for persistence
   *
   * Call this during app initialization with the Drizzle db instance.
   * If not set, audit entries are logged but not persisted.
   */
  setDatabase(db: DbHandle): void {
    this.db = db;
  }

  /**
   * Log an API key usage entry
   *
   * This is designed to be non-blocking to avoid impacting
   * request latency. Errors are logged but don't fail the request.
   *
   * Dual logging strategy:
   * 1. Always log to structured logger (immediate, sync)
   * 2. Persist to PostgreSQL if db is configured (async, non-blocking)
   */
  async logUsage(entry: ApiKeyUsageEntry): Promise<void> {
    const logEntry = {
      keyHint: entry.keyHint,
      adminName: entry.adminName,
      endpoint: entry.endpoint,
      method: entry.method,
      ipAddress: entry.ipAddress,
      success: entry.success,
      failureReason: entry.failureReason,
      timestamp: new Date().toISOString(),
    };

    // Always log to structured logger (immediate visibility)
    try {
      if (entry.success) {
        logger.info(logEntry, 'API key validation success (audit)');
      } else {
        logger.warn(logEntry, 'API key validation failure (audit)');
      }

      if (this.debug) {
        logger.debug({ ...logEntry, userAgent: entry.userAgent }, 'API key audit entry');
      }
    } catch (logError) {
      // Never fail on logging errors
      console.error('[ApiKeyUsageAuditLogger] Logger error:', logError);
    }

    // Persist to PostgreSQL (non-blocking, fire and forget)
    if (this.db) {
      this.persistToDatabase(entry).catch((dbError) => {
        // Log but don't fail - audit persistence is best-effort
        logger.error({ error: dbError }, 'Failed to persist API key audit entry to database');
      });
    }
  }

  /**
   * Persist audit entry to PostgreSQL
   *
   * @internal Called in non-blocking manner from logUsage
   */
  private async persistToDatabase(entry: ApiKeyUsageEntry): Promise<void> {
    if (!this.db) return;

    try {
      // Dynamic import to avoid circular dependencies
      const { apiKeyUsage } = await import('../../packages/adapters/storage/schema.js');

      await this.db.insert(apiKeyUsage).values({
        keyHint: entry.keyHint,
        adminName: entry.adminName ?? null,
        endpoint: entry.endpoint,
        method: entry.method,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent ?? null,
        success: entry.success,
        failureReason: entry.failureReason ?? null,
      });
    } catch (error) {
      // Re-throw to be caught by caller for logging
      throw error;
    }
  }

  /**
   * Log a successful API key validation
   */
  async logSuccess(
    keyHint: string,
    adminName: string,
    endpoint: string,
    method: string,
    ipAddress: string,
    userAgent?: string
  ): Promise<void> {
    await this.logUsage({
      keyHint,
      adminName,
      endpoint,
      method,
      ipAddress,
      userAgent,
      success: true,
    });
  }

  /**
   * Log a failed API key validation
   */
  async logFailure(
    keyHint: string,
    endpoint: string,
    method: string,
    ipAddress: string,
    failureReason: string,
    userAgent?: string
  ): Promise<void> {
    await this.logUsage({
      keyHint,
      endpoint,
      method,
      ipAddress,
      userAgent,
      success: false,
      failureReason,
    });
  }
}

// Singleton audit logger
let auditLoggerInstance: ApiKeyUsageAuditLogger | null = null;

/**
 * Get the API key usage audit logger
 */
export function getApiKeyAuditLogger(debug = false): ApiKeyUsageAuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new ApiKeyUsageAuditLogger(debug);
  }
  return auditLoggerInstance;
}

/**
 * Reset audit logger instance (for testing)
 */
export function resetApiKeyAuditLogger(): void {
  auditLoggerInstance = null;
}
