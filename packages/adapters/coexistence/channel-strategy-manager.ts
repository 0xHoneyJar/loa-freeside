/**
 * ChannelStrategyManager Implementation
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 *
 * Manages Arrakis channels based on configured strategy.
 * Supports none, additive_only, parallel_mirror, and custom strategies.
 *
 * @see SDD §7.2.1 Channel Strategy
 */

import type { Logger } from 'pino';
import type { IChannelStrategyManager } from '@arrakis/core/ports';
import type {
  ChannelStrategyConfig,
  ChannelStrategy,
  AdditiveChannelConfig,
  MirrorChannelConfig,
  CustomChannelConfig,
  MemberEligibility,
  DiscordChannel,
} from '@arrakis/core/domain';
import {
  DEFAULT_CHANNEL_STRATEGY_CONFIG,
  DEFAULT_ADDITIVE_CHANNELS,
} from '@arrakis/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Discord REST service interface for channel operations.
 */
export interface IDiscordChannelService {
  /**
   * Get all channels in a guild.
   */
  getGuildChannels(guildId: string): Promise<DiscordChannel[]>;

  /**
   * Create a channel.
   */
  createChannel(
    guildId: string,
    options: {
      name: string;
      type: number;
      topic?: string;
      parentId?: string;
      position?: number;
      permissionOverwrites?: PermissionOverwrite[];
    }
  ): Promise<DiscordChannel>;

  /**
   * Update channel permissions.
   */
  editChannelPermissions(
    channelId: string,
    overwriteId: string,
    options: {
      type: 0 | 1; // 0 = role, 1 = member
      allow: bigint;
      deny: bigint;
    }
  ): Promise<void>;

  /**
   * Delete channel permissions.
   */
  deleteChannelPermission(channelId: string, overwriteId: string): Promise<void>;
}

/**
 * Permission overwrite structure.
 */
export interface PermissionOverwrite {
  id: string;
  type: 0 | 1; // 0 = role, 1 = member
  allow: bigint;
  deny: bigint;
}

/**
 * Synthesis queue interface for rate-limited operations.
 */
export interface ISynthesisQueue {
  /**
   * Enqueue a synthesis job.
   */
  add(
    jobName: string,
    data: {
      type: string;
      guildId: string;
      communityId: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    }
  ): Promise<void>;
}

/**
 * Config store interface.
 */
export interface IChannelConfigStore {
  /**
   * Get channel configuration for a community.
   */
  getChannelConfig(communityId: string): Promise<ChannelStrategyConfig | null>;

  /**
   * Save channel configuration for a community.
   */
  saveChannelConfig(
    communityId: string,
    config: ChannelStrategyConfig
  ): Promise<void>;
}

/**
 * Metrics client interface.
 */
export interface IChannelMetrics {
  /** Channel creation counter */
  channelCreations: {
    inc(labels: { community_id: string; strategy: string }): void;
  };
  /** Permission sync counter */
  permissionSyncs: {
    inc(labels: { community_id: string }): void;
  };
}

// =============================================================================
// ChannelStrategyManager Implementation
// =============================================================================

/**
 * Options for ChannelStrategyManager.
 */
export interface ChannelStrategyManagerOptions {
  /** Default category name */
  defaultCategoryName?: string;
  /** Default channel prefix */
  defaultChannelPrefix?: string;
}

/**
 * ChannelStrategyManager implements channel management for parallel mode.
 */
export class ChannelStrategyManager implements IChannelStrategyManager {
  private readonly discord: IDiscordChannelService;
  private readonly synthesis: ISynthesisQueue;
  private readonly configStore: IChannelConfigStore;
  private readonly metrics: IChannelMetrics;
  private readonly log: Logger;
  private readonly options: Required<ChannelStrategyManagerOptions>;

  constructor(
    discord: IDiscordChannelService,
    synthesis: ISynthesisQueue,
    configStore: IChannelConfigStore,
    metrics: IChannelMetrics,
    logger: Logger,
    options?: ChannelStrategyManagerOptions
  ) {
    this.discord = discord;
    this.synthesis = synthesis;
    this.configStore = configStore;
    this.metrics = metrics;
    this.log = logger.child({ component: 'ChannelStrategyManager' });
    this.options = {
      defaultCategoryName: options?.defaultCategoryName ?? 'Arrakis',
      defaultChannelPrefix: options?.defaultChannelPrefix ?? 'arrakis-',
    };
  }

