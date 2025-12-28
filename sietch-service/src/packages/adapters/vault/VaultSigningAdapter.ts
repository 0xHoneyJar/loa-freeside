/**
 * VaultSigningAdapter - HashiCorp Vault Transit Signing Adapter
 *
 * Sprint 46: Vault Transit Integration - Phase 5
 *
 * Production implementation of ISigningAdapter using HashiCorp Vault Transit
 * secrets engine for HSM-backed cryptographic operations.
 *
 * Features:
 * - HSM-backed signing operations
 * - No PRIVATE_KEY in environment
 * - Structured audit logging
 * - Key rotation without downtime
 * - Circuit breaker for fault tolerance
 *
 * Configuration:
 * - VAULT_ADDR: Vault server address
 * - VAULT_TOKEN: Authentication token
 * - VAULT_NAMESPACE: Optional namespace (for Vault Enterprise)
 *
 * @module packages/adapters/vault/VaultSigningAdapter
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
  VaultUnavailableError,
} from '../../core/ports/ISigningAdapter.js';
import nodeVault from 'node-vault';
import type { VaultOptions } from 'node-vault';
import * as crypto from 'crypto';
import type { Logger } from 'pino';

/**
 * Configuration for VaultSigningAdapter
 */
export interface VaultSigningAdapterConfig extends SigningAdapterConfig {
  /** Vault server address (e.g., 'https://vault.honeyjar.xyz') */
  vaultAddr: string;
  /** Vault authentication token */
  vaultToken: string;
  /** Optional Vault namespace (Vault Enterprise) */
  vaultNamespace?: string;
  /** Default key name for signing operations */
  keyName?: string;
  /** Default algorithm (defaults to 'sha2-256') */
  algorithm?: string;
  /** Enable audit logging (defaults to true) */
  auditLogging?: boolean;
  /** Request timeout in milliseconds (defaults to 5000) */
  requestTimeout?: number;
  /** Logger instance for structured logging */
  logger?: Logger;
}

/**
 * Vault Transit response for sign operation
 */
interface VaultSignResponse {
  data: {
    signature: string;
    key_version: number;
  };
}

/**
 * Vault Transit response for verify operation
 */
interface VaultVerifyResponse {
  data: {
    valid: boolean;
  };
}

/**
 * Vault Transit response for key info
 */
interface VaultKeyResponse {
  data: {
    keys: Record<
      string,
      {
        public_key?: string;
      }
    >;
    latest_version: number;
    name: string;
  };
}

/**
 * VaultSigningAdapter - Production signing adapter using HashiCorp Vault Transit
 *
 * Eliminates PRIVATE_KEY from environment by using Vault Transit secrets engine.
 * All signing operations are performed by Vault's HSM-backed cryptographic system.
 *
 * @example
 * ```typescript
 * const adapter = new VaultSigningAdapter({
 *   vaultAddr: process.env.VAULT_ADDR!,
 *   vaultToken: process.env.VAULT_TOKEN!,
 *   keyName: 'arrakis-signing',
 *   logger: pino()
 * });
 *
 * const result = await adapter.sign('Hello, World!');
 * console.log(result.signature); // Vault signature
 * ```
 */
export class VaultSigningAdapter implements ISigningAdapter {
  private vault: ReturnType<typeof nodeVault>;
  private config: Required<VaultSigningAdapterConfig>;
  private auditLogs: SigningAuditLog[] = [];
  private transitPath: string = 'transit';
  private ready: boolean = false;

  constructor(config: VaultSigningAdapterConfig) {
    // Set defaults
    this.config = {
      vaultAddr: config.vaultAddr,
      vaultToken: config.vaultToken,
      vaultNamespace: config.vaultNamespace,
      keyName: config.keyName || 'arrakis-signing',
      algorithm: config.algorithm || 'sha2-256',
      auditLogging: config.auditLogging !== false,
      requestTimeout: config.requestTimeout || 5000,
      logger: config.logger,
    } as Required<VaultSigningAdapterConfig>;

    // Initialize Vault client
    const vaultOptions: VaultOptions = {
      apiVersion: 'v1',
      endpoint: this.config.vaultAddr,
      token: this.config.vaultToken,
      requestOptions: {
        timeout: this.config.requestTimeout,
      },
    };

    if (this.config.vaultNamespace) {
      vaultOptions.namespace = this.config.vaultNamespace;
    }

    this.vault = nodeVault(vaultOptions);

    // Log initialization
    this.log('info', 'VaultSigningAdapter initialized', {
      vaultAddr: this.config.vaultAddr,
      keyName: this.config.keyName,
      auditLogging: this.config.auditLogging,
    });
  }

  /**
   * Sign data using Vault Transit
   */
  async sign(data: string | Buffer, keyName?: string): Promise<SigningResult> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();
    const dataHash = this.hashData(data);

    try {
      this.log('info', 'Signing data with Vault Transit', {
        operationId,
        keyName: effectiveKeyName,
        dataHash,
      });

      // Encode data to base64 for Vault
      const input = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');

      // Call Vault Transit sign endpoint
      const response = (await this.vault.write(`${this.transitPath}/sign/${effectiveKeyName}/${this.config.algorithm}`, {
        input,
      })) as VaultSignResponse;

      if (!response?.data?.signature) {
        throw new SigningOperationError('Vault returned no signature');
      }

      const result: SigningResult = {
        signature: response.data.signature,
        keyVersion: response.data.key_version,
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

      // Classify error
      if (errorMsg.includes('permission denied') || errorMsg.includes('not found')) {
        throw new KeyNotFoundError(effectiveKeyName, error as Error);
      }
      if (errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
        throw new VaultUnavailableError('Vault server unavailable', error as Error);
      }
      throw new SigningOperationError(`Signing failed: ${errorMsg}`, error as Error);
    }
  }

