/**
 * WalletVerification Tests
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Tests for HSM-backed wallet challenge signing:
 * - Challenge creation with nonce
 * - Challenge signing with Vault Transit
 * - Challenge verification
 * - Nonce expiration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WalletVerification,
  createWalletVerification,
} from '../wallet-verification.js';
import type { IVaultClient, WalletChallenge } from '@freeside/core/ports';
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
  private signatures: Map<string, string> = new Map();

  async sign(_keyName: string, data: string): Promise<string> {
    const sig = `vault:v1:sig-${Buffer.from(data).toString('base64').slice(0, 10)}`;
    this.signatures.set(data, sig);
    return sig;
  }

  async verify(_keyName: string, data: string, signature: string): Promise<boolean> {
    const stored = this.signatures.get(data);
    return stored === signature;
  }

  async encrypt(_keyName: string, plaintext: string): Promise<string> {
    return `vault:v1:enc-${plaintext}`;
  }

  async decrypt(_keyName: string, ciphertext: string): Promise<string> {
    return ciphertext.replace('vault:v1:enc-', '');
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

  // Test helper
  clearSignatures(): void {
    this.signatures.clear();
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('WalletVerification', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;
  let verification: WalletVerification;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();

    verification = new WalletVerification({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockVault.clearSignatures();
  });

  describe('createWalletVerification', () => {
    it('should create a WalletVerification instance', () => {
      const wv = createWalletVerification({
        vault: mockVault,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(wv).toBeInstanceOf(WalletVerification);
    });

    it('should use default values when not specified', () => {
      const wv = createWalletVerification({
        vault: mockVault,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(wv).toBeDefined();
    });
  });

  describe('createChallenge', () => {
    it('should create a challenge with user ID and wallet address', async () => {
      const userId = 'user-123';
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

      const challenge = await verification.createChallenge(userId, walletAddress);

      expect(challenge).toBeDefined();
      expect(challenge.message).toContain(userId);
      expect(challenge.message).toContain(walletAddress);
    });

    it('should include unique nonce', async () => {
      const userId = 'user-123';
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';

      const challenge1 = await verification.createChallenge(userId, walletAddress);
      const challenge2 = await verification.createChallenge(userId, walletAddress);

      expect(challenge1.nonce).not.toBe(challenge2.nonce);
    });

    it('should include expiration timestamp', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      // Default 5 minutes from now
      const expectedExpiry = new Date('2024-01-15T12:05:00Z');
      expect(challenge.expiresAt).toEqual(expectedExpiry);
    });

    it('should sign challenge with Vault Transit', async () => {
      const signSpy = vi.spyOn(mockVault, 'sign');

      await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(signSpy).toHaveBeenCalledWith(
        'arrakis-wallet-verification',
        expect.any(String)
      );
    });

    it('should return server signature', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(challenge.signature).toMatch(/^vault:v1:/);
    });
  });

  describe('verifyChallenge', () => {
    it('should verify valid challenge', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      const valid = await verification.verifyChallenge(challenge);

      expect(valid).toBe(true);
    });

    it('should reject expired challenge', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      // Advance time past expiration
      vi.setSystemTime(new Date('2024-01-15T12:06:00Z'));

      const valid = await verification.verifyChallenge(challenge);

      expect(valid).toBe(false);
    });

    it('should reject invalid server signature', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      // Tamper with signature
      const tamperedChallenge: WalletChallenge = {
        ...challenge,
        signature: 'invalid-signature',
      };

      const valid = await verification.verifyChallenge(tamperedChallenge);

      expect(valid).toBe(false);
    });
  });

  describe('Challenge Message Format', () => {
    it('should follow EIP-4361 inspired format', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(challenge.message).toContain('Arrakis Wallet Verification');
      expect(challenge.message).toContain('Nonce:');
      expect(challenge.message).toContain('Expires:');
    });

    it('should include wallet address in message', async () => {
      const walletAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';

      const challenge = await verification.createChallenge('user-123', walletAddress);

      expect(challenge.message).toContain(walletAddress);
    });

    it('should include ISO timestamps', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(challenge.message).toContain('2024-01-15T12:05:00');
    });
  });

  describe('Nonce Management', () => {
    it('should generate cryptographically random nonces', async () => {
      const nonces = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const challenge = await verification.createChallenge(
          `user-${i}`,
          '0x1234567890abcdef1234567890abcdef12345678'
        );
        nonces.add(challenge.nonce);
      }

      // All nonces should be unique
      expect(nonces.size).toBe(100);
    });

    it('should generate nonces of sufficient length', async () => {
      const challenge = await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      // 32 bytes hex = 64 characters
      expect(challenge.nonce.length).toBe(64);
    });
  });

  describe('Metrics', () => {
    it('should record challenge creation', async () => {
      const incSpy = vi.spyOn(mockMetrics.walletChallenges, 'inc');

      await verification.createChallenge(
        'user-123',
        '0x1234567890abcdef1234567890abcdef12345678'
      );

      expect(incSpy).toHaveBeenCalledWith({ status: 'success' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle checksummed addresses', async () => {
      const checksummed = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

      const challenge = await verification.createChallenge('user-123', checksummed);

      expect(challenge).toBeDefined();
      expect(challenge.message).toContain(checksummed);
    });

    it('should handle lowercase addresses', async () => {
      const lowercase = '0xab5801a7d398351b8be11c439e05c5b3259aec9b';

      const challenge = await verification.createChallenge('user-123', lowercase);

      expect(challenge).toBeDefined();
    });

    it('should handle concurrent challenge creation', async () => {
      const challenges = await Promise.all([
        verification.createChallenge('user-1', '0x1234567890abcdef1234567890abcdef12345678'),
        verification.createChallenge('user-2', '0x1234567890abcdef1234567890abcdef12345678'),
        verification.createChallenge('user-3', '0x1234567890abcdef1234567890abcdef12345678'),
        verification.createChallenge('user-4', '0x1234567890abcdef1234567890abcdef12345678'),
        verification.createChallenge('user-5', '0x1234567890abcdef1234567890abcdef12345678'),
      ]);

      // All should have unique nonces
      const nonces = challenges.map((c) => c.nonce);
      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).toBe(5);
    });
  });
});

describe('WalletVerification with Custom Configuration', () => {
  let mockVault: MockVaultClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    mockVault = new MockVaultClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should use custom TTL', async () => {
    const verification = new WalletVerification({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
      challengeExpirationSeconds: 60, // 1 minute
    });

    const challenge = await verification.createChallenge(
      'user-123',
      '0x1234567890abcdef1234567890abcdef12345678'
    );

    const expectedExpiry = new Date('2024-01-15T12:01:00Z');
    expect(challenge.expiresAt).toEqual(expectedExpiry);
  });

  it('should use custom signing key', async () => {
    const signSpy = vi.spyOn(mockVault, 'sign');

    const verification = new WalletVerification({
      vault: mockVault,
      logger: mockLogger,
      metrics: mockMetrics,
      keyName: 'custom-wallet-key',
    });

    await verification.createChallenge(
      'user-123',
      '0x1234567890abcdef1234567890abcdef12345678'
    );

    expect(signSpy).toHaveBeenCalledWith('custom-wallet-key', expect.any(String));
  });
});
