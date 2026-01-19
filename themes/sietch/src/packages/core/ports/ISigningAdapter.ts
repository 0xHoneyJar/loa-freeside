/**
 * ISigningAdapter - Cryptographic Signing Port
 *
 * Sprint 46: Vault Transit Integration - Phase 5
 *
 * Architecture:
 * - Port interface for cryptographic signing operations
 * - Implementations: VaultSigningAdapter (production), LocalSigningAdapter (dev/test)
 * - HSM-backed operations via HashiCorp Vault Transit
 * - Audit logging for all signing operations
 * - Key rotation without downtime
 *
 * @module packages/core/ports/ISigningAdapter
 */

/**
 * Result of a signing operation
 */
export interface SigningResult {
  /** Cryptographic signature (hex string) */
  signature: string;
  /** Key version used for signing */
  keyVersion: number;
  /** Signing algorithm used */
  algorithm: string;
  /** Timestamp when signature was created */
  signedAt: Date;
  /** Hash of data that was signed (for audit trail) */
  dataHash: string;
}

/**
 * Result of a key rotation operation
 */
export interface KeyRotationResult {
  /** Name of the key that was rotated */
  keyName: string;
  /** New key version after rotation */
  newVersion: number;
  /** Previous key version before rotation */
  previousVersion: number;
  /** Timestamp when rotation occurred */
  rotatedAt: Date;
  /** Whether rotation completed successfully */
  success: boolean;
  /** Error message if rotation failed */
  error?: string;
}

/**
 * Signing adapter configuration
 */
export interface SigningAdapterConfig {
  /** Key name/identifier for signing operations */
  keyName?: string;
  /** Algorithm to use for signing (e.g., 'sha2-256', 'sha2-512') */
  algorithm?: string;
  /** Enable audit logging for signing operations */
  auditLogging?: boolean;
}

/**
 * Audit log entry for signing operations
 */
export interface SigningAuditLog {
  /** Unique ID for this signing operation */
  operationId: string;
  /** Type of operation (sign, verify, rotate) */
  operation: 'sign' | 'verify' | 'rotate' | 'getPublicKey';
  /** Key name used */
  keyName: string;
  /** Key version used */
  keyVersion?: number;
  /** Success or failure */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Hash of data that was signed/verified */
  dataHash?: string;
  /** Timestamp of operation */
  timestamp: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * ISigningAdapter - Cryptographic Signing Interface
 *
 * Provides HSM-backed cryptographic signing operations via HashiCorp Vault Transit.
 * Eliminates need for PRIVATE_KEY in environment variables.
 *
 * Key Features:
 * - Sign arbitrary data with HSM-backed keys
 * - Verify signatures
 * - Key rotation without downtime
 * - Audit logging for compliance
 *
 * Implementations:
 * - VaultSigningAdapter: Production implementation using Vault Transit
 * - LocalSigningAdapter: Development/test implementation using Node.js crypto
 */
export interface ISigningAdapter {
  /**
   * Sign data using the configured key
   *
   * @param data - Data to sign (string or Buffer)
   * @param keyName - Optional key name (defaults to adapter's configured key)
   * @returns Signing result with signature, key version, and metadata
   *
   * @example
   * ```typescript
   * const result = await adapter.sign('Hello, World!');
   * console.log(result.signature); // '0x1234...'
   * console.log(result.keyVersion); // 1
   * ```
   */
  sign(data: string | Buffer, keyName?: string): Promise<SigningResult>;

  /**
   * Verify a signature for given data
   *
   * @param data - Original data that was signed
   * @param signature - Signature to verify
   * @param keyName - Optional key name (defaults to adapter's configured key)
   * @returns true if signature is valid, false otherwise
   *
   * @example
   * ```typescript
   * const isValid = await adapter.verify(
   *   'Hello, World!',
   *   result.signature
   * );
   * console.log(isValid); // true
   * ```
   */
  verify(data: string | Buffer, signature: string, keyName?: string): Promise<boolean>;

  /**
   * Get public key for verification
   *
   * @param keyName - Optional key name (defaults to adapter's configured key)
   * @returns Public key in hex format
   *
   * @example
   * ```typescript
   * const publicKey = await adapter.getPublicKey();
   * console.log(publicKey); // '0x04...'
   * ```
   */
  getPublicKey(keyName?: string): Promise<string>;

  /**
   * Check if signing adapter is ready and healthy
   *
   * @returns true if adapter is operational, false otherwise
   *
   * @example
   * ```typescript
   * const ready = await adapter.isReady();
   * if (!ready) {
   *   throw new Error('Signing adapter not ready');
   * }
   * ```
   */
  isReady(): Promise<boolean>;

  /**
   * Rotate signing key to a new version
   *
   * Key rotation creates a new key version without downtime.
   * Old key versions remain available for signature verification.
   *
   * @param keyName - Optional key name (defaults to adapter's configured key)
   * @returns Key rotation result with new and previous versions
   *
   * @example
   * ```typescript
   * const result = await adapter.rotateKey();
   * console.log(result.newVersion); // 2
   * console.log(result.previousVersion); // 1
   * ```
   */
  rotateKey(keyName?: string): Promise<KeyRotationResult>;

  /**
   * Get audit logs for signing operations (if audit logging enabled)
   *
   * @param limit - Maximum number of logs to return
   * @returns Array of audit log entries
   */
  getAuditLogs?(limit?: number): Promise<SigningAuditLog[]>;
}

/**
 * Signing adapter error types
 */
export class SigningError extends Error {
  public readonly code: string;

  constructor(
    message: string,
    code: string,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'SigningError';
    this.code = code;
  }
}

export class KeyNotFoundError extends SigningError {
  constructor(keyName: string, cause?: Error) {
    super(`Signing key not found: ${keyName}`, 'KEY_NOT_FOUND', cause);
    this.name = 'KeyNotFoundError';
  }
}

export class SigningOperationError extends SigningError {
  constructor(message: string, cause?: Error) {
    super(message, 'SIGNING_OPERATION_FAILED', cause);
    this.name = 'SigningOperationError';
  }
}

export class KeyRotationError extends SigningError {
  constructor(message: string, cause?: Error) {
    super(message, 'KEY_ROTATION_FAILED', cause);
    this.name = 'KeyRotationError';
  }
}

export class VaultUnavailableError extends SigningError {
  constructor(message: string, cause?: Error) {
    super(message, 'VAULT_UNAVAILABLE', cause);
    this.name = 'VaultUnavailableError';
  }
}
