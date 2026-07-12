/**
 * ParallelModeOrchestrator Tests
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParallelModeOrchestrator } from './parallel-mode-orchestrator.js';
import type {
  IParallelModeCommunityService,
  IShadowLedgerReadiness,
  IFeatureGateReadiness,
  INatsPublisher,
  IParallelModeOrchestratorMetrics,
} from './parallel-mode-orchestrator.js';
import type { INamespacedRoleManager, IChannelStrategyManager, TierRoleConfig } from '@freeside/core/ports';
import type {
  ParallelModeConfig,
  MemberEligibility,
  DiscordRole,
  DiscordChannel,
  NamespacedRoleConfig,
  ChannelStrategyConfig,
} from '@freeside/core/domain';
import {
  DEFAULT_NAMESPACED_ROLE_CONFIG,
  DEFAULT_CHANNEL_STRATEGY_CONFIG,
} from '@freeside/core/domain';
import type { Logger } from 'pino';

// =============================================================================
// Test Mocks
// =============================================================================

function createMockLogger(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

function createMockRoleManager(): INamespacedRoleManager {
  return {
    createNamespacedRole: vi.fn(),
    createAllRoles: vi.fn().mockResolvedValue(['arrakis-Fremen', 'arrakis-Outsider']),
    findIncumbentRolePosition: vi.fn(),
    calculateRolePosition: vi.fn(),
    isArrakisRole: vi.fn((name: string) => name.startsWith('arrakis-')),
    getArrakisRoles: vi.fn().mockResolvedValue([]),
    syncRoles: vi.fn().mockResolvedValue({ assigned: 0, removed: 0, unchanged: 0 }),
    syncMemberRole: vi.fn().mockResolvedValue(true),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  };
}

function createMockChannelManager(): IChannelStrategyManager {
  return {
    createCategory: vi.fn(),
    createChannels: vi.fn().mockResolvedValue([]),
    createAdditiveChannels: vi.fn().mockResolvedValue([]),
    createMirrorChannels: vi.fn().mockResolvedValue([]),
    isArrakisChannel: vi.fn((name: string) => name.startsWith('arrakis-') || name === 'Arrakis'),
    getArrakisChannels: vi.fn().mockResolvedValue([]),
    syncChannelPermissions: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  };
}

function createMockCommunityService(): IParallelModeCommunityService {
  const configs = new Map<string, ParallelModeConfig>();

  return {
    getParallelModeConfig: vi.fn(async (communityId: string) => configs.get(communityId) ?? null),
    saveParallelModeConfig: vi.fn(async (config: ParallelModeConfig) => {
      configs.set(config.communityId, config);
    }),
    getGuildId: vi.fn().mockResolvedValue('guild-123'),
    getTierConfigs: vi.fn().mockResolvedValue([
      { id: 'tier-1', name: 'Fremen', roleColor: 0x3498db, permissions: BigInt(0) },
      { id: 'tier-2', name: 'Outsider', roleColor: 0x95a5a6, permissions: BigInt(0) },
    ]),
    getMemberEligibilities: vi.fn().mockResolvedValue([]),
    getMemberEligibility: vi.fn().mockResolvedValue(null),
  };
}

function createMockShadowLedger(): IShadowLedgerReadiness {
  return {
    getStats: vi.fn().mockResolvedValue({
      totalMembers: 100,
      divergentMembers: 3,
      accuracy: 0.97,
      lastSyncAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
    }),
  };
}

function createMockFeatureGate(): IFeatureGateReadiness {
  return {
    checkAccess: vi.fn().mockResolvedValue({
      allowed: true,
      currentTier: 'Fremen',
    }),
  };
}

function createMockNats(): INatsPublisher {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMetrics(): IParallelModeOrchestratorMetrics {
  return {
    parallelModeEnablements: { inc: vi.fn() },
    parallelModeSyncDuration: { observe: vi.fn() },
  };
}

function createMockRole(id: string, name: string, position: number): DiscordRole {
  return {
    id,
    name,
    color: 0,
    position,
    permissions: BigInt(0),
    hoist: false,
    managed: false,
    mentionable: false,
  };
}

function createMockChannel(id: string, name: string, type: number): DiscordChannel {
  return {
    id,
    name,
    type,
    parentId: null,
    position: 0,
    topic: null,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ParallelModeOrchestrator', () => {
  let orchestrator: ParallelModeOrchestrator;
  let roleManager: INamespacedRoleManager;
  let channelManager: IChannelStrategyManager;
  let communityService: IParallelModeCommunityService;
  let shadowLedger: IShadowLedgerReadiness;
  let featureGate: IFeatureGateReadiness;
  let nats: INatsPublisher;
  let metrics: IParallelModeOrchestratorMetrics;
  let logger: Logger;

  beforeEach(() => {
    roleManager = createMockRoleManager();
    channelManager = createMockChannelManager();
    communityService = createMockCommunityService();
    shadowLedger = createMockShadowLedger();
    featureGate = createMockFeatureGate();
    nats = createMockNats();
    metrics = createMockMetrics();
    logger = createMockLogger();

    orchestrator = new ParallelModeOrchestrator(
      roleManager,
      channelManager,
      communityService,
      shadowLedger,
      featureGate,
      nats,
      metrics,
      logger
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // checkReadiness Tests
  // ===========================================================================

  describe('checkReadiness', () => {
    it('should return ready when all requirements met', async () => {
      const readiness = await orchestrator.checkReadiness('community-456');

      expect(readiness.ready).toBe(true);
      expect(readiness.blockers).toHaveLength(0);
      expect(readiness.checks.accuracy.passed).toBe(true);
      expect(readiness.checks.featureGate.passed).toBe(true);
    });

    it('should block when community not found', async () => {
      vi.mocked(communityService.getGuildId).mockResolvedValue(null);

      const readiness = await orchestrator.checkReadiness('community-456');

      expect(readiness.ready).toBe(false);
      expect(readiness.blockers).toContain('Community not found');
    });

    it('should block when accuracy too low', async () => {
      vi.mocked(shadowLedger.getStats).mockResolvedValue({
        totalMembers: 100,
        divergentMembers: 10,
        accuracy: 0.90, // Below 95%
        lastSyncAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      });

      const readiness = await orchestrator.checkReadiness('community-456');

      expect(readiness.ready).toBe(false);
      expect(readiness.checks.accuracy.passed).toBe(false);
      expect(readiness.blockers.some(b => b.includes('accuracy'))).toBe(true);
    });

    it('should block when feature gate denies access', async () => {
      vi.mocked(featureGate.checkAccess).mockResolvedValue({
        allowed: false,
        currentTier: 'Outsider',
      });

      const readiness = await orchestrator.checkReadiness('community-456');

      expect(readiness.ready).toBe(false);
      expect(readiness.checks.featureGate.passed).toBe(false);
      expect(readiness.blockers.some(b => b.includes('Feature gate'))).toBe(true);
    });

    it('should use custom requirements when provided', async () => {
      const customOrchestrator = new ParallelModeOrchestrator(
        roleManager,
        channelManager,
        communityService,
        shadowLedger,
        featureGate,
        nats,
        metrics,
        logger,
        { minShadowDays: 30, minAccuracy: 0.99 }
      );

      const readiness = await customOrchestrator.checkReadiness('community-456');

      // Should fail with custom requirements (15 days < 30, 0.97 < 0.99)
      expect(readiness.ready).toBe(false);
    });
  });

  // ===========================================================================
  // enable Tests
  // ===========================================================================

  describe('enable', () => {
    it('should enable parallel mode when ready', async () => {
      const result = await orchestrator.enable('community-456', 'guild-123', {});

      expect(result).toBe(true);
      expect(roleManager.createAllRoles).toHaveBeenCalledWith(
        'guild-123',
        'community-456',
        expect.any(Array),
        expect.objectContaining({ prefix: 'arrakis-' })
      );
      expect(communityService.saveParallelModeConfig).toHaveBeenCalled();
      expect(nats.publish).toHaveBeenCalledWith(
        'parallel.mode.enabled',
        expect.objectContaining({ communityId: 'community-456' })
      );
      expect(metrics.parallelModeEnablements.inc).toHaveBeenCalledWith({
        community_id: 'community-456',
        result: 'success',
      });
    });

    it('should not enable when not ready', async () => {
      vi.mocked(shadowLedger.getStats).mockResolvedValue({
        totalMembers: 100,
        divergentMembers: 50,
        accuracy: 0.50,
        lastSyncAt: new Date(),
      });

      const result = await orchestrator.enable('community-456', 'guild-123', {});

      expect(result).toBe(false);
      expect(roleManager.createAllRoles).not.toHaveBeenCalled();
      expect(metrics.parallelModeEnablements.inc).toHaveBeenCalledWith({
        community_id: 'community-456',
        result: 'not_ready',
      });
    });

    it('should not enable when no tier configs found', async () => {
      vi.mocked(communityService.getTierConfigs).mockResolvedValue([]);

      const result = await orchestrator.enable('community-456', 'guild-123', {});

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should create channels when strategy is not none', async () => {
      const result = await orchestrator.enable('community-456', 'guild-123', {
        channelConfig: { ...DEFAULT_CHANNEL_STRATEGY_CONFIG, strategy: 'additive_only' },
      });

      expect(result).toBe(true);
      expect(channelManager.createChannels).toHaveBeenCalled();
    });

    it('should not create channels when strategy is none', async () => {
      const result = await orchestrator.enable('community-456', 'guild-123', {
        channelConfig: { ...DEFAULT_CHANNEL_STRATEGY_CONFIG, strategy: 'none' },
      });

      expect(result).toBe(true);
      expect(channelManager.createChannels).not.toHaveBeenCalled();
    });

    it('should record entry accuracy and shadow days', async () => {
      await orchestrator.enable('community-456', 'guild-123', {});

      expect(communityService.saveParallelModeConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          entryAccuracy: 0.97,
          entryShadowDays: expect.any(Number),
        })
      );
    });
  });

  // ===========================================================================
  // disable Tests
  // ===========================================================================

  describe('disable', () => {
    beforeEach(async () => {
      // Enable first
      await orchestrator.enable('community-456', 'guild-123', {});
    });

    it('should disable parallel mode', async () => {
      const result = await orchestrator.disable('community-456');

      expect(result).toBe(true);
      expect(communityService.saveParallelModeConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false })
      );
      expect(nats.publish).toHaveBeenCalledWith(
        'parallel.mode.disabled',
        expect.objectContaining({ communityId: 'community-456' })
      );
    });

    it('should return false when not enabled', async () => {
      const result = await orchestrator.disable('community-999');

      expect(result).toBe(false);
    });

    it('should log artifact removal when requested', async () => {
      const result = await orchestrator.disable('community-456', true);

      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ communityId: 'community-456' }),
        'Artifact removal would occur here'
      );
    });
  });

  // ===========================================================================
  // sync Tests
  // ===========================================================================

  describe('sync', () => {
    beforeEach(async () => {
      // Enable with additive_only strategy so channels are synced
      await orchestrator.enable('community-456', 'guild-123', {
        channelConfig: { ...DEFAULT_CHANNEL_STRATEGY_CONFIG, strategy: 'additive_only' },
      });
    });

    it('should sync roles and channels', async () => {
      vi.mocked(channelManager.getArrakisChannels).mockResolvedValue([
        createMockChannel('ch-1', 'arrakis-lounge', 0),
        createMockChannel('ch-2', 'arrakis-diamond', 0),
      ]);

      const result = await orchestrator.sync('community-456');

      expect(result.communityId).toBe('community-456');
      expect(result.guildId).toBe('guild-123');
      expect(roleManager.syncRoles).toHaveBeenCalled();
      expect(channelManager.syncChannelPermissions).toHaveBeenCalledTimes(2);
      expect(result.channelsSynced).toBe(2);
      expect(nats.publish).toHaveBeenCalledWith(
        'parallel.mode.sync.completed',
        expect.any(Object)
      );
    });

    it('should throw when parallel mode not enabled', async () => {
      await expect(orchestrator.sync('community-999')).rejects.toThrow(
        'Parallel mode not enabled'
      );
    });

    it('should record sync duration metrics', async () => {
      await orchestrator.sync('community-456');

      expect(metrics.parallelModeSyncDuration.observe).toHaveBeenCalledWith(
        { community_id: 'community-456' },
        expect.any(Number)
      );
    });

    it('should include role sync errors in result', async () => {
      vi.mocked(roleManager.syncRoles).mockResolvedValue({
        assigned: 1,
        removed: 0,
        unchanged: 5,
        errors: [
          { userId: 'user-1', message: 'Rate limited', retryable: true },
        ],
      });

      const result = await orchestrator.sync('community-456');

      expect(result.errors).toContain('Rate limited');
    });

    it('should skip channel sync when strategy is none', async () => {
      // Re-enable with none strategy
      await orchestrator.enable('community-456', 'guild-123', {
        channelConfig: { ...DEFAULT_CHANNEL_STRATEGY_CONFIG, strategy: 'none' },
      });

      const result = await orchestrator.sync('community-456');

      expect(result.channelsSynced).toBe(0);
      expect(channelManager.syncChannelPermissions).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // syncMember Tests
  // ===========================================================================

  describe('syncMember', () => {
    beforeEach(async () => {
      await orchestrator.enable('community-456', 'guild-123', {});
    });

    it('should sync single member', async () => {
      vi.mocked(communityService.getMemberEligibility).mockResolvedValue({
        userId: 'user-123',
        eligible: true,
        tier: 'Fremen',
        roles: [],
      });

      const result = await orchestrator.syncMember('community-456', 'user-123');

      expect(result).toBe(true);
      expect(roleManager.syncMemberRole).toHaveBeenCalledWith(
        'guild-123',
        'community-456',
        expect.objectContaining({ userId: 'user-123' })
      );
    });

    it('should return false when member not found', async () => {
      vi.mocked(communityService.getMemberEligibility).mockResolvedValue(null);

      const result = await orchestrator.syncMember('community-456', 'user-999');

      expect(result).toBe(false);
    });

    it('should return false when parallel mode not enabled', async () => {
      const result = await orchestrator.syncMember('community-999', 'user-123');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // getStatus Tests
  // ===========================================================================

  describe('getStatus', () => {
    beforeEach(async () => {
      await orchestrator.enable('community-456', 'guild-123', {});
    });

    it('should return status when enabled', async () => {
      vi.mocked(roleManager.getArrakisRoles).mockResolvedValue([
        createMockRole('r1', 'arrakis-Fremen', 5),
        createMockRole('r2', 'arrakis-Outsider', 3),
      ]);
      vi.mocked(channelManager.getArrakisChannels).mockResolvedValue([
        createMockChannel('c1', 'arrakis-lounge', 0),
      ]);

      const status = await orchestrator.getStatus('community-456');

      expect(status).not.toBeNull();
      expect(status?.active).toBe(true);
      expect(status?.arrakisRolesCount).toBe(2);
      expect(status?.arrakisChannelsCount).toBe(1);
    });

    it('should return null when not configured', async () => {
      const status = await orchestrator.getStatus('community-999');

      expect(status).toBeNull();
    });

    it('should report healthy sync status', async () => {
      vi.mocked(shadowLedger.getStats).mockResolvedValue({
        totalMembers: 100,
        divergentMembers: 2,
        accuracy: 0.98,
        lastSyncAt: new Date(), // Just synced
      });

      const status = await orchestrator.getStatus('community-456');

      expect(status?.syncHealth).toBe('healthy');
      expect(status?.errors).toHaveLength(0);
    });

    it('should report degraded sync status when stale', async () => {
      vi.mocked(shadowLedger.getStats).mockResolvedValue({
        totalMembers: 100,
        divergentMembers: 2,
        accuracy: 0.98,
        lastSyncAt: new Date(Date.now() - 13 * 60 * 60 * 1000), // 13 hours ago
      });

      const status = await orchestrator.getStatus('community-456');

      expect(status?.syncHealth).toBe('degraded');
    });

    it('should report failed sync status when very stale', async () => {
      vi.mocked(shadowLedger.getStats).mockResolvedValue({
        totalMembers: 100,
        divergentMembers: 2,
        accuracy: 0.98,
        lastSyncAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
      });

      const status = await orchestrator.getStatus('community-456');

      expect(status?.syncHealth).toBe('failed');
      expect(status?.errors.length).toBeGreaterThan(0);
    });

    it('should count members with Arrakis roles', async () => {
      vi.mocked(roleManager.getArrakisRoles).mockResolvedValue([
        createMockRole('r1', 'arrakis-Fremen', 5),
      ]);
      vi.mocked(communityService.getMemberEligibilities).mockResolvedValue([
        { userId: 'u1', eligible: true, tier: 'Fremen', roles: ['r1'] },
        { userId: 'u2', eligible: true, tier: 'Fremen', roles: ['r1'] },
        { userId: 'u3', eligible: false, tier: null, roles: [] },
      ]);

      const status = await orchestrator.getStatus('community-456');

      expect(status?.membersWithArrakisRoles).toBe(2);
    });
  });

  // ===========================================================================
  // Configuration Tests
  // ===========================================================================

  describe('configuration', () => {
    beforeEach(async () => {
      await orchestrator.enable('community-456', 'guild-123', {});
    });

    it('should get config', async () => {
      const config = await orchestrator.getConfig('community-456');

      expect(config).not.toBeNull();
      expect(config?.communityId).toBe('community-456');
      expect(config?.enabled).toBe(true);
    });

    it('should update config', async () => {
      await orchestrator.updateConfig('community-456', {
        roleConfig: { ...DEFAULT_NAMESPACED_ROLE_CONFIG, prefix: 'custom-' },
      });

      const config = await orchestrator.getConfig('community-456');
      expect(config?.roleConfig.prefix).toBe('custom-');
    });

    it('should throw when updating non-existent config', async () => {
      await expect(
        orchestrator.updateConfig('community-999', {})
      ).rejects.toThrow('Parallel mode not configured');
    });

    it('should merge nested config objects', async () => {
      await orchestrator.updateConfig('community-456', {
        channelConfig: { ...DEFAULT_CHANNEL_STRATEGY_CONFIG, strategy: 'parallel_mirror' },
      });

      const config = await orchestrator.getConfig('community-456');
      expect(config?.channelConfig.strategy).toBe('parallel_mirror');
      // Should preserve other channel config properties
      expect(config?.channelConfig.channelPrefix).toBe('arrakis-');
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should handle enable errors gracefully', async () => {
      vi.mocked(roleManager.createAllRoles).mockRejectedValue(new Error('Discord error'));

      const result = await orchestrator.enable('community-456', 'guild-123', {});

      expect(result).toBe(false);
      expect(metrics.parallelModeEnablements.inc).toHaveBeenCalledWith({
        community_id: 'community-456',
        result: 'error',
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle disable errors gracefully', async () => {
      await orchestrator.enable('community-456', 'guild-123', {});
      vi.mocked(communityService.saveParallelModeConfig).mockRejectedValueOnce(
        new Error('DB error')
      );

      const result = await orchestrator.disable('community-456');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
