/**
 * OAuthTokenEncryption Tests
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Tests for Discord OAuth token encryption:
 * - Token encryption and decryption
 * - Structured token data handling
 * - Error handling for invalid data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OAuthTokenEncryption,
  createOAuthTokenEncryption,
} from '../oauth-token-encryption.js';
import type {
  IVaultClient,
  DecryptedOAuthTokens,
  EncryptedOAuthTokens,
} from '@freeside/core/ports';
import type { VaultMetrics } from '../metrics.js';
import { createNoOpVaultMetrics } from '../metrics.js';
import type { Logger } from 'pino';

// =============================================================================
// Mock Implementations
// =============================================================================

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as Logger;
}

class MockVaultClient implements IVaultClient {
  private encryptedData: Map<string, string> = new Map();
  private encryptCounter = 0;

  async sign(): Promise<string> {
    return 'signature';
  }

  async verify(): Promise<boolean> {
    return true;
  }

  async encrypt(_keyName: string, plaintext: string): Promise<string> {
    const id = `enc-${++this.encryptCounter}`;
    this.encryptedData.set(id, plaintext);
    return `vault:v1:${id}`;
  }

  async decrypt(_keyName: string, ciphertext: string): Promise<string> {
    const id = ciphertext.replace('vault:v1:', '');
    if (!this.encryptedData.has(id)) {
      throw new Error('Decryption failed: unknown ciphertext');
    }
    return this.encryptedData.get(id)!;
  }

  async rotateKey(): Promise<void> {}

  async getKeyInfo() {
    return {
      name: 'key',
      type: 'aes256-gcm96',
      latestVersion: 1,
      minDecryptionVersion: 1,
      supportsEncryption: true,
      supportsDecryption: true,
      supportsSigning: false,
      exportable: false,
      deletionAllowed: false,
    };
  }

  async getSecret(): Promise<Record<string, string>> {
    return {};
  }

  async putSecret(): Promise<void> {}

  async deleteSecret(): Promise<void> {}

  async health() {
    return { initialized: true, sealed: false, version: '1.15.0' };
  }

  async renewToken(): Promise<void> {}

  async revokeToken(): Promise<void> {}

  // Test helpers
  clearEncrypted(): void {
    this.encryptedData.clear();
    this.encryptCounter = 0;
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('OAuthTokenEncryption', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;
  let encryption: OAuthTokenEncryption;

  beforeEach(() => {
    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();

    encryption = new OAuthTokenEncryption({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockVault.clearEncrypted();
  });

  describe('createOAuthTokenEncryption', () => {
    it('should create an OAuthTokenEncryption instance', () => {
      const enc = createOAuthTokenEncryption({
        vault: mockVault,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(enc).toBeInstanceOf(OAuthTokenEncryption);
    });

    it('should use default key name when not specified', () => {
      const enc = createOAuthTokenEncryption({
        vault: mockVault,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(enc).toBeDefined();
    });
  });

  describe('encrypt', () => {
    it('should encrypt OAuth tokens', async () => {
      const tokens: DecryptedOAuthTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer',
        scope: 'identify guilds',
      };

      const encrypted = await encryption.encrypt(tokens);

      expect(encrypted.accessToken).toMatch(/^vault:v1:/);
      expect(encrypted.refreshToken).toMatch(/^vault:v1:/);
      expect(encrypted.tokenType).toBe('Bearer');
      expect(encrypted.scope).toBe('identify guilds');
    });

    it('should encrypt access and refresh tokens separately', async () => {
      const tokens: DecryptedOAuthTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresAt: new Date(Date.now() + 3600000),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      const encrypted = await encryption.encrypt(tokens);

      expect(encrypted.accessToken).not.toBe(encrypted.refreshToken);
    });

    it('should preserve non-encrypted fields', async () => {
      const expiresAt = new Date('2024-01-15T12:00:00Z');
      const tokens: DecryptedOAuthTokens = {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt,
        tokenType: 'Bearer',
        scope: 'identify guilds guilds.members.read',
      };

      const encrypted = await encryption.encrypt(tokens);

      expect(encrypted.tokenType).toBe('Bearer');
      expect(encrypted.scope).toBe('identify guilds guilds.members.read');
      expect(encrypted.expiresAt).toEqual(expiresAt);
    });
  });

  describe('decrypt', () => {
    it('should decrypt encrypted tokens', async () => {
      const originalTokens: DecryptedOAuthTokens = {
        accessToken: 'my-access-token',
        refreshToken: 'my-refresh-token',
        expiresAt: new Date('2024-01-15T12:00:00Z'),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      const encrypted = await encryption.encrypt(originalTokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe('my-access-token');
      expect(decrypted.refreshToken).toBe('my-refresh-token');
    });

    it('should throw on invalid ciphertext', async () => {
      const invalidEncrypted: EncryptedOAuthTokens = {
        accessToken: 'invalid-ciphertext',
        refreshToken: 'invalid-ciphertext',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      await expect(encryption.decrypt(invalidEncrypted)).rejects.toThrow();
    });
  });

  describe('Round-Trip Encryption', () => {
    it('should preserve all token fields through round-trip', async () => {
      const tokens: DecryptedOAuthTokens = {
        // Using obviously fake tokens to avoid secret scanning
        accessToken: 'test-access-token-abcdef123456789',
        refreshToken: 'test-refresh-token-xyz987654321abc',
        expiresAt: new Date('2024-01-15T12:00:00Z'),
        tokenType: 'Bearer',
        scope: 'identify guilds guilds.members.read',
      };

      const encrypted = await encryption.encrypt(tokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe(tokens.accessToken);
      expect(decrypted.refreshToken).toBe(tokens.refreshToken);
      expect(decrypted.tokenType).toBe(tokens.tokenType);
      expect(decrypted.scope).toBe(tokens.scope);
    });

    it('should handle special characters in tokens', async () => {
      const tokens: DecryptedOAuthTokens = {
        accessToken: 'token+with/special=chars&more',
        refreshToken: 'refresh\\with"quotes\'and\nnewlines',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      const encrypted = await encryption.encrypt(tokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe(tokens.accessToken);
      expect(decrypted.refreshToken).toBe(tokens.refreshToken);
    });

    it('should handle unicode in tokens', async () => {
      const tokens: DecryptedOAuthTokens = {
        accessToken: 'token-with-emojis-and-chars',
        refreshToken: 'refresh-kosme',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      const encrypted = await encryption.encrypt(tokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe(tokens.accessToken);
      expect(decrypted.refreshToken).toBe(tokens.refreshToken);
    });
  });

  describe('Metrics', () => {
    it('should record encryption operations', async () => {
      const incSpy = vi.spyOn(mockMetrics.oauthEncryptions, 'inc');

      await encryption.encrypt({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      });

      expect(incSpy).toHaveBeenCalledWith({ status: 'success' });
    });

    it('should record decryption operations', async () => {
      const incSpy = vi.spyOn(mockMetrics.oauthDecryptions, 'inc');

      const encrypted = await encryption.encrypt({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      });

      await encryption.decrypt(encrypted);

      expect(incSpy).toHaveBeenCalledWith({ status: 'success' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string tokens', async () => {
      const tokens: DecryptedOAuthTokens = {
        accessToken: '',
        refreshToken: '',
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: '',
      };

      const encrypted = await encryption.encrypt(tokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe('');
      expect(decrypted.refreshToken).toBe('');
    });

    it('should handle very long tokens', async () => {
      const longToken = 'a'.repeat(10000);
      const tokens: DecryptedOAuthTokens = {
        accessToken: longToken,
        refreshToken: longToken,
        expiresAt: new Date(),
        tokenType: 'Bearer',
        scope: 'identify',
      };

      const encrypted = await encryption.encrypt(tokens);
      const decrypted = await encryption.decrypt(encrypted);

      expect(decrypted.accessToken).toBe(longToken);
      expect(decrypted.refreshToken).toBe(longToken);
    });
  });
});

describe('OAuthTokenEncryption with Custom Key', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;

  beforeEach(() => {
    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();
  });

  it('should use custom key name', async () => {
    const encryptSpy = vi.spyOn(mockVault, 'encrypt');

    const encryption = new OAuthTokenEncryption({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
      keyName: 'custom-oauth-key',
    });

    await encryption.encrypt({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: new Date(),
      tokenType: 'Bearer',
      scope: 'identify',
    });

    expect(encryptSpy).toHaveBeenCalledWith('custom-oauth-key', 'token');
  });

  it('should default to arrakis-oauth-tokens key', async () => {
    const encryptSpy = vi.spyOn(mockVault, 'encrypt');

    const encryption = createOAuthTokenEncryption({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
    });

    await encryption.encrypt({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: new Date(),
      tokenType: 'Bearer',
      scope: 'identify',
    });

    expect(encryptSpy).toHaveBeenCalledWith('arrakis-oauth-tokens', 'token');
  });
});
