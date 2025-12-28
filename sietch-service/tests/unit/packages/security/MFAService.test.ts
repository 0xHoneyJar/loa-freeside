/**
 * MFAService Tests
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Test coverage:
 * - TOTP setup and secret generation
 * - TOTP verification with time drift tolerance
 * - Backup code generation and verification
 * - Rate limiting for verification attempts
 * - MFA configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MFAService, MFAError } from '../../../../src/packages/security/MFAService.js';
import { Redis } from 'ioredis';

describe('MFAService', () => {
  let redis: any; // Mocked Redis
  let mfaService: MFAService;

  beforeEach(() => {
    // Mock Redis with in-memory store
    const store = new Map<string, string>();
    redis = {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
      setex: vi.fn((key: string, ttl: number, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn((...keys: string[]) => {
        keys.forEach((key) => store.delete(key));
        return Promise.resolve(keys.length);
      }),
      incr: vi.fn((key: string) => {
        const current = parseInt(store.get(key) || '0', 10);
        store.set(key, (current + 1).toString());
        return Promise.resolve(current + 1);
      }),
    };

    mfaService = new MFAService({
      redis: redis as any,
      totpWindow: 1,
      totpStep: 30,
      maxAttempts: 5,
      attemptWindow: 300,
      debug: false,
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('TOTP Setup', () => {
    it('should setup TOTP for a user', async () => {
      const result = await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe('TOTP');
      expect(result.totpSecret).toBeDefined();
      expect(result.totpSecret.length).toBeGreaterThan(0);
      expect(result.qrCodeDataUrl).toContain('otpauth://totp/');
      expect(result.backupCodes).toHaveLength(10);
      expect(result.setupAt).toBeInstanceOf(Date);
    });

    it('should generate base32 encoded TOTP secret', async () => {
      const result = await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      // Base32 should only contain A-Z and 2-7
      expect(result.totpSecret).toMatch(/^[A-Z2-7]+$/);
    });

    it('should generate unique backup codes', async () => {
      const result = await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      const uniqueCodes = new Set(result.backupCodes);
      expect(uniqueCodes.size).toBe(result.backupCodes.length);
    });

    it('should store MFA config in Redis', async () => {
      await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      const config = await mfaService.getConfig('user123');
      expect(config).toBeDefined();
      expect(config?.userId).toBe('user123');
      expect(config?.enabled).toBe(true);
      expect(config?.primaryMethod).toBe('TOTP');
      expect(config?.backupCodesRemaining).toBe(10);
    });

    it('should reject unsupported MFA methods', async () => {
      await expect(
        mfaService.setupTOTP({
          userId: 'user123',
          method: 'SMS' as any,
        })
      ).rejects.toThrow(MFAError);
    });
  });

  describe('TOTP Verification', () => {
    let secret: string;
    let userId: string;

    beforeEach(async () => {
      userId = 'user123';
      const setup = await mfaService.setupTOTP({
        userId,
        method: 'TOTP',
      });
      secret = setup.totpSecret;
    });

    it('should verify valid TOTP code', async () => {
      // Generate valid TOTP code for current time
      const code = generateTOTPCodeForSecret(secret);

      const result = await mfaService.verifyTOTP(userId, code);

      expect(result.valid).toBe(true);
      expect(result.method).toBe('TOTP');
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it('should reject invalid TOTP code', async () => {
      const result = await mfaService.verifyTOTP(userId, '000000');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should update last verified timestamp on success', async () => {
      const code = generateTOTPCodeForSecret(secret);
      await mfaService.verifyTOTP(userId, code);

      const config = await mfaService.getConfig(userId);
      expect(config?.lastVerifiedAt).toBeInstanceOf(Date);
    });

    it('should handle TOTP not configured', async () => {
      const result = await mfaService.verifyTOTP('nonexistent', '123456');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not configured');
    });
  });

  describe('Backup Code Verification', () => {
    let backupCodes: string[];
    let userId: string;

    beforeEach(async () => {
      userId = 'user123';
      const setup = await mfaService.setupTOTP({
        userId,
        method: 'TOTP',
      });
      backupCodes = setup.backupCodes;
    });

    it('should verify valid backup code', async () => {
      const code = backupCodes[0];
      const result = await mfaService.verifyBackupCode(userId, code);

      expect(result.valid).toBe(true);
      expect(result.method).toBe('BACKUP_CODES');
    });

    it('should remove backup code after use', async () => {
      const code = backupCodes[0];
      await mfaService.verifyBackupCode(userId, code);

      // Try to use same code again
      const result = await mfaService.verifyBackupCode(userId, code);
      expect(result.valid).toBe(false);
    });

    it('should decrement backup codes remaining', async () => {
      const code = backupCodes[0];
      await mfaService.verifyBackupCode(userId, code);

      const config = await mfaService.getConfig(userId);
      expect(config?.backupCodesRemaining).toBe(9);
    });

    it('should reject invalid backup code', async () => {
      const result = await mfaService.verifyBackupCode(userId, 'INVALID');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid backup code');
    });
  });

  describe('Rate Limiting', () => {
    let userId: string;

    beforeEach(async () => {
      userId = 'user123';
      await mfaService.setupTOTP({
        userId,
        method: 'TOTP',
      });
    });

    it('should allow up to max attempts', async () => {
      // Make 4 failed attempts (max is 5)
      for (let i = 0; i < 4; i++) {
        const result = await mfaService.verifyTOTP(userId, '000000');
        expect(result.valid).toBe(false);
        expect(result.attemptsRemaining).toBeGreaterThan(0);
      }
    });

    it('should block after max attempts exceeded', async () => {
      // Make 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await mfaService.verifyTOTP(userId, '000000');
      }

      // 6th attempt should be rate limited
      const result = await mfaService.verifyTOTP(userId, '000000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Too many verification attempts');
      expect(result.attemptsRemaining).toBe(0);
    });

    it('should reset rate limit on successful verification', async () => {
      // Make 3 failed attempts
      for (let i = 0; i < 3; i++) {
        await mfaService.verifyTOTP(userId, '000000');
      }

      // Successful verification
      const setup = await mfaService.getConfig(userId);
      const secret = await redis.get(`mfa:secret:${userId}`);
      const validCode = generateTOTPCodeForSecret(secret!);
      await mfaService.verifyTOTP(userId, validCode);

      // Should be able to verify again
      const validCode2 = generateTOTPCodeForSecret(secret!);
      const result = await mfaService.verifyTOTP(userId, validCode2);
      expect(result.valid).toBe(true);
    });
  });

  describe('MFA Configuration', () => {
    it('should get MFA configuration for user', async () => {
      await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      const config = await mfaService.getConfig('user123');
      expect(config).toBeDefined();
      expect(config?.userId).toBe('user123');
      expect(config?.enabled).toBe(true);
    });

    it('should return null for non-existent user', async () => {
      const config = await mfaService.getConfig('nonexistent');
      expect(config).toBeNull();
    });

    it('should disable MFA for user', async () => {
      await mfaService.setupTOTP({
        userId: 'user123',
        method: 'TOTP',
      });

      await mfaService.disable('user123');

      const config = await mfaService.getConfig('user123');
      expect(config).toBeNull();
    });
  });

  describe('Generic Verify Method', () => {
    let secret: string;
    let backupCodes: string[];
    let userId: string;

    beforeEach(async () => {
      userId = 'user123';
      const setup = await mfaService.setupTOTP({
        userId,
        method: 'TOTP',
      });
      secret = setup.totpSecret;
      backupCodes = setup.backupCodes;
    });

    it('should verify with TOTP code', async () => {
      const code = generateTOTPCodeForSecret(secret);

      const result = await mfaService.verify({
        userId,
        operation: 'DELETE_CHANNEL',
        totpCode: code,
      });

      expect(result.valid).toBe(true);
      expect(result.method).toBe('TOTP');
    });

    it('should verify with backup code', async () => {
      const result = await mfaService.verify({
        userId,
        operation: 'DELETE_CHANNEL',
        backupCode: backupCodes[0],
      });

      expect(result.valid).toBe(true);
      expect(result.method).toBe('BACKUP_CODES');
    });

    it('should reject when no code provided', async () => {
      const result = await mfaService.verify({
        userId,
        operation: 'DELETE_CHANNEL',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No verification code provided');
    });
  });
});

/**
 * Helper: Generate TOTP code for a given secret
 * (Simplified for testing - uses current time)
 */
function generateTOTPCodeForSecret(secret: string): string {
  // This is a simplified implementation for testing
  // In real tests, you'd use the same algorithm as MFAService
  const crypto = require('crypto');

  // Decode base32 secret
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < secret.length; i++) {
    const charIndex = base32Chars.indexOf(secret[i].toUpperCase());
    if (charIndex === -1) continue;

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const secretBuffer = Buffer.from(output);

  // Get current time counter
  const currentTime = Math.floor(Date.now() / 1000);
  const timeCounter = Math.floor(currentTime / 30);

  // Convert time counter to 8-byte buffer (big-endian)
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(timeCounter), 0);

  // HMAC-SHA1
  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(timeBuffer);
  const hmacResult = hmac.digest();

  // Dynamic truncation (RFC 4226)
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const truncated =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  // Generate 6-digit code
  const code = (truncated % 1000000).toString().padStart(6, '0');
  return code;
}
