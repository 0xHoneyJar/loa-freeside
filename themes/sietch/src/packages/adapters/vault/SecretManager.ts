/**
 * SecretManager - HashiCorp Vault KV Secrets Manager
 *
 * Sprint 71: Vault Transit Integration - CRIT-2
 *
 * Manages secrets from HashiCorp Vault KV secrets engine with:
 * - Dynamic secret retrieval
 * - TTL-based caching (1 hour default)
 * - Fallback to environment variables
 * - Audit logging for secret access
 *
 * Configuration:
 * - VAULT_ADDR: Vault server address
 * - VAULT_TOKEN: Authentication token
 * - VAULT_NAMESPACE: Optional namespace (for Vault Enterprise)
 *
 * @module packages/adapters/vault/SecretManager
 */

import nodeVault from 'node-vault';
import type { VaultOptions } from 'node-vault';
import type { Logger } from 'pino';

/**
 * Secret access audit log entry
 */
export interface SecretAuditLog {
  timestamp: Date;
  operation: 'read' | 'cache_hit' | 'fallback';
  secretPath: string;
  source: 'vault' | 'cache' | 'env';
  success: boolean;
  error?: string;
  ttlRemaining?: number;
}

/**
 * Cached secret with TTL tracking
 */
interface CachedSecret {
  value: string;
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * Configuration for SecretManager
 */
export interface SecretManagerConfig {
  /** Vault server address (e.g., 'https://vault.honeyjar.xyz') */
  vaultAddr: string;
  /** Vault authentication token */
  vaultToken: string;
  /** Optional Vault namespace (Vault Enterprise) */
  vaultNamespace?: string;
  /** KV secrets engine mount path (defaults to 'secret') */
  kvMountPath?: string;
  /** KV version (1 or 2, defaults to 2) */
  kvVersion?: 1 | 2;
  /** Cache TTL in seconds (defaults to 3600 = 1 hour) */
  cacheTtlSeconds?: number;
  /** Request timeout in milliseconds (defaults to 5000) */
  requestTimeout?: number;
  /** Enable fallback to environment variables (defaults to true) */
  enableEnvFallback?: boolean;
  /** Enable audit logging (defaults to true) */
  auditLogging?: boolean;
  /** Logger instance for structured logging */
  logger?: Logger;
}

/**
 * Well-known secret paths in Vault
 */
export const SecretPaths = {
  /** Discord bot token */
  DISCORD_BOT_TOKEN: 'arrakis/discord/bot-token',
  /** Paddle API key */
  PADDLE_API_KEY: 'arrakis/paddle/api-key',
  /** Paddle webhook secret */
  PADDLE_WEBHOOK_SECRET: 'arrakis/paddle/webhook-secret',
  /** Paddle client token */
  PADDLE_CLIENT_TOKEN: 'arrakis/paddle/client-token',
  /** Telegram bot token */
  TELEGRAM_BOT_TOKEN: 'arrakis/telegram/bot-token',
  /** Telegram webhook secret */
  TELEGRAM_WEBHOOK_SECRET: 'arrakis/telegram/webhook-secret',
  /** API key pepper for hashing */
  API_KEY_PEPPER: 'arrakis/security/api-key-pepper',
  /** Rate limit salt */
  RATE_LIMIT_SALT: 'arrakis/security/rate-limit-salt',
  /** Trigger.dev secret key */
  TRIGGER_SECRET_KEY: 'arrakis/trigger/secret-key',
  /** Database URL (PostgreSQL connection string) */
  DATABASE_URL: 'arrakis/database/url',
  /** Redis URL */
  REDIS_URL: 'arrakis/redis/url',
} as const;

/**
 * Environment variable mappings for fallback
 */
const EnvFallbackMap: Record<string, string> = {
  [SecretPaths.DISCORD_BOT_TOKEN]: 'DISCORD_BOT_TOKEN',
  [SecretPaths.PADDLE_API_KEY]: 'PADDLE_API_KEY',
  [SecretPaths.PADDLE_WEBHOOK_SECRET]: 'PADDLE_WEBHOOK_SECRET',
  [SecretPaths.PADDLE_CLIENT_TOKEN]: 'PADDLE_CLIENT_TOKEN',
  [SecretPaths.TELEGRAM_BOT_TOKEN]: 'TELEGRAM_BOT_TOKEN',
  [SecretPaths.TELEGRAM_WEBHOOK_SECRET]: 'TELEGRAM_WEBHOOK_SECRET',
  [SecretPaths.API_KEY_PEPPER]: 'API_KEY_PEPPER',
  [SecretPaths.RATE_LIMIT_SALT]: 'RATE_LIMIT_SALT',
  [SecretPaths.TRIGGER_SECRET_KEY]: 'TRIGGER_SECRET_KEY',
  [SecretPaths.DATABASE_URL]: 'DATABASE_URL',
  [SecretPaths.REDIS_URL]: 'REDIS_URL',
};

/**
 * SecretManager - Dynamic secret retrieval from HashiCorp Vault
 *
 * Provides secure secret management with:
 * - Vault KV v2 secrets engine support
 * - In-memory caching with configurable TTL
 * - Automatic fallback to environment variables
 * - Comprehensive audit logging
 *
 * @example
 * ```typescript
 * const manager = new SecretManager({
 *   vaultAddr: process.env.VAULT_ADDR!,
 *   vaultToken: process.env.VAULT_TOKEN!,
 *   cacheTtlSeconds: 3600,
 *   logger: pino()
 * });
 *
 * const discordToken = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
 * ```
 */
export class SecretManager {
  private vault: ReturnType<typeof nodeVault>;
  private config: Required<SecretManagerConfig>;
  private cache: Map<string, CachedSecret> = new Map();
  private auditLogs: SecretAuditLog[] = [];
  private ready: boolean = false;