  // ===========================================================================
  // Channel Creation
  // ===========================================================================

  /**
   * Create Arrakis channels based on strategy.
   */
  async createChannels(
    guildId: string,
    communityId: string,
    config: ChannelStrategyConfig
  ): Promise<string[]> {
    this.log.info(
      { guildId, communityId, strategy: config.strategy },
      'Creating channels with strategy'
    );

    if (config.strategy === 'none') {
      this.log.info({ communityId }, 'Channel strategy is none, skipping');
      return [];
    }

    // Create category first
    const categoryId = await this.createCategory(
      guildId,
      config.categoryName ?? this.options.defaultCategoryName
    );

    const channelIds: string[] = [];

    switch (config.strategy) {
      case 'additive_only':
        channelIds.push(
          ...(await this.createAdditiveChannels(
            guildId,
            communityId,
            categoryId,
            config
          ))
        );
        break;

      case 'parallel_mirror':
        channelIds.push(
          ...(await this.createMirrorChannels(
            guildId,
            communityId,
            categoryId,
            config
          ))
        );
        break;

      case 'custom':
        channelIds.push(
          ...(await this.createCustomChannels(
            guildId,
            communityId,
            categoryId,
            config
          ))
        );
        break;
    }

    this.metrics.channelCreations.inc({
      community_id: communityId,
      strategy: config.strategy,
    });

    this.log.info(
      { guildId, communityId, channelCount: channelIds.length },
      'Channels created'
    );

    return channelIds;
  }

  /**
   * Create the Arrakis category for channels.
   */
  async createCategory(guildId: string, categoryName: string): Promise<string> {
    // Check if category already exists
    const channels = await this.discord.getGuildChannels(guildId);
    const existing = channels.find(
      (c) => c.type === 4 && c.name === categoryName
    );

    if (existing) {
      this.log.debug({ guildId, categoryName }, 'Category already exists');
      return existing.id;
    }

    // Use synthesis queue for rate-limited category creation
    // Generate a deterministic ID for the pending category
    const pendingCategoryId = `pending-category:${guildId}:${categoryName}`;

    await this.synthesis.add(`create-category:${guildId}:${categoryName}`, {
      type: 'create_channel',
      guildId,
      communityId: 'system', // Category is guild-level, not community-specific
      payload: {
        name: categoryName,
        type: 4, // GUILD_CATEGORY
      },
      idempotencyKey: `create-category:${guildId}:${categoryName}`,
    });

    this.log.info(
      { guildId, categoryName },
      'Queued Arrakis category creation via synthesis'
    );

    // Return pending ID - caller should poll for actual category
    // or use eventual consistency pattern
    return pendingCategoryId;
  }

  /**
   * Create additive conviction-gated channels.
   */
  async createAdditiveChannels(
    guildId: string,
    communityId: string,
    categoryId: string,
    config: ChannelStrategyConfig
  ): Promise<string[]> {
    const additiveConfigs = config.additiveChannels ?? DEFAULT_ADDITIVE_CHANNELS;
    const prefix = config.channelPrefix ?? this.options.defaultChannelPrefix;
    const channelIds: string[] = [];

    for (const channelConfig of additiveConfigs) {
      const channelName = `${prefix}${channelConfig.name}`;

      // Check if channel already exists
      const channels = await this.discord.getGuildChannels(guildId);
      const existing = channels.find(
        (c) => c.name === channelName && c.parentId === categoryId
      );

      if (existing) {
        channelIds.push(existing.id);
        continue;
      }

      // Enqueue channel creation via synthesis (rate-limited)
      await this.synthesis.add(`create-channel:${communityId}:${channelConfig.name}`, {
        type: 'create_channel',
        guildId,
        communityId,
        payload: {
          name: channelName,
          type: 0, // Text channel
          topic: channelConfig.topic,
          parentId: categoryId,
          minConvictionScore: channelConfig.minConvictionScore,
        },
        idempotencyKey: `create-channel:${communityId}:${channelName}`,
      });

      this.log.info(
        {
          guildId,
          communityId,
          channelName,
          minScore: channelConfig.minConvictionScore,
        },
        'Additive channel creation queued'
      );

      // Note: actual channel ID will be available after synthesis completes
      channelIds.push(`pending:${channelName}`);
    }

    return channelIds;
  }

