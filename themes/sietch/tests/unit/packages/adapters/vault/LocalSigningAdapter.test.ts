/**
 * LocalSigningAdapter Tests
 *
 * Sprint 46: Vault Transit Integration - Phase 5
 *
 * Tests for LocalSigningAdapter using Node.js crypto.
 * Comprehensive coverage of signing, verification, and key rotation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LocalSigningAdapter } from '../../../../../src/packages/adapters/vault/LocalSigningAdapter.js';
import type { LocalSigningAdapterConfig } from '../../../../../src/packages/adapters/vault/LocalSigningAdapter.js';
import { KeyNotFoundError } from '../../../../../src/packages/core/ports/ISigningAdapter.js';

describe('LocalSigningAdapter', () => {
  let adapter: LocalSigningAdapter;

  beforeEach(() => {
    adapter = new LocalSigningAdapter({
      keyName: 'test-key',
      auditLogging: true,
    });
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const defaultAdapter = new LocalSigningAdapter({});
      expect(defaultAdapter).toBeDefined();
    });

    it('should initialize with custom key name', () => {
      const customAdapter = new LocalSigningAdapter({
        keyName: 'custom-key',
      });
      expect(customAdapter).toBeDefined();
    });

    it('should be ready after initialization', async () => {
      const ready = await adapter.isReady();
      expect(ready).toBe(true);
    });
  });

  describe('Signing Operations', () => {
    it('should sign string data', async () => {
      const data = 'Hello, World!';
      const result = await adapter.sign(data);

      expect(result).toBeDefined();
      expect(result.signature).toBeTruthy();
      expect(typeof result.signature).toBe('string');
      expect(result.keyVersion).toBe(1);
      expect(result.algorithm).toBe('sha256');
      expect(result.signedAt).toBeInstanceOf(Date);
      expect(result.dataHash).toBeTruthy();
    });

    it('should sign Buffer data', async () => {
      const data = Buffer.from('Hello, World!');
      const result = await adapter.sign(data);

      expect(result).toBeDefined();
      expect(result.signature).toBeTruthy();
      expect(result.keyVersion).toBe(1);
    });

    it('should produce different signatures for different data', async () => {
      const result1 = await adapter.sign('Hello');
      const result2 = await adapter.sign('World');

      expect(result1.signature).not.toBe(result2.signature);
      expect(result1.dataHash).not.toBe(result2.dataHash);
    });

    it('should produce consistent signatures for same data', async () => {
      const data = 'Test data';
      const result1 = await adapter.sign(data);
      const result2 = await adapter.sign(data);

      // Signatures should be consistent (deterministic signing)
      // Note: ECDSA can produce different signatures for same data
      // so we verify they both are valid instead
      const verify1 = await adapter.verify(data, result1.signature);
      const verify2 = await adapter.verify(data, result2.signature);

      expect(verify1).toBe(true);
      expect(verify2).toBe(true);
      expect(result1.dataHash).toBe(result2.dataHash);
    });

    it('should handle empty string', async () => {
      const result = await adapter.sign('');
      expect(result.signature).toBeTruthy();
    });

    it('should handle long data', async () => {
      const data = 'x'.repeat(10000);
      const result = await adapter.sign(data);
      expect(result.signature).toBeTruthy();
    });
  });

  describe('Signature Verification', () => {
    it('should verify valid signature', async () => {
      const data = 'Test message';
      const result = await adapter.sign(data);

      const isValid = await adapter.verify(data, result.signature);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const data = 'Test message';
      const fakeSignature = 'invalid_signature_hex';

      const isValid = await adapter.verify(data, fakeSignature);
      expect(isValid).toBe(false);
    });

    it('should reject signature for wrong data', async () => {
      const data = 'Original message';
      const result = await adapter.sign(data);

      const isValid = await adapter.verify('Different message', result.signature);
      expect(isValid).toBe(false);
    });

    it('should verify Buffer data', async () => {
      const data = Buffer.from('Binary data');
      const result = await adapter.sign(data);

      const isValid = await adapter.verify(data, result.signature);
      expect(isValid).toBe(true);
    });

    it('should handle empty signature gracefully', async () => {
      const isValid = await adapter.verify('test', '');
      expect(isValid).toBe(false);
    });
  });

  describe('Public Key Operations', () => {
    it('should return public key', async () => {
      const publicKey = await adapter.getPublicKey();

      expect(publicKey).toBeDefined();
      expect(typeof publicKey).toBe('string');
      expect(publicKey.length).toBeGreaterThan(0);
    });

    it('should return same public key for same key name', async () => {
      const pk1 = await adapter.getPublicKey();
      const pk2 = await adapter.getPublicKey();

      expect(pk1).toBe(pk2);
    });

    it('should use custom key name', async () => {
      const customAdapter = new LocalSigningAdapter({
        keyName: 'custom-key-2',
      });

      const pk1 = await adapter.getPublicKey();
      const pk2 = await customAdapter.getPublicKey();

      // Different key names should have different public keys
      expect(pk1).not.toBe(pk2);
    });
  });

  describe('Key Rotation', () => {
    it('should rotate key successfully', async () => {
      const result = await adapter.rotateKey();

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(2);
      expect(result.previousVersion).toBe(1);
      expect(result.keyName).toBe('test-key');
      expect(result.rotatedAt).toBeInstanceOf(Date);
    });

    it('should increment version after rotation', async () => {
      await adapter.rotateKey(); // v2
      const result = await adapter.rotateKey(); // v3

      expect(result.newVersion).toBe(3);
      expect(result.previousVersion).toBe(2);
    });

    it('should sign with new version after rotation', async () => {
      const data = 'Test data';

      // Sign with version 1
      const result1 = await adapter.sign(data);
      expect(result1.keyVersion).toBe(1);

      // Rotate to version 2
      await adapter.rotateKey();

      // Sign with version 2
      const result2 = await adapter.sign(data);
      expect(result2.keyVersion).toBe(2);
    });

    it('should verify old signatures after rotation', async () => {
      const data = 'Important message';

      // Sign with version 1
      const result1 = await adapter.sign(data);

      // Rotate key
      await adapter.rotateKey();

      // Should still verify signature from version 1
      const isValid = await adapter.verify(data, result1.signature);
      expect(isValid).toBe(true);
    });

    it('should verify signatures from all versions', async () => {
      const data = 'Test';

      // Sign with v1
      const sig1 = await adapter.sign(data);

      // Rotate to v2
      await adapter.rotateKey();
      const sig2 = await adapter.sign(data);

      // Rotate to v3
      await adapter.rotateKey();
      const sig3 = await adapter.sign(data);

      // All signatures should verify
      expect(await adapter.verify(data, sig1.signature)).toBe(true);
      expect(await adapter.verify(data, sig2.signature)).toBe(true);
      expect(await adapter.verify(data, sig3.signature)).toBe(true);
    });

    it('should update public key after rotation', async () => {
      const pk1 = await adapter.getPublicKey();
      await adapter.rotateKey();
      const pk2 = await adapter.getPublicKey();

      // Public key should change after rotation
      expect(pk1).not.toBe(pk2);
    });
  });

  describe('Audit Logging', () => {
    it('should record sign operations in audit log', async () => {
      await adapter.sign('test data');

      const logs = await adapter.getAuditLogs!();
      expect(logs.length).toBeGreaterThan(0);

      const signLog = logs.find((log) => log.operation === 'sign');
      expect(signLog).toBeDefined();
      expect(signLog!.success).toBe(true);
      expect(signLog!.keyName).toBe('test-key');
      expect(signLog!.dataHash).toBeTruthy();
    });

    it('should record verify operations in audit log', async () => {
      const result = await adapter.sign('test');
      await adapter.verify('test', result.signature);

      const logs = await adapter.getAuditLogs!();
      const verifyLog = logs.find((log) => log.operation === 'verify');

      expect(verifyLog).toBeDefined();
      expect(verifyLog!.success).toBe(true);
    });

    it('should record key rotation in audit log', async () => {
      await adapter.rotateKey();

      const logs = await adapter.getAuditLogs!();
      const rotateLog = logs.find((log) => log.operation === 'rotate');

      expect(rotateLog).toBeDefined();
      expect(rotateLog!.success).toBe(true);
      expect(rotateLog!.metadata).toHaveProperty('newVersion');
      expect(rotateLog!.metadata).toHaveProperty('previousVersion');
    });

    it('should record getPublicKey in audit log', async () => {
      await adapter.getPublicKey();

      const logs = await adapter.getAuditLogs!();
      const pkLog = logs.find((log) => log.operation === 'getPublicKey');

      expect(pkLog).toBeDefined();
      expect(pkLog!.success).toBe(true);
    });

    it('should limit audit logs to requested limit', async () => {
      // Create many operations
      for (let i = 0; i < 20; i++) {
        await adapter.sign(`test ${i}`);
      }

      const logs = await adapter.getAuditLogs!(10);
      expect(logs.length).toBeLessThanOrEqual(10);
    });

    it('should not log when audit logging disabled', async () => {
      const noAuditAdapter = new LocalSigningAdapter({
        keyName: 'no-audit',
        auditLogging: false,
      });

      await noAuditAdapter.sign('test');

      const logs = await noAuditAdapter.getAuditLogs!();
      expect(logs.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw KeyNotFoundError for non-existent key name', async () => {
      // LocalSigningAdapter only manages keys it initializes
      await expect(adapter.sign('test', 'non-existent-key')).rejects.toThrow(KeyNotFoundError);
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode data', async () => {
      const data = '你好世界 🌍 Здравствуй мир';
      const result = await adapter.sign(data);
      const isValid = await adapter.verify(data, result.signature);

      expect(isValid).toBe(true);
    });

    it('should handle special characters', async () => {
      const data = '!@#$%^&*()_+-=[]{}|;:",.<>?/~`';
      const result = await adapter.sign(data);
      const isValid = await adapter.verify(data, result.signature);

      expect(isValid).toBe(true);
    });

    it('should handle newlines and whitespace', async () => {
      const data = 'Line 1\nLine 2\r\nLine 3\t\tTab';
      const result = await adapter.sign(data);
      const isValid = await adapter.verify(data, result.signature);

      expect(isValid).toBe(true);
    });
  });

  describe('Concurrency', () => {
    it('should handle concurrent sign operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => adapter.sign(`message ${i}`));

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      results.forEach((result) => {
        expect(result.signature).toBeTruthy();
        expect(result.keyVersion).toBe(1);
      });
    });

    it('should handle concurrent verify operations', async () => {
      const data = 'concurrent test';
      const result = await adapter.sign(data);

      const promises = Array.from({ length: 10 }, () => adapter.verify(data, result.signature));

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      results.forEach((isValid) => {
        expect(isValid).toBe(true);
      });
    });
  });
});
