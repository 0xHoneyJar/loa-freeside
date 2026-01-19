/**
 * Discord REST Client Wrapper
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Wraps @discordjs/rest for Discord API interactions.
 * Handles authentication, rate limiting, and error handling.
 *
 * @see SDD grimoires/loa/discord-iac-sdd.md §4.7
 * @module packages/cli/commands/server/iac/DiscordClient
 */

import { REST } from '@discordjs/rest';
import {
  Routes,
  type RESTGetAPIGuildResult,
  type RESTGetAPIGuildRolesResult,
  type RESTGetAPIGuildChannelsResult,
  type RESTPostAPIGuildRoleJSONBody,
  type RESTPostAPIGuildRoleResult,
  type RESTPatchAPIGuildRoleJSONBody,
  type RESTPatchAPIGuildRoleResult,
  type RESTPostAPIGuildChannelJSONBody,
  type RESTPostAPIGuildChannelResult,
  type RESTPatchAPIChannelJSONBody,
  type RESTPatchAPIChannelResult,
  type RESTPutAPIChannelPermissionJSONBody,
  type APIRole,
  type APIChannel,
  type APIGuildCategoryChannel,
  type APIGuildVoiceChannel,
  ChannelType as DiscordChannelType,
} from 'discord-api-types/v10';
import type { Snowflake } from './types.js';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error from Discord API operations
 */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    public readonly code: DiscordErrorCode,
    public readonly statusCode?: number,
    public readonly discordCode?: number
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

/**
 * Discord API error codes
 */
export enum DiscordErrorCode {
  /** Invalid or missing bot token */
  INVALID_TOKEN = 'INVALID_TOKEN',
  /** Bot doesn't have access to the guild */
  GUILD_NOT_FOUND = 'GUILD_NOT_FOUND',
  /** Bot lacks required permissions */
  MISSING_PERMISSIONS = 'MISSING_PERMISSIONS',
  /** Rate limited by Discord */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Generic API error */
  API_ERROR = 'API_ERROR',
  /** Network error */
  NETWORK_ERROR = 'NETWORK_ERROR',
}

// ============================================================================
// Discord Client
// ============================================================================

/**
 * Options for creating a Discord client
 */
export interface DiscordClientOptions {
  /** Bot token */
  token: string;
  /** API version (default: 10) */
  apiVersion?: number;
}

/**
 * Raw guild data from Discord API
 */
export interface RawGuildData {
  guild: RESTGetAPIGuildResult;
  roles: APIRole[];
  channels: APIChannel[];
}

/**
 * Discord REST API client wrapper
 */
export class DiscordClient {
  private readonly rest: REST;
  private readonly token: string;

  constructor(options: DiscordClientOptions) {
    this.token = options.token;
    this.rest = new REST({ version: String(options.apiVersion ?? 10) }).setToken(
      options.token
    );
  }

  /**
   * Get bot token (masked for display)
   */
  getMaskedToken(): string {
    if (this.token.length < 20) {
      return '***';
    }
    return `${this.token.slice(0, 10)}...${this.token.slice(-5)}`;
  }

  /**
   * Fetch complete guild data (guild info, roles, channels)
   *
   * @param guildId - Discord guild ID
   * @returns Raw guild data from API
   * @throws DiscordApiError on failure
   */
  async fetchGuildData(guildId: Snowflake): Promise<RawGuildData> {
    try {
      // Fetch guild, roles, and channels in parallel
      const [guild, roles, channels] = await Promise.all([
        this.rest.get(Routes.guild(guildId)) as Promise<RESTGetAPIGuildResult>,
        this.rest.get(Routes.guildRoles(guildId)) as Promise<RESTGetAPIGuildRolesResult>,
        this.rest.get(Routes.guildChannels(guildId)) as Promise<RESTGetAPIGuildChannelsResult>,
      ]);

      return { guild, roles, channels };
    } catch (error) {
      throw this.handleError(error, `Failed to fetch guild data for ${guildId}`);
    }
  }

  /**
   * Fetch guild info only
   */
  async fetchGuild(guildId: Snowflake): Promise<RESTGetAPIGuildResult> {
    try {
      return (await this.rest.get(Routes.guild(guildId))) as RESTGetAPIGuildResult;
    } catch (error) {
      throw this.handleError(error, `Failed to fetch guild ${guildId}`);
    }
  }

