/**
 * VaultClient Implementation
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * HashiCorp Vault Transit client for HSM-backed cryptographic operations.
 * Features:
 * - AppRole authentication with auto-renewal
 * - Transit engine for signing, verification, encryption, decryption
 * - KV v2 engine for secrets management
 * - Key rotation support
 * - Prometheus metrics integration
 *
 * @see SDD §6.4.2 Vault Client
 */

import type { Logger } from 'pino';
import type {
  IVaultClient,
  VaultConfig,
  VaultHealthStatus,
  TransitKeyInfo,
} from '@freeside/core/ports';
import {
  VAULT_CONFIG_DEFAULTS,
  VAULT_METRICS_PREFIX,
} from '@freeside/core/ports';
import type { VaultMetrics } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Vault HTTP client interface (for DI).
 */
export interface VaultHttpClient {
  read(path: string): Promise<VaultResponse>;
  write(path: string, data?: Record<string, unknown>): Promise<VaultResponse>;
  delete(path: string): Promise<void>;
  health(): Promise<VaultHealthResponse>;
}

/**
 * Vault response structure.
 */
export interface VaultResponse {
  data: Record<string, unknown>;
  auth?: {
    client_token: string;
    accessor: string;
    policies: string[];
    token_policies: string[];
    metadata: Record<string, string>;
    lease_duration: number;
    renewable: boolean;
  };
}

/**
 * Vault health response.
 */
export interface VaultHealthResponse {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  performance_standby: boolean;
  replication_performance_mode: string;
  replication_dr_mode: string;
  server_time_utc: number;
  version: string;
  cluster_name: string;
  cluster_id: string;
}

/**
 * AppRole login response.
 */
export interface AppRoleLoginResponse {
  auth: {
    client_token: string;
    accessor: string;
    policies: string[];
    token_policies: string[];
    metadata: Record<string, string>;
    lease_duration: number;
    renewable: boolean;
  };
}

/**
 * Options for VaultClient.
 */
export interface VaultClientOptions {
  /** Vault configuration */
  config: VaultConfig;
  /** HTTP client for Vault API */
  httpClient: VaultHttpClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: VaultMetrics;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * HashiCorp Vault client implementation.
 */
export class VaultClient implements IVaultClient {
  private readonly config: VaultConfig;
  private readonly http: VaultHttpClient;
  private readonly log: Logger;
  private readonly metrics: VaultMetrics;
  private readonly transitPath: string;
  private readonly kvPath: string;

  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private renewalTimer: NodeJS.Timeout | null = null;

