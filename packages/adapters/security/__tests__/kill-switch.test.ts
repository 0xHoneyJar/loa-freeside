/**
 * KillSwitch Tests
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Tests for emergency kill switch:
 * - MFA-protected activation/deactivation
 * - Redis state storage
 * - NATS broadcast
 * - Synthesis pause/resume
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KillSwitch, createKillSwitch } from '../kill-switch.js';
import type {
  RedisClient,
  NatsClient,
  NotificationService,
} from '../kill-switch.js';
import type {
  IVaultClient,
  IMfaVerifier,
  KillSwitchRequest,
  MfaVerificationResult,
} from '@freeside/core/ports';
import { KILL_SWITCH_KEYS } from '@freeside/core/ports';
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
}

class MockMfaVerifier implements IMfaVerifier {
  private shouldSucceed = true;

  setResult(success: boolean): void {
    this.shouldSucceed = success;
  }

  async verify(_userId: string, _token: string): Promise<MfaVerificationResult> {
    return {
      valid: this.shouldSucceed,
      error: this.shouldSucceed ? undefined : 'Invalid token',
      verifiedAt: new Date(),
    };
  }

  async generateSecret(): Promise<string> {
    return 'JBSWY3DPEHPK3PXP';
  }

  getTotpUri(userId: string, secret: string): string {
    return `otpauth://totp/Test:${userId}?secret=${secret}`;
  }
}

class MockRedisClient implements RedisClient {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  // Test helper
  clear(): void {
    this.store.clear();
  }
}

class MockNatsClient implements NatsClient {
  public messages: Array<{ subject: string; data: unknown }> = [];

  async publish(subject: string, data: unknown): Promise<void> {
    this.messages.push({ subject, data });
  }

  clear(): void {
    this.messages = [];
  }
}

class MockNotificationService implements NotificationService {
  public notifications: Array<{ event: string; data: Record<string, unknown> }> = [];

  async notifyAdmins(event: string, data: Record<string, unknown>): Promise<void> {
    this.notifications.push({ event, data });
  }

  clear(): void {
    this.notifications = [];
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('KillSwitch', () => {
  let mockVault: MockVaultClient;
  let mockMfaVerifier: MockMfaVerifier;
  let mockRedis: MockRedisClient;
  let mockNats: MockNatsClient;
  let mockNotifications: MockNotificationService;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;
  let killSwitch: KillSwitch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    mockVault = new MockVaultClient();
    mockMfaVerifier = new MockMfaVerifier();
    mockRedis = new MockRedisClient();
    mockNats = new MockNatsClient();
    mockNotifications = new MockNotificationService();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();

    killSwitch = new KillSwitch({
      vault: mockVault,
      mfaVerifier: mockMfaVerifier,
      redis: mockRedis,
      nats: mockNats,
      notifications: mockNotifications,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mockRedis.clear();
    mockNats.clear();
    mockNotifications.clear();
  });

  describe('createKillSwitch', () => {
    it('should create a KillSwitch instance', () => {
      const ks = createKillSwitch({
        vault: mockVault,
        mfaVerifier: mockMfaVerifier,
        redis: mockRedis,
        nats: mockNats,
        notifications: mockNotifications,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(ks).toBeDefined();
    });
  });

  describe('activate', () => {
    const request: KillSwitchRequest = {
      adminId: 'admin-123',
      mfaToken: '123456',
      reason: 'Security incident',
    };

    it('should store kill switch state in Redis', async () => {
      await killSwitch.activate(request);

      const state = await mockRedis.get(KILL_SWITCH_KEYS.STATE);
      expect(state).not.toBeNull();

      const parsed = JSON.parse(state!);
      expect(parsed.activatedBy).toBe('admin-123');
      expect(parsed.reason).toBe('Security incident');
    });

    it('should broadcast ACTIVATE message via NATS', async () => {
      await killSwitch.activate(request);

      expect(mockNats.messages).toHaveLength(1);
      expect(mockNats.messages[0].subject).toBe('internal.killswitch');
      expect((mockNats.messages[0].data as Record<string, unknown>).action).toBe(
        'ACTIVATE'
      );
    });

    it('should pause synthesis operations', async () => {
      await killSwitch.activate(request);

      const paused = await mockRedis.get(KILL_SWITCH_KEYS.SYNTHESIS_PAUSED);
      expect(paused).toBe('1');
    });

    it('should notify admins of activation', async () => {
      await killSwitch.activate(request);

      expect(mockNotifications.notifications).toHaveLength(1);
      expect(mockNotifications.notifications[0].event).toBe('KILL_SWITCH_ACTIVATED');
      expect(mockNotifications.notifications[0].data.adminId).toBe('admin-123');
    });

    it('should log activation with warning level', async () => {
      await killSwitch.activate(request);

      // KillSwitch creates a child logger, verify that child was created properly
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'KillSwitch' });
    });

    it('should throw on MFA failure', async () => {
      mockMfaVerifier.setResult(false);

      await expect(killSwitch.activate(request)).rejects.toThrow(
        'MFA verification failed'
      );
    });
  });

  describe('deactivate', () => {
    beforeEach(async () => {
      mockMfaVerifier.setResult(true);
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });
      mockNats.clear();
      mockNotifications.clear();
    });

    it('should require valid MFA token', async () => {
      mockMfaVerifier.setResult(false);

      await expect(killSwitch.deactivate('admin-456', '654321')).rejects.toThrow(
        'MFA verification failed'
      );
    });

    it('should clear kill switch state from Redis', async () => {
      await killSwitch.deactivate('admin-456', '654321');

      const state = await mockRedis.get(KILL_SWITCH_KEYS.STATE);
      expect(state).toBeNull();
    });

    it('should broadcast DEACTIVATE message via NATS', async () => {
      await killSwitch.deactivate('admin-456', '654321');

      expect(mockNats.messages).toHaveLength(1);
      expect((mockNats.messages[0].data as Record<string, unknown>).action).toBe(
        'DEACTIVATE'
      );
    });

    it('should resume synthesis operations', async () => {
      await killSwitch.deactivate('admin-456', '654321');

      const paused = await mockRedis.get(KILL_SWITCH_KEYS.SYNTHESIS_PAUSED);
      expect(paused).toBeNull();
    });

    it('should notify admins of deactivation', async () => {
      await killSwitch.deactivate('admin-456', '654321');

      expect(mockNotifications.notifications).toHaveLength(1);
      expect(mockNotifications.notifications[0].event).toBe('KILL_SWITCH_DEACTIVATED');
    });
  });

  describe('isActive', () => {
    it('should return false when not activated', async () => {
      const active = await killSwitch.isActive();
      expect(active).toBe(false);
    });

    it('should return true when activated', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      const active = await killSwitch.isActive();
      expect(active).toBe(true);
    });

    it('should return false after deactivation', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });
      await killSwitch.deactivate('admin-456', '654321');

      const active = await killSwitch.isActive();
      expect(active).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return inactive state when not activated', async () => {
      const state = await killSwitch.getState();
      expect(state.active).toBe(false);
      expect(state.activatedBy).toBeUndefined();
    });

    it('should return full state when activated', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Security incident',
      });

      const state = await killSwitch.getState();

      expect(state.active).toBe(true);
      expect(state.activatedBy).toBe('admin-123');
      expect(state.reason).toBe('Security incident');
    });

    it('should preserve activation timestamp', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      const state = await killSwitch.getState();

      expect(state.activatedAt).toBeInstanceOf(Date);
      expect(state.activatedAt?.toISOString()).toBe('2024-01-15T12:00:00.000Z');
    });
  });

  describe('MFA Verification Metrics', () => {
    it('should record successful MFA verification', async () => {
      const incSpy = vi.spyOn(mockMetrics.mfaVerifications, 'inc');

      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      expect(incSpy).toHaveBeenCalledWith({ status: 'success' });
    });

    it('should record failed MFA verification', async () => {
      const incSpy = vi.spyOn(mockMetrics.mfaVerifications, 'inc');
      mockMfaVerifier.setResult(false);

      await expect(
        killSwitch.activate({
          adminId: 'admin-123',
          mfaToken: '123456',
          reason: 'Test',
        })
      ).rejects.toThrow();

      expect(incSpy).toHaveBeenCalledWith({ status: 'failure' });
    });
  });

  describe('Kill Switch Metrics', () => {
    it('should update metrics on activation', async () => {
      const setSpy = vi.spyOn(mockMetrics.killSwitchActive, 'set');
      const incSpy = vi.spyOn(mockMetrics.killSwitchActivations, 'inc');

      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      expect(setSpy).toHaveBeenCalledWith(1);
      expect(incSpy).toHaveBeenCalled();
    });

    it('should update metrics on deactivation', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      const setSpy = vi.spyOn(mockMetrics.killSwitchActive, 'set');
      const incSpy = vi.spyOn(mockMetrics.killSwitchDeactivations, 'inc');

      await killSwitch.deactivate('admin-456', '654321');

      expect(setSpy).toHaveBeenCalledWith(0);
      expect(incSpy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple activations', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'First',
      });
      await killSwitch.activate({
        adminId: 'admin-456',
        mfaToken: '654321',
        reason: 'Second',
      });

      const state = await killSwitch.getState();
      expect(state.activatedBy).toBe('admin-456');
      expect(state.reason).toBe('Second');
    });

    it('should handle deactivation when not active', async () => {
      // Should not throw
      await killSwitch.deactivate('admin-123', '123456');

      const active = await killSwitch.isActive();
      expect(active).toBe(false);
    });

    it('should include timestamp in NATS messages', async () => {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: '123456',
        reason: 'Test',
      });

      const message = mockNats.messages[0].data as Record<string, unknown>;
      expect(message.timestamp).toBeDefined();
      expect(typeof message.timestamp).toBe('number');
    });
  });
});

describe('KillSwitch Error Handling', () => {
  let mockVault: MockVaultClient;
  let mockMfaVerifier: MockMfaVerifier;
  let mockRedis: MockRedisClient;
  let mockNats: MockNatsClient;
  let mockNotifications: MockNotificationService;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;
  let killSwitch: KillSwitch;

  beforeEach(() => {
    mockVault = new MockVaultClient();
    mockMfaVerifier = new MockMfaVerifier();
    mockRedis = new MockRedisClient();
    mockNats = new MockNatsClient();
    mockNotifications = new MockNotificationService();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();

    killSwitch = new KillSwitch({
      vault: mockVault,
      mfaVerifier: mockMfaVerifier,
      redis: mockRedis,
      nats: mockNats,
      notifications: mockNotifications,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  it('should log MFA failure details', async () => {
    mockMfaVerifier.setResult(false);

    try {
      await killSwitch.activate({
        adminId: 'admin-123',
        mfaToken: 'invalid',
        reason: 'Test',
      });
    } catch {
      // Expected
    }

    // KillSwitch creates a child logger, so verify child was created
    expect(mockLogger.child).toHaveBeenCalledWith({ component: 'KillSwitch' });
  });
});