  /**
   * Fetch guild roles
   */
  async fetchRoles(guildId: Snowflake): Promise<APIRole[]> {
    try {
      return (await this.rest.get(
        Routes.guildRoles(guildId)
      )) as RESTGetAPIGuildRolesResult;
    } catch (error) {
      throw this.handleError(error, `Failed to fetch roles for guild ${guildId}`);
    }
  }

  /**
   * Fetch guild channels
   */
  async fetchChannels(guildId: Snowflake): Promise<APIChannel[]> {
    try {
      return (await this.rest.get(
        Routes.guildChannels(guildId)
      )) as RESTGetAPIGuildChannelsResult;
    } catch (error) {
      throw this.handleError(error, `Failed to fetch channels for guild ${guildId}`);
    }
  }

  /**
   * Validate bot has access to guild
   *
   * @param guildId - Discord guild ID
   * @returns true if bot has access
   * @throws DiscordApiError if no access
   */
  async validateGuildAccess(guildId: Snowflake): Promise<boolean> {
    try {
      await this.rest.get(Routes.guild(guildId));
      return true;
    } catch (error) {
      throw this.handleError(error, `Bot doesn't have access to guild ${guildId}`);
    }
  }

  // ============================================================================
  // Write Methods (Sprint 92)
  // ============================================================================

  /**
   * Create a new role
   */
  async createRole(
    guildId: Snowflake,
    data: RESTPostAPIGuildRoleJSONBody
  ): Promise<APIRole> {
    try {
      return (await this.rest.post(Routes.guildRoles(guildId), {
        body: data,
      })) as RESTPostAPIGuildRoleResult;
    } catch (error) {
      throw this.handleError(error, `Failed to create role in guild ${guildId}`);
    }
  }

  /**
   * Update an existing role
   */
  async updateRole(
    guildId: Snowflake,
    roleId: Snowflake,
    data: RESTPatchAPIGuildRoleJSONBody
  ): Promise<APIRole> {
    try {
      return (await this.rest.patch(Routes.guildRole(guildId, roleId), {
        body: data,
      })) as RESTPatchAPIGuildRoleResult;
    } catch (error) {
      throw this.handleError(error, `Failed to update role ${roleId} in guild ${guildId}`);
    }
  }

  /**
   * Delete a role
   */
  async deleteRole(guildId: Snowflake, roleId: Snowflake): Promise<void> {
    try {
      await this.rest.delete(Routes.guildRole(guildId, roleId));
    } catch (error) {
      throw this.handleError(error, `Failed to delete role ${roleId} in guild ${guildId}`);
    }
  }

  /**
   * Create a new channel (or category)
   */
  async createChannel(
    guildId: Snowflake,
    data: RESTPostAPIGuildChannelJSONBody
  ): Promise<APIChannel> {
    try {
      return (await this.rest.post(Routes.guildChannels(guildId), {
        body: data,
      })) as RESTPostAPIGuildChannelResult;
    } catch (error) {
      throw this.handleError(error, `Failed to create channel in guild ${guildId}`);
    }
  }

  /**
   * Update an existing channel
   */
  async updateChannel(
    channelId: Snowflake,
    data: RESTPatchAPIChannelJSONBody
  ): Promise<APIChannel> {
    try {
      return (await this.rest.patch(Routes.channel(channelId), {
        body: data,
      })) as RESTPatchAPIChannelResult;
    } catch (error) {
      throw this.handleError(error, `Failed to update channel ${channelId}`);
    }
  }

  /**
   * Delete a channel
   */
  async deleteChannel(channelId: Snowflake): Promise<void> {
    try {
      await this.rest.delete(Routes.channel(channelId));
    } catch (error) {
      throw this.handleError(error, `Failed to delete channel ${channelId}`);
    }
  }

