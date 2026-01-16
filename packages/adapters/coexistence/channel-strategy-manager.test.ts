/**
 * ChannelStrategyManager Tests
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelStrategyManager } from './channel-strategy-manager.js';
import type {
  IDiscordChannelService,
  ISynthesisQueue,
  IChannelConfigStore,
  IChannelMetrics,
} from './channel-strategy-manager.js';
import type { DiscordChannel, ChannelStrategyConfig } from '@arrakis/core/domain';
import { DEFAULT_CHANNEL_STRATEGY_CONFIG, DEFAULT_ADDITIVE_CHANNELS } from '@arrakis/core/domain';
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

function createMockDiscordService(): IDiscordChannelService {
  return {
    getGuildChannels: vi.fn(),
    createChannel: vi.fn(),
    editChannelPermissions: vi.fn(),
    deleteChannelPermission: vi.fn(),
  };
}

function createMockSynthesisQueue(): ISynthesisQueue {
  return {
    add: vi.fn(),
  };
}

function createMockConfigStore(): IChannelConfigStore {
  const configs = new Map<string, ChannelStrategyConfig>();
  return {
    getChannelConfig: vi.fn(async (communityId: string) => configs.get(communityId) ?? null),
    saveChannelConfig: vi.fn(async (communityId: string, config: ChannelStrategyConfig) => {
      configs.set(communityId, config);
    }),
  };
}

function createMockMetrics(): IChannelMetrics {
  return {
    channelCreations: { inc: vi.fn() },
    permissionSyncs: { inc: vi.fn() },
  };
}

function createMockChannel(
  id: string,
  name: string,
  type: number,
  parentId: string | null = null
): DiscordChannel {
  return {
    id,
    name,
    type,
    parentId,
    position: 0,
    topic: null,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ChannelStrategyManager', () => {
  let manager: ChannelStrategyManager;
  let discord: IDiscordChannelService;
  let synthesis: ISynthesisQueue;
  let configStore: IChannelConfigStore;
  let metrics: IChannelMetrics;
  let logger: Logger;

  beforeEach(() => {
    discord = createMockDiscordService();
    synthesis = createMockSynthesisQueue();
    configStore = createMockConfigStore();
    metrics = createMockMetrics();
    logger = createMockLogger();

    manager = new ChannelStrategyManager(
      discord,
      synthesis,
      configStore,
      metrics,
      logger
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createCategory', () => {
    it('should queue category creation via synthesis if not exists', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([]);

      const categoryId = await manager.createCategory('guild-123', 'Arrakis');

      // Returns pending ID for eventual consistency
      expect(categoryId).toBe('pending-category:guild-123:Arrakis');
      // Uses synthesis queue instead of direct Discord call
      expect(synthesis.add).toHaveBeenCalledWith(
        'create-category:guild-123:Arrakis',
        expect.objectContaining({
          type: 'create_channel',
          guildId: 'guild-123',
          payload: expect.objectContaining({
            name: 'Arrakis',
            type: 4,
          }),
          idempotencyKey: 'create-category:guild-123:Arrakis',
        })
      );
      // Should NOT call discord directly (rate limiting compliance)
      expect(discord.createChannel).not.toHaveBeenCalled();
    });

    it('should return existing category if found', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('cat-existing', 'Arrakis', 4),
      ]);

      const categoryId = await manager.createCategory('guild-123', 'Arrakis');

      expect(categoryId).toBe('cat-existing');
      expect(synthesis.add).not.toHaveBeenCalled();
      expect(discord.createChannel).not.toHaveBeenCalled();
    });
  });

  describe('createChannels - none strategy', () => {
    it('should not create any channels', async () => {
      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'none',
      };

      const channelIds = await manager.createChannels('guild-123', 'community-456', config);

      expect(channelIds).toHaveLength(0);
      expect(discord.createChannel).not.toHaveBeenCalled();
      expect(synthesis.add).not.toHaveBeenCalled();
    });
  });

  describe('createChannels - additive_only strategy', () => {
    it('should create default additive channels', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([]);

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'additive_only',
        channelPrefix: 'arrakis-',
      };

      const channelIds = await manager.createChannels('guild-123', 'community-456', config);

      // Should have created 2 default channels
      expect(channelIds).toHaveLength(2);
      // 3 synthesis calls: 1 category + 2 channels (all rate-limited)
      expect(synthesis.add).toHaveBeenCalledTimes(3);

      // Verify category creation via synthesis
      expect(synthesis.add).toHaveBeenCalledWith(
        'create-category:guild-123:Arrakis',
        expect.objectContaining({
          type: 'create_channel',
          payload: expect.objectContaining({
            name: 'Arrakis',
            type: 4,
          }),
        })
      );

      // Verify conviction-lounge channel
      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('create-channel:community-456:conviction-lounge'),
        expect.objectContaining({
          type: 'create_channel',
          payload: expect.objectContaining({
            name: 'arrakis-conviction-lounge',
            minConvictionScore: 80,
          }),
        })
      );

      // Verify diamond-hands channel
      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('create-channel:community-456:diamond-hands'),
        expect.objectContaining({
          type: 'create_channel',
          payload: expect.objectContaining({
            name: 'arrakis-diamond-hands',
            minConvictionScore: 95,
          }),
        })
      );
    });

    it('should use custom additive channels', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([]);
      vi.mocked(discord.createChannel).mockResolvedValue(
        createMockChannel('cat-123', 'Arrakis', 4)
      );

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'additive_only',
        additiveChannels: [
          {
            name: 'whale-lounge',
            minConvictionScore: 99,
            topic: 'For whales only',
            readOnly: false,
          },
        ],
      };

      await manager.createChannels('guild-123', 'community-456', config);

      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('whale-lounge'),
        expect.objectContaining({
          payload: expect.objectContaining({
            name: 'arrakis-whale-lounge',
            minConvictionScore: 99,
          }),
        })
      );
    });

    it('should skip existing channels', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('cat-123', 'Arrakis', 4),
        createMockChannel('ch-existing', 'arrakis-conviction-lounge', 0, 'cat-123'),
      ]);
      vi.mocked(discord.createChannel).mockResolvedValue(
        createMockChannel('cat-123', 'Arrakis', 4)
      );

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'additive_only',
        channelPrefix: 'arrakis-',
      };

      const channelIds = await manager.createChannels('guild-123', 'community-456', config);

      // conviction-lounge exists, only diamond-hands should be created
      expect(channelIds).toContain('ch-existing');
      expect(synthesis.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('createChannels - parallel_mirror strategy', () => {
    it('should create mirror channels for incumbent channels', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('cat-123', 'Arrakis', 4),
        createMockChannel('ch-holders', 'holders-only', 0),
      ]);
      vi.mocked(discord.createChannel).mockResolvedValue(
        createMockChannel('cat-123', 'Arrakis', 4)
      );

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'parallel_mirror',
        mirrorChannels: [
          {
            sourcePattern: 'holders',
            arrakisName: 'arrakis-holders',
            minTier: 'Fremen',
            syncPermissions: false,
          },
        ],
      };

      await manager.createChannels('guild-123', 'community-456', config);

      expect(synthesis.add).toHaveBeenCalledWith(
        expect.stringContaining('create-mirror'),
        expect.objectContaining({
          type: 'create_channel',
          payload: expect.objectContaining({
            name: 'arrakis-holders',
            sourceChannelId: 'ch-holders',
          }),
        })
      );
    });

    it('should warn when source channel not found', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('cat-123', 'Arrakis', 4),
      ]);
      vi.mocked(discord.createChannel).mockResolvedValue(
        createMockChannel('cat-123', 'Arrakis', 4)
      );

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'parallel_mirror',
        mirrorChannels: [
          {
            sourcePattern: 'nonexistent',
            arrakisName: 'arrakis-mirror',
            minTier: 'Fremen',
            syncPermissions: false,
          },
        ],
      };

      const channelIds = await manager.createChannels('guild-123', 'community-456', config);

      expect(channelIds).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ pattern: 'nonexistent' }),
        'Source channel not found for mirror'
      );
    });
  });

  describe('isArrakisChannel', () => {
    it('should identify Arrakis channels by prefix', () => {
      expect(manager.isArrakisChannel('arrakis-conviction-lounge')).toBe(true);
      expect(manager.isArrakisChannel('arrakis-diamond-hands')).toBe(true);
      expect(manager.isArrakisChannel('Arrakis')).toBe(true); // category
      expect(manager.isArrakisChannel('general')).toBe(false);
      expect(manager.isArrakisChannel('holders-only')).toBe(false);
    });
  });

  describe('getArrakisChannels', () => {
    it('should return only Arrakis channels', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('ch-1', 'general', 0),
        createMockChannel('ch-2', 'arrakis-lounge', 0),
        createMockChannel('ch-3', 'Arrakis', 4),
        createMockChannel('ch-4', 'holders', 0),
      ]);

      const channels = await manager.getArrakisChannels('guild-123');

      expect(channels).toHaveLength(2);
      expect(channels.map(c => c.name)).toEqual(['arrakis-lounge', 'Arrakis']);
    });
  });

  describe('syncChannelPermissions', () => {
    it('should sync permissions for additive channel', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([
        createMockChannel('ch-lounge', 'arrakis-conviction-lounge', 0),
      ]);

      await configStore.saveChannelConfig('community-456', {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'additive_only',
        additiveChannels: DEFAULT_ADDITIVE_CHANNELS,
        channelPrefix: 'arrakis-',
      });

      const members = [
        { userId: 'user-1', eligible: true, tier: 'Fremen', roles: [] },
        { userId: 'user-2', eligible: false, tier: null, roles: [] },
      ];

      await manager.syncChannelPermissions(
        'guild-123',
        'community-456',
        'ch-lounge',
        members
      );

      expect(synthesis.add).toHaveBeenCalledTimes(2);
      expect(metrics.permissionSyncs.inc).toHaveBeenCalledWith({
        community_id: 'community-456',
      });
    });
  });

  describe('configuration', () => {
    it('should save and retrieve config', async () => {
      await manager.updateConfig('community-456', {
        strategy: 'additive_only',
        categoryName: 'Custom Category',
      });

      const config = await manager.getConfig('community-456');

      expect(config).toBeDefined();
      expect(config?.strategy).toBe('additive_only');
      expect(config?.categoryName).toBe('Custom Category');
    });

    it('should merge with defaults', async () => {
      await manager.updateConfig('community-456', {
        strategy: 'parallel_mirror',
      });

      const config = await manager.getConfig('community-456');

      expect(config?.strategy).toBe('parallel_mirror');
      expect(config?.channelPrefix).toBe('arrakis-'); // default
    });
  });

  describe('metrics', () => {
    it('should record channel creation metrics', async () => {
      vi.mocked(discord.getGuildChannels).mockResolvedValue([]);
      vi.mocked(discord.createChannel).mockResolvedValue(
        createMockChannel('cat-123', 'Arrakis', 4)
      );

      const config: ChannelStrategyConfig = {
        ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
        strategy: 'additive_only',
      };

      await manager.createChannels('guild-123', 'community-456', config);

      expect(metrics.channelCreations.inc).toHaveBeenCalledWith({
        community_id: 'community-456',
        strategy: 'additive_only',
      });
    });
  });
});
