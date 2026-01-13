/**
 * ParallelChannelManager Tests
 *
 * Sprint 59: Parallel Mode - Channels & Conviction Gates
 *
 * Tests for:
 * - Channel setup with different strategies
 * - Conviction-gated access sync
 * - Default channel templates
 * - Channel cleanup
 * - Admin configuration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ParallelChannelManager,
  createParallelChannelManager,
  DEFAULT_CATEGORY_NAME,
  DEFAULT_CHANNEL_TEMPLATES,
  type ChannelSetupOptions,
  type GetMemberConvictionsBatch,
} from '../../../../../src/packages/adapters/coexistence/ParallelChannelManager.js';
import type { ICoexistenceStorage, StoredParallelChannelConfig, StoredParallelChannel } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';

// =============================================================================
// Mocks
// =============================================================================

// Mock Discord.js Client
function createMockClient() {
  const mockGuilds = new Map<string, ReturnType<typeof createMockGuild>>();

  return {
    guilds: {
      fetch: vi.fn(async (guildId: string) => mockGuilds.get(guildId)),
      cache: mockGuilds,
    },
    _setGuild: (guild: ReturnType<typeof createMockGuild>) => {
      mockGuilds.set(guild.id, guild);
    },
  };
}

// Mock Discord Guild
function createMockGuild(id: string) {
  const channelsCache = new Collection<string, any>();
  const rolesCache = new Collection<string, any>();
  const membersCache = new Collection<string, any>();

  let channelIdCounter = 1;
  let categoryIdCounter = 1;

  const mockGuild = {
    id,
    channels: {
      cache: channelsCache,
      create: vi.fn(async (options: any) => {
        const channelId = options.type === ChannelType.GuildCategory
          ? `category-${categoryIdCounter++}`
          : `channel-${channelIdCounter++}`;

        const mockChannel = createMockChannel(channelId, options.name, options.type, options.parent);
        channelsCache.set(channelId, mockChannel);

        // If it's a category, add children collection
        if (options.type === ChannelType.GuildCategory) {
          mockChannel.children = {
            cache: new Collection(),
          };
        }

        // If it has a parent, add to parent's children
        if (options.parent) {
          const parent = channelsCache.get(options.parent);
          if (parent?.children) {
            parent.children.cache.set(channelId, mockChannel);
          }
        }

        return mockChannel;
      }),
    },
    roles: {
      cache: rolesCache,
    },
    members: {
      cache: membersCache,
      fetch: vi.fn(async () => membersCache),
    },
    _addChannel: (channel: any) => {
      channelsCache.set(channel.id, channel);
    },
    _addMember: (member: any) => {
      membersCache.set(member.id, member);
    },
  };

  return mockGuild;
}

// Mock Discord Channel
function createMockChannel(id: string, name: string, type: ChannelType, parentId?: string) {
  const permissionOverwrites = new Collection<string, any>();

  return {
    id,
    name,
    type,
    parent: parentId ? { id: parentId } : null,
    topic: 'Test topic',
    children: type === ChannelType.GuildCategory ? { cache: new Collection() } : undefined,
    permissionOverwrites: {
      cache: permissionOverwrites,
      create: vi.fn(async (target: any, permissions: any) => {
        const id = typeof target === 'string' ? target : target.id;
        permissionOverwrites.set(id, { id, permissions });
      }),
    },
    delete: vi.fn(async () => {}),
  };
}

// Mock Discord Member
function createMockMember(id: string, isBot = false) {
  return {
    id,
    user: { bot: isBot },
  };
}

// Mock Storage
function createMockStorage(): ICoexistenceStorage {
  const channelConfigs = new Map<string, StoredParallelChannelConfig>();
  const channels = new Map<string, StoredParallelChannel>();
  const channelAccess = new Map<string, any>();
  const migrationStates = new Map<string, any>();

  return {
    // Migration state methods
    getMigrationState: vi.fn(async (communityId: string) => migrationStates.get(communityId)),
    saveMigrationState: vi.fn(async (input: any) => {
      migrationStates.set(input.communityId, input);
      return input;
    }),

    // Parallel channel config methods
    getParallelChannelConfig: vi.fn(async (communityId: string) => channelConfigs.get(communityId) ?? null),
    saveParallelChannelConfig: vi.fn(async (input: any) => {
      const existing = channelConfigs.get(input.communityId);
      const config = {
        id: existing?.id ?? 'config-id',
        communityId: input.communityId,
        strategy: input.strategy ?? existing?.strategy ?? 'additive_only',
        enabled: input.enabled ?? existing?.enabled ?? false,
        categoryName: input.categoryName ?? existing?.categoryName ?? DEFAULT_CATEGORY_NAME,
        categoryId: input.categoryId ?? existing?.categoryId ?? null,
        channelTemplates: input.channelTemplates ?? existing?.channelTemplates ?? [],
        customChannels: input.customChannels ?? existing?.customChannels ?? [],
        mirrorSourceChannels: input.mirrorSourceChannels ?? existing?.mirrorSourceChannels ?? [],
        setupCompletedAt: input.setupCompletedAt ?? existing?.setupCompletedAt ?? null,
        lastSyncAt: input.lastSyncAt ?? existing?.lastSyncAt ?? null,
        totalChannelsCreated: input.totalChannelsCreated ?? existing?.totalChannelsCreated ?? 0,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      channelConfigs.set(input.communityId, config as StoredParallelChannelConfig);
      return config;
    }),
    deleteParallelChannelConfig: vi.fn(async (communityId: string) => {
      channelConfigs.delete(communityId);
    }),
    isChannelsEnabled: vi.fn(async (communityId: string) => {
      const config = channelConfigs.get(communityId);
      return config?.enabled ?? false;
    }),

    // Parallel channel methods
    getParallelChannel: vi.fn(async (communityId: string, discordChannelId: string) => {
      const key = `${communityId}:${discordChannelId}`;
      return channels.get(key) ?? null;
    }),
    getParallelChannels: vi.fn(async (communityId: string) => {
      return Array.from(channels.values()).filter(c => c.communityId === communityId);
    }),
    getParallelChannelsByConviction: vi.fn(async (communityId: string, minConviction: number) => {
      return Array.from(channels.values())
        .filter(c => c.communityId === communityId && c.minConviction <= minConviction);
    }),
    saveParallelChannel: vi.fn(async (input: any) => {
      const key = `${input.communityId}:${input.discordChannelId}`;
      const channel = {
        id: 'channel-record-id',
        communityId: input.communityId,
        discordChannelId: input.discordChannelId,
        channelName: input.channelName,
        channelType: input.channelType,
        minConviction: input.minConviction,
        categoryId: input.categoryId ?? null,
        topic: null,
        templateId: input.templateId ?? null,
        isDefault: !!input.templateId,
        mirrorSourceId: input.mirrorSourceId ?? null,
        isPublicView: input.minConviction === 0,
        memberAccessCount: 0,
        lastAccessUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      channels.set(key, channel as StoredParallelChannel);
      return channel;
    }),
    updateParallelChannelAccessCount: vi.fn(async () => {}),
    deleteParallelChannel: vi.fn(async (communityId: string, discordChannelId: string) => {
      const key = `${communityId}:${discordChannelId}`;
      channels.delete(key);
    }),
    deleteAllParallelChannels: vi.fn(async (communityId: string) => {
      for (const [key, channel] of channels.entries()) {
        if (channel.communityId === communityId) {
          channels.delete(key);
        }
      }
    }),

    // Parallel channel access methods
    getParallelChannelAccess: vi.fn(async (communityId: string, memberId: string, channelId: string) => {
      const key = `${communityId}:${memberId}:${channelId}`;
      return channelAccess.get(key) ?? null;
    }),
    getMemberChannelAccess: vi.fn(async () => []),
    getChannelAccessMembers: vi.fn(async () => []),
    saveParallelChannelAccess: vi.fn(async (input: any) => {
      const key = `${input.communityId}:${input.memberId}:${input.channelId}`;
      channelAccess.set(key, input);
      return input;
    }),
    batchSaveParallelChannelAccess: vi.fn(async () => {}),
    deleteParallelChannelAccess: vi.fn(async () => {}),
    getMembersNeedingAccess: vi.fn(async () => []),
    getMembersNeedingRevocation: vi.fn(async () => []),

    // Helper to set up migration state
    _setMigrationState: (communityId: string, state: any) => {
      migrationStates.set(communityId, state);
    },
  } as unknown as ICoexistenceStorage & { _setMigrationState: (communityId: string, state: any) => void };
}

// =============================================================================
// Tests
// =============================================================================

describe('ParallelChannelManager', () => {
  let manager: ParallelChannelManager;
  let mockClient: ReturnType<typeof createMockClient>;
  let mockStorage: ReturnType<typeof createMockStorage>;
  let mockGuild: ReturnType<typeof createMockGuild>;

  const communityId = 'community-123';
  const guildId = 'guild-456';

  beforeEach(() => {
    mockClient = createMockClient();
    mockStorage = createMockStorage();
    mockGuild = createMockGuild(guildId);
    mockClient._setGuild(mockGuild);

    // Set up shadow mode by default
    mockStorage._setMigrationState(communityId, {
      communityId,
      currentMode: 'shadow',
    });

    manager = createParallelChannelManager(
      mockClient as any,
      mockStorage as ICoexistenceStorage
    );
  });

  describe('setupChannels', () => {
    it('should create channels with additive_only strategy', async () => {
      const result = await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBe(2); // conviction-lounge and diamond-hands
      expect(result.channelIds.length).toBe(2);
      expect(result.categoryId).toBeTruthy();
      expect(mockGuild.channels.create).toHaveBeenCalled();
    });

    it('should create category with correct name', async () => {
      const categoryName = 'Custom Arrakis Category';
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
        categoryName,
      });

      // Verify category was created with custom name
      const categoryCall = (mockGuild.channels.create as any).mock.calls.find(
        (call: any[]) => call[0].type === ChannelType.GuildCategory
      );
      expect(categoryCall[0].name).toBe(categoryName);
    });

    it('should fail when not in shadow or parallel mode', async () => {
      mockStorage._setMigrationState(communityId, {
        communityId,
        currentMode: 'inactive',
      });

      const result = await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('should skip channel creation with none strategy', async () => {
      const result = await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'none',
      });

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBe(0);
      expect(result.categoryId).toBeNull();
    });

    it('should use custom channel templates', async () => {
      const customTemplates = [
        {
          templateId: 'custom-1',
          name: 'vip-lounge',
          topic: 'VIP only',
          minConviction: 90,
          isDefault: false,
          type: 'text' as const,
        },
      ];

      const result = await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
        channelTemplates: customTemplates,
      });

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBe(1);
    });

    it('should save configuration to storage', async () => {
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      expect(mockStorage.saveParallelChannelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId,
          strategy: 'additive_only',
          enabled: true,
        })
      );
    });

    it('should handle guild not found', async () => {
      const result = await manager.setupChannels({
        communityId,
        guildId: 'non-existent-guild',
        strategy: 'additive_only',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Guild not found');
    });
  });

  describe('syncChannelAccess', () => {
    beforeEach(async () => {
      // Set up channels first
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      // Add some members
      mockGuild._addMember(createMockMember('member-1'));
      mockGuild._addMember(createMockMember('member-2'));
      mockGuild._addMember(createMockMember('member-3'));
      mockGuild._addMember(createMockMember('bot-1', true)); // Bot should be skipped
    });

    it('should grant access based on conviction scores', async () => {
      const getMemberConvictions: GetMemberConvictionsBatch = async (memberIds) => {
        const map = new Map<string, number>();
        for (const id of memberIds) {
          if (id === 'member-1') map.set(id, 85); // Above 80, below 95
          if (id === 'member-2') map.set(id, 96); // Above 95
          if (id === 'member-3') map.set(id, 50); // Below 80
        }
        return map;
      };

      const result = await manager.syncChannelAccess(
        { communityId, guildId },
        getMemberConvictions
      );

      expect(result.success).toBe(true);
      expect(result.accessGrants).toBeGreaterThan(0);
    });

    it('should fail when channels not enabled', async () => {
      await mockStorage.saveParallelChannelConfig({
        communityId,
        enabled: false,
      });

      const result = await manager.syncChannelAccess(
        { communityId, guildId },
        async () => new Map()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should handle guild not found', async () => {
      const result = await manager.syncChannelAccess(
        { communityId, guildId: 'non-existent' },
        async () => new Map()
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Guild not found');
    });

    it('should update last sync timestamp', async () => {
      await manager.syncChannelAccess(
        { communityId, guildId },
        async () => new Map()
      );

      expect(mockStorage.saveParallelChannelConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId,
          lastSyncAt: expect.any(Date),
        })
      );
    });
  });

  describe('getChannelConfig', () => {
    it('should return configuration', async () => {
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      const config = await manager.getChannelConfig(communityId);

      expect(config).not.toBeNull();
      expect(config?.strategy).toBe('additive_only');
      expect(config?.enabled).toBe(true);
    });

    it('should return null when no config exists', async () => {
      const config = await manager.getChannelConfig('non-existent');
      expect(config).toBeNull();
    });
  });

  describe('updateStrategy', () => {
    it('should update strategy and recreate channels', async () => {
      // First setup with additive_only
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      // Update to none
      const result = await manager.updateStrategy(communityId, 'none', guildId);

      expect(result.success).toBe(true);
      expect(mockStorage.deleteAllParallelChannels).toHaveBeenCalled();
    });

    it('should skip if strategy unchanged', async () => {
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      const result = await manager.updateStrategy(communityId, 'additive_only', guildId);

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBe(0);
    });
  });

  describe('cleanupChannels', () => {
    it('should delete all channels and config', async () => {
      await manager.setupChannels({
        communityId,
        guildId,
        strategy: 'additive_only',
      });

      await manager.cleanupChannels(communityId, guildId);

      expect(mockStorage.deleteAllParallelChannels).toHaveBeenCalledWith(communityId);
      expect(mockStorage.deleteParallelChannelConfig).toHaveBeenCalledWith(communityId);
    });

    it('should handle guild not found', async () => {
      await expect(
        manager.cleanupChannels(communityId, 'non-existent')
      ).rejects.toThrow('Guild not found');
    });
  });

  describe('enableChannels', () => {
    it('should enable channels from shadow mode', async () => {
      const result = await manager.enableChannels(communityId, guildId);

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBeGreaterThan(0);
    });

    it('should fail when not in shadow mode', async () => {
      mockStorage._setMigrationState(communityId, {
        communityId,
        currentMode: 'parallel',
      });

      const result = await manager.enableChannels(communityId, guildId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Can only enable channels from shadow mode');
    });

    it('should use custom templates when provided', async () => {
      const customTemplates = [
        {
          templateId: 'elite',
          name: 'elite-chat',
          topic: 'Elite members only',
          minConviction: 99,
          isDefault: false,
          type: 'text' as const,
        },
      ];

      const result = await manager.enableChannels(
        communityId,
        guildId,
        'additive_only',
        customTemplates
      );

      expect(result.success).toBe(true);
      expect(result.channelsCreated).toBe(1);
    });
  });

  describe('Factory and Constants', () => {
    it('createParallelChannelManager creates instance', () => {
      const instance = createParallelChannelManager(
        mockClient as any,
        mockStorage as ICoexistenceStorage
      );
      expect(instance).toBeInstanceOf(ParallelChannelManager);
    });

    it('DEFAULT_CATEGORY_NAME has correct value', () => {
      expect(DEFAULT_CATEGORY_NAME).toBe('Arrakis Channels');
    });

    it('DEFAULT_CHANNEL_TEMPLATES has conviction-lounge and diamond-hands', () => {
      expect(DEFAULT_CHANNEL_TEMPLATES.length).toBe(2);

      const loungeTemplate = DEFAULT_CHANNEL_TEMPLATES.find(
        t => t.templateId === 'conviction-lounge'
      );
      expect(loungeTemplate).toBeDefined();
      expect(loungeTemplate?.minConviction).toBe(80);

      const diamondTemplate = DEFAULT_CHANNEL_TEMPLATES.find(
        t => t.templateId === 'diamond-hands'
      );
      expect(diamondTemplate).toBeDefined();
      expect(diamondTemplate?.minConviction).toBe(95);
    });
  });
});