  /**
   * Set permission overwrite for a channel
   */
  async setChannelPermission(
    channelId: Snowflake,
    overwriteId: Snowflake,
    data: RESTPutAPIChannelPermissionJSONBody
  ): Promise<void> {
    try {
      await this.rest.put(Routes.channelPermission(channelId, overwriteId), {
        body: data,
      });
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to set permission for ${overwriteId} on channel ${channelId}`
      );
    }
  }

  /**
   * Delete permission overwrite for a channel
   */
  async deleteChannelPermission(
    channelId: Snowflake,
    overwriteId: Snowflake
  ): Promise<void> {
    try {
      await this.rest.delete(Routes.channelPermission(channelId, overwriteId));
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to delete permission for ${overwriteId} on channel ${channelId}`
      );
    }
  }

  // ============================================================================
  // Resource Fetching Methods (Sprint 99)
  // ============================================================================

  /**
   * Fetch a single role by ID
   *
   * @param guildId - Discord guild ID
   * @param roleId - Discord role ID
   * @returns Role data or null if not found
   */
  async fetchRole(guildId: Snowflake, roleId: Snowflake): Promise<APIRole | null> {
    try {
      const roles = await this.fetchRoles(guildId);
      return roles.find((r) => r.id === roleId) ?? null;
    } catch (error) {
      throw this.handleError(error, `Failed to fetch role ${roleId} in guild ${guildId}`);
    }
  }

  /**
   * Fetch a single channel by ID
   *
   * @param channelId - Discord channel ID
   * @returns Channel data
   */
  async fetchChannel(channelId: Snowflake): Promise<APIChannel> {
    try {
      return (await this.rest.get(Routes.channel(channelId))) as APIChannel;
    } catch (error) {
      throw this.handleError(error, `Failed to fetch channel ${channelId}`);
    }
  }

  /**
   * Fetch a resource by type and ID
   *
   * @param guildId - Discord guild ID
   * @param type - Resource type (role, channel, category)
   * @param resourceId - Discord resource ID
   * @returns Fetched resource in state-compatible format
   * @throws DiscordApiError if resource not found or permission denied
   */
  async fetchResource(
    guildId: Snowflake,
    type: 'role' | 'channel' | 'category',
    resourceId: Snowflake
  ): Promise<FetchedResource> {
    switch (type) {
      case 'role': {
        const role = await this.fetchRole(guildId, resourceId);
        if (!role) {
          throw new DiscordApiError(
            `Role ${resourceId} not found in guild ${guildId}`,
            DiscordErrorCode.GUILD_NOT_FOUND,
            404
          );
        }
        return {
          type: 'role',
          id: role.id,
          name: role.name,
          attributes: {
            id: role.id,
            name: role.name,
            color: `#${role.color.toString(16).padStart(6, '0')}`,
            hoist: role.hoist,
            mentionable: role.mentionable,
            permissions: role.permissions,
            position: role.position,
          },
        };
      }

      case 'channel':
      case 'category': {
        const channel = await this.fetchChannel(resourceId);
        const isChannelCategory = channel.type === DiscordChannelType.GuildCategory;

        // Validate type matches
        if (type === 'category' && !isChannelCategory) {
          throw new DiscordApiError(
            `Resource ${resourceId} is a channel, not a category`,
            DiscordErrorCode.API_ERROR,
            400
          );
        }
        if (type === 'channel' && isChannelCategory) {
          throw new DiscordApiError(
            `Resource ${resourceId} is a category, not a channel`,
            DiscordErrorCode.API_ERROR,
            400
          );
        }

        const channelType = mapChannelType(channel.type);

        if (isChannelCategory) {
          return {
            type: 'category',
            id: channel.id,
            name: channel.name ?? 'unknown',
            attributes: {
              id: channel.id,
              name: channel.name,
              position: 'position' in channel ? channel.position : 0,
            },
          };
        }

        return {
          type: 'channel',
          id: channel.id,
          name: channel.name ?? 'unknown',
          attributes: {
            id: channel.id,
            name: channel.name,
            type: channelType ?? 'text',
            position: 'position' in channel ? channel.position : 0,
            parent_id: 'parent_id' in channel ? channel.parent_id : null,
            topic: 'topic' in channel ? channel.topic : null,
            nsfw: 'nsfw' in channel ? channel.nsfw : false,
          },
        };
      }

      default:
        throw new DiscordApiError(
          `Unsupported resource type: ${type}`,
          DiscordErrorCode.API_ERROR,
          400
        );
    }
  }

  /**
   * Handle Discord API errors
   */
  private handleError(error: unknown, context: string): DiscordApiError {
    // Handle @discordjs/rest errors
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as {
        status: number;
        message?: string;
        code?: number;
        rawError?: { message?: string; code?: number };
      };

      const statusCode = apiError.status;
      const message = apiError.rawError?.message || apiError.message || 'Unknown error';
      const discordCode = apiError.rawError?.code || apiError.code;

      // Map status codes to error types
      if (statusCode === 401) {
        return new DiscordApiError(
          `${context}: Invalid bot token`,
          DiscordErrorCode.INVALID_TOKEN,
          statusCode,
          discordCode
        );
      }

      if (statusCode === 403) {
        return new DiscordApiError(
          `${context}: Missing permissions`,
          DiscordErrorCode.MISSING_PERMISSIONS,
          statusCode,
          discordCode
        );
      }

      if (statusCode === 404) {
        return new DiscordApiError(
          `${context}: Guild not found or bot not a member`,
          DiscordErrorCode.GUILD_NOT_FOUND,
          statusCode,
          discordCode
        );
      }

      if (statusCode === 429) {
        return new DiscordApiError(
          `${context}: Rate limited by Discord`,
          DiscordErrorCode.RATE_LIMITED,
          statusCode,
          discordCode
        );
      }

      return new DiscordApiError(
        `${context}: ${message}`,
        DiscordErrorCode.API_ERROR,
        statusCode,
        discordCode
      );
    }

    // Handle network errors
    if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        return new DiscordApiError(
          `${context}: Network error - ${error.message}`,
          DiscordErrorCode.NETWORK_ERROR
        );
      }
      return new DiscordApiError(
        `${context}: ${error.message}`,
        DiscordErrorCode.API_ERROR
      );
    }

    return new DiscordApiError(
      `${context}: Unknown error`,
      DiscordErrorCode.API_ERROR
    );
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a Discord client from environment variable
 *
 * Accepts either DISCORD_BOT_TOKEN or DISCORD_TOKEN for flexibility
 *
 * @returns DiscordClient instance
 * @throws Error if neither DISCORD_BOT_TOKEN nor DISCORD_TOKEN is set
 */
