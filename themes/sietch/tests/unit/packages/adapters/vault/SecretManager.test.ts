/**
 * SecretManager Tests
 *
 * Sprint 71: Vault Transit Integration - CRIT-2
 *
 * Tests for SecretManager with mocked Vault client.
 * Comprehensive coverage of Vault KV secrets retrieval.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SecretManager,
  SecretPaths,
  VaultSecretError,
  createSecretManager,
} from '../../../../../src/packages/adapters/vault/SecretManager.js';
import type { SecretManagerConfig } from '../../../../../src/packages/adapters/vault/SecretManager.js';

// Mock node-vault
vi.mock('node-vault', () => {
  return {
    default: vi.fn(() => mockVaultClient),
  };
});

let mockVaultClient: any;

describe('SecretManager', () => {
  let manager: SecretManager;
  let config: SecretManagerConfig;

  beforeEach(() => {
    // Reset mock
    mockVaultClient = {
      health: vi.fn().mockResolvedValue({ initialized: true, sealed: false }),
      mounts: vi.fn().mockResolvedValue({}),
      read: vi.fn(),
    };

    config = {
      vaultAddr: 'https://vault.test',
      vaultToken: 'test-token',
      kvMountPath: 'secret',
      kvVersion: 2,
      cacheTtlSeconds: 60,
      enableEnvFallback: true,
      auditLogging: true,
    };

    // Clear environment for tests
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.PADDLE_API_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with valid configuration', async () => {
      manager = new SecretManager(config);
      await manager.initialize();
      expect(manager.isReady()).toBe(true);
    });

    it('should use default values for optional config', () => {
      const minimalConfig = {
        vaultAddr: 'https://vault.test',
        vaultToken: 'test-token',
      };
      manager = new SecretManager(minimalConfig);
      expect(manager).toBeDefined();
    });

    it('should throw VaultSecretError if initialization fails', async () => {
      mockVaultClient.health.mockRejectedValueOnce(new Error('Connection refused'));
      manager = new SecretManager(config);

      await expect(manager.initialize()).rejects.toThrow(VaultSecretError);
    });

    it('should handle mounts permission error gracefully', async () => {
      mockVaultClient.mounts.mockRejectedValueOnce(new Error('Permission denied'));
      manager = new SecretManager(config);

      // Should not throw - just logs warning
      await expect(manager.initialize()).resolves.not.toThrow();
      expect(manager.isReady()).toBe(true);
    });
  });

  describe('Secret Retrieval', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
      await manager.initialize();
    });

    it('should retrieve secret from Vault KV v2', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          data: {
            value: 'super-secret-token',
          },
        },
      });

      const result = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe('super-secret-token');
      expect(mockVaultClient.read).toHaveBeenCalledWith('secret/data/arrakis/discord/bot-token');
    });

    it('should cache secrets with TTL', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          data: {
            value: 'cached-secret',
          },
        },
      });

      // First call - fetches from Vault
      const result1 = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      expect(result1).toBe('cached-secret');
      expect(mockVaultClient.read).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      expect(result2).toBe('cached-secret');
      expect(mockVaultClient.read).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should fallback to environment variable when Vault fails', async () => {
      process.env.DISCORD_BOT_TOKEN = 'env-fallback-token';
      mockVaultClient.read.mockRejectedValueOnce(new Error('Secret not found'));

      const result = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe('env-fallback-token');
    });

    it('should throw when secret not found and no fallback', async () => {
      mockVaultClient.read.mockRejectedValueOnce(new Error('Secret not found'));

      await expect(manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN)).rejects.toThrow(
        VaultSecretError
      );
    });

    it('should respect enableEnvFallback=false', async () => {
      const noFallbackConfig = { ...config, enableEnvFallback: false };
      manager = new SecretManager(noFallbackConfig);
      await manager.initialize();

      process.env.DISCORD_BOT_TOKEN = 'should-not-use';
      mockVaultClient.read.mockRejectedValueOnce(new Error('Secret not found'));

      await expect(manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN)).rejects.toThrow(
        VaultSecretError
      );
    });

    it('should throw when secret has no value field', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          data: {
            // Missing 'value' field
            other: 'data',
          },
        },
      });

      await expect(manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN)).rejects.toThrow(
        VaultSecretError
      );
    });
  });

  describe('getSecretOptional', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
      await manager.initialize();
    });

    it('should return undefined when secret not found', async () => {
      mockVaultClient.read.mockRejectedValueOnce(new Error('Secret not found'));

      const result = await manager.getSecretOptional(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBeUndefined();
    });

    it('should return secret value when found', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          data: {
            value: 'optional-secret',
          },
        },
      });

      const result = await manager.getSecretOptional(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe('optional-secret');
    });
  });

  describe('hasSecret', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
      await manager.initialize();
    });

    it('should return true when secret exists', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          data: {
            value: 'exists',
          },
        },
      });

      const result = await manager.hasSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      mockVaultClient.read.mockRejectedValueOnce(new Error('Secret not found'));

      const result = await manager.hasSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe(false);
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
      await manager.initialize();
    });

    it('should invalidate single cache entry', async () => {
      mockVaultClient.read
        .mockResolvedValueOnce({
          data: { data: { value: 'first' } },
        })
        .mockResolvedValueOnce({
          data: { data: { value: 'second' } },
        });

      // First call
      const result1 = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      expect(result1).toBe('first');

      // Invalidate cache
      manager.invalidateCache(SecretPaths.DISCORD_BOT_TOKEN);

      // Second call should fetch fresh
      const result2 = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      expect(result2).toBe('second');
      expect(mockVaultClient.read).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all cache entries', async () => {
      mockVaultClient.read
        .mockResolvedValueOnce({ data: { data: { value: 'token1' } } })
        .mockResolvedValueOnce({ data: { data: { value: 'key1' } } })
        .mockResolvedValueOnce({ data: { data: { value: 'token2' } } })
        .mockResolvedValueOnce({ data: { data: { value: 'key2' } } });

      // Cache two secrets
      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      await manager.getSecret(SecretPaths.PADDLE_API_KEY);

      // Invalidate all
      manager.invalidateAllCache();

      // Both should fetch fresh
      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      await manager.getSecret(SecretPaths.PADDLE_API_KEY);

      expect(mockVaultClient.read).toHaveBeenCalledTimes(4);
    });

    it('should report cache statistics', async () => {
      mockVaultClient.read.mockResolvedValue({
        data: { data: { value: 'test' } },
      });

      // First call (cache miss)
      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      // Second call (cache hit)
      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      const stats = manager.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.paths).toContain(SecretPaths.DISCORD_BOT_TOKEN);
      expect(stats.hitRate).toBe(0.5); // 1 hit / 2 total
    });
  });

  describe('Audit Logging', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
      await manager.initialize();
    });

    it('should log audit events for secret access', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: { data: { value: 'audited-secret' } },
      });

      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      const logs = manager.getAuditLogs();

      expect(logs.length).toBe(1);
      expect(logs[0]).toMatchObject({
        operation: 'read',
        secretPath: SecretPaths.DISCORD_BOT_TOKEN,
        source: 'vault',
        success: true,
      });
      expect(logs[0].timestamp).toBeInstanceOf(Date);
    });

    it('should log cache hits', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: { data: { value: 'cached' } },
      });

      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);
      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      const logs = manager.getAuditLogs();

      expect(logs.length).toBe(2);
      expect(logs[1].operation).toBe('cache_hit');
      expect(logs[1].source).toBe('cache');
    });

    it('should log fallback events', async () => {
      process.env.DISCORD_BOT_TOKEN = 'fallback';
      mockVaultClient.read.mockRejectedValueOnce(new Error('Not found'));

      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      const logs = manager.getAuditLogs();

      expect(logs.length).toBe(1);
      expect(logs[0]).toMatchObject({
        operation: 'fallback',
        source: 'env',
        success: true,
      });
    });

    it('should clear audit logs', async () => {
      mockVaultClient.read.mockResolvedValue({
        data: { data: { value: 'test' } },
      });

      await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(manager.getAuditLogs().length).toBe(1);

      manager.clearAuditLogs();

      expect(manager.getAuditLogs().length).toBe(0);
    });
  });

  describe('Health Check', () => {
    beforeEach(async () => {
      manager = new SecretManager(config);
    });

    it('should return healthy status when Vault is accessible', async () => {
      await manager.initialize();

      mockVaultClient.health.mockResolvedValueOnce({ initialized: true });

      const health = await manager.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      expect(health.error).toBeUndefined();
    });

    it('should return unhealthy status when Vault is inaccessible', async () => {
      await manager.initialize();

      mockVaultClient.health.mockRejectedValueOnce(new Error('Connection timeout'));

      const health = await manager.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.error).toBe('Connection timeout');
    });
  });

  describe('KV v1 Support', () => {
    it('should support KV v1 engine', async () => {
      const v1Config = { ...config, kvVersion: 1 as const };
      manager = new SecretManager(v1Config);
      await manager.initialize();

      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          value: 'v1-secret',
        },
      });

      const result = await manager.getSecret(SecretPaths.DISCORD_BOT_TOKEN);

      expect(result).toBe('v1-secret');
      // KV v1 path doesn't have 'data' in the middle
      expect(mockVaultClient.read).toHaveBeenCalledWith('secret/arrakis/discord/bot-token');
    });
  });

  describe('createSecretManager factory', () => {
    it('should create SecretManager with minimal config', () => {
      const sm = createSecretManager('https://vault.test', 'token');
      expect(sm).toBeInstanceOf(SecretManager);
    });

    it('should accept additional options', () => {
      const sm = createSecretManager('https://vault.test', 'token', {
        cacheTtlSeconds: 120,
        enableEnvFallback: false,
      });
      expect(sm).toBeInstanceOf(SecretManager);
    });
  });

  describe('SecretPaths', () => {
    it('should define all expected secret paths', () => {
      expect(SecretPaths.DISCORD_BOT_TOKEN).toBe('arrakis/discord/bot-token');
      expect(SecretPaths.PADDLE_API_KEY).toBe('arrakis/paddle/api-key');
      expect(SecretPaths.PADDLE_WEBHOOK_SECRET).toBe('arrakis/paddle/webhook-secret');
      expect(SecretPaths.TELEGRAM_BOT_TOKEN).toBe('arrakis/telegram/bot-token');
      expect(SecretPaths.API_KEY_PEPPER).toBe('arrakis/security/api-key-pepper');
      expect(SecretPaths.DATABASE_URL).toBe('arrakis/database/url');
      expect(SecretPaths.REDIS_URL).toBe('arrakis/redis/url');
    });
  });
});
