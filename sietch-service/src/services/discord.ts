import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  TextChannel,
  Guild,
  GuildMember,
  type ColorResolvable,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  getCurrentEligibility,
  getHealthStatus,
  getDiscordIdByWallet,
  logAuditEvent,
} from '../db/index.js';
import type { EligibilityEntry, EligibilityDiff } from '../types/index.js';

/**
 * Discord embed colors
 */
const COLORS = {
  GOLD: 0xf5a623 as ColorResolvable, // Naib / Premium
  BLUE: 0x3498db as ColorResolvable, // Fedaykin / Standard
  RED: 0xe74c3c as ColorResolvable, // Removal / Warning
  GREEN: 0x2ecc71 as ColorResolvable, // Success / New member
  PURPLE: 0x9b59b6 as ColorResolvable, // Promotion
  GRAY: 0x95a5a6 as ColorResolvable, // Neutral
};

/**
 * Truncate an Ethereum address for display
 */
function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format BGT amount for display with commas and 2 decimal places
 */
function formatBGT(amount: bigint): string {
  const value = Number(amount) / 1e18;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Split a string into chunks for Discord field limits (1024 chars)
 */
function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  const lines = str.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > size) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Discord Service
 *
 * Manages Discord bot connection, notifications, and leaderboard updates.
 * Handles:
 * - Bot lifecycle (connect, reconnect, disconnect)
 * - Leaderboard posting to #census
 * - Announcements to #the-door
 * - DM notifications for access changes
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
      ],
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Discord client event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', async () => {
      logger.info({ user: this.client.user?.tag }, 'Discord bot connected');
      this.isReady = true;
      this.reconnectAttempts = 0;

      // Fetch and cache the guild
      try {
        this.guild = await this.client.guilds.fetch(config.discord.guildId);
        logger.info({ guildName: this.guild.name }, 'Connected to guild');
      } catch (error) {
        logger.error({ error, guildId: config.discord.guildId }, 'Failed to fetch guild');
      }
    });

    this.client.on('disconnect', () => {
      logger.warn('Discord bot disconnected');
      this.isReady = false;
    });

    this.client.on('error', (error) => {
      logger.error({ error }, 'Discord client error');
    });

    this.client.on('warn', (message) => {
      logger.warn({ message }, 'Discord client warning');
    });

    // Handle reconnection
    this.client.on('shardDisconnect', () => {
      logger.warn('Discord shard disconnected, attempting reconnect...');
      this.handleReconnect();
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
    const discordId = getDiscordIdByWallet(walletAddress);
    if (!discordId) {
      return null;
    }

    try {
      const guild = this.getGuild();
      return await guild.members.fetch(discordId);
    } catch (error) {
      logger.debug({ walletAddress, discordId, error }, 'Could not find member');
      return null;
    }
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

      const embed = this.buildLeaderboardEmbed(eligibility, health.lastSuccessfulQuery);

      await channel.send({ embeds: [embed] });

      logger.info({ count: eligibility.length }, 'Posted leaderboard to #census');
    } catch (error) {
      logger.error({ error }, 'Failed to post leaderboard');
      throw error;
    }
  }

  /**
   * Build the leaderboard embed
   */
  buildLeaderboardEmbed(eligibility: EligibilityEntry[], updatedAt: Date | null): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('BGT Census')
      .setDescription(`Last Updated: ${updatedAt?.toISOString() ?? 'Unknown'}`)
      .setColor(COLORS.GOLD)
      .setTimestamp();

    // Top 7 (Naib Council)
    const naibList = eligibility
      .filter((e) => e.rank !== undefined && e.rank <= 7)
      .map((e) => `**${e.rank}.** \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgtHeld)} BGT`)
      .join('\n');

    if (naibList) {
      embed.addFields({
        name: 'Naib Council',
        value: naibList || 'No members',
        inline: false,
      });
    }

    // Fedaykin (8-69)
    const fedaykinList = eligibility
      .filter((e) => e.rank !== undefined && e.rank > 7 && e.rank <= 69)
      .map((e) => `**${e.rank}.** \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgtHeld)} BGT`)
      .join('\n');

    if (fedaykinList) {
      // Split into multiple fields if needed (Discord limit: 1024 chars per field)
      const chunks = chunkString(fedaykinList, 1024);
      chunks.forEach((chunk, idx) => {
        embed.addFields({
          name: idx === 0 ? 'Fedaykin' : '\u200b',
          value: chunk,
          inline: false,
        });
      });
    }

    // Footer with total count
    const totalEligible = eligibility.filter((e) => e.rank !== undefined && e.rank <= 69).length;
    embed.setFooter({ text: `Total Eligible: ${totalEligible}/69` });

    return embed;
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
    if (!this.isConnected()) {
      logger.warn('Cannot process eligibility changes: Discord not connected');
      return;
    }

    const errors: Error[] = [];

    // Handle removals (most sensitive - DM + announcement)
    for (const entry of diff.removed) {
      try {
        await this.handleMemberRemoval(entry);
      } catch (error) {
        errors.push(error as Error);
        logger.error({ error, address: entry.address }, 'Failed to handle member removal');
      }
    }

    // Handle Naib demotions (DM + announcement)
    for (const entry of diff.demotedFromNaib) {
      try {
        await this.handleNaibDemotion(entry);
      } catch (error) {
        errors.push(error as Error);
        logger.error({ error, address: entry.address }, 'Failed to handle Naib demotion');
      }
    }

    // Handle Naib promotions (DM + announcement)
    for (const entry of diff.promotedToNaib) {
      try {
        await this.handleNaibPromotion(entry);
      } catch (error) {
        errors.push(error as Error);
        logger.error({ error, address: entry.address }, 'Failed to handle Naib promotion');
      }
    }

    // Handle new additions (announcement only - Collab.Land handles actual access)
    for (const entry of diff.added) {
      try {
        await this.announceNewEligible(entry);
      } catch (error) {
        errors.push(error as Error);
        logger.error({ error, address: entry.address }, 'Failed to announce new eligible');
      }
    }

    // Post updated leaderboard
    try {
      await this.postLeaderboard();
    } catch (error) {
      errors.push(error as Error);
      logger.error({ error }, 'Failed to post leaderboard after changes');
    }

    // Log summary
    logger.info({
      added: diff.added.length,
      removed: diff.removed.length,
      promotedToNaib: diff.promotedToNaib.length,
      demotedFromNaib: diff.demotedFromNaib.length,
      errors: errors.length,
    }, 'Processed eligibility changes');
  }

  /**
   * Handle member removal (lost eligibility)
   */
  private async handleMemberRemoval(entry: EligibilityEntry): Promise<void> {
    const member = await this.findMemberByWallet(entry.address);

    // Send DM if we can find the member
    if (member) {
      try {
        const dmEmbed = this.buildRemovalDMEmbed(entry);
        await member.send({ embeds: [dmEmbed] });
        logger.info({ address: entry.address, userId: member.id }, 'Sent removal DM');
      } catch (error) {
        // User may have DMs disabled - log but continue
        logger.warn({ address: entry.address, error }, 'Could not DM removed member (DMs may be disabled)');
      }
    }

    // Post to #the-door
    const announcementEmbed = this.buildDepartureAnnouncementEmbed(entry);
    await this.postToTheDoor(announcementEmbed);

    // Log audit event
    logAuditEvent('member_removed', {
      address: entry.address,
      previousRank: entry.rank,
      reason: 'rank_change',
    });
  }

  /**
   * Handle Naib demotion (left top 7)
   */
  private async handleNaibDemotion(entry: EligibilityEntry): Promise<void> {
    const member = await this.findMemberByWallet(entry.address);

    // Send DM if we can find the member
    if (member) {
      try {
        const dmEmbed = this.buildNaibDemotionDMEmbed(entry);
        await member.send({ embeds: [dmEmbed] });
        logger.info({ address: entry.address, userId: member.id }, 'Sent Naib demotion DM');
      } catch (error) {
        logger.warn({ address: entry.address, error }, 'Could not DM demoted Naib (DMs may be disabled)');
      }
    }

    // Post to #the-door
    const announcementEmbed = this.buildNaibDemotionAnnouncementEmbed(entry);
    await this.postToTheDoor(announcementEmbed);

    // Log audit event
    logAuditEvent('naib_demotion', {
      address: entry.address,
      newRank: entry.rank,
    });
  }

  /**
   * Handle Naib promotion (entered top 7)
   */
  private async handleNaibPromotion(entry: EligibilityEntry): Promise<void> {
    const member = await this.findMemberByWallet(entry.address);

    // Send DM if we can find the member
    if (member) {
      try {
        const dmEmbed = this.buildNaibPromotionDMEmbed(entry);
        await member.send({ embeds: [dmEmbed] });
        logger.info({ address: entry.address, userId: member.id }, 'Sent Naib promotion DM');
      } catch (error) {
        logger.warn({ address: entry.address, error }, 'Could not DM promoted Naib (DMs may be disabled)');
      }
    }

    // Post to #the-door
    const announcementEmbed = this.buildNaibPromotionAnnouncementEmbed(entry);
    await this.postToTheDoor(announcementEmbed);

    // Log audit event
    logAuditEvent('naib_promotion', {
      address: entry.address,
      newRank: entry.rank,
    });
  }

  /**
   * Announce new eligible member
   */
  private async announceNewEligible(entry: EligibilityEntry): Promise<void> {
    const announcementEmbed = this.buildNewEligibleAnnouncementEmbed(entry);
    await this.postToTheDoor(announcementEmbed);

    // Log audit event
    logAuditEvent('member_added', {
      address: entry.address,
      rank: entry.rank,
      role: entry.role,
    });
  }

  // ==========================================================================
  // Embed Builders
  // ==========================================================================

  /**
   * Build removal DM embed
   */
  private buildRemovalDMEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Sietch Access Update')
      .setDescription('Your access to Sietch has been revoked.')
      .setColor(COLORS.RED)
      .addFields(
        { name: 'Reason', value: 'You have fallen below rank 69 in BGT holdings.', inline: false },
        { name: 'Previous Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
        { name: 'Current Status', value: 'Not Eligible', inline: true }
      )
      .setFooter({ text: 'If you believe this is an error, please contact support.' })
      .setTimestamp();
  }

  /**
   * Build Naib demotion DM embed
   */
  private buildNaibDemotionDMEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Naib Council Update')
      .setDescription('You have been moved from the Naib Council to Fedaykin.')
      .setColor(COLORS.PURPLE)
      .addFields(
        { name: 'Reason', value: 'Your rank has fallen below the top 7.', inline: false },
        { name: 'New Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
        { name: 'New Role', value: 'Fedaykin', inline: true }
      )
      .setFooter({ text: 'You still have access to Sietch as a Fedaykin.' })
      .setTimestamp();
  }

  /**
   * Build Naib promotion DM embed
   */
  private buildNaibPromotionDMEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Welcome to the Naib Council!')
      .setDescription('Congratulations! You have been promoted to Naib.')
      .setColor(COLORS.GOLD)
      .addFields(
        { name: 'Your Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
        { name: 'BGT Held', value: `${formatBGT(entry.bgtHeld)} BGT`, inline: true }
      )
      .setFooter({ text: 'You now have access to the Naib Council channels.' })
      .setTimestamp();
  }

  /**
   * Build departure announcement embed for #the-door
   */
  private buildDepartureAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Departure')
      .setColor(COLORS.RED)
      .addFields(
        { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
        { name: 'Reason', value: 'Rank change (now below #69)', inline: true },
        { name: 'Previous Role', value: entry.role === 'naib' ? 'Naib' : 'Fedaykin', inline: true }
      )
      .setTimestamp();
  }

  /**
   * Build Naib demotion announcement embed for #the-door
   */
  private buildNaibDemotionAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Naib Council Change')
      .setColor(COLORS.PURPLE)
      .addFields(
        { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
        { name: 'Change', value: 'Naib to Fedaykin', inline: true },
        { name: 'New Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true }
      )
      .setTimestamp();
  }

  /**
   * Build Naib promotion announcement embed for #the-door
   */
  private buildNaibPromotionAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('New Naib Council Member')
      .setColor(COLORS.GOLD)
      .addFields(
        { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
        { name: 'Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
        { name: 'BGT Held', value: `${formatBGT(entry.bgtHeld)} BGT`, inline: true }
      )
      .setTimestamp();
  }

  /**
   * Build new eligible announcement embed for #the-door
   */
  private buildNewEligibleAnnouncementEmbed(entry: EligibilityEntry): EmbedBuilder {
    const roleName = entry.role === 'naib' ? 'Naib' : 'Fedaykin';

    return new EmbedBuilder()
      .setTitle('New Eligible Member')
      .setColor(COLORS.GREEN)
      .addFields(
        { name: 'Wallet', value: `\`${truncateAddress(entry.address)}\``, inline: true },
        { name: 'Rank', value: `#${entry.rank ?? 'Unknown'}`, inline: true },
        { name: 'Role', value: roleName, inline: true }
      )
      .setFooter({ text: 'Welcome to Sietch!' })
      .setTimestamp();
  }
}

/**
 * Singleton Discord service instance
 */
export const discordService = new DiscordService();