export function createClientFromEnv(): DiscordClient {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not found.\n' +
        'Set DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable.'
    );
  }
  return new DiscordClient({ token });
}

/**
 * Check if a channel is a category
 */
export function isCategory(channel: APIChannel): channel is APIGuildCategoryChannel {
  return channel.type === DiscordChannelType.GuildCategory;
}

/**
 * Check if a channel is a text channel
 */
export function isTextChannel(channel: APIChannel): boolean {
  return channel.type === DiscordChannelType.GuildText;
}

/**
 * Check if a channel is a voice channel
 */
export function isVoiceChannel(channel: APIChannel): channel is APIGuildVoiceChannel {
  return channel.type === DiscordChannelType.GuildVoice;
}

/**
 * Map Discord channel type to IaC channel type
 */
export function mapChannelType(
  discordType: DiscordChannelType
): 'text' | 'voice' | 'announcement' | 'stage' | 'forum' | null {
  switch (discordType) {
    case DiscordChannelType.GuildText:
      return 'text';
    case DiscordChannelType.GuildVoice:
      return 'voice';
    case DiscordChannelType.GuildAnnouncement:
      return 'announcement';
    case DiscordChannelType.GuildStageVoice:
      return 'stage';
    case DiscordChannelType.GuildForum:
      return 'forum';
    default:
      return null; // Unsupported channel type
  }
}

// ============================================================================
// Resource Types (Sprint 99)
// ============================================================================

/**
 * Supported resource types for import and state operations
 */
export type ResourceType = 'role' | 'channel' | 'category';

/**
 * Fetched resource in state-compatible format
 */
export interface FetchedResource {
  /** Resource type */
  type: ResourceType;
  /** Resource ID (Discord snowflake) */
  id: string;
  /** Resource name */
  name: string;
  /** Resource attributes for state */
  attributes: Record<string, unknown>;
}
