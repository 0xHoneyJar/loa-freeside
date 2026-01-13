/**
 * Discord Service
 *
 * Manages Discord bot connection, notifications, and leaderboard updates.
 * Delegates to extracted modules for specific functionality.
 *
 * Handles:
 * - Bot lifecycle (connect, reconnect, disconnect)
 * - Leaderboard posting to #census
 * - Announcements to #the-door
 * - DM notifications for access changes
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  type Guild,
  type GuildMember,
  type User,
  type EmbedBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getCurrentEligibility, getHealthStatus } from '../db/index.js';
import type { EligibilityDiff } from '../types/index.js';

// Import from extracted modules
import { setupEventHandlers } from './discord/handlers/index.js';
import {
  getMemberById as getMemberByIdOp,
  assignRole as assignRoleOp,
  removeRole as removeRoleOp,
  findMemberByWallet as findMemberByWalletOp,
  getBotChannel as getBotChannelOp,
  sendDMWithFallback as sendDMWithFallbackOp,
  notifyBadgeAwarded as notifyBadgeAwardedOp,
} from './discord/operations/index.js';
import { buildLeaderboardEmbed } from './discord/embeds/index.js';
import { processEligibilityChanges } from './discord/processors/index.js';

/**
 * Discord Service
 *
 * Manages Discord bot connection, notifications, and leaderboard updates.
 */
class DiscordService {
  private client: Client;
  private guild: Guild | null = null;
  private isReady = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Create state object for event handlers
    const state = {
      guild: this.guild,
      isReady: this.isReady,
      reconnectAttempts: this.reconnectAttempts,
    };

    // Set up event handlers with state synchronization
    setupEventHandlers(
      this.client,
      state,
      () => this.handleReconnect()
    );

    // Synchronize state changes back from handlers
    this.client.on('ready', () => {
      this.isReady = state.isReady;
      this.guild = state.guild;
      this.reconnectAttempts = state.reconnectAttempts;
    });
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached, giving up');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info({ attempt: this.reconnectAttempts, delay }, 'Scheduling reconnect');

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error({ error }, 'Reconnect failed');
        await this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<void> {
    if (this.isReady) {
      logger.debug('Discord bot already connected');
      return;
    }

    logger.info('Connecting to Discord...');
    await this.client.login(config.discord.botToken);

    // Wait for ready event to set guild
    await new Promise<void>((resolve) => {
      if (this.isReady) {
        resolve();
        return;
      }
      this.client.once('ready', async () => {
        this.isReady = true;
        this.reconnectAttempts = 0;
        try {
          this.guild = await this.client.guilds.fetch(config.discord.guildId);
        } catch (error) {
          logger.error({ error, guildId: config.discord.guildId }, 'Failed to fetch guild');
        }
        resolve();
      });
    });
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (!this.isReady) {
      return;
    }

    logger.info('Disconnecting from Discord...');
    this.client.destroy();
    this.isReady = false;
    this.guild = null;
  }

  /**
   * Check if the bot is connected and ready
   */
  isConnected(): boolean {
    return this.isReady && this.guild !== null;
  }

  /**
   * Get the guild instance
   */
  private getGuild(): Guild {
    if (!this.guild) {
      throw new Error('Discord bot not connected to guild');
    }
    return this.guild;
  }

  /**
   * Find a Discord member by their wallet address
   */
  async findMemberByWallet(walletAddress: string): Promise<GuildMember | null> {
    return findMemberByWalletOp(this.guild, walletAddress);
  }

  /**
   * Post or update the leaderboard in #census
   */
  async postLeaderboard(): Promise<void> {
    if (!this.isConnected()) {
      logger.warn('Cannot post leaderboard: Discord not connected');
      return;
    }

    try {
      const guild = this.getGuild();
      const channel = await guild.channels.fetch(config.discord.channels.census);

      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ channelId: config.discord.channels.census }, 'Census channel not found or not a text channel');
        return;
      }

      const eligibility = getCurrentEligibility();
      const health = getHealthStatus();

      const embed = buildLeaderboardEmbed(eligibility, health.lastSuccessfulQuery);

      await channel.send({ embeds: [embed] });

      logger.info({ count: eligibility.length }, 'Posted leaderboard to #census');
    } catch (error) {
      logger.error({ error }, 'Failed to post leaderboard');
      throw error;
    }
  }

  /**
   * Post an announcement to #the-door
   */
  async postToTheDoor(embed: EmbedBuilder): Promise<void> {
    if (!this.isConnected()) {
      logger.warn('Cannot post to #the-door: Discord not connected');
      return;
    }

    try {
      const guild = this.getGuild();
      const channel = await guild.channels.fetch(config.discord.channels.theDoor);

      if (!channel || !(channel instanceof TextChannel)) {
        logger.error({ channelId: config.discord.channels.theDoor }, '#the-door channel not found or not a text channel');
        return;
      }

      await channel.send({ embeds: [embed] });
      logger.debug('Posted announcement to #the-door');
    } catch (error) {
      logger.error({ error }, 'Failed to post to #the-door');
      throw error;
    }
  }

  /**
   * Process eligibility changes and send notifications
   */
  async processEligibilityChanges(diff: EligibilityDiff): Promise<void> {
    await processEligibilityChanges(
      this.guild,
      diff,
      () => this.postLeaderboard()
    );
  }

  // ==========================================================================
  // Role Management Methods (S7-T7)
  // ==========================================================================

  /**
   * Get a guild member by Discord ID
   */
  async getMemberById(discordUserId: string): Promise<GuildMember | null> {
    return getMemberByIdOp(this.guild, discordUserId);
  }

  /**
   * Assign a role to a member
   */
  async assignRole(discordUserId: string, roleId: string): Promise<boolean> {
    return assignRoleOp(this.guild, discordUserId, roleId);
  }

  /**
   * Remove a role from a member
   */
  async removeRole(discordUserId: string, roleId: string): Promise<boolean> {
    return removeRoleOp(this.guild, discordUserId, roleId);
  }

  /**
   * Get the bot commands channel (for fallback messages)
   */
  async getBotChannel(): Promise<TextChannel | null> {
    return getBotChannelOp(this.guild);
  }

  /**
   * Send a DM to a user with fallback to channel message
   */
  async sendDMWithFallback(
    user: User,
    content: { embeds?: EmbedBuilder[]; content?: string }
  ): Promise<boolean> {
    return sendDMWithFallbackOp(this.guild, user, content);
  }

  /**
   * Notify user about badge award
   */
  async notifyBadgeAwarded(
    discordUserId: string,
    badgeName: string,
    badgeEmoji: string,
    badgeDescription: string
  ): Promise<void> {
    return notifyBadgeAwardedOp(this.guild, discordUserId, badgeName, badgeEmoji, badgeDescription);
  }

  /**
   * Get the Discord client (for direct access if needed)
   */
  getClient(): Client {
    return this.client;
  }
}

/**
 * Singleton Discord service instance
 */
export const discordService = new DiscordService();
