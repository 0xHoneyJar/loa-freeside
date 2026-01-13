/**
 * LocalSigningAdapter - Local Signing Adapter for Development/Testing
 *
 * Sprint 46: Vault Transit Integration - Phase 5
 *
 * Development/testing implementation of ISigningAdapter using Node.js crypto module.
 * Uses local ECDSA keys instead of Vault Transit.
 *
 * **WARNING**: Only for development and testing. NOT for production use.
 *
 * Features:
 * - Local ECDSA key generation and signing
 * - Same interface as VaultSigningAdapter
 * - Audit logging for consistency
 * - Key rotation simulation
 *
 * Configuration:
 * - PRIVATE_KEY: Optional hex-encoded private key (generates if not provided)
 *
 * @module packages/adapters/vault/LocalSigningAdapter
 */

import type {
  ISigningAdapter,
  SigningResult,
  KeyRotationResult,
  SigningAdapterConfig,
  SigningAuditLog,
} from '../../core/ports/ISigningAdapter.js';
import {
  SigningError,
  KeyNotFoundError,
  SigningOperationError,
  KeyRotationError,
} from '../../core/ports/ISigningAdapter.js';
import * as crypto from 'crypto';
import type { Logger } from 'pino';

/**
 * Configuration for LocalSigningAdapter
 */
export interface LocalSigningAdapterConfig extends SigningAdapterConfig {
  /** Optional private key (hex-encoded). If not provided, generates one. */
  privateKey?: string;
  /** Default key name for signing operations */
  keyName?: string;
  /** Default algorithm (defaults to 'sha256') */
  algorithm?: string;
  /** Enable audit logging (defaults to true) */
  auditLogging?: boolean;
  /** Logger instance for structured logging */
  logger?: Logger;
}

/**
 * Internal key storage
 */
interface KeyVersion {
  version: number;
  privateKey: string;
  publicKey: string;
  createdAt: Date;
}

/**
 * LocalSigningAdapter - Development/test signing adapter using Node.js crypto
 *
 * Provides same interface as VaultSigningAdapter but uses local cryptography.
 * Useful for testing without requiring Vault infrastructure.
 *
 * **WARNING**: Do NOT use in production. Private keys stored in memory.
 *
 * @example
 * ```typescript
 * const adapter = new LocalSigningAdapter({
 *   keyName: 'test-signing',
 *   logger: pino()
 * });
 *
 * const result = await adapter.sign('Hello, World!');
 * console.log(result.signature); // ECDSA signature
 * ```
 */
export class LocalSigningAdapter implements ISigningAdapter {
  private config: Required<LocalSigningAdapterConfig>;
  private auditLogs: SigningAuditLog[] = [];
  private keys: Map<string, KeyVersion[]> = new Map();
  private currentKeyVersion: Map<string, number> = new Map();

  constructor(config: LocalSigningAdapterConfig) {
    // Set defaults
    this.config = {
      privateKey: config.privateKey,
      keyName: config.keyName || 'local-signing',
      algorithm: config.algorithm || 'sha256',
      auditLogging: config.auditLogging !== false,
      logger: config.logger,
    } as Required<LocalSigningAdapterConfig>;

    // Initialize key
    this.initializeKey(this.config.keyName, this.config.privateKey);

    // Log initialization
    this.log('info', 'LocalSigningAdapter initialized (DEVELOPMENT ONLY)', {
      keyName: this.config.keyName,
      auditLogging: this.config.auditLogging,
    });

    // Warn about production use
    this.log('warn', '⚠️  LocalSigningAdapter is for DEVELOPMENT/TESTING only. Do NOT use in production!', {});
  }

  /**
   * Initialize key for a given key name
   */
  private initializeKey(keyName: string, privateKeyHex?: string): void {
    let privateKey: string;
    let publicKey: string;

    if (privateKeyHex) {
      // Use provided private key
      privateKey = privateKeyHex;

      // Derive public key from private key
      const keyObject = crypto.createPrivateKey({
        key: Buffer.from(privateKey, 'hex'),
        format: 'der',
        type: 'sec1',
      });
      publicKey = keyObject.export({ format: 'der', type: 'spki' }).toString('hex');
    } else {
      // Generate new ECDSA key pair
      const { privateKey: privKey, publicKey: pubKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'secp256k1',
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'sec1', format: 'der' },
      });

