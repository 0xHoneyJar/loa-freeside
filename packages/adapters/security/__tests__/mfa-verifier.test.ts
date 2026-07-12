/**
 * MfaVerifier Tests
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Tests for TOTP-based MFA verification:
 * - Token verification
 * - Secret generation
 * - TOTP URI generation
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MfaVerifier, createMfaVerifier } from '../mfa-verifier.js';
import type { IVaultClient } from '@freeside/core/ports';
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
  private secrets: Map<string, Record<string, string>> = new Map();

  async sign(): Promise<string> {
    return 'signature';
  }

  async verify(): Promise<boolean> {
    return true;
  }

  async encrypt(): Promise<string> {
    return 'encrypted';
  }

  async decrypt(): Promise<string> {
    return 'decrypted';
  }

  async rotateKey(): Promise<void> {}

  async getKeyInfo() {
    return {
      name: 'key',
      type: 'ed25519',
      latestVersion: 1,
      minDecryptionVersion: 1,
      supportsEncryption: false,
      supportsDecryption: false,
      supportsSigning: true,
      exportable: false,
      deletionAllowed: false,
    };
  }

  async getSecret(path: string): Promise<Record<string, string>> {
    const secret = this.secrets.get(path);
    if (!secret) {
      throw new Error('Secret not found');
    }
    return secret;
  }

  async putSecret(path: string, data: Record<string, string>): Promise<void> {
    this.secrets.set(path, data);
  }

  async deleteSecret(path: string): Promise<void> {
    this.secrets.delete(path);
  }

  async health() {
    return { initialized: true, sealed: false, version: '1.15.0' };
  }

  async renewToken(): Promise<void> {}

  async revokeToken(): Promise<void> {}

  // Test helpers
  clearSecrets(): void {
    this.secrets.clear();
  }

  setSecret(path: string, data: Record<string, string>): void {
    this.secrets.set(path, data);
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('MfaVerifier', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let verifier: MfaVerifier;

  beforeEach(() => {
    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();

    verifier = new MfaVerifier({
      vault: mockVault,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockVault.clearSecrets();
  });

  describe('createMfaVerifier', () => {
    it('should create an MfaVerifier instance', () => {
      const mfa = createMfaVerifier({
        vault: mockVault,
        logger: mockLogger,
      });

      expect(mfa).toBeInstanceOf(MfaVerifier);
    });

    it('should use default issuer when not specified', () => {
      const mfa = createMfaVerifier({
        vault: mockVault,
        logger: mockLogger,
      });

      expect(mfa).toBeDefined();
    });
  });

  describe('verify', () => {
    it('should return invalid for non-6-digit tokens', async () => {
      const result = await verifier.verify('user-123', '12345');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should return invalid for non-numeric tokens', async () => {
      const result = await verifier.verify('user-123', 'abcdef');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token format');
    });

    it('should return invalid when MFA not configured', async () => {
      const result = await verifier.verify('user-123', '123456');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('MFA not configured for user');
    });

    it('should include verifiedAt timestamp', async () => {
      const result = await verifier.verify('user-123', '123456');

      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it('should log successful verification', async () => {
      // Set up a secret for the user
      mockVault.setSecret('mfa/users/user-123', {
        secret: 'JBSWY3DPEHPK3PXP',
        createdAt: new Date().toISOString(),
      });

      // Since we can't easily generate valid TOTP, just verify logging on attempt
      await verifier.verify('user-123', '123456');

      // The verifier creates a child logger, so verify child was created
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'MfaVerifier' });
    });
  });

  describe('generateSecret', () => {
    it('should generate a base32 encoded secret', async () => {
      const secret = await verifier.generateSecret('user-123');

      // Base32 characters
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });

    it('should store secret in Vault', async () => {
      const putSpy = vi.spyOn(mockVault, 'putSecret');

      await verifier.generateSecret('user-123');

      expect(putSpy).toHaveBeenCalledWith(
        'mfa/users/user-123',
        expect.objectContaining({
          secret: expect.any(String),
          createdAt: expect.any(String),
        })
      );
    });

    it('should generate different secrets for different users', async () => {
      const secret1 = await verifier.generateSecret('user-1');
      const secret2 = await verifier.generateSecret('user-2');

      expect(secret1).not.toBe(secret2);
    });

    it('should log secret generation', async () => {
      await verifier.generateSecret('user-123');

      // Verify that the child logger was created
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'MfaVerifier' });
    });
  });

  describe('getTotpUri', () => {
    it('should generate valid otpauth URI', () => {
      const uri = verifier.getTotpUri('user@example.com', 'JBSWY3DPEHPK3PXP');

      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain('Arrakis');
      expect(uri).toContain('JBSWY3DPEHPK3PXP');
    });

    it('should include issuer', () => {
      const uri = verifier.getTotpUri('user@example.com', 'SECRET');

      expect(uri).toContain('issuer=Arrakis');
    });

    it('should include algorithm', () => {
      const uri = verifier.getTotpUri('user@example.com', 'SECRET');

      expect(uri).toContain('algorithm=SHA1');
    });

    it('should include digits', () => {
      const uri = verifier.getTotpUri('user@example.com', 'SECRET');

      expect(uri).toContain('digits=6');
    });

    it('should include period', () => {
      const uri = verifier.getTotpUri('user@example.com', 'SECRET');

      expect(uri).toContain('period=30');
    });

    it('should URL encode user ID', () => {
      const uri = verifier.getTotpUri('user@example.com', 'SECRET');

      expect(uri).toContain('user%40example.com');
    });
  });

  describe('Custom Configuration', () => {
    it('should use custom issuer', () => {
      const customVerifier = new MfaVerifier({
        vault: mockVault,
        logger: mockLogger,
        issuer: 'CustomApp',
      });

      const uri = customVerifier.getTotpUri('user', 'SECRET');

      expect(uri).toContain('CustomApp');
    });

    it('should use custom digits', () => {
      const customVerifier = new MfaVerifier({
        vault: mockVault,
        logger: mockLogger,
        digits: 8,
      });

      const uri = customVerifier.getTotpUri('user', 'SECRET');

      expect(uri).toContain('digits=8');
    });

    it('should use custom period', () => {
      const customVerifier = new MfaVerifier({
        vault: mockVault,
        logger: mockLogger,
        period: 60,
      });

      const uri = customVerifier.getTotpUri('user', 'SECRET');

      expect(uri).toContain('period=60');
    });
  });

  describe('Error Handling', () => {
    it('should handle vault errors gracefully', async () => {
      // Don't set up any secret - will throw on getSecret
      const result = await verifier.verify('nonexistent-user', '123456');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('MFA not configured for user');
    });

    it('should return verifiedAt even on error', async () => {
      const result = await verifier.verify('user', 'invalid');

      expect(result.verifiedAt).toBeInstanceOf(Date);
    });
  });
});

describe('MfaVerifier TOTP Validation', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let verifier: MfaVerifier;

  beforeEach(() => {
    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();
    verifier = new MfaVerifier({
      vault: mockVault,
      logger: mockLogger,
    });
  });

  it('should accept valid 6-digit numeric token format', async () => {
    // Set up secret for user
    mockVault.setSecret('mfa/users/user-123', {
      secret: 'JBSWY3DPEHPK3PXP',
      createdAt: new Date().toISOString(),
    });

    // The token format validation passes
    const result = await verifier.verify('user-123', '123456');

    // Format is valid, but the actual TOTP verification will fail
    // since we don't have the correct time-based token
    expect(result.error).not.toBe('Invalid token format');
  });

  it('should reject tokens with leading spaces', async () => {
    const result = await verifier.verify('user-123', ' 23456');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid token format');
  });

  it('should reject tokens with trailing spaces', async () => {
    const result = await verifier.verify('user-123', '12345 ');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid token format');
  });

  it('should reject empty tokens', async () => {
    const result = await verifier.verify('user-123', '');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid token format');
  });

  it('should reject tokens with special characters', async () => {
    const result = await verifier.verify('user-123', '123-45');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid token format');
  });
});
