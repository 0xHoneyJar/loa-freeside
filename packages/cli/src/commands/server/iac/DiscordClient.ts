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
  type APIRole,
  type APIChannel,
  type APIGuildCategoryChannel,
  type APIGuildTextChannel,
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
 * @returns DiscordClient instance
 * @throws Error if DISCORD_BOT_TOKEN is not set
 */
export function createClientFromEnv(): DiscordClient {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'DISCORD_BOT_TOKEN environment variable is required.\n' +
        'Set it with: export DISCORD_BOT_TOKEN="your-bot-token"'
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
export function isTextChannel(channel: APIChannel): channel is APIGuildTextChannel {
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
