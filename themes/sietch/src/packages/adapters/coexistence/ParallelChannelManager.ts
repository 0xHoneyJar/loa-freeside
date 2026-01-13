/**
 * ParallelChannelManager - Conviction-Gated Channel Management for Parallel Mode
 *
 * Sprint 59: Parallel Mode - Channels & Conviction Gates
 *
 * Creates and manages conviction-gated channels that provide differentiated
 * value that incumbents cannot offer. Channels are organized under a dedicated
 * category and access is granted/revoked based on conviction scores.
 *
 * Key Features:
 * - Conviction-gated access (channels unlock at specific conviction thresholds)
 * - Four channel strategies: none, additive_only, parallel_mirror, custom
 * - Default channels: #conviction-lounge (80+), #diamond-hands (95+)
 * - Permission overwrites for access control
 *
 * @module packages/adapters/coexistence/ParallelChannelManager
 */

import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildChannel,
  type TextChannel,
  type CategoryChannel,
  type GuildMember,
} from 'discord.js';
import type {
  ICoexistenceStorage,
  StoredParallelChannelConfig,
  SaveParallelChannelInput,
  StoredParallelChannel,
  ChannelStrategy,
  ParallelChannelTemplate,
  CustomChannelDefinition,
} from '../../core/ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default category name for Arrakis channels
 */
export const DEFAULT_CATEGORY_NAME = 'Arrakis Channels';

/**
 * Default channel templates for additive_only strategy
 */
export const DEFAULT_CHANNEL_TEMPLATES: ParallelChannelTemplate[] = [
  {
    templateId: 'conviction-lounge',
    name: 'conviction-lounge',
    topic: '💎 Exclusive space for high-conviction holders (80+ conviction)',
    minConviction: 80,
    isDefault: true,
    type: 'text',
    emoji: '💎',
  },
  {
    templateId: 'diamond-hands',
    name: 'diamond-hands',
    topic: '🏆 Ultimate diamond hands club (95+ conviction) - Only the most dedicated',
    minConviction: 95,
    isDefault: true,
    type: 'text',
    emoji: '🏆',
  },
];

// =============================================================================
// Types
// =============================================================================

/**
 * Options for setting up parallel channels
 */
export interface ChannelSetupOptions {
  /** Community UUID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Channel strategy */
  strategy: ChannelStrategy;
  /** Category name (default: "Arrakis Channels") */
  categoryName?: string;
  /** Custom channel templates (overrides defaults for additive_only) */
  channelTemplates?: ParallelChannelTemplate[];
  /** Custom channel definitions (for custom strategy) */
  customChannels?: CustomChannelDefinition[];
  /** Source channel IDs to mirror (for parallel_mirror strategy) */
  mirrorSourceChannels?: string[];
}

/**
 * Result of channel setup
 */
export interface ChannelSetupResult {
  /** Whether setup completed successfully */
  success: boolean;
  /** Category ID created/found */
  categoryId: string | null;
  /** Number of channels created */
  channelsCreated: number;
  /** Number of channels that already existed */
  channelsExisted: number;
  /** Number of channels that failed to create */
  channelsFailed: number;
  /** Created channel IDs */
  channelIds: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Options for syncing channel access
 */
export interface ChannelAccessSyncOptions {
  /** Community UUID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Specific channel ID to sync (or all if not provided) */
  channelId?: string;
  /** Process members in batches of this size */
  batchSize?: number;
}

/**
 * Result of channel access sync
 */
export interface ChannelAccessSyncResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of channels synced */
  channelsSynced: number;
  /** Number of access grants */
  accessGrants: number;
  /** Number of access revocations */
  accessRevocations: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Callback to get member conviction score
 */
export type GetMemberConviction = (memberId: string) => Promise<number | null>;

/**
 * Callback to get conviction for multiple members
 */
export type GetMemberConvictionsBatch = (
  memberIds: string[]
) => Promise<Map<string, number>>;

// =============================================================================
// ParallelChannelManager
// =============================================================================

/**
 * Manages conviction-gated channels for parallel mode
 */
export class ParallelChannelManager {
  private readonly client: Client;
  private readonly storage: ICoexistenceStorage;
  private readonly logger: ILogger;

  constructor(
    client: Client,
    storage: ICoexistenceStorage,
    logger?: ILogger
  ) {
    this.client = client;
    this.storage = storage;
    this.logger = logger ?? createLogger({ service: 'ParallelChannelManager' });
  }

  // ===========================================================================
  // Channel Setup
  // ===========================================================================