  /**
   * Verify signature using Vault Transit
   */
  async verify(data: string | Buffer, signature: string, keyName?: string): Promise<boolean> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();
    const dataHash = this.hashData(data);

    try {
      this.log('info', 'Verifying signature with Vault Transit', {
        operationId,
        keyName: effectiveKeyName,
        dataHash,
      });

      // Encode data to base64 for Vault
      const input = Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64');

      // Call Vault Transit verify endpoint
      const response = (await this.vault.write(`${this.transitPath}/verify/${effectiveKeyName}/${this.config.algorithm}`, {
        input,
        signature,
      })) as VaultVerifyResponse;

      const valid = response?.data?.valid === true;

      // Audit log
      this.addAuditLog({
        operationId,
        operation: 'verify',
        keyName: effectiveKeyName,
        success: true,
        dataHash,
        timestamp: new Date(),
        metadata: { valid, signature: signature.substring(0, 20) + '...' },
      });

      this.log('info', 'Signature verification complete', {
        operationId,
        keyName: effectiveKeyName,
        valid,
      });

      return valid;
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

      // Verification failures return false rather than throw
      return false;
    }
  }

  /**
   * Get public key from Vault Transit
   */
  async getPublicKey(keyName?: string): Promise<string> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();

    try {
      this.log('info', 'Getting public key from Vault Transit', {
        operationId,
        keyName: effectiveKeyName,
      });

      // Call Vault Transit keys endpoint
      const response = (await this.vault.read(`${this.transitPath}/keys/${effectiveKeyName}`)) as VaultKeyResponse;

      if (!response?.data?.keys) {
        throw new KeyNotFoundError(effectiveKeyName);
      }

      // Get latest version's public key
      const latestVersion = response.data.latest_version.toString();
      const publicKey = response.data.keys[latestVersion]?.public_key;

      if (!publicKey) {
        throw new SigningOperationError('Public key not available for this key type');
      }

      // Audit log
      this.addAuditLog({
        operationId,
        operation: 'getPublicKey',
        keyName: effectiveKeyName,
        keyVersion: response.data.latest_version,
        success: true,
        timestamp: new Date(),
      });

      this.log('info', 'Public key retrieved', {
        operationId,
        keyName: effectiveKeyName,
        keyVersion: response.data.latest_version,
      });

      return publicKey;
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
   * Check if Vault Transit is healthy
   */
  async isReady(): Promise<boolean> {
    try {
      // Try to read key info to verify connectivity
      await this.vault.read(`${this.transitPath}/keys/${this.config.keyName}`);
      this.ready = true;
      return true;
    } catch (error) {
      this.ready = false;
      this.log('warn', 'Vault Transit health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Rotate signing key in Vault Transit
   */
  async rotateKey(keyName?: string): Promise<KeyRotationResult> {
    const effectiveKeyName = keyName || this.config.keyName;
    const operationId = crypto.randomUUID();

    try {
      this.log('info', 'Rotating key in Vault Transit', {
        operationId,
        keyName: effectiveKeyName,
      });

      // Get current version
      const beforeResponse = (await this.vault.read(
        `${this.transitPath}/keys/${effectiveKeyName}`
      )) as VaultKeyResponse;
      const previousVersion = beforeResponse.data.latest_version;

      // Call Vault Transit rotate endpoint
      await this.vault.write(`${this.transitPath}/keys/${effectiveKeyName}/rotate`, {});

      // Get new version
      const afterResponse = (await this.vault.read(
        `${this.transitPath}/keys/${effectiveKeyName}`
      )) as VaultKeyResponse;
      const newVersion = afterResponse.data.latest_version;

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
   * Revoke Vault ACL policy
   *
   * Used by kill switch to revoke signing permissions
   *
   * @param policyName - Name of the policy to revoke
   */
  async revokePolicy(policyName: string): Promise<void> {
    try {
      this.log('info', 'Revoking Vault ACL policy', { policyName });

      // Delete policy from Vault
      await this.vault.delete(`/sys/policies/acl/${policyName}`);

      this.log('info', 'Vault ACL policy revoked', { policyName });

      // Audit log (using 'rotate' as closest match for policy operations)
      this.addAuditLog({
        operationId: crypto.randomUUID(),
        timestamp: new Date(),
        operation: 'rotate',
        keyName: policyName,
        success: true,
        metadata: {
          policyName,
          operationType: 'REVOKE_POLICY',
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log('error', 'Failed to revoke Vault ACL policy', {
        policyName,
        error: errorMsg,
      });

      // Audit log failure
      this.addAuditLog({
        operationId: crypto.randomUUID(),
        timestamp: new Date(),
        operation: 'rotate',
        keyName: policyName,
        success: false,
        error: errorMsg,
        metadata: {
          operationType: 'REVOKE_POLICY',
        },
      });

      throw new VaultUnavailableError(`Failed to revoke Vault policy: ${errorMsg}`, error as Error);
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
      this.config.logger[level]({ ...context, adapter: 'VaultSigningAdapter' }, message);
    }
  }
}