  constructor(config: SecretManagerConfig) {
    // Set defaults
    this.config = {
      vaultAddr: config.vaultAddr,
      vaultToken: config.vaultToken,
      vaultNamespace: config.vaultNamespace,
      kvMountPath: config.kvMountPath || 'secret',
      kvVersion: config.kvVersion || 2,
      cacheTtlSeconds: config.cacheTtlSeconds || 3600,
      requestTimeout: config.requestTimeout || 5000,
      enableEnvFallback: config.enableEnvFallback !== false,
      auditLogging: config.auditLogging !== false,
      logger: config.logger,
    } as Required<SecretManagerConfig>;

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
  }

  /**
   * Initialize the secret manager
   * Tests Vault connectivity and verifies KV engine access
   */
  async initialize(): Promise<void> {
    try {
      // Verify Vault connectivity
      await this.vault.health();

      // Check KV mount exists (optional, may fail without permission)
      try {
        await this.vault.mounts();
      } catch {
        this.log('warn', 'Could not verify KV mount (may require admin permissions)');
      }

      this.ready = true;
      this.log('info', 'SecretManager initialized successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('error', `SecretManager initialization failed: ${message}`);
      throw new VaultSecretError(`Failed to initialize SecretManager: ${message}`);
    }
  }

  /**
   * Get a secret value
   *
   * Resolution order:
   * 1. Check in-memory cache
   * 2. Fetch from Vault
   * 3. Fallback to environment variable (if enabled)
   *
   * @param path - Secret path (e.g., 'arrakis/discord/bot-token')
   * @returns Secret value
   * @throws VaultSecretError if secret cannot be retrieved
   */
  async getSecret(path: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(path);
    if (cached && new Date() < cached.expiresAt) {
      this.logAudit({
        timestamp: new Date(),
        operation: 'cache_hit',
        secretPath: path,
        source: 'cache',
        success: true,
        ttlRemaining: Math.floor((cached.expiresAt.getTime() - Date.now()) / 1000),
      });
      return cached.value;
    }

    // Try Vault
    try {
      const value = await this.fetchFromVault(path);
      this.cacheSecret(path, value);
      this.logAudit({
        timestamp: new Date(),
        operation: 'read',
        secretPath: path,
        source: 'vault',
        success: true,
      });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log('warn', `Vault secret fetch failed for ${path}: ${message}`);

      // Try environment fallback
      if (this.config.enableEnvFallback) {
        const envVar = EnvFallbackMap[path];
        if (envVar && process.env[envVar]) {
          this.logAudit({
            timestamp: new Date(),
            operation: 'fallback',
            secretPath: path,
            source: 'env',
            success: true,
          });
          this.log('warn', `Using environment fallback for ${path} -> ${envVar}`);
          return process.env[envVar]!;
        }
      }

      // Log failure and throw
      this.logAudit({
        timestamp: new Date(),
        operation: 'read',
        secretPath: path,
        source: 'vault',
        success: false,
        error: message,
      });
      throw new VaultSecretError(`Failed to retrieve secret ${path}: ${message}`);
    }
  }

  /**
   * Get a secret, returning undefined if not found
   * Useful for optional secrets
   */
  async getSecretOptional(path: string): Promise<string | undefined> {
    try {
      return await this.getSecret(path);
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a secret exists in Vault
   */
  async hasSecret(path: string): Promise<boolean> {
    try {
      await this.getSecret(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate a cached secret
   * Forces re-fetch on next access
   */
  invalidateCache(path: string): void {
    this.cache.delete(path);
    this.log('debug', `Cache invalidated for ${path}`);
  }

  /**
   * Invalidate all cached secrets
   */
  invalidateAllCache(): void {
    this.cache.clear();
    this.log('debug', 'All cache invalidated');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; paths: string[]; hitRate: number } {
    const reads = this.auditLogs.filter((l) => l.operation === 'read').length;
    const cacheHits = this.auditLogs.filter((l) => l.operation === 'cache_hit').length;
    const total = reads + cacheHits;

    return {
      size: this.cache.size,
      paths: Array.from(this.cache.keys()),
      hitRate: total > 0 ? cacheHits / total : 0,
    };
  }

  /**
   * Get audit logs
   */
  getAuditLogs(): SecretAuditLog[] {
    return [...this.auditLogs];
  }

  /**
   * Clear audit logs
   */
  clearAuditLogs(): void {
    this.auditLogs = [];
  }

  /**
   * Check if the manager is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.vault.health();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch secret from Vault KV engine
   */
  private async fetchFromVault(path: string): Promise<string> {
    const fullPath =
      this.config.kvVersion === 2
        ? `${this.config.kvMountPath}/data/${path}`
        : `${this.config.kvMountPath}/${path}`;

    try {
      const response = await this.vault.read(fullPath);

      // KV v2 has data nested
      const data = this.config.kvVersion === 2 ? response.data?.data : response.data;

      if (!data?.value) {
        throw new Error(`Secret has no 'value' field`);
      }

      return data.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new VaultSecretError(`Vault read failed: ${message}`);
    }
  }

  /**
   * Cache a secret with TTL
   */
  private cacheSecret(path: string, value: string): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.cacheTtlSeconds * 1000);

    this.cache.set(path, {
      value,
      cachedAt: now,
      expiresAt,
    });
  }

  /**
   * Log an audit entry
   */
  private logAudit(entry: SecretAuditLog): void {
    if (this.config.auditLogging) {
      this.auditLogs.push(entry);

      // Keep only last 1000 entries
      if (this.auditLogs.length > 1000) {
        this.auditLogs = this.auditLogs.slice(-1000);
      }
    }
  }

  /**
   * Internal logging helper
   */
  private log(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', message: string): void {
    if (this.config.logger) {
      this.config.logger[level]({ module: 'SecretManager' }, message);
    }
  }
}

/**
 * Error class for Vault secret operations
 */
export class VaultSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultSecretError';
    Object.setPrototypeOf(this, VaultSecretError.prototype);
  }
}

/**
 * Create a SecretManager instance from config
 */
export function createSecretManager(
  vaultAddr: string,
  vaultToken: string,
  options: Partial<SecretManagerConfig> = {}
): SecretManager {
  return new SecretManager({
    vaultAddr,
    vaultToken,
    ...options,
  });
}
