/**
 * NaibSecurityGuard Tests
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Test coverage:
 * - Protected operation verification
 * - MFA requirement enforcement
 * - Configuration management
 * - Audit logging
 * - Express middleware integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NaibSecurityGuard, SecurityGuardError, DEFAULT_PROTECTED_OPERATIONS } from '../../../../src/packages/security/NaibSecurityGuard.js';
import { MFAService } from '../../../../src/packages/security/MFAService.js';
import { Redis } from 'ioredis';

describe('NaibSecurityGuard', () => {
  let redis: Redis;
  let mfaService: MFAService;
  let guard: NaibSecurityGuard;
  let userId: string;
  let totpSecret: string;

  beforeEach(async () => {
    redis = new Redis();
    mfaService = new MFAService({
      redis,
      maxAttempts: 5,
      debug: false,
    });
    guard = new NaibSecurityGuard(mfaService, {
      protectedOperations: DEFAULT_PROTECTED_OPERATIONS,
      requireMfaForDestructive: true,
      maxVerificationAttempts: 5,
      notifyAdmins: false,
    });

    // Setup MFA for test user
    userId = 'user123';
    const setup = await mfaService.setupTOTP({
      userId,
      method: 'TOTP',
    });
    totpSecret = setup.totpSecret;
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  describe('Protected Operation Detection', () => {
    it('should identify protected operations', () => {
      expect(guard.isProtectedOperation('DELETE_CHANNEL')).toBe(true);
      expect(guard.isProtectedOperation('DELETE_ROLE')).toBe(true);
      expect(guard.isProtectedOperation('KILL_SWITCH')).toBe(true);
    });

    it('should allow non-protected operations without MFA', async () => {
      // Remove all protected operations
      guard.updateConfig({ protectedOperations: [] });

      const result = await guard.verify({
        operation: 'DELETE_CHANNEL' as any,
        userId,
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          // No TOTP code provided
        },
      });

      expect(result.allowed).toBe(true);
    });

    it('should add operation to protected list', () => {
      guard.addProtectedOperation('ADMIN_OVERRIDE');
      expect(guard.isProtectedOperation('ADMIN_OVERRIDE')).toBe(true);
    });

    it('should remove operation from protected list', () => {
      guard.removeProtectedOperation('DELETE_CHANNEL');
      expect(guard.isProtectedOperation('DELETE_CHANNEL')).toBe(false);
    });
  });

  describe('MFA Verification', () => {
    it('should allow operation with valid TOTP code', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);

      const result = await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          totpCode,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.mfaResult.valid).toBe(true);
      expect(result.mfaResult.method).toBe('TOTP');
      expect(result.auditLogId).toBeDefined();
    });

    it('should deny operation with invalid TOTP code', async () => {
      const result = await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          totpCode: '000000',
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.mfaResult.valid).toBe(false);
      expect(result.denialReason).toBeDefined();
    });

    it('should allow operation with valid backup code', async () => {
      // Get backup code
      const setup = await mfaService.getConfig(userId);
      const backupCodesJson = await redis.get(`mfa:backup_codes:${userId}`);
      const hashedCodes = JSON.parse(backupCodesJson!);

      // Generate a valid backup code (for testing, we'll just use first hashed code directly)
      // In reality, you'd need the original unhashed code
      // For this test, let's set up a new user with known backup codes
      const testUserId = 'backupuser';
      const backupSetup = await mfaService.setupTOTP({
        userId: testUserId,
        method: 'TOTP',
      });
      const backupCode = backupSetup.backupCodes[0];

      const result = await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId: testUserId,
        communityId: 'community123',
        mfaVerification: {
          userId: testUserId,
          operation: 'DELETE_CHANNEL',
          backupCode,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.mfaResult.method).toBe('BACKUP_CODES');
    });

    it('should deny operation without MFA code', async () => {
      const result = await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          // No code provided
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.denialReason).toContain('No verification code');
    });
  });

  describe('Configuration Management', () => {
    it('should get current configuration', () => {
      const config = guard.getConfig();

      expect(config.protectedOperations).toEqual(DEFAULT_PROTECTED_OPERATIONS);
      expect(config.requireMfaForDestructive).toBe(true);
      expect(config.maxVerificationAttempts).toBe(5);
    });

    it('should update configuration', () => {
      guard.updateConfig({
        maxVerificationAttempts: 10,
        notifyAdmins: true,
      });

      const config = guard.getConfig();
      expect(config.maxVerificationAttempts).toBe(10);
      expect(config.notifyAdmins).toBe(true);
    });

    it('should preserve unmodified configuration fields', () => {
      const originalOperations = guard.getConfig().protectedOperations;

      guard.updateConfig({
        maxVerificationAttempts: 10,
      });

      const config = guard.getConfig();
      expect(config.protectedOperations).toEqual(originalOperations);
    });
  });

  describe('Audit Logging', () => {
    it('should log successful verification', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);

      await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          totpCode,
        },
      });

      const logs = guard.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);

      const lastLog = logs[logs.length - 1];
      expect(lastLog.eventType).toBe('SECURITY_GUARD');
      expect(lastLog.success).toBe(true);
      expect(lastLog.userId).toBe(userId);
      expect(lastLog.operation).toBe('DELETE_CHANNEL');
    });

    it('should log failed verification', async () => {
      await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          totpCode: '000000',
        },
      });

      const logs = guard.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);

      const lastLog = logs[logs.length - 1];
      expect(lastLog.eventType).toBe('SECURITY_GUARD');
      expect(lastLog.success).toBe(false);
      expect(lastLog.error).toBeDefined();
    });

    it('should limit audit logs to specified count', () => {
      const logs = guard.getAuditLogs(5);
      expect(logs.length).toBeLessThanOrEqual(5);
    });

    it('should include metadata in audit logs', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);

      await guard.verify({
        operation: 'DELETE_CHANNEL',
        userId,
        communityId: 'community123',
        mfaVerification: {
          userId,
          operation: 'DELETE_CHANNEL',
          totpCode,
        },
        metadata: {
          customField: 'test-value',
        },
      });

      const logs = guard.getAuditLogs();
      const lastLog = logs[logs.length - 1];
      expect(lastLog.metadata).toHaveProperty('customField', 'test-value');
    });
  });

  describe('Express Middleware', () => {
    it('should create middleware function', () => {
      const middleware = guard.middleware('DELETE_CHANNEL');
      expect(typeof middleware).toBe('function');
    });

    it('should allow request with valid MFA', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);
      const middleware = guard.middleware('DELETE_CHANNEL');

      const req = {
        user: { id: userId },
        body: { totpCode },
        params: { communityId: 'community123' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test' },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req).toHaveProperty('securityGuardResult');
    });

    it('should deny request with invalid MFA', async () => {
      const middleware = guard.middleware('DELETE_CHANNEL');

      const req = {
        user: { id: userId },
        body: { totpCode: '000000' },
        params: { communityId: 'community123' },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test' },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Operation denied',
        })
      );
    });

    it('should extract TOTP from header', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);
      const middleware = guard.middleware('DELETE_CHANNEL');

      const req = {
        user: { id: userId },
        body: {},
        headers: {
          'x-totp-code': totpCode,
          'user-agent': 'test',
        },
        params: { communityId: 'community123' },
        ip: '127.0.0.1',
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Discord Interaction Guard', () => {
    it('should allow Discord interaction with valid MFA', async () => {
      const totpCode = generateTOTPCodeForSecret(totpSecret);

      const interaction = {
        user: { id: userId },
        guildId: 'guild123',
        type: 2, // APPLICATION_COMMAND
        commandName: 'delete-channel',
        options: {
          getString: vi.fn((key: string) => (key === 'totp_code' ? totpCode : null)),
        },
      };

      const allowed = await guard.guardInteraction('DELETE_CHANNEL', interaction);
      expect(allowed).toBe(true);
    });

    it('should deny Discord interaction with invalid MFA', async () => {
      const interaction = {
        user: { id: userId },
        guildId: 'guild123',
        type: 2,
        commandName: 'delete-channel',
        options: {
          getString: vi.fn(() => '000000'),
        },
      };

      const allowed = await guard.guardInteraction('DELETE_CHANNEL', interaction);
      expect(allowed).toBe(false);
    });

    it('should handle backup code in Discord interaction', async () => {
      const testUserId = 'backupuser';
      const backupSetup = await mfaService.setupTOTP({
        userId: testUserId,
        method: 'TOTP',
      });
      const backupCode = backupSetup.backupCodes[0];

      const interaction = {
        user: { id: testUserId },
        guildId: 'guild123',
        type: 2,
        commandName: 'delete-channel',
        options: {
          getString: vi.fn((key: string) => (key === 'backup_code' ? backupCode : null)),
        },
      };

      const allowed = await guard.guardInteraction('DELETE_CHANNEL', interaction);
      expect(allowed).toBe(true);
    });
  });
});

/**
 * Helper: Generate TOTP code for a given secret
 */
function generateTOTPCodeForSecret(secret: string): string {
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

  // Dynamic truncation
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
