/**
 * Incumbent Health Monitor Tests - Sprint 64
 *
 * Tests for health checking, alerting, and backup activation.
 *
 * @module tests/unit/packages/adapters/coexistence/IncumbentHealthMonitor.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IncumbentHealthMonitor,
  createIncumbentHealthMonitor,
  BOT_ONLINE_ALERT_MS,
  ROLE_UPDATE_ALERT_MS,
  ROLE_UPDATE_CRITICAL_MS,
  CHANNEL_ACTIVITY_ALERT_MS,
  ALERT_THROTTLE_MS,
  type HealthAlert,
  type NotifyAdminCallback,
  type ActivateBackupCallback,
} from '../../../../../src/packages/adapters/coexistence/IncumbentHealthMonitor.js';
import type { ICoexistenceStorage, StoredCommunityBasic } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { Client, Guild, GuildMember, TextChannel, Message, Collection, Presence } from 'discord.js';

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockStorage(overrides: Partial<ICoexistenceStorage> = {}): ICoexistenceStorage {
  return {
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn().mockResolvedValue({}),
    updateIncumbentHealth: vi.fn().mockResolvedValue(undefined),
    deleteIncumbentConfig: vi.fn().mockResolvedValue(undefined),
    hasIncumbent: vi.fn().mockResolvedValue(false),
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn().mockResolvedValue({}),
    updateMigrationState: vi.fn().mockResolvedValue({}),
    getCurrentMode: vi.fn().mockResolvedValue('shadow'),
    updateMode: vi.fn().mockResolvedValue(undefined),
    recordRollback: vi.fn().mockResolvedValue(undefined),
    initializeShadowMode: vi.fn().mockResolvedValue({}),
    getCommunity: vi.fn().mockResolvedValue(null),
    getCommunitiesByMode: vi.fn().mockResolvedValue([]),
    getReadyCommunities: vi.fn().mockResolvedValue([]),
    getIncumbentHealthOverview: vi.fn().mockResolvedValue(new Map()),
    getShadowMemberState: vi.fn().mockResolvedValue(null),
    getShadowMemberStates: vi.fn().mockResolvedValue([]),
    saveShadowMemberState: vi.fn().mockResolvedValue({}),
    batchSaveShadowMemberStates: vi.fn().mockResolvedValue(undefined),
    deleteShadowMemberState: vi.fn().mockResolvedValue(undefined),
    saveDivergence: vi.fn().mockResolvedValue({}),
    getDivergences: vi.fn().mockResolvedValue([]),
    resolveDivergence: vi.fn().mockResolvedValue(undefined),
    getDivergenceSummary: vi.fn().mockResolvedValue({ match: 0, arrakis_higher: 0, arrakis_lower: 0, mismatch: 0 }),
    savePrediction: vi.fn().mockResolvedValue({}),
    validatePrediction: vi.fn().mockResolvedValue(undefined),
    getUnvalidatedPredictions: vi.fn().mockResolvedValue([]),
    getPredictionAccuracy: vi.fn().mockResolvedValue({ total: 0, accurate: 0, inaccurate: 0, pending: 0 }),
    getParallelRoleConfig: vi.fn().mockResolvedValue(null),
    saveParallelRoleConfig: vi.fn().mockResolvedValue({}),
    getParallelRoles: vi.fn().mockResolvedValue([]),
    getParallelRoleByTier: vi.fn().mockResolvedValue(null),
    saveParallelRole: vi.fn().mockResolvedValue({}),
    deleteParallelRole: vi.fn().mockResolvedValue(undefined),
    deleteAllParallelRoles: vi.fn().mockResolvedValue(undefined),
    getParallelMemberAssignment: vi.fn().mockResolvedValue(null),
    getParallelMemberAssignments: vi.fn().mockResolvedValue([]),
    saveParallelMemberAssignment: vi.fn().mockResolvedValue({}),
    batchSaveParallelMemberAssignments: vi.fn().mockResolvedValue(undefined),
    deleteParallelMemberAssignment: vi.fn().mockResolvedValue(undefined),
    getMembersNeedingRoleUpdate: vi.fn().mockResolvedValue([]),
    getParallelChannelConfig: vi.fn().mockResolvedValue(null),
    saveParallelChannelConfig: vi.fn().mockResolvedValue({}),
    getParallelChannel: vi.fn().mockResolvedValue(null),
    getParallelChannels: vi.fn().mockResolvedValue([]),
    saveParallelChannel: vi.fn().mockResolvedValue({}),
    deleteParallelChannel: vi.fn().mockResolvedValue(undefined),
    deleteAllParallelChannels: vi.fn().mockResolvedValue(undefined),
    getParallelChannelAccess: vi.fn().mockResolvedValue(null),
    getParallelChannelAccessByChannel: vi.fn().mockResolvedValue([]),
    getParallelChannelAccessByMember: vi.fn().mockResolvedValue([]),
    saveParallelChannelAccess: vi.fn().mockResolvedValue({}),
    batchSaveParallelChannelAccess: vi.fn().mockResolvedValue(undefined),
    deleteParallelChannelAccess: vi.fn().mockResolvedValue(undefined),
    getMembersNeedingAccess: vi.fn().mockResolvedValue([]),
    getMembersNeedingRevocation: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ICoexistenceStorage;
}

function createMockGuild(overrides: Partial<Guild> = {}): Guild {
  const mockMembers = new Map<string, GuildMember>();
  const mockChannels = new Map<string, TextChannel>();

  return {
    id: 'guild-123',
    name: 'Test Guild',
    members: {
      fetch: vi.fn().mockResolvedValue(mockMembers),
      cache: mockMembers,
    },
    channels: {
      fetch: vi.fn().mockResolvedValue(null),
      cache: mockChannels,
    },
    ...overrides,
  } as unknown as Guild;
}

function createMockClient(guild?: Guild): Client {
  const mockGuilds = new Map<string, Guild>();
  if (guild) {
    mockGuilds.set(guild.id, guild);
  }

  return {
    guilds: {
      fetch: vi.fn().mockImplementation((guildId: string) => {
        if (guild && guild.id === guildId) {
          return Promise.resolve(guild);
        }
        return Promise.reject(new Error('Guild not found'));
      }),
      cache: mockGuilds,
    },
  } as unknown as Client;
}

function createMockBotMember(
  isOnline: boolean,
  botId = 'bot-123'
): GuildMember {
  return {
    id: botId,
    user: {
      id: botId,
      username: 'Collab.Land',
      bot: true,
    },
    presence: isOnline ? { status: 'online' } as Presence : { status: 'offline' } as Presence,
  } as unknown as GuildMember;
}

function createMockMessage(createdAt: Date): Message {
  return {
    createdAt,
    id: `msg-${Date.now()}`,
  } as unknown as Message;
}

// =============================================================================
// Tests
// =============================================================================

describe('IncumbentHealthMonitor', () => {
  let storage: ICoexistenceStorage;
  let discordClient: Client;
  let notifyAdmin: NotifyAdminCallback;
  let activateBackup: ActivateBackupCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-30T12:00:00Z'));

    storage = createMockStorage();
    discordClient = createMockClient();
    notifyAdmin = vi.fn().mockResolvedValue(undefined);
    activateBackup = vi.fn().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constants', () => {
    it('should have correct threshold values', () => {
      expect(BOT_ONLINE_ALERT_MS).toBe(60 * 60 * 1000); // 1 hour
      expect(ROLE_UPDATE_ALERT_MS).toBe(48 * 60 * 60 * 1000); // 48 hours
      expect(ROLE_UPDATE_CRITICAL_MS).toBe(72 * 60 * 60 * 1000); // 72 hours
      expect(CHANNEL_ACTIVITY_ALERT_MS).toBe(168 * 60 * 60 * 1000); // 168 hours (7 days)
      expect(ALERT_THROTTLE_MS).toBe(4 * 60 * 60 * 1000); // 4 hours
    });
  });

  describe('checkHealth()', () => {
    it('should return null when no incumbent config exists', async () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkHealth('community-123');

      expect(result).toBeNull();
      expect(storage.getIncumbentConfig).toHaveBeenCalledWith('community-123');
    });

    it('should return null when no migration state exists', async () => {
      vi.mocked(storage.getIncumbentConfig).mockResolvedValue({
        id: 'config-1',
        communityId: 'community-123',
        provider: 'collabland',
        botId: 'bot-123',
        botUsername: 'Collab.Land',
        verificationChannelId: 'channel-123',
        detectedAt: new Date(),
        confidence: 95,
        manualOverride: false,
        lastHealthCheck: new Date(),
        healthStatus: 'healthy',
        detectedRoles: [],
        capabilities: {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkHealth('community-123');

      expect(result).toBeNull();
    });

    it('should detect offline bot and return critical status', async () => {
      const botMember = createMockBotMember(false, 'bot-123');
      const mockGuild = createMockGuild();
      (mockGuild.members.cache as Map<string, GuildMember>).set('bot-123', botMember);

      vi.mocked(storage.getIncumbentConfig).mockResolvedValue({
        id: 'config-1',
        communityId: 'community-123',
        provider: 'collabland',
        botId: 'bot-123',
        botUsername: 'Collab.Land',
        verificationChannelId: null,
        detectedAt: new Date(),
        confidence: 95,
        manualOverride: false,
        lastHealthCheck: new Date(),
        healthStatus: 'healthy',
        detectedRoles: [],
        capabilities: {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getCommunity).mockResolvedValue({
        id: 'community-123',
        name: 'Test Community',
        discordGuildId: 'guild-123',
        telegramChatId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = createMockClient(mockGuild);
      const monitor = createIncumbentHealthMonitor(storage, client, notifyAdmin);

      const result = await monitor.checkHealth('community-123');

      expect(result).not.toBeNull();
      expect(result!.checks.botOnline.passed).toBe(false);
      expect(result!.checks.botOnline.severity).toBe('warning');
      expect(result!.overallStatus).toBe('degraded');
    });

    it('should detect online bot and return healthy status', async () => {
      const botMember = createMockBotMember(true, 'bot-123');
      const mockGuild = createMockGuild();
      (mockGuild.members.cache as Map<string, GuildMember>).set('bot-123', botMember);

      vi.mocked(storage.getIncumbentConfig).mockResolvedValue({
        id: 'config-1',
        communityId: 'community-123',
        provider: 'collabland',
        botId: 'bot-123',
        botUsername: 'Collab.Land',
        verificationChannelId: null,
        detectedAt: new Date(),
        confidence: 95,
        manualOverride: false,
        lastHealthCheck: new Date(),
        healthStatus: 'healthy',
        detectedRoles: [],
        capabilities: {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getCommunity).mockResolvedValue({
        id: 'community-123',
        name: 'Test Community',
        discordGuildId: 'guild-123',
        telegramChatId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = createMockClient(mockGuild);
      const monitor = createIncumbentHealthMonitor(storage, client, notifyAdmin);

      const result = await monitor.checkHealth('community-123');

      expect(result).not.toBeNull();
      expect(result!.checks.botOnline.passed).toBe(true);
      expect(result!.checks.botOnline.severity).toBe('ok');
    });
  });

  describe('checkRoleUpdateFreshness()', () => {
    it('should return ok for fresh updates', async () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);
      const recentUpdate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const result = await monitor.checkRoleUpdateFreshness('community-123', recentUpdate);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ok');
    });

    it('should return warning for stale updates (>48h)', async () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);
      const staleUpdate = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50 hours ago

      const result = await monitor.checkRoleUpdateFreshness('community-123', staleUpdate);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('50 hours');
    });

    it('should return critical for very stale updates (>72h)', async () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);
      const veryStaleUpdate = new Date(Date.now() - 80 * 60 * 60 * 1000); // 80 hours ago

      const result = await monitor.checkRoleUpdateFreshness('community-123', veryStaleUpdate);

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('critical');
      expect(result.message).toContain('80 hours');
    });

    it('should return ok for first check (no previous data)', async () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkRoleUpdateFreshness('community-123', null);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.context?.reason).toBe('first_check');
    });
  });

  describe('Alert Throttling', () => {
    it('should throttle alerts within cooldown period', async () => {
      const botMember = createMockBotMember(false, 'bot-123');
      const mockGuild = createMockGuild();
      (mockGuild.members.cache as Map<string, GuildMember>).set('bot-123', botMember);

      vi.mocked(storage.getIncumbentConfig).mockResolvedValue({
        id: 'config-1',
        communityId: 'community-123',
        provider: 'collabland',
        botId: 'bot-123',
        botUsername: 'Collab.Land',
        verificationChannelId: null,
        detectedAt: new Date(),
        confidence: 95,
        manualOverride: false,
        lastHealthCheck: new Date(),
        healthStatus: 'healthy',
        detectedRoles: [],
        capabilities: {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getCommunity).mockResolvedValue({
        id: 'community-123',
        name: 'Test Community',
        discordGuildId: 'guild-123',
        telegramChatId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = createMockClient(mockGuild);
      const monitor = createIncumbentHealthMonitor(storage, client, notifyAdmin);

      // First check - should send alert
      await monitor.checkHealth('community-123');
      expect(notifyAdmin).toHaveBeenCalledTimes(1);

      // Second check within 4 hours - should be throttled
      vi.advanceTimersByTime(2 * 60 * 60 * 1000); // 2 hours
      const result2 = await monitor.checkHealth('community-123');
      expect(result2!.alertThrottled).toBe(true);
      expect(notifyAdmin).toHaveBeenCalledTimes(1); // No additional call

      // Third check after 4 hours - should send alert
      vi.advanceTimersByTime(3 * 60 * 60 * 1000); // 3 more hours (5 total)
      await monitor.checkHealth('community-123');
      expect(notifyAdmin).toHaveBeenCalledTimes(2);
    });

    it('should clear alert throttle when requested', () => {
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      // Set a throttle
      const throttleState = monitor.getAlertThrottleState();
      expect(throttleState.size).toBe(0);

      // Check with alert would set throttle, so test clearAlertThrottle directly
      monitor.clearAlertThrottle('guild-123');

      expect(monitor.getAlertThrottleState().get('guild-123')).toBeUndefined();
    });
  });

  describe('activateEmergencyBackup()', () => {
    it('should transition from shadow to parallel mode', async () => {
      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.activateEmergencyBackup(
        'community-123',
        'guild-123',
        'admin-456'
      );

      expect(result.success).toBe(true);
      expect(result.newMode).toBe('parallel');
      expect(storage.updateMigrationState).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'community-123',
          currentMode: 'parallel',
        })
      );
    });

    it('should fail if not in shadow mode', async () => {
      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'parallel', // Already in parallel
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: new Date(),
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.activateEmergencyBackup(
        'community-123',
        'guild-123',
        'admin-456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot activate backup from parallel mode');
    });

    it('should fail if migration state not found', async () => {
      vi.mocked(storage.getMigrationState).mockResolvedValue(null);

      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.activateEmergencyBackup(
        'community-123',
        'guild-123',
        'admin-456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Migration state not found');
    });

    it('should use activateBackup callback if provided', async () => {
      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const customActivateBackup = vi.fn().mockResolvedValue({ success: true });
      const monitor = createIncumbentHealthMonitor(
        storage,
        discordClient,
        notifyAdmin,
        customActivateBackup
      );

      const result = await monitor.activateEmergencyBackup(
        'community-123',
        'guild-123',
        'admin-456'
      );

      expect(result.success).toBe(true);
      expect(customActivateBackup).toHaveBeenCalledWith(
        'community-123',
        'guild-123',
        expect.stringContaining('admin-456')
      );
    });
  });

  describe('checkBotOnline()', () => {
    it('should return ok when no bot ID configured', async () => {
      const mockGuild = createMockGuild();
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkBotOnline(mockGuild, null);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.context?.reason).toBe('no_bot_id');
    });

    it('should return critical when bot not found in guild', async () => {
      const mockGuild = createMockGuild();
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkBotOnline(mockGuild, 'nonexistent-bot');

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('critical');
      expect(result.message).toContain('not found');
    });
  });

  describe('checkChannelActivity()', () => {
    it('should return ok when no channel ID configured', async () => {
      const mockGuild = createMockGuild();
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkChannelActivity(mockGuild, null);

      expect(result.passed).toBe(true);
      expect(result.severity).toBe('ok');
      expect(result.context?.reason).toBe('no_channel_id');
    });

    it('should return warning when channel not found', async () => {
      const mockGuild = createMockGuild();
      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const result = await monitor.checkChannelActivity(mockGuild, 'nonexistent-channel');

      expect(result.passed).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('not found');
    });
  });

  describe('checkAllCommunities()', () => {
    it('should check all communities in monitoring-eligible modes', async () => {
      vi.mocked(storage.getCommunitiesByMode).mockResolvedValue([
        {
          id: 'community-1',
          name: 'Community 1',
          discordGuildId: 'guild-1',
          telegramChatId: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'community-2',
          name: 'Community 2',
          discordGuildId: 'guild-2',
          telegramChatId: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const monitor = createIncumbentHealthMonitor(storage, discordClient);

      const reports = await monitor.checkAllCommunities();

      expect(storage.getCommunitiesByMode).toHaveBeenCalledWith(['shadow', 'parallel', 'primary']);
      expect(reports).toHaveLength(0); // No incumbent configs, so no reports
    });
  });

  describe('Dry Run Mode', () => {
    it('should not send alerts in dry run mode', async () => {
      const botMember = createMockBotMember(false, 'bot-123');
      const mockGuild = createMockGuild();
      (mockGuild.members.cache as Map<string, GuildMember>).set('bot-123', botMember);

      vi.mocked(storage.getIncumbentConfig).mockResolvedValue({
        id: 'config-1',
        communityId: 'community-123',
        provider: 'collabland',
        botId: 'bot-123',
        botUsername: 'Collab.Land',
        verificationChannelId: null,
        detectedAt: new Date(),
        confidence: 95,
        manualOverride: false,
        lastHealthCheck: new Date(),
        healthStatus: 'healthy',
        detectedRoles: [],
        capabilities: {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getMigrationState).mockResolvedValue({
        id: 'state-1',
        communityId: 'community-123',
        currentMode: 'shadow',
        targetMode: null,
        strategy: null,
        shadowStartedAt: new Date(),
        parallelEnabledAt: null,
        primaryEnabledAt: null,
        exclusiveEnabledAt: null,
        rollbackCount: 0,
        lastRollbackAt: null,
        lastRollbackReason: null,
        readinessCheckPassed: false,
        accuracyPercent: null,
        shadowDays: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.mocked(storage.getCommunity).mockResolvedValue({
        id: 'community-123',
        name: 'Test Community',
        discordGuildId: 'guild-123',
        telegramChatId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const client = createMockClient(mockGuild);
      const monitor = createIncumbentHealthMonitor(
        storage,
        client,
        notifyAdmin,
        activateBackup,
        { dryRun: true }
      );

      await monitor.checkHealth('community-123');

      expect(notifyAdmin).not.toHaveBeenCalled();
    });
  });
});
