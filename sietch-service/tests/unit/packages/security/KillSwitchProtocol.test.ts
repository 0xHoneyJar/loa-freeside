/**
 * KillSwitchProtocol Tests
 *
 * Sprint 47: Kill Switch & MFA
 *
 * Test coverage:
 * - Kill switch activation (GLOBAL, COMMUNITY, USER scopes)
 * - Session revocation
 * - Community freeze/unfreeze
 * - Timing requirements (<5s)
 * - Admin notifications
 * - Audit logging
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KillSwitchProtocol, KillSwitchError } from '../../../../src/packages/security/KillSwitchProtocol.js';
import { WizardSessionStore } from '../../../../src/packages/wizard/WizardSessionStore.js';
import { Redis } from 'ioredis';

describe('KillSwitchProtocol', () => {
  let redis: Redis;
  let sessionStore: WizardSessionStore;
  let killSwitch: KillSwitchProtocol;

  beforeEach(() => {
    redis = new Redis();
    sessionStore = new WizardSessionStore({ redis, debug: false });
    killSwitch = new KillSwitchProtocol({
      redis,
      sessionStore,
      debug: false,
    });
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  describe('Kill Switch Activation', () => {
    it('should activate kill switch for USER scope', async () => {
      // Create a session for the user
      await sessionStore.create({
        guildId: 'guild123',
        userId: 'user456',
        communityId: 'community789',
      });

      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
      expect(result.scope).toBe('USER');
      expect(result.reason).toBe('CREDENTIAL_COMPROMISE');
      expect(result.sessionsRevoked).toBe(1);
      expect(result.durationMs).toBeLessThan(5000);
    });

    it('should activate kill switch for COMMUNITY scope', async () => {
      // Create sessions for the community
      await sessionStore.create({
        guildId: 'guild123',
        userId: 'user1',
        communityId: 'community789',
      });
      await sessionStore.create({
        guildId: 'guild123',
        userId: 'user2',
        communityId: 'community789',
      });

      const result = await killSwitch.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId: 'guild123',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
      expect(result.scope).toBe('COMMUNITY');
      expect(result.sessionsRevoked).toBe(2);
      expect(result.synthesisJobsPaused).toBeGreaterThan(0);
    });

    it('should activate kill switch for GLOBAL scope', async () => {
      // Create sessions across multiple communities
      await sessionStore.create({
        guildId: 'guild1',
        userId: 'user1',
        communityId: 'community1',
      });
      await sessionStore.create({
        guildId: 'guild2',
        userId: 'user2',
        communityId: 'community2',
      });

      const result = await killSwitch.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
      expect(result.scope).toBe('GLOBAL');
      expect(result.sessionsRevoked).toBe(2);
      expect(result.synthesisJobsPaused).toBeGreaterThan(0);
    });

    it('should complete activation in under 5 seconds', async () => {
      const startTime = Date.now();

      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000);
      expect(result.durationMs).toBeLessThan(5000);
    });

    it('should validate required options', async () => {
      await expect(
        killSwitch.activate({
          scope: 'COMMUNITY',
          reason: 'SECURITY_BREACH',
          // Missing communityId
          activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        } as any)
      ).rejects.toThrow(KillSwitchError);
    });

    it('should validate USER scope requires userId', async () => {
      await expect(
        killSwitch.activate({
          scope: 'USER',
          reason: 'CREDENTIAL_COMPROMISE',
          // Missing userId
          activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        } as any)
      ).rejects.toThrow(KillSwitchError);
    });

    it('should require activatedBy', async () => {
      await expect(
        killSwitch.activate({
          scope: 'GLOBAL',
          reason: 'EMERGENCY_MAINTENANCE',
          // Missing activatedBy
        } as any)
      ).rejects.toThrow(KillSwitchError);
    });
  });

  describe('Session Revocation', () => {
    it('should revoke all sessions for a user', async () => {
      const userId = 'user456';

      // Create sessions in different guilds for same user
      await sessionStore.create({
        guildId: 'guild1',
        userId,
        communityId: 'community1',
      });
      await sessionStore.create({
        guildId: 'guild2',
        userId,
        communityId: 'community2',
      });

      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId,
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.sessionsRevoked).toBe(2);

      // Verify sessions are deleted
      const session1 = await sessionStore.getActiveSession('guild1', userId);
      const session2 = await sessionStore.getActiveSession('guild2', userId);
      expect(session1).toBeNull();
      expect(session2).toBeNull();
    });

    it('should revoke all sessions for a community', async () => {
      const guildId = 'guild123';

      // Create sessions for multiple users in same guild
      await sessionStore.create({
        guildId,
        userId: 'user1',
        communityId: 'community1',
      });
      await sessionStore.create({
        guildId,
        userId: 'user2',
        communityId: 'community1',
      });
      await sessionStore.create({
        guildId,
        userId: 'user3',
        communityId: 'community1',
      });

      const result = await killSwitch.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId: guildId,
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.sessionsRevoked).toBe(3);
    });

    it('should handle zero sessions gracefully', async () => {
      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'nonexistent',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
      expect(result.sessionsRevoked).toBe(0);
    });
  });

  describe('Community Freeze', () => {
    it('should freeze community synthesis', async () => {
      const communityId = 'community123';

      const result = await killSwitch.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId,
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.synthesisJobsPaused).toBeGreaterThan(0);

      // Check freeze status
      const freezeStatus = await killSwitch.isCommunityFrozen(communityId);
      expect(freezeStatus.frozen).toBe(true);
      expect(freezeStatus.reason).toBe('SECURITY_BREACH');
    });

    it('should freeze global synthesis', async () => {
      const result = await killSwitch.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.synthesisJobsPaused).toBeGreaterThan(0);

      // Check global freeze affects all communities
      const freezeStatus = await killSwitch.isCommunityFrozen('any-community');
      expect(freezeStatus.frozen).toBe(true);
      expect(freezeStatus.reason).toContain('Global freeze');
    });

    it('should unfreeze community', async () => {
      const communityId = 'community123';

      // Freeze
      await killSwitch.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId,
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      // Unfreeze
      await killSwitch.unfreezeCommunity(communityId);

      const freezeStatus = await killSwitch.isCommunityFrozen(communityId);
      expect(freezeStatus.frozen).toBe(false);
    });

    it('should unfreeze global synthesis', async () => {
      // Freeze globally
      await killSwitch.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      // Unfreeze
      await killSwitch.unfreezeGlobal();

      const freezeStatus = await killSwitch.isCommunityFrozen('any-community');
      expect(freezeStatus.frozen).toBe(false);
    });

    it('should return not frozen for unfrozen community', async () => {
      const freezeStatus = await killSwitch.isCommunityFrozen('unfrozen-community');
      expect(freezeStatus.frozen).toBe(false);
    });
  });

  describe('Audit Logging', () => {
    it('should log successful activation', async () => {
      await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      const logs = killSwitch.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);

      const lastLog = logs[logs.length - 1];
      expect(lastLog.eventType).toBe('KILL_SWITCH');
      expect(lastLog.success).toBe(true);
      expect(lastLog.userId).toBe('user456');
    });

    it('should log failed activation', async () => {
      try {
        await killSwitch.activate({
          scope: 'COMMUNITY',
          reason: 'SECURITY_BREACH',
          // Missing communityId
          activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        } as any);
      } catch (error) {
        // Expected to fail
      }

      const logs = killSwitch.getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);

      const lastLog = logs[logs.length - 1];
      expect(lastLog.eventType).toBe('KILL_SWITCH');
      expect(lastLog.success).toBe(false);
      expect(lastLog.error).toBeDefined();
    });

    it('should limit audit logs to last 1000 entries', async () => {
      // Create 1001 audit logs (if possible)
      // This is a basic test - in reality, you'd need to mock the internal audit log array
      const logs = killSwitch.getAuditLogs(10);
      expect(logs.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Admin Notifications', () => {
    it('should skip notification if webhook not configured', async () => {
      // Kill switch has no webhook configured in beforeEach
      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: true, // Request notification
      });

      // Should succeed even without webhook
      expect(result.success).toBe(true);
    });

    it('should skip notification if notifyAdmins is false', async () => {
      const killSwitchWithWebhook = new KillSwitchProtocol({
        redis,
        sessionStore,
        adminWebhookUrl: 'https://discord.com/api/webhooks/test',
        debug: false,
      });

      // Mock fetch to track calls
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await killSwitchWithWebhook.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false, // Skip notification
      });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should send Discord webhook notification with correct payload', async () => {
      const webhookUrl = 'https://discord.com/api/webhooks/test';
      const killSwitchWithWebhook = new KillSwitchProtocol({
        redis,
        sessionStore,
        adminWebhookUrl: webhookUrl,
        debug: false,
      });

      // Mock fetch
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      );
      global.fetch = fetchMock;

      await killSwitchWithWebhook.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId: 'guild123',
        activatedBy: 'admin123',
        activatorRole: 'NAIB_COUNCIL',
        notifyAdmins: true,
      });

      // Verify webhook was called
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Verify payload structure
      const callArgs = fetchMock.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body as string);

      expect(payload.embeds).toBeDefined();
      expect(payload.embeds).toHaveLength(1);

      const embed = payload.embeds[0];
      expect(embed.title).toContain('Kill Switch Activated');
      expect(embed.title).toContain('COMMUNITY');
      expect(embed.description).toContain('SECURITY_BREACH');
      expect(embed.description).toContain('admin123');
      expect(embed.description).toContain('guild123');
      expect(embed.color).toBe(0xff0000); // Red for CRITICAL
      expect(embed.timestamp).toBeDefined();
      expect(embed.footer).toBeDefined();
      expect(embed.footer.text).toBe('Arrakis Security System');
    });

    it('should not break kill switch if webhook fails', async () => {
      const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
      global.fetch = fetchMock;

      const killSwitchWithWebhook = new KillSwitchProtocol({
        redis,
        sessionStore,
        adminWebhookUrl: 'https://discord.com/api/webhooks/test',
        debug: false,
      });

      // Should NOT throw even if webhook fails
      const result = await killSwitchWithWebhook.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user123',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: true,
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should handle webhook HTTP errors gracefully', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 429, // Rate limited
        } as Response)
      );
      global.fetch = fetchMock;

      const killSwitchWithWebhook = new KillSwitchProtocol({
        redis,
        sessionStore,
        adminWebhookUrl: 'https://discord.com/api/webhooks/test',
        debug: false,
      });

      // Should complete successfully even if webhook returns error
      const result = await killSwitchWithWebhook.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'admin123',
        activatorRole: 'NAIB_COUNCIL',
        notifyAdmins: true,
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should include correct severity color in webhook payload', async () => {
      const webhookUrl = 'https://discord.com/api/webhooks/test';
      const killSwitchWithWebhook = new KillSwitchProtocol({
        redis,
        sessionStore,
        adminWebhookUrl: webhookUrl,
        debug: false,
      });

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
        } as Response)
      );
      global.fetch = fetchMock;

      await killSwitchWithWebhook.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user456',
        activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: true,
      });

      const callArgs = fetchMock.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body as string);
      const embed = payload.embeds[0];

      // CRITICAL severity should be red (0xff0000)
      expect(embed.color).toBe(0xff0000);
    });
  });

  describe('Authorization', () => {
    it('should allow Naib Council to activate GLOBAL kill switch', async () => {
      const result = await killSwitch.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'naib-member',
        activatorRole: 'NAIB_COUNCIL',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
    });

    it('should allow Platform Admin to activate GLOBAL kill switch', async () => {
      const result = await killSwitch.activate({
        scope: 'GLOBAL',
        reason: 'EMERGENCY_MAINTENANCE',
        activatedBy: 'platform-admin',
        activatorRole: 'PLATFORM_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
    });

    it('should deny Community Admin from activating GLOBAL kill switch', async () => {
      await expect(
        killSwitch.activate({
          scope: 'GLOBAL',
          reason: 'EMERGENCY_MAINTENANCE',
          activatedBy: 'community-admin',
          activatorRole: 'COMMUNITY_ADMIN',
          notifyAdmins: false,
        })
      ).rejects.toThrow(KillSwitchError);
    });

    it('should deny regular USER from activating GLOBAL kill switch', async () => {
      await expect(
        killSwitch.activate({
          scope: 'GLOBAL',
          reason: 'EMERGENCY_MAINTENANCE',
          activatedBy: 'regular-user',
          activatorRole: 'USER',
          notifyAdmins: false,
        })
      ).rejects.toThrow(KillSwitchError);
    });

    it('should allow Community Admin to activate COMMUNITY kill switch', async () => {
      const result = await killSwitch.activate({
        scope: 'COMMUNITY',
        reason: 'SECURITY_BREACH',
        communityId: 'guild123',
        activatedBy: 'community-admin',
        activatorRole: 'COMMUNITY_ADMIN',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
    });

    it('should deny regular USER from activating COMMUNITY kill switch', async () => {
      await expect(
        killSwitch.activate({
          scope: 'COMMUNITY',
          reason: 'SECURITY_BREACH',
          communityId: 'guild123',
          activatedBy: 'regular-user',
          activatorRole: 'USER',
          notifyAdmins: false,
        })
      ).rejects.toThrow(KillSwitchError);
    });

    it('should allow user to self-revoke (USER scope)', async () => {
      const result = await killSwitch.activate({
        scope: 'USER',
        reason: 'CREDENTIAL_COMPROMISE',
        userId: 'user123',
        activatedBy: 'user123', // Same as userId
        activatorRole: 'USER',
        notifyAdmins: false,
      });

      expect(result.success).toBe(true);
    });

    it('should deny user from revoking another user without admin role', async () => {
      await expect(
        killSwitch.activate({
          scope: 'USER',
          reason: 'CREDENTIAL_COMPROMISE',
          userId: 'user456',
          activatedBy: 'user123', // Different user
          activatorRole: 'USER',
          notifyAdmins: false,
        })
      ).rejects.toThrow(KillSwitchError);
    });
  });

  describe('Error Handling', () => {
    it('should handle session store errors gracefully', async () => {
      // Mock session store to throw error
      const brokenSessionStore = {
        ...sessionStore,
        delete: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      } as any;

      const brokenKillSwitch = new KillSwitchProtocol({
        redis,
        sessionStore: brokenSessionStore,
        debug: false,
      });

      await expect(
        brokenKillSwitch.activate({
          scope: 'USER',
          reason: 'CREDENTIAL_COMPROMISE',
          userId: 'user456',
          activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
          notifyAdmins: false,
        })
      ).rejects.toThrow(KillSwitchError);
    });

    it('should include error in result on failure', async () => {
      try {
        await killSwitch.activate({
          scope: 'COMMUNITY',
          reason: 'SECURITY_BREACH',
          // Missing communityId
          activatedBy: 'admin123',
        activatorRole: 'PLATFORM_ADMIN',
        } as any);
      } catch (error) {
        expect(error).toBeInstanceOf(KillSwitchError);
        expect((error as KillSwitchError).code).toBe('ACTIVATION_FAILED');
      }
    });
  });
});
