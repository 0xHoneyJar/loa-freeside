/**
 * VaultSigningAdapter Tests
 *
 * Sprint 46: Vault Transit Integration - Phase 5
 *
 * Tests for VaultSigningAdapter with mocked Vault client.
 * Comprehensive coverage of Vault Transit integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultSigningAdapter } from '../../../../../src/packages/adapters/vault/VaultSigningAdapter.js';
import type { VaultSigningAdapterConfig } from '../../../../../src/packages/adapters/vault/VaultSigningAdapter.js';
import {
  KeyNotFoundError,
  VaultUnavailableError,
  SigningOperationError,
} from '../../../../../src/packages/core/ports/ISigningAdapter.js';

// Mock node-vault
vi.mock('node-vault', () => {
  return {
    default: vi.fn(() => mockVaultClient),
  };
});

let mockVaultClient: any;

describe('VaultSigningAdapter', () => {
  let adapter: VaultSigningAdapter;
  let config: VaultSigningAdapterConfig;

  beforeEach(() => {
    // Reset mock
    mockVaultClient = {
      write: vi.fn(),
      read: vi.fn(),
    };

    config = {
      vaultAddr: 'https://vault.test',
      vaultToken: 'test-token',
      keyName: 'test-key',
      auditLogging: true,
    };
  });

  describe('Initialization', () => {
    it('should initialize with valid configuration', () => {
      adapter = new VaultSigningAdapter(config);
      expect(adapter).toBeDefined();
    });

    it('should use default key name if not provided', () => {
      const defaultConfig = { ...config };
      delete defaultConfig.keyName;

      adapter = new VaultSigningAdapter(defaultConfig);
      expect(adapter).toBeDefined();
    });

    it('should use default algorithm if not provided', () => {
      adapter = new VaultSigningAdapter(config);
      expect(adapter).toBeDefined();
    });
  });

  describe('Signing Operations', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should sign data successfully', async () => {
      // Mock Vault response
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          signature: 'vault:v1:signature_data_here',
          key_version: 1,
        },
      });

      const result = await adapter.sign('Hello, World!');

      expect(result).toBeDefined();
      expect(result.signature).toBe('vault:v1:signature_data_here');
      expect(result.keyVersion).toBe(1);
      expect(result.algorithm).toBe('sha2-256');
      expect(result.signedAt).toBeInstanceOf(Date);
      expect(result.dataHash).toBeTruthy();

      // Verify Vault was called correctly
      expect(mockVaultClient.write).toHaveBeenCalledWith(
        'transit/sign/test-key/sha2-256',
        expect.objectContaining({
          input: expect.any(String),
        })
      );
    });

    it('should sign Buffer data', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          signature: 'vault:v1:buffer_signature',
          key_version: 1,
        },
      });

      const data = Buffer.from('Binary data');
      const result = await adapter.sign(data);

      expect(result.signature).toBe('vault:v1:buffer_signature');
    });

    it('should throw KeyNotFoundError for missing key', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('permission denied'));

      await expect(adapter.sign('test')).rejects.toThrow(KeyNotFoundError);
    });

    it('should throw VaultUnavailableError on connection failure', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(adapter.sign('test')).rejects.toThrow(VaultUnavailableError);
    });

    it('should throw SigningOperationError on unknown error', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('Unknown Vault error'));

      await expect(adapter.sign('test')).rejects.toThrow(SigningOperationError);
    });

    it('should handle empty response from Vault', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {},
      });

      await expect(adapter.sign('test')).rejects.toThrow(SigningOperationError);
    });
  });

  describe('Signature Verification', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should verify valid signature', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          valid: true,
        },
      });

      const isValid = await adapter.verify('test data', 'vault:v1:signature');

      expect(isValid).toBe(true);
      expect(mockVaultClient.write).toHaveBeenCalledWith(
        'transit/verify/test-key/sha2-256',
        expect.objectContaining({
          input: expect.any(String),
          signature: 'vault:v1:signature',
        })
      );
    });

    it('should reject invalid signature', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          valid: false,
        },
      });

      const isValid = await adapter.verify('test data', 'invalid_signature');

      expect(isValid).toBe(false);
    });

    it('should return false on verification error', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('Verification failed'));

      const isValid = await adapter.verify('test', 'signature');

      expect(isValid).toBe(false);
    });

    it('should verify Buffer data', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          valid: true,
        },
      });

      const data = Buffer.from('Binary verification');
      const isValid = await adapter.verify(data, 'vault:v1:sig');

      expect(isValid).toBe(true);
    });
  });

  describe('Public Key Operations', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should get public key successfully', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          keys: {
            '1': {
              public_key: '04abcdef1234567890',
            },
          },
          latest_version: 1,
          name: 'test-key',
        },
      });

      const publicKey = await adapter.getPublicKey();

      expect(publicKey).toBe('04abcdef1234567890');
      expect(mockVaultClient.read).toHaveBeenCalledWith('transit/keys/test-key');
    });

    it('should throw KeyNotFoundError if key does not exist', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {},
      });

      await expect(adapter.getPublicKey()).rejects.toThrow(KeyNotFoundError);
    });

    it('should throw SigningOperationError if public key not available', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          keys: {
            '1': {},
          },
          latest_version: 1,
        },
      });

      await expect(adapter.getPublicKey()).rejects.toThrow(SigningOperationError);
    });
  });

  describe('Health Check', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should return true when Vault is healthy', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          keys: { '1': {} },
          latest_version: 1,
        },
      });

      const ready = await adapter.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when Vault is unavailable', async () => {
      mockVaultClient.read.mockRejectedValueOnce(new Error('Connection failed'));

      const ready = await adapter.isReady();

      expect(ready).toBe(false);
    });
  });

  describe('Key Rotation', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should rotate key successfully', async () => {
      // Mock reading key version before rotation
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          latest_version: 1,
        },
      });

      // Mock rotation
      mockVaultClient.write.mockResolvedValueOnce({});

      // Mock reading key version after rotation
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          latest_version: 2,
        },
      });

      const result = await adapter.rotateKey();

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);
      expect(result.previousVersion).toBe(1);
      expect(result.keyName).toBe('test-key');
      expect(result.rotatedAt).toBeInstanceOf(Date);

      expect(mockVaultClient.write).toHaveBeenCalledWith('transit/keys/test-key/rotate', {});
    });

    it('should handle rotation failure', async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          latest_version: 1,
        },
      });

      mockVaultClient.write.mockRejectedValueOnce(new Error('Rotation failed'));

      await expect(adapter.rotateKey()).rejects.toThrow('Key rotation failed');
    });
  });

  describe('Audit Logging', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should record sign operations in audit log', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: {
          signature: 'vault:v1:sig',
          key_version: 1,
        },
      });

      await adapter.sign('test data');

      const logs = await adapter.getAuditLogs!();
      expect(logs.length).toBeGreaterThan(0);

      const signLog = logs.find((log) => log.operation === 'sign');
      expect(signLog).toBeDefined();
      expect(signLog!.success).toBe(true);
      expect(signLog!.keyName).toBe('test-key');
      expect(signLog!.keyVersion).toBe(1);
    });

    it('should record failures in audit log', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('Test error'));

      try {
        await adapter.sign('test');
      } catch (error) {
        // Expected
      }

      const logs = await adapter.getAuditLogs!();
      const failLog = logs.find((log) => log.success === false);

      expect(failLog).toBeDefined();
      expect(failLog!.error).toContain('Test error');
    });

    it('should record verify operations', async () => {
      mockVaultClient.write.mockResolvedValueOnce({
        data: { valid: true },
      });

      await adapter.verify('test', 'sig');

      const logs = await adapter.getAuditLogs!();
      const verifyLog = logs.find((log) => log.operation === 'verify');

      expect(verifyLog).toBeDefined();
      expect(verifyLog!.success).toBe(true);
    });

    it('should record key rotation', async () => {
      mockVaultClient.read.mockResolvedValue({
        data: { latest_version: 1 },
      });
      mockVaultClient.write.mockResolvedValueOnce({});

      await adapter.rotateKey();

      const logs = await adapter.getAuditLogs!();
      const rotateLog = logs.find((log) => log.operation === 'rotate');

      expect(rotateLog).toBeDefined();
      expect(rotateLog!.metadata).toHaveProperty('newVersion');
    });

    it('should not log when audit logging disabled', async () => {
      const noAuditAdapter = new VaultSigningAdapter({
        ...config,
        auditLogging: false,
      });

      mockVaultClient.write.mockResolvedValueOnce({
        data: { signature: 'vault:v1:sig', key_version: 1 },
      });

      await noAuditAdapter.sign('test');

      const logs = await noAuditAdapter.getAuditLogs!();
      expect(logs.length).toBe(0);
    });
  });

  describe('Custom Key Names', () => {
    it('should use custom key name in sign operation', async () => {
      adapter = new VaultSigningAdapter(config);

      mockVaultClient.write.mockResolvedValueOnce({
        data: { signature: 'vault:v1:sig', key_version: 1 },
      });

      await adapter.sign('test', 'custom-key');

      expect(mockVaultClient.write).toHaveBeenCalledWith(
        'transit/sign/custom-key/sha2-256',
        expect.any(Object)
      );
    });

    it('should use custom key name in verify operation', async () => {
      adapter = new VaultSigningAdapter(config);

      mockVaultClient.write.mockResolvedValueOnce({
        data: { valid: true },
      });

      await adapter.verify('test', 'sig', 'custom-key');

      expect(mockVaultClient.write).toHaveBeenCalledWith(
        'transit/verify/custom-key/sha2-256',
        expect.any(Object)
      );
    });
  });

  describe('Error Classification', () => {
    beforeEach(() => {
      adapter = new VaultSigningAdapter(config);
    });

    it('should classify permission denied as KeyNotFoundError', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('permission denied'));

      await expect(adapter.sign('test')).rejects.toThrow(KeyNotFoundError);
    });

    it('should classify not found as KeyNotFoundError', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('key not found'));

      await expect(adapter.sign('test')).rejects.toThrow(KeyNotFoundError);
    });

    it('should classify timeout as VaultUnavailableError', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('timeout exceeded'));

      await expect(adapter.sign('test')).rejects.toThrow(VaultUnavailableError);
    });

    it('should classify connection refused as VaultUnavailableError', async () => {
      mockVaultClient.write.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(adapter.sign('test')).rejects.toThrow(VaultUnavailableError);
    });
  });
});