  /**
   * Set up parallel channels for a community
   *
   * Creates the category and channels based on the strategy:
   * - none: No channels created
   * - additive_only: Default conviction-gated channels
   * - parallel_mirror: Clones existing channels with conviction gates
   * - custom: Creates admin-defined channels
   */
  async setupChannels(options: ChannelSetupOptions): Promise<ChannelSetupResult> {
    const startTime = Date.now();
    const { communityId, guildId, strategy, categoryName } = options;

    this.logger.info('Setting up parallel channels', { communityId, guildId, strategy });

    // Validate mode
    const migrationState = await this.storage.getMigrationState(communityId);
    if (!migrationState || !['shadow', 'parallel'].includes(migrationState.currentMode)) {
      return {
        success: false,
        categoryId: null,
        channelsCreated: 0,
        channelsExisted: 0,
        channelsFailed: 0,
        channelIds: [],
        error: `Invalid mode for channel setup: ${migrationState?.currentMode ?? 'none'}`,
      };
    }

    // Strategy: none - skip setup
    if (strategy === 'none') {
      await this.storage.saveParallelChannelConfig({
        communityId,
        strategy: 'none',
        enabled: false,
      });
      return {
        success: true,
        categoryId: null,
        channelsCreated: 0,
        channelsExisted: 0,
        channelsFailed: 0,
        channelIds: [],
      };
    }

    // Get Discord guild
    const guild = await this.client.guilds.fetch(guildId);
    if (!guild) {
      return {
        success: false,
        categoryId: null,
        channelsCreated: 0,
        channelsExisted: 0,
        channelsFailed: 0,
        channelIds: [],
        error: `Guild not found: ${guildId}`,
      };
    }

    try {
      // Create or find category
      const category = await this.ensureCategory(guild, categoryName ?? DEFAULT_CATEGORY_NAME);

      // Determine channels to create based on strategy
      let channelsToCreate: Array<{
        name: string;
        topic: string;
        minConviction: number;
        type: 'text' | 'voice';
        templateId?: string;
        mirrorSourceId?: string;
      }> = [];

      switch (strategy) {
        case 'additive_only':
          channelsToCreate = (options.channelTemplates ?? DEFAULT_CHANNEL_TEMPLATES).map(t => ({
            name: t.name,
            topic: t.topic,
            minConviction: t.minConviction,
            type: t.type,
            templateId: t.templateId,
          }));
          break;

        case 'parallel_mirror':
          if (options.mirrorSourceChannels && options.mirrorSourceChannels.length > 0) {
            channelsToCreate = await this.getMirrorChannelDefinitions(
              guild,
              options.mirrorSourceChannels
            );
          }
          break;

        case 'custom':
          if (options.customChannels) {
            channelsToCreate = options.customChannels.map(c => ({
              name: c.name,
              topic: c.topic,
              minConviction: c.minConviction,
              type: c.type,
            }));
          }
          break;
      }

      // Create channels
      let channelsCreated = 0;
      let channelsExisted = 0;
      let channelsFailed = 0;
      const channelIds: string[] = [];

      for (const channelDef of channelsToCreate) {
        try {
          const result = await this.createConvictionGatedChannel(
            guild,
            category,
            channelDef.name,
            channelDef.topic,
            channelDef.minConviction,
            channelDef.type,
            channelDef.templateId,
            channelDef.mirrorSourceId
          );

          if (result.created) {
            channelsCreated++;
            channelIds.push(result.channelId);

            // Save to storage
            await this.storage.saveParallelChannel({
              communityId,
              discordChannelId: result.channelId,
              channelName: channelDef.name,
              channelType: channelDef.type,
              minConviction: channelDef.minConviction,
              categoryId: category.id,
              templateId: channelDef.templateId,
              mirrorSourceId: channelDef.mirrorSourceId,
            });
          } else if (result.existed) {
            channelsExisted++;
            channelIds.push(result.channelId);
          }
        } catch (err) {
          channelsFailed++;
          this.logger.error('Failed to create channel', {
            channelName: channelDef.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Save configuration
      await this.storage.saveParallelChannelConfig({
        communityId,
        strategy,
        enabled: true,
        categoryName: categoryName ?? DEFAULT_CATEGORY_NAME,
        categoryId: category.id,
        channelTemplates: strategy === 'additive_only'
          ? (options.channelTemplates ?? DEFAULT_CHANNEL_TEMPLATES)
          : [],
        customChannels: strategy === 'custom' ? options.customChannels : [],
        mirrorSourceChannels: strategy === 'parallel_mirror'
          ? options.mirrorSourceChannels
          : [],
        setupCompletedAt: new Date(),
        totalChannelsCreated: channelsCreated,
      });

      const durationMs = Date.now() - startTime;
      this.logger.info('Parallel channels setup complete', {
        communityId,
        strategy,
        channelsCreated,
        channelsExisted,
        channelsFailed,
        durationMs,
      });

      return {
        success: true,
        categoryId: category.id,
        channelsCreated,
        channelsExisted,
        channelsFailed,
        channelIds,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to setup parallel channels', { communityId, error });
      return {
        success: false,
        categoryId: null,
        channelsCreated: 0,
        channelsExisted: 0,
        channelsFailed: 0,
        channelIds: [],
        error,
      };
    }
  }

  /**
   * Ensure category exists, create if not
   */
  private async ensureCategory(
    guild: Guild,
    categoryName: string
  ): Promise<CategoryChannel> {
    // Check if category already exists
    const existing = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === categoryName
    ) as CategoryChannel | undefined;

    if (existing) {
      this.logger.debug('Category already exists', { categoryId: existing.id, categoryName });
      return existing;
    }

    // Create new category with restricted permissions
    const category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel], // Hidden by default
        },
      ],
    });

