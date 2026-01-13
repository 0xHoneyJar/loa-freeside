/**
 * SecureSessionStore Tests
 *
 * Sprint 51: Session Security Enhancements
 * Sprint 53: Updated for required RATE_LIMIT_SALT env var
 *
 * Tests IP binding, device fingerprinting, and failed attempt rate limiting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecureSessionStore } from '../../../../src/packages/security/SecureSessionStore.js';
import type { Redis } from 'ioredis';
import * as crypto from 'node:crypto';

// Sprint 53: Required env var for rate limit salt
const TEST_RATE_LIMIT_SALT = 'test-rate-limit-salt-value';

describe('SecureSessionStore', () => {
  let store: SecureSessionStore;
  let mockRedis: Redis;
  const testUserId = 'user-123';
  const testGuildId = 'guild-456';

  // Helper to generate rate limit key matching production logic
  const getRateLimitKey = (userId: string, guildId: string): string => {
    const hash = crypto
      .createHash('sha256')
      .update(`${TEST_RATE_LIMIT_SALT}:${guildId}:${userId}`)
      .digest('hex')
      .substring(0, 16);
    return `secure_session:rate_limit:${hash}`;
  };

  // Mock Redis implementation
  beforeEach(() => {
    // Sprint 53: Set required env var before tests
    process.env.RATE_LIMIT_SALT = TEST_RATE_LIMIT_SALT;
    const data = new Map<string, string>();
    const ttls = new Map<string, number>();

    mockRedis = {
      setex: vi.fn(async (key: string, ttl: number, value: string) => {
        data.set(key, value);
        ttls.set(key, ttl);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => {
        return data.get(key) ?? null;
      }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const key of keys) {
          if (data.delete(key)) count++;
          ttls.delete(key);
        }
        return count;
      }),
      incr: vi.fn(async (key: string) => {
        const current = parseInt(data.get(key) ?? '0', 10);
        const newValue = current + 1;
        data.set(key, String(newValue));
        return newValue;
      }),
      expire: vi.fn(async (key: string, seconds: number) => {
        ttls.set(key, seconds);
        return 1;
      }),
      ttl: vi.fn(async (key: string) => {
        return ttls.get(key) ?? -1;
      }),
      scan: vi.fn(async (cursor: string, ...args: any[]) => {
        const keys = Array.from(data.keys());
        return [String(keys.length > 0 ? '0' : cursor), keys];
      }),
    } as unknown as Redis;

    store = new SecureSessionStore({
      redis: mockRedis,
      sessionTtl: 900, // 15 minutes
      failedAttemptThreshold: 10,
      lockoutDuration: 900,
    });
  });

  describe('Session Creation', () => {
    it('should create session with IP binding', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      expect(session).toBeDefined();
      expect(session.userId).toBe(testUserId);
      expect(session.guildId).toBe(testGuildId);
      expect(session.boundIpAddress).toBe('192.168.1.100');
      expect(session.sessionId).toBeDefined();
      expect(session.deviceFingerprint).toBeDefined();
    });

    it('should generate unique session IDs', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      };

      const session1 = await store.createSession(testUserId, testGuildId, context);
      const session2 = await store.createSession(testUserId, testGuildId, context);

      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it('should set expiration timestamp', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      };

      const before = new Date();
      const session = await store.createSession(testUserId, testGuildId, context);
      const after = new Date(Date.now() + 900 * 1000); // 15 min

      expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(before.getTime());
      expect(new Date(session.expiresAt).getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should initialize failed attempts to 0', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      expect(session.failedAttempts).toBe(0);
    });

    it('should reject session creation when rate limited', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
      };

      // Simulate 10 failed attempts (hit rate limit)
      // Sprint 53: Use hashed rate limit key
      const rateLimitKey = getRateLimitKey(testUserId, testGuildId);
      for (let i = 0; i < 10; i++) {
        await mockRedis.incr(rateLimitKey);
      }

      await expect(
        store.createSession(testUserId, testGuildId, context)
      ).rejects.toThrow('locked out');
    });
  });

  describe('Device Fingerprinting', () => {
    it('should generate consistent fingerprint for same context', () => {
      const context1 = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        acceptHeader: 'text/html,application/xhtml+xml',
      };

      const context2 = {
        ipAddress: '192.168.1.200', // Different IP (not used in fingerprint)
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        acceptHeader: 'text/html,application/xhtml+xml',
      };

      const fp1 = store.generateDeviceFingerprint(context1);
      const fp2 = store.generateDeviceFingerprint(context2);

      expect(fp1).toBe(fp2);
    });

    it('should generate different fingerprints for different User-Agents', () => {
      const context1 = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows)',
        acceptHeader: 'text/html',
      };

      const context2 = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Macintosh)',
        acceptHeader: 'text/html',
      };

      const fp1 = store.generateDeviceFingerprint(context1);
      const fp2 = store.generateDeviceFingerprint(context2);

      expect(fp1).not.toBe(fp2);
    });

    it('should generate different fingerprints for different Accept headers', () => {
      const context1 = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'text/html',
      };

      const context2 = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'application/json',
      };

      const fp1 = store.generateDeviceFingerprint(context1);
      const fp2 = store.generateDeviceFingerprint(context2);

      expect(fp1).not.toBe(fp2);
    });

    it('should handle missing Accept header', () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const fp = store.generateDeviceFingerprint(context);

      expect(fp).toBeDefined();
      expect(typeof fp).toBe('string');
    });
  });

  describe('Session Validation', () => {
    it('should validate session with matching IP and fingerprint', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.reason).toBeUndefined();
    });

    it('should reject session with mismatched IP', async () => {
      const createContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, createContext);

      const validateContext = {
        ...createContext,
        ipAddress: '192.168.1.200', // Different IP
      };

      const result = await store.validateSession(session.sessionId, validateContext);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ip_mismatch');
    });

    it('should reject session with mismatched fingerprint', async () => {
      const createContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows)',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, createContext);

      const validateContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Macintosh)', // Different User-Agent
        acceptHeader: 'text/html',
      };

      const result = await store.validateSession(session.sessionId, validateContext);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('fingerprint_mismatch');
    });

    it('should reject expired session', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      // Manually expire session
      session.expiresAt = new Date(Date.now() - 1000);
      await mockRedis.setex(
        `secure_session:${session.sessionId}`,
        900,
        JSON.stringify(session)
      );

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('should reject non-existent session', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const result = await store.validateSession('nonexistent-session-id', context);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('session_not_found');
    });

    it('should update lastAccessedAt on successful validation', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        acceptHeader: 'text/html',
      };

      const session = await store.createSession(testUserId, testGuildId, context);
      const originalLastAccessed = new Date(session.lastAccessedAt);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(true);
      expect(new Date(result.session!.lastAccessedAt).getTime()).toBeGreaterThan(
        originalLastAccessed.getTime()
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should not rate limit below threshold', async () => {
      // Sprint 53: Use hashed rate limit key
      const rateLimitKey = getRateLimitKey(testUserId, testGuildId);
      // Record 9 failed attempts (below threshold of 10)
      for (let i = 0; i < 9; i++) {
        await mockRedis.incr(rateLimitKey);
      }

      const status = await store.checkRateLimit(testUserId, testGuildId);

      expect(status.limited).toBe(false);
      expect(status.attempts).toBe(9);
    });

    it('should rate limit at threshold', async () => {
      // Sprint 53: Use hashed rate limit key
      const rateLimitKey = getRateLimitKey(testUserId, testGuildId);
      // Record 10 failed attempts (threshold)
      for (let i = 0; i < 10; i++) {
        await mockRedis.incr(rateLimitKey);
      }

      const status = await store.checkRateLimit(testUserId, testGuildId);

      expect(status.limited).toBe(true);
      expect(status.attempts).toBe(10);
      expect(status.lockoutExpiresAt).toBeDefined();
    });

    it('should reset rate limit', async () => {
      // Sprint 53: Use hashed rate limit key
      const rateLimitKey = getRateLimitKey(testUserId, testGuildId);
      // Record failed attempts
      for (let i = 0; i < 10; i++) {
        await mockRedis.incr(rateLimitKey);
      }

      // Reset
      await store.resetRateLimit(testUserId, testGuildId);

      const status = await store.checkRateLimit(testUserId, testGuildId);

      expect(status.limited).toBe(false);
      expect(status.attempts).toBe(0);
    });

    it('should reject validation when locked out', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      // Sprint 53: Use hashed rate limit key
      const rateLimitKey = getRateLimitKey(testUserId, testGuildId);
      // Trigger lockout
      for (let i = 0; i < 10; i++) {
        await mockRedis.incr(rateLimitKey);
      }

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('locked_out');
    });
  });

  describe('Session Updates', () => {
    it('should update session data', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const session = await store.createSession(testUserId, testGuildId, context, {
        step: 'initial',
      });

      await store.updateSession(session.sessionId, { step: 'completed' });

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(true);
      expect(result.session!.data.step).toBe('completed');
    });

    it('should throw error updating non-existent session', async () => {
      await expect(
        store.updateSession('nonexistent-id', { data: 'test' })
      ).rejects.toThrow('Session nonexistent-id not found');
    });
  });

  describe('Session Deletion', () => {
    it('should delete session', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const session = await store.createSession(testUserId, testGuildId, context);

      await store.deleteSession(session.sessionId);

      const result = await store.validateSession(session.sessionId, context);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('session_not_found');
    });
  });

  describe('Session Revocation', () => {
    it('should revoke all sessions for a user', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      // Create multiple sessions
      const session1 = await store.createSession(testUserId, testGuildId, context);
      const session2 = await store.createSession(testUserId, testGuildId, context);
      const session3 = await store.createSession(testUserId, testGuildId, context);

      const revokedCount = await store.revokeUserSessions(testUserId, testGuildId);

      expect(revokedCount).toBe(3);

      // Verify all sessions are invalid
      const result1 = await store.validateSession(session1.sessionId, context);
      const result2 = await store.validateSession(session2.sessionId, context);
      const result3 = await store.validateSession(session3.sessionId, context);

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
      expect(result3.valid).toBe(false);
    });

    it('should only revoke sessions for specified user/guild', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const sessionUser1 = await store.createSession(testUserId, testGuildId, context);
      const sessionUser2 = await store.createSession('user-999', testGuildId, context);

      await store.revokeUserSessions(testUserId, testGuildId);

      // User 1 session should be revoked
      const result1 = await store.validateSession(sessionUser1.sessionId, context);
      expect(result1.valid).toBe(false);

      // User 2 session should still be valid
      const result2 = await store.validateSession(sessionUser2.sessionId, context);
      expect(result2.valid).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should return session statistics', async () => {
      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      await store.createSession(testUserId, testGuildId, context);
      await store.createSession('user-2', testGuildId, context);

      const stats = await store.getStats();

      expect(stats.totalSessions).toBeGreaterThanOrEqual(2);
      expect(stats.activeSessions).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Configuration', () => {
    it('should allow disabling IP binding', async () => {
      const storeNoIpBinding = new SecureSessionStore({
        redis: mockRedis,
        enableIpBinding: false,
      });

      const createContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const session = await storeNoIpBinding.createSession(
        testUserId,
        testGuildId,
        createContext
      );

      const validateContext = {
        ipAddress: '192.168.1.200', // Different IP
        userAgent: 'Mozilla/5.0',
      };

      const result = await storeNoIpBinding.validateSession(
        session.sessionId,
        validateContext
      );

      // Should be valid since IP binding is disabled
      expect(result.valid).toBe(true);
    });

    it('should allow disabling device fingerprinting', async () => {
      const storeNoFingerprinting = new SecureSessionStore({
        redis: mockRedis,
        enableFingerprinting: false,
      });

      const createContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows)',
      };

      const session = await storeNoFingerprinting.createSession(
        testUserId,
        testGuildId,
        createContext
      );

      const validateContext = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Macintosh)', // Different User-Agent
      };

      const result = await storeNoFingerprinting.validateSession(
        session.sessionId,
        validateContext
      );

      // Should be valid since fingerprinting is disabled
      expect(result.valid).toBe(true);
    });

    it('should use custom key prefix', async () => {
      const customStore = new SecureSessionStore({
        redis: mockRedis,
        keyPrefix: 'custom_prefix',
      });

      const context = {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
      };

      const session = await customStore.createSession(testUserId, testGuildId, context);

      // Verify key was created with custom prefix
      const spy = vi.spyOn(mockRedis, 'setex');
      await customStore.updateSession(session.sessionId, { test: true });

      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('custom_prefix:'),
        expect.any(Number),
        expect.any(String)
      );
    });
  });
});