  /**
   * Create mirror channels for incumbent channels.
   */
  async createMirrorChannels(
    guildId: string,
    communityId: string,
    categoryId: string,
    config: ChannelStrategyConfig
  ): Promise<string[]> {
    const mirrorConfigs = config.mirrorChannels ?? [];
    const channelIds: string[] = [];

    if (mirrorConfigs.length === 0) {
      this.log.warn(
        { communityId },
        'No mirror channels configured for parallel_mirror strategy'
      );
      return channelIds;
    }

    const existingChannels = await this.discord.getGuildChannels(guildId);

    for (const mirrorConfig of mirrorConfigs) {
      // Find source channel matching pattern
      const sourceChannelPattern = new RegExp(mirrorConfig.sourcePattern, 'i');
      const sourceChannel = existingChannels.find((c) =>
        sourceChannelPattern.test(c.name)
      );

      if (!sourceChannel) {
        this.log.warn(
          { communityId, pattern: mirrorConfig.sourcePattern },
          'Source channel not found for mirror'
        );
        continue;
      }

      // Check if mirror already exists
      const existing = existingChannels.find(
        (c) => c.name === mirrorConfig.arrakisName && c.parentId === categoryId
      );

      if (existing) {
        channelIds.push(existing.id);
        continue;
      }

      // Enqueue channel creation via synthesis
      await this.synthesis.add(
        `create-mirror:${communityId}:${mirrorConfig.arrakisName}`,
        {
          type: 'create_channel',
          guildId,
          communityId,
          payload: {
            name: mirrorConfig.arrakisName,
            type: sourceChannel.type,
            topic: `Arrakis mirror of ${sourceChannel.name}`,
            parentId: categoryId,
            minTier: mirrorConfig.minTier,
            sourceChannelId: sourceChannel.id,
          },
          idempotencyKey: `create-mirror:${communityId}:${mirrorConfig.arrakisName}`,
        }
      );

      this.log.info(
        {
          guildId,
          communityId,
          sourceName: sourceChannel.name,
          mirrorName: mirrorConfig.arrakisName,
        },
        'Mirror channel creation queued'
      );

      channelIds.push(`pending:${mirrorConfig.arrakisName}`);
    }

    return channelIds;
  }

  /**
   * Create custom channels from configuration.
   */
  private async createCustomChannels(
    guildId: string,
    communityId: string,
    categoryId: string,
    config: ChannelStrategyConfig
  ): Promise<string[]> {
    const customConfigs = config.customChannels ?? [];
    const channelIds: string[] = [];

    for (const channelConfig of customConfigs) {
      // Check if channel already exists
      const channels = await this.discord.getGuildChannels(guildId);
      const parentId = channelConfig.parentId ?? categoryId;
      const existing = channels.find(
        (c) => c.name === channelConfig.name && c.parentId === parentId
      );

      if (existing) {
        channelIds.push(existing.id);
        continue;
      }

      // Enqueue channel creation via synthesis
      await this.synthesis.add(
        `create-custom:${communityId}:${channelConfig.name}`,
        {
          type: 'create_channel',
          guildId,
          communityId,
          payload: {
            name: channelConfig.name,
            type: channelConfig.type,
            topic: channelConfig.topic,
            parentId,
            requirement: channelConfig.requirement,
          },
          idempotencyKey: `create-custom:${communityId}:${channelConfig.name}`,
        }
      );

      this.log.info(
        { guildId, communityId, channelName: channelConfig.name },
        'Custom channel creation queued'
      );

      channelIds.push(`pending:${channelConfig.name}`);
    }

    return channelIds;
  }

  // ===========================================================================
  // Channel Sync
  // ===========================================================================