    this.logger.info('Created category', { categoryId: category.id, categoryName });
    return category;
  }

  /**
   * Create a conviction-gated channel
   */
  private async createConvictionGatedChannel(
    guild: Guild,
    category: CategoryChannel,
    name: string,
    topic: string,
    minConviction: number,
    type: 'text' | 'voice',
    templateId?: string,
    mirrorSourceId?: string
  ): Promise<{ channelId: string; created: boolean; existed: boolean }> {
    // Check if channel already exists in category
    const existingChannel = category.children.cache.find(
      c => c.name === name
    );

    if (existingChannel) {
      return { channelId: existingChannel.id, created: false, existed: true };
    }

    // Create channel with hidden-by-default permissions
    const channelType = type === 'voice'
      ? ChannelType.GuildVoice
      : ChannelType.GuildText;

    const channel = await guild.channels.create({
      name,
      type: channelType,
      parent: category.id,
      topic: type === 'text' ? topic : undefined,
      permissionOverwrites: [
        {
          id: guild.id, // @everyone
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel], // Hidden by default
        },
      ],
    });

    this.logger.info('Created conviction-gated channel', {
      channelId: channel.id,
      channelName: name,
      minConviction,
      templateId,
      mirrorSourceId,
    });

    return { channelId: channel.id, created: true, existed: false };
  }

  /**
   * Get channel definitions from source channels for mirroring
   */
  private async getMirrorChannelDefinitions(
    guild: Guild,
    sourceChannelIds: string[]
  ): Promise<Array<{
    name: string;
    topic: string;
    minConviction: number;
    type: 'text' | 'voice';
    mirrorSourceId: string;
  }>> {
    const definitions: Array<{
      name: string;
      topic: string;
      minConviction: number;
      type: 'text' | 'voice';
      mirrorSourceId: string;
    }> = [];

    for (const sourceId of sourceChannelIds) {
      const sourceChannel = guild.channels.cache.get(sourceId);
      if (!sourceChannel) continue;

      const type = sourceChannel.type === ChannelType.GuildVoice ? 'voice' : 'text';
      const topic = sourceChannel.type === ChannelType.GuildText
        ? (sourceChannel as TextChannel).topic ?? ''
        : '';

      definitions.push({
        name: `arrakis-${sourceChannel.name}`,
        topic: `[Arrakis Mirror] ${topic}`,
        minConviction: 50, // Default conviction threshold for mirrored channels
        type,
        mirrorSourceId: sourceId,
      });
    }

    return definitions;
  }

  // ===========================================================================
  // Channel Access Sync
  // ===========================================================================

  /**
   * Sync channel access for all conviction-gated channels
   *
   * Grants/revokes access based on member conviction scores.
   */
  async syncChannelAccess(
    options: ChannelAccessSyncOptions,
    getMemberConviction: GetMemberConvictionsBatch
  ): Promise<ChannelAccessSyncResult> {
    const startTime = Date.now();
    const { communityId, guildId, channelId, batchSize = 100 } = options;

    this.logger.info('Syncing channel access', { communityId, guildId, channelId });

    // Check if channels are enabled
    const config = await this.storage.getParallelChannelConfig(communityId);
    if (!config?.enabled) {
      return {
        success: false,
        channelsSynced: 0,
        accessGrants: 0,
        accessRevocations: 0,
        durationMs: 0,
        error: 'Parallel channels not enabled for this community',
      };
    }

    // Get Discord guild
    const guild = await this.client.guilds.fetch(guildId);
    if (!guild) {
      return {
        success: false,
        channelsSynced: 0,
        accessGrants: 0,
        accessRevocations: 0,
        durationMs: 0,
        error: `Guild not found: ${guildId}`,
      };
    }

    try {
      // Get channels to sync
      let channels: StoredParallelChannel[];
      if (channelId) {
        const channel = await this.storage.getParallelChannel(communityId, channelId);
        channels = channel ? [channel] : [];
      } else {
        channels = await this.storage.getParallelChannels(communityId);
      }

      if (channels.length === 0) {
        return {
          success: true,
          channelsSynced: 0,
          accessGrants: 0,
          accessRevocations: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // Get all guild members (excluding bots)
      await guild.members.fetch();
      const members = Array.from(guild.members.cache.values())
        .filter(m => !m.user.bot);

      let totalGrants = 0;
      let totalRevocations = 0;
      let channelsSynced = 0;

      // Process each channel
      for (const channel of channels) {
        const discordChannel = guild.channels.cache.get(channel.discordChannelId);
        if (!discordChannel) {
          this.logger.warn('Channel not found in Discord', {
            channelId: channel.discordChannelId,
          });
          continue;
        }

        // Process members in batches
        for (let i = 0; i < members.length; i += batchSize) {
          const batch = members.slice(i, i + batchSize);
          const memberIds = batch.map(m => m.id);

          // Get conviction scores for batch
          const convictions = await getMemberConviction(memberIds);

          // Update access for each member
          for (const member of batch) {
            const conviction = convictions.get(member.id) ?? 0;
            const shouldHaveAccess = conviction >= channel.minConviction;

            const result = await this.updateMemberChannelAccess(
              communityId,
              discordChannel as GuildChannel,
              member,
              shouldHaveAccess,
              conviction
            );

            if (result.granted) totalGrants++;
            if (result.revoked) totalRevocations++;
          }
        }

        // Update channel access count
        const accessCount = await this.storage.getChannelAccessMembers(
          communityId,
          channel.discordChannelId
        );
        await this.storage.updateParallelChannelAccessCount(
          communityId,
          channel.discordChannelId,
          accessCount.length
        );

        channelsSynced++;
      }

      // Update last sync timestamp
      await this.storage.saveParallelChannelConfig({
        communityId,
        lastSyncAt: new Date(),
      });

      const durationMs = Date.now() - startTime;
      this.logger.info('Channel access sync complete', {
        communityId,
        channelsSynced,
        totalGrants,
        totalRevocations,
        durationMs,
      });

      return {
        success: true,
        channelsSynced,
        accessGrants: totalGrants,
        accessRevocations: totalRevocations,
        durationMs,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to sync channel access', { communityId, error });
      return {
        success: false,
        channelsSynced: 0,
        accessGrants: 0,
        accessRevocations: 0,
        durationMs: Date.now() - startTime,
        error,
      };
    }
  }

  /**
   * Update a member's access to a channel
   */
  private async updateMemberChannelAccess(
    communityId: string,
    channel: GuildChannel,
    member: GuildMember,
    shouldHaveAccess: boolean,
    conviction: number
  ): Promise<{ granted: boolean; revoked: boolean }> {
    const memberId = member.id;
    const channelId = channel.id;

    // Check current access
    const existingAccess = await this.storage.getParallelChannelAccess(
      communityId,
      memberId,
      channelId
    );
    const currentlyHasAccess = existingAccess?.hasAccess ?? false;

    // No change needed
    if (currentlyHasAccess === shouldHaveAccess) {
      // Update conviction tracking even if access unchanged
      await this.storage.saveParallelChannelAccess({
        communityId,
        memberId,
        channelId,
        hasAccess: shouldHaveAccess,
        currentConviction: conviction,
        lastAccessCheckAt: new Date(),
      });
      return { granted: false, revoked: false };
    }

    try {
      if (shouldHaveAccess && !currentlyHasAccess) {
        // Grant access
        await channel.permissionOverwrites.create(member, {
          ViewChannel: true,
          SendMessages: channel.type === ChannelType.GuildText,
          Connect: channel.type === ChannelType.GuildVoice,
        });

        await this.storage.saveParallelChannelAccess({
          communityId,
          memberId,
          channelId,
          hasAccess: true,
          currentConviction: conviction,
          accessGrantedAt: new Date(),
          lastAccessCheckAt: new Date(),
        });

        this.logger.debug('Granted channel access', {
          memberId,
          channelId,
          conviction,
        });

        return { granted: true, revoked: false };
      } else if (!shouldHaveAccess && currentlyHasAccess) {
        // Revoke access
        const existingOverwrite = channel.permissionOverwrites.cache.get(memberId);
        if (existingOverwrite) {
          await existingOverwrite.delete('Conviction fell below threshold');
        }

        await this.storage.saveParallelChannelAccess({
          communityId,
          memberId,
          channelId,
          hasAccess: false,
          currentConviction: conviction,
          lastAccessCheckAt: new Date(),
        });

        this.logger.debug('Revoked channel access', {
          memberId,
          channelId,
          conviction,
        });

        return { granted: false, revoked: true };
      }
    } catch (err) {
      this.logger.error('Failed to update channel access', {
        memberId,
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { granted: false, revoked: false };
  }

  // ===========================================================================
  // Configuration Methods
  // ===========================================================================

  /**
   * Get current channel configuration for a community
   */
  async getChannelConfig(communityId: string): Promise<StoredParallelChannelConfig | null> {
    return this.storage.getParallelChannelConfig(communityId);
  }

  /**
   * Update channel strategy
   */
  async updateStrategy(
    communityId: string,
    strategy: ChannelStrategy,
    guildId: string
  ): Promise<ChannelSetupResult> {
    const config = await this.storage.getParallelChannelConfig(communityId);

    if (config?.strategy === strategy) {
      return {
        success: true,
        categoryId: config.categoryId,
        channelsCreated: 0,
        channelsExisted: config.totalChannelsCreated,
        channelsFailed: 0,
        channelIds: [],
      };
    }

    // If changing strategy, clean up existing channels first
    if (config?.enabled) {
      await this.cleanupChannels(communityId, guildId);
    }

    // Set up with new strategy
    return this.setupChannels({
      communityId,
      guildId,
      strategy,
      categoryName: config?.categoryName,
    });
  }

  /**
   * Clean up all parallel channels for a community
   */
  async cleanupChannels(communityId: string, guildId: string): Promise<void> {
    this.logger.info('Cleaning up parallel channels', { communityId, guildId });

    const guild = await this.client.guilds.fetch(guildId);
    if (!guild) {
      throw new Error(`Guild not found: ${guildId}`);
    }

    const config = await this.storage.getParallelChannelConfig(communityId);
    if (!config) {
      return;
    }

    // Get all channels
    const channels = await this.storage.getParallelChannels(communityId);

    // Delete channels from Discord
    for (const channel of channels) {
      try {
        const discordChannel = guild.channels.cache.get(channel.discordChannelId);
        if (discordChannel) {
          await discordChannel.delete('Parallel mode cleanup');
        }
      } catch (err) {
        this.logger.error('Failed to delete channel', {
          channelId: channel.discordChannelId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Delete category if empty
    if (config.categoryId) {
      try {
        const category = guild.channels.cache.get(config.categoryId) as CategoryChannel;
        if (category && category.children.cache.size === 0) {
          await category.delete('Parallel mode cleanup');
        }
      } catch (err) {
        this.logger.error('Failed to delete category', {
          categoryId: config.categoryId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Clean up storage
    await this.storage.deleteAllParallelChannels(communityId);
    await this.storage.deleteParallelChannelConfig(communityId);

    this.logger.info('Parallel channels cleaned up', { communityId });
  }

  /**
   * Enable channel setup for parallel mode transition
   */
  async enableChannels(
    communityId: string,
    guildId: string,
    strategy: ChannelStrategy = 'additive_only',
    customTemplates?: ParallelChannelTemplate[]
  ): Promise<ChannelSetupResult> {
    // Validate migration state
    const migrationState = await this.storage.getMigrationState(communityId);
    if (!migrationState || migrationState.currentMode !== 'shadow') {
      return {
        success: false,
        categoryId: null,
        channelsCreated: 0,
        channelsExisted: 0,
        channelsFailed: 0,
        channelIds: [],
        error: 'Can only enable channels from shadow mode',
      };
    }

    return this.setupChannels({
      communityId,
      guildId,
      strategy,
      channelTemplates: customTemplates,
    });
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a ParallelChannelManager instance
 */
export function createParallelChannelManager(
  client: Client,
  storage: ICoexistenceStorage,
  logger?: ILogger
): ParallelChannelManager {
  return new ParallelChannelManager(client, storage, logger);
}