  constructor(options: VaultClientOptions) {
    this.config = options.config;
    this.http = options.httpClient;
    this.log = options.logger.child({ component: 'VaultClient' });
    this.metrics = options.metrics;

    this.transitPath = options.config.transitPath ?? VAULT_CONFIG_DEFAULTS.TRANSIT_PATH;
    this.kvPath = options.config.kvPath ?? VAULT_CONFIG_DEFAULTS.KV_PATH;

    // Set initial token if provided (dev mode)
    if (options.config.token) {
      this.token = options.config.token;
      this.log.info('Using static token (dev mode)');
    }

    this.log.info(
      { endpoint: this.config.endpoint, transitPath: this.transitPath },
      'Vault client initialized'
    );
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Authenticate using AppRole.
   */
  async authenticateAppRole(): Promise<void> {
    if (!this.config.roleId || !this.config.secretId) {
      throw new Error('AppRole credentials not configured');
    }

    const start = Date.now();

    try {
      const response = await this.http.write('auth/approle/login', {
        role_id: this.config.roleId,
        secret_id: this.config.secretId,
      });

      if (!response.auth) {
        throw new Error('No auth data in AppRole response');
      }

      this.token = response.auth.client_token;
      this.tokenExpiresAt = new Date(Date.now() + response.auth.lease_duration * 1000);

      this.metrics.operations.inc({ operation: 'auth', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'auth' },
        (Date.now() - start) / 1000
      );

      this.log.info(
        { leaseDuration: response.auth.lease_duration },
        'Authenticated with Vault via AppRole'
      );

      // Schedule token renewal
      this.scheduleTokenRenewal(response.auth.lease_duration);
    } catch (error) {
      this.metrics.operations.inc({ operation: 'auth', status: 'error' });
      this.log.error({ error }, 'AppRole authentication failed');
      throw error;
    }
  }

  /**
   * Schedule automatic token renewal.
   */
  private scheduleTokenRenewal(leaseDuration: number): void {
    // Clear existing timer
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    // Renew at 50% of TTL
    const renewalDelay = Math.floor(leaseDuration * VAULT_CONFIG_DEFAULTS.TOKEN_RENEWAL_THRESHOLD * 1000);

    this.renewalTimer = setTimeout(async () => {
      try {
        await this.renewToken();
      } catch (error) {
        this.log.error({ error }, 'Token renewal failed, re-authenticating');
        await this.authenticateAppRole();
      }
    }, renewalDelay);

    this.log.debug({ renewalDelay }, 'Token renewal scheduled');
  }

  // ===========================================================================
  // Transit Operations
  // ===========================================================================

  async sign(keyName: string, data: string): Promise<string> {
    const start = Date.now();

    try {
      const input = Buffer.from(data).toString('base64');

      const response = await this.http.write(
        `${this.transitPath}/sign/${keyName}`,
        { input }
      );

      const signature = response.data.signature as string;

      this.metrics.operations.inc({ operation: 'sign', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'sign' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ keyName }, 'Data signed');
      return signature;
    } catch (error) {
      this.metrics.operations.inc({ operation: 'sign', status: 'error' });
      this.log.error({ error, keyName }, 'Vault sign failed');
      throw error;
    }
  }

  async verify(keyName: string, data: string, signature: string): Promise<boolean> {
    const start = Date.now();

    try {
      const input = Buffer.from(data).toString('base64');

      const response = await this.http.write(
        `${this.transitPath}/verify/${keyName}`,
        { input, signature }
      );

      const valid = response.data.valid as boolean;

      this.metrics.operations.inc({ operation: 'verify', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'verify' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ keyName, valid }, 'Signature verified');
      return valid;
    } catch (error) {
      this.metrics.operations.inc({ operation: 'verify', status: 'error' });
      this.log.error({ error, keyName }, 'Vault verify failed');
      throw error;
    }
  }

  async encrypt(keyName: string, plaintext: string): Promise<string> {
    const start = Date.now();

    try {
      const plaintextBase64 = Buffer.from(plaintext).toString('base64');

      const response = await this.http.write(
        `${this.transitPath}/encrypt/${keyName}`,
        { plaintext: plaintextBase64 }
      );

      const ciphertext = response.data.ciphertext as string;

      this.metrics.operations.inc({ operation: 'encrypt', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'encrypt' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ keyName }, 'Data encrypted');
      return ciphertext;
    } catch (error) {
      this.metrics.operations.inc({ operation: 'encrypt', status: 'error' });
      this.log.error({ error, keyName }, 'Vault encrypt failed');
      throw error;
    }
  }

  async decrypt(keyName: string, ciphertext: string): Promise<string> {
    const start = Date.now();

    try {
      const response = await this.http.write(
        `${this.transitPath}/decrypt/${keyName}`,
        { ciphertext }
      );

      const plaintextBase64 = response.data.plaintext as string;
      const plaintext = Buffer.from(plaintextBase64, 'base64').toString('utf8');

      this.metrics.operations.inc({ operation: 'decrypt', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'decrypt' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ keyName }, 'Data decrypted');
      return plaintext;
    } catch (error) {
      this.metrics.operations.inc({ operation: 'decrypt', status: 'error' });
      this.log.error({ error, keyName }, 'Vault decrypt failed');
      throw error;
    }
  }

  async rotateKey(keyName: string): Promise<void> {
    const start = Date.now();

    try {
      await this.http.write(`${this.transitPath}/keys/${keyName}/rotate`, {});

      this.metrics.operations.inc({ operation: 'rotate', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'rotate' },
        (Date.now() - start) / 1000
      );
      this.metrics.keyRotations.inc({ key: keyName });

      this.log.info({ keyName }, 'Transit key rotated');
    } catch (error) {
      this.metrics.operations.inc({ operation: 'rotate', status: 'error' });
      this.log.error({ error, keyName }, 'Key rotation failed');
      throw error;
    }
  }

  async getKeyInfo(keyName: string): Promise<TransitKeyInfo> {
    const start = Date.now();

    try {
      const response = await this.http.read(`${this.transitPath}/keys/${keyName}`);
      const data = response.data;

      this.metrics.operations.inc({ operation: 'getKey', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'getKey' },
        (Date.now() - start) / 1000
      );

      return {
        name: data.name as string,
        type: data.type as string,
        latestVersion: data.latest_version as number,
        minDecryptionVersion: data.min_decryption_version as number,
        supportsEncryption: data.supports_encryption as boolean,
        supportsDecryption: data.supports_decryption as boolean,
        supportsSigning: data.supports_signing as boolean,
        exportable: data.exportable as boolean,
        deletionAllowed: data.deletion_allowed as boolean,
      };
    } catch (error) {
      this.metrics.operations.inc({ operation: 'getKey', status: 'error' });
      this.log.error({ error, keyName }, 'Get key info failed');
      throw error;
    }
  }

  // ===========================================================================
  // KV v2 Operations
  // ===========================================================================

  async getSecret(path: string): Promise<Record<string, string>> {
    const start = Date.now();

    try {
      const response = await this.http.read(`${this.kvPath}/data/${path}`);
      const secrets = (response.data.data as Record<string, string>) ?? {};

      this.metrics.operations.inc({ operation: 'getSecret', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'getSecret' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ path }, 'Secret retrieved');
      return secrets;
    } catch (error) {
      this.metrics.operations.inc({ operation: 'getSecret', status: 'error' });
      this.log.error({ error, path }, 'Get secret failed');
      throw error;
    }
  }

  async putSecret(path: string, data: Record<string, string>): Promise<void> {
    const start = Date.now();

    try {
      await this.http.write(`${this.kvPath}/data/${path}`, { data });

      this.metrics.operations.inc({ operation: 'putSecret', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'putSecret' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ path }, 'Secret stored');
    } catch (error) {
      this.metrics.operations.inc({ operation: 'putSecret', status: 'error' });
      this.log.error({ error, path }, 'Put secret failed');
      throw error;
    }
  }

  async deleteSecret(path: string): Promise<void> {
    const start = Date.now();

    try {
      await this.http.delete(`${this.kvPath}/data/${path}`);

      this.metrics.operations.inc({ operation: 'deleteSecret', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'deleteSecret' },
        (Date.now() - start) / 1000
      );

      this.log.debug({ path }, 'Secret deleted');
    } catch (error) {
      this.metrics.operations.inc({ operation: 'deleteSecret', status: 'error' });
      this.log.error({ error, path }, 'Delete secret failed');
      throw error;
    }
  }

  // ===========================================================================
  // Health & Lifecycle
  // ===========================================================================

  async health(): Promise<VaultHealthStatus> {
    const start = Date.now();

    try {
      const response = await this.http.health();

      this.metrics.operations.inc({ operation: 'health', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'health' },
        (Date.now() - start) / 1000
      );

      return {
        sealed: response.sealed,
        initialized: response.initialized,
        version: response.version,
        clusterName: response.cluster_name,
      };
    } catch (error) {
      this.metrics.operations.inc({ operation: 'health', status: 'error' });
      throw error;
    }
  }

  async renewToken(): Promise<void> {
    const start = Date.now();

    try {
      const response = await this.http.write('auth/token/renew-self', {});

      if (response.auth) {
        this.tokenExpiresAt = new Date(Date.now() + response.auth.lease_duration * 1000);
        this.scheduleTokenRenewal(response.auth.lease_duration);
      }

      this.metrics.operations.inc({ operation: 'renewToken', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'renewToken' },
        (Date.now() - start) / 1000
      );
      this.metrics.tokenRenewals.inc();

      this.log.info('Token renewed');
    } catch (error) {
      this.metrics.operations.inc({ operation: 'renewToken', status: 'error' });
      this.log.error({ error }, 'Token renewal failed');
      throw error;
    }
  }

  async revokeToken(): Promise<void> {
    const start = Date.now();

    try {
      // Clear renewal timer
      if (this.renewalTimer) {
        clearTimeout(this.renewalTimer);
        this.renewalTimer = null;
      }

      await this.http.write('auth/token/revoke-self', {});

      this.token = null;
      this.tokenExpiresAt = null;

      this.metrics.operations.inc({ operation: 'revokeToken', status: 'success' });
      this.metrics.latency.observe(
        { operation: 'revokeToken' },
        (Date.now() - start) / 1000
      );

      this.log.info('Token revoked');
    } catch (error) {
      this.metrics.operations.inc({ operation: 'revokeToken', status: 'error' });
      this.log.error({ error }, 'Token revocation failed');
      throw error;
    }
  }

  /**
   * Get current token (for HTTP client).
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Check if token is valid and not expired.
   */
  isTokenValid(): boolean {
    if (!this.token) return false;
    if (!this.tokenExpiresAt) return true; // Static token
    return this.tokenExpiresAt > new Date();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a Vault client.
 *
 * @param options - Client options
 * @returns Vault client instance
 */
export function createVaultClient(options: VaultClientOptions): VaultClient {
  return new VaultClient(options);
}