      privateKey = privKey.toString('hex');
      publicKey = pubKey.toString('hex');
    }

    // Store version 1
    const version: KeyVersion = {
      version: 1,
      privateKey,
      publicKey,
      createdAt: new Date(),
    };

    this.keys.set(keyName, [version]);
    this.currentKeyVersion.set(keyName, 1);

    this.log('info', 'Key initialized', {
      keyName,
      version: 1,
      publicKey: publicKey.substring(0, 32) + '...',
    });
  }

  /**
   * Get current key version for key name
   */
  private getKeyVersion(keyName: string, version?: number): KeyVersion | null {
    const versions = this.keys.get(keyName);
    if (!versions || versions.length === 0) {
      return null;
    }

    if (version !== undefined) {
      return versions.find((v) => v.version === version) || null;
    }

    // Return latest version
    const currentVersion = this.currentKeyVersion.get(keyName) || 1;
    return versions.find((v) => v.version === currentVersion) || null;
  }

  /**
   * Sign data using local ECDSA
   */
  async sign(data: string | Buffer, keyName?: string): Promise<SigningResult> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();
    const dataHash = this.hashData(data);

    try {
      this.log('info', 'Signing data with local ECDSA', {
        operationId,
        keyName: effectiveKeyName,
        dataHash,
      });

      // Get current key
      const keyVersion = this.getKeyVersion(effectiveKeyName);
      if (!keyVersion) {
        throw new KeyNotFoundError(effectiveKeyName);
      }

      // Create signing key
      const privateKeyObject = crypto.createPrivateKey({
        key: Buffer.from(keyVersion.privateKey, 'hex'),
        format: 'der',
        type: 'sec1',
      });

      // Sign data
      const sign = crypto.createSign(this.config.algorithm);
      sign.update(Buffer.isBuffer(data) ? data : Buffer.from(data));
      sign.end();

      const signature = sign.sign(privateKeyObject, 'hex');

      const result: SigningResult = {
        signature,
        keyVersion: keyVersion.version,
        algorithm: this.config.algorithm,
        signedAt: new Date(),
        dataHash,
      };

      // Audit log
      this.addAuditLog({
        operationId,
        operation: 'sign',
        keyName: effectiveKeyName,
        keyVersion: result.keyVersion,
        success: true,
        dataHash,
        timestamp: new Date(),
        metadata: { algorithm: this.config.algorithm },
      });

      this.log('info', 'Signing successful', {
        operationId,
        keyName: effectiveKeyName,
        keyVersion: result.keyVersion,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Audit log failure
      this.addAuditLog({
        operationId,
        operation: 'sign',
        keyName: effectiveKeyName,
        success: false,
        error: errorMsg,
        dataHash,
        timestamp: new Date(),
      });

      this.log('error', 'Signing failed', {
        operationId,
        keyName: effectiveKeyName,
        error: errorMsg,
      });

      if (error instanceof SigningError) {
        throw error;
      }
      throw new SigningOperationError(`Signing failed: ${errorMsg}`, error as Error);
    }
  }

  /**
   * Verify signature using local ECDSA
   */
  async verify(data: string | Buffer, signature: string, keyName?: string): Promise<boolean> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();
    const dataHash = this.hashData(data);

    try {
      this.log('info', 'Verifying signature with local ECDSA', {
        operationId,
        keyName: effectiveKeyName,
        dataHash,
      });

      // Try all key versions (newest to oldest)
      const versions = this.keys.get(effectiveKeyName);
      if (!versions || versions.length === 0) {
        throw new KeyNotFoundError(effectiveKeyName);
      }

      for (const keyVersion of [...versions].reverse()) {
        try {
          // Create verification key
          const publicKeyObject = crypto.createPublicKey({
            key: Buffer.from(keyVersion.publicKey, 'hex'),
            format: 'der',
            type: 'spki',
          });

          // Verify signature
          const verify = crypto.createVerify(this.config.algorithm);
          verify.update(Buffer.isBuffer(data) ? data : Buffer.from(data));
          verify.end();

          const valid = verify.verify(publicKeyObject, Buffer.from(signature, 'hex'));

          if (valid) {
            // Audit log
            this.addAuditLog({
              operationId,
              operation: 'verify',
              keyName: effectiveKeyName,
              keyVersion: keyVersion.version,
              success: true,
              dataHash,
              timestamp: new Date(),
              metadata: { valid, signature: signature.substring(0, 20) + '...' },
            });

            this.log('info', 'Signature verification complete', {
              operationId,
              keyName: effectiveKeyName,
              valid: true,
              keyVersion: keyVersion.version,
            });

            return true;
          }
        } catch (err) {
          // Try next version
          continue;
        }
      }

      // No version verified signature
      this.addAuditLog({
        operationId,
        operation: 'verify',
        keyName: effectiveKeyName,
        success: true,
        dataHash,
        timestamp: new Date(),
        metadata: { valid: false, signature: signature.substring(0, 20) + '...' },
      });

      this.log('info', 'Signature verification complete', {
        operationId,
        keyName: effectiveKeyName,
        valid: false,
      });

      return false;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Audit log failure
      this.addAuditLog({
        operationId,
        operation: 'verify',
        keyName: effectiveKeyName,
        success: false,
        error: errorMsg,
        dataHash,
        timestamp: new Date(),
      });

      this.log('error', 'Signature verification failed', {
        operationId,
        keyName: effectiveKeyName,
        error: errorMsg,
      });

      // Verification errors return false rather than throw
      return false;
    }
  }

  /**
   * Get public key
   */
  async getPublicKey(keyName?: string): Promise<string> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();

    try {
      this.log('info', 'Getting public key', {
        operationId,
        keyName: effectiveKeyName,
      });

      const keyVersion = this.getKeyVersion(effectiveKeyName);
      if (!keyVersion) {
        throw new KeyNotFoundError(effectiveKeyName);
      }

      // Audit log
      this.addAuditLog({
        operationId,
        operation: 'getPublicKey',
        keyName: effectiveKeyName,
        keyVersion: keyVersion.version,
        success: true,
        timestamp: new Date(),
      });

      this.log('info', 'Public key retrieved', {
        operationId,
        keyName: effectiveKeyName,
        keyVersion: keyVersion.version,
      });

      return keyVersion.publicKey;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Audit log failure
      this.addAuditLog({
        operationId,
        operation: 'getPublicKey',
        keyName: effectiveKeyName,
        success: false,
        error: errorMsg,
        timestamp: new Date(),
      });

      this.log('error', 'Failed to get public key', {
        operationId,
        keyName: effectiveKeyName,
        error: errorMsg,
      });

      if (error instanceof SigningError) {
        throw error;
      }
      throw new SigningOperationError(`Failed to get public key: ${errorMsg}`, error as Error);
    }
  }

  /**
   * Check if adapter is ready
   */
  async isReady(): Promise<boolean> {
    return this.keys.size > 0;
  }

  /**
   * Rotate signing key (simulate)
   */
  async rotateKey(keyName?: string): Promise<KeyRotationResult> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();

    try {
      this.log('info', 'Rotating local key', {
        operationId,
        keyName: effectiveKeyName,
      });

      const versions = this.keys.get(effectiveKeyName);
      if (!versions || versions.length === 0) {
        throw new KeyNotFoundError(effectiveKeyName);
      }

      const previousVersion = this.currentKeyVersion.get(effectiveKeyName) || 1;
      const newVersion = previousVersion + 1;

      // Generate new key pair
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'secp256k1',
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'sec1', format: 'der' },
      });

      // Add new version
      const newKeyVersion: KeyVersion = {
        version: newVersion,
        privateKey: privateKey.toString('hex'),
        publicKey: publicKey.toString('hex'),
        createdAt: new Date(),
      };

      versions.push(newKeyVersion);
      this.currentKeyVersion.set(effectiveKeyName, newVersion);

      const result: KeyRotationResult = {
        keyName: effectiveKeyName,
        newVersion,
        previousVersion,
        rotatedAt: new Date(),
        success: true,
      };

      // Audit log
      this.addAuditLog({
        operationId,
        operation: 'rotate',
        keyName: effectiveKeyName,
        keyVersion: newVersion,
        success: true,
        timestamp: new Date(),
        metadata: { previousVersion, newVersion },
      });

      this.log('info', 'Key rotation successful', {
        operationId,
        keyName: effectiveKeyName,
        previousVersion,
        newVersion,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Audit log failure
      this.addAuditLog({
        operationId,
        operation: 'rotate',
        keyName: effectiveKeyName,
        success: false,
        error: errorMsg,
        timestamp: new Date(),
      });

      this.log('error', 'Key rotation failed', {
        operationId,
        keyName: effectiveKeyName,
        error: errorMsg,
      });

      throw new KeyRotationError(`Key rotation failed: ${errorMsg}`, error as Error);
    }
  }

  /**
   * Get audit logs
   */
  async getAuditLogs(limit: number = 100): Promise<SigningAuditLog[]> {
    if (!this.config.auditLogging) {
      return [];
    }
    return this.auditLogs.slice(-limit);
  }

  /**
   * Add audit log entry
   */
  private addAuditLog(entry: SigningAuditLog): void {
    if (!this.config.auditLogging) {
      return;
    }

    this.auditLogs.push(entry);

    // Keep last 1000 entries in memory
    if (this.auditLogs.length > 1000) {
      this.auditLogs = this.auditLogs.slice(-1000);
    }
  }

  /**
   * Hash data for audit trail
   */
  private hashData(data: string | Buffer): string {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Structured logging
   */
  private log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
    if (this.config.logger) {
      this.config.logger[level]({ ...context, adapter: 'LocalSigningAdapter' }, message);
    }
  }
}