  /**
   * Sync channel permissions based on member eligibility.
   */
  async syncChannelPermissions(
    guildId: string,
    communityId: string,
    channelId: string,
    members: MemberEligibility[]
  ): Promise<void> {
    this.log.info(
      { guildId, communityId, channelId, memberCount: members.length },
      'Syncing channel permissions'
    );

    // Get channel config to determine requirements
    const config = await this.getConfig(communityId);
    if (!config) {
      this.log.warn({ communityId }, 'No channel config found');
      return;
    }

    // Find channel configuration
    let minScore: number | null = null;
    let minTier: string | null = null;

    // Check additive channels
    if (config.additiveChannels) {
      const channels = await this.discord.getGuildChannels(guildId);
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        const additiveConfig = config.additiveChannels.find(
          (ac) =>
            `${config.channelPrefix}${ac.name}` === channel.name
        );
        if (additiveConfig) {
          minScore = additiveConfig.minConvictionScore;
        }
      }
    }

    // Check mirror channels
    if (!minScore && config.mirrorChannels) {
      const channels = await this.discord.getGuildChannels(guildId);
      const channel = channels.find((c) => c.id === channelId);
      if (channel) {
        const mirrorConfig = config.mirrorChannels.find(
          (mc) => mc.arrakisName === channel.name
        );
        if (mirrorConfig) {
          minTier = mirrorConfig.minTier;
        }
      }
    }

    // Sync permissions via synthesis (rate-limited)
    for (const member of members) {
      let hasAccess = false;

      // Check conviction score
      if (minScore !== null && member.eligible) {
        // Would need conviction score from member eligibility
        // For now, assume tier-based access
        hasAccess = member.eligible;
      }

      // Check tier
      if (minTier !== null && member.tier) {
        // Simple tier comparison (would need tier hierarchy)
        hasAccess = member.tier === minTier || member.eligible;
      }

      await this.synthesis.add(`sync-perm:${channelId}:${member.userId}`, {
        type: 'edit_channel_permissions',
        guildId,
        communityId,
        payload: {
          channelId,
          userId: member.userId,
          allow: hasAccess ? BigInt(1024).toString() : '0', // VIEW_CHANNEL
          deny: hasAccess ? '0' : BigInt(1024).toString(),
        },
        idempotencyKey: `sync-perm:${communityId}:${channelId}:${member.userId}`,
      });
    }

    this.metrics.permissionSyncs.inc({ community_id: communityId });

    this.log.info(
      { guildId, communityId, channelId },
      'Channel permissions sync queued'
    );
  }

  // ===========================================================================
  // Channel Queries
  // ===========================================================================

  /**
   * Get all Arrakis channels in a guild.
   */
  async getArrakisChannels(guildId: string): Promise<DiscordChannel[]> {
    const channels = await this.discord.getGuildChannels(guildId);
    return channels.filter((c) => this.isArrakisChannel(c.name));
  }

  /**
   * Check if a channel is an Arrakis channel.
   */
  isArrakisChannel(channelName: string): boolean {
    return (
      channelName.startsWith(this.options.defaultChannelPrefix) ||
      channelName === this.options.defaultCategoryName
    );
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get channel strategy configuration for a community.
   */
  async getConfig(communityId: string): Promise<ChannelStrategyConfig | null> {
    return this.configStore.getChannelConfig(communityId);
  }

  /**
   * Update channel strategy configuration.
   */
  async updateConfig(
    communityId: string,
    config: Partial<ChannelStrategyConfig>
  ): Promise<void> {
    const existing = await this.getConfig(communityId);
    const fullConfig: ChannelStrategyConfig = {
      ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
      ...existing,
      ...config,
    };
    await this.configStore.saveChannelConfig(communityId, fullConfig);

    this.log.info({ communityId, strategy: fullConfig.strategy }, 'Channel config updated');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ChannelStrategyManager instance.
 */
export function createChannelStrategyManager(
  discord: IDiscordChannelService,
  synthesis: ISynthesisQueue,
  configStore: IChannelConfigStore,
  metrics: IChannelMetrics,
  logger: Logger,
  options?: ChannelStrategyManagerOptions
): ChannelStrategyManager {
  return new ChannelStrategyManager(
    discord,
    synthesis,
    configStore,
    metrics,
    logger,
    options
  );
}
