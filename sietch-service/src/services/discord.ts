import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  TextChannel,
  Guild,
  GuildMember,
  Role,
  User,
  Message,
  MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type ColorResolvable,
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  getCurrentEligibility,
  getHealthStatus,
  getDiscordIdByWallet,
  getWalletByDiscordId,
  getEligibilityByAddress,
  logAuditEvent,
  getMemberProfileByDiscordId,
} from '../db/index.js';
import type { EligibilityEntry, EligibilityDiff } from '../types/index.js';
import {
  registerCommands,
  handleProfileCommand,
  handleBadgesCommand,
  handleBadgesAutocomplete,
  handleStatsCommand,
  handleAdminBadgeCommand,
  handleAdminBadgeAutocomplete,
  handleDirectoryCommand,
  handleDirectoryButton,
  handleDirectorySelect,
  handleLeaderboardCommand,
  handleNaibCommand,
  handleThresholdCommand,
  handleRegisterWaitlistCommand,
  handleWaterShareCommand,
  DIRECTORY_INTERACTIONS,
} from '../discord/commands/index.js';
import {
  isOnboardingButton,
  isOnboardingModal,
  handleOnboardingButton,
  handleOnboardingModal,
} from '../discord/interactions/index.js';
import { profileService } from './profile.js';
import {
  recordMessage,
  recordReactionGiven,
  recordReactionReceived,
} from './activity.js';

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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
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

        // Register slash commands
        if (this.client.user) {
          await registerCommands(this.client.user.id);
        }
      } catch (error) {
        logger.error({ error, guildId: config.discord.guildId }, 'Failed to fetch guild or register commands');
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

    // Handle slash commands and interactions
    this.client.on('interactionCreate', async (interaction) => {
      await this.handleInteraction(interaction);
    });

    // Handle role changes for auto-onboarding
    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      // Ensure we have full member objects
      if (oldMember.partial) {
        try {
          await oldMember.fetch();
        } catch (error) {
          logger.warn({ error }, 'Could not fetch partial old member');
          return;
        }
      }
      await this.handleMemberUpdate(oldMember as GuildMember, newMember);
    });

    // Activity tracking: message create
    this.client.on('messageCreate', async (message) => {
      await this.handleMessageCreate(message);
    });

    // Activity tracking: reaction add
    this.client.on('messageReactionAdd', async (reaction, user) => {
      await this.handleReactionAdd(reaction, user);
    });

    // Activity tracking: reaction remove
    this.client.on('messageReactionRemove', async (reaction, user) => {
      await this.handleReactionRemove(reaction, user);
    });
  }

  /**
   * Handle incoming Discord interactions (slash commands, buttons, modals, select menus)
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      // Slash commands
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
        return;
      }

      // Button clicks
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
        return;
      }

      // Modal submissions
      if (interaction.isModalSubmit()) {
        await this.handleModalInteraction(interaction);
        return;
      }

      // String select menus
      if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
        return;
      }

      // Autocomplete
      if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
        return;
      }
    } catch (error) {
      logger.error({ error, interactionType: interaction.type }, 'Error handling interaction');
    }
  }

  /**
   * Handle slash command interactions
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    switch (commandName) {
      case 'profile':
        await handleProfileCommand(interaction);
        break;
      case 'badges':
        await handleBadgesCommand(interaction);
        break;
      case 'stats':
        await handleStatsCommand(interaction);
        break;
      case 'admin-badge':
        await handleAdminBadgeCommand(interaction);
        break;
      case 'directory':
        await handleDirectoryCommand(interaction);
        break;
      case 'leaderboard':
        await handleLeaderboardCommand(interaction);
        break;
      case 'naib':
        await handleNaibCommand(interaction);
        break;
      case 'threshold':
        await handleThresholdCommand(interaction);
        break;
      case 'register-waitlist':
        await handleRegisterWaitlistCommand(interaction);
        break;
      case 'water-share':
        await handleWaterShareCommand(interaction);
        break;
      default:
        logger.warn({ commandName }, 'Unknown slash command');
        await interaction.reply({
          content: 'Unknown command',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle button interactions
   */
  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const { customId } = interaction;

    // Onboarding buttons
    if (isOnboardingButton(customId)) {
      await handleOnboardingButton(interaction);
      return;
    }

    // Directory pagination buttons
    if (this.isDirectoryButton(customId)) {
      await handleDirectoryButton(interaction);
      return;
    }

    logger.warn({ customId }, 'Unknown button interaction');
  }

  /**
   * Handle string select menu interactions
   */
  private async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const { customId } = interaction;

    // Directory filter/sort select menus
    if (this.isDirectorySelectMenu(customId)) {
      await handleDirectorySelect(interaction);
      return;
    }

    logger.warn({ customId }, 'Unknown select menu interaction');
  }

  /**
   * Check if a custom ID is a directory button
   */
  private isDirectoryButton(customId: string): boolean {
    return (
      customId === DIRECTORY_INTERACTIONS.prevPage ||
      customId === DIRECTORY_INTERACTIONS.nextPage ||
      customId === DIRECTORY_INTERACTIONS.refresh
    );
  }

  /**
   * Check if a custom ID is a directory select menu
   */
  private isDirectorySelectMenu(customId: string): boolean {
    return (
      customId === DIRECTORY_INTERACTIONS.tierFilter ||
      customId === DIRECTORY_INTERACTIONS.sortBy
    );
  }

  /**
   * Handle modal submission interactions
   */
  private async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const { customId } = interaction;

    // Onboarding modals
    if (isOnboardingModal(customId)) {
      await handleOnboardingModal(interaction);
      return;
    }

    logger.warn({ customId }, 'Unknown modal interaction');
  }

  /**
   * Handle autocomplete interactions (for nym search)
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const { commandName } = interaction;
    const focusedOption = interaction.options.getFocused(true);

    // Profile command autocomplete
    if (commandName === 'profile' && focusedOption.name === 'nym') {
      const query = focusedOption.value;
      const results = profileService.searchByNym(query, 25);

      await interaction.respond(
        results.map((profile) => ({
          name: profile.nym,
          value: profile.nym,
        }))
      );
      return;
    }

    // Badges command autocomplete
    if (commandName === 'badges') {
      await handleBadgesAutocomplete(interaction);
      return;
    }

    // Admin-badge command autocomplete
    if (commandName === 'admin-badge') {
      await handleAdminBadgeAutocomplete(interaction);
      return;
    }

    await interaction.respond([]);
  }

  /**
   * Handle member role updates for auto-onboarding detection
   */
  private async handleMemberUpdate(
    oldMember: GuildMember,
    newMember: GuildMember
  ): Promise<void> {
    // Check if Naib or Fedaykin role was added
    const naibRoleId = config.discord.roles.naib;
    const fedaykinRoleId = config.discord.roles.fedaykin;

    const hadNaib = oldMember.roles.cache.has(naibRoleId);
    const hadFedaykin = oldMember.roles.cache.has(fedaykinRoleId);
    const hasNaib = newMember.roles.cache.has(naibRoleId);
    const hasFedaykin = newMember.roles.cache.has(fedaykinRoleId);

    // New role assignment detected
    const gainedAccess = (!hadNaib && !hadFedaykin) && (hasNaib || hasFedaykin);

    if (gainedAccess) {
      await this.triggerOnboardingIfNeeded(newMember.user, hasNaib ? 'naib' : 'fedaykin');
    }
  }

  /**
   * Trigger onboarding for a user if they haven't completed it
   */
  private async triggerOnboardingIfNeeded(user: User, tier: 'naib' | 'fedaykin'): Promise<void> {
    // Check if user already has a profile
    const existingProfile = profileService.getProfileByDiscordId(user.id);
    if (existingProfile) {
      logger.debug({ userId: user.id }, 'User already has profile, skipping onboarding');
      return;
    }

    // Lazy import to avoid circular dependency
    const { onboardingService } = await import('./onboarding.js');

    try {
      await onboardingService.startOnboarding(user, tier);
      logger.info({ userId: user.id, tier }, 'Triggered onboarding for new member');
    } catch (error) {
      logger.warn({ error, userId: user.id }, 'Could not start onboarding - DMs may be disabled');
    }
  }

  // ==========================================================================
  // Activity Tracking Handlers (S8-T3)
  // ==========================================================================

  /**
   * Handle message create event for activity tracking
   */
  private async handleMessageCreate(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only track messages in our guild
    if (!message.guild || message.guild.id !== config.discord.guildId) return;

    // Only track messages from onboarded members
    const profile = getMemberProfileByDiscordId(message.author.id);
    if (!profile || !profile.onboardingComplete) return;

    try {
      await recordMessage(message.author.id, message.channel.id);
    } catch (error) {
      logger.error({ error, userId: message.author.id }, 'Failed to record message activity');
    }
  }

  /**
   * Handle reaction add event for activity tracking
   */
  private async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    // Ignore bot reactions
    if (user.bot) return;

    // Fetch full reaction if partial
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        logger.debug({ error }, 'Could not fetch partial reaction');
        return;
      }
    }

    // Only track reactions in our guild
    if (!reaction.message.guild || reaction.message.guild.id !== config.discord.guildId) return;

    // Only track reactions from onboarded members
    const profile = getMemberProfileByDiscordId(user.id);
    if (!profile || !profile.onboardingComplete) return;

    try {
      // Record reaction given by the user
      await recordReactionGiven(user.id, reaction.message.channel.id);

      // Record reaction received by the message author (if different and onboarded)
      const messageAuthorId = reaction.message.author?.id;
      if (messageAuthorId && messageAuthorId !== user.id) {
        const authorProfile = getMemberProfileByDiscordId(messageAuthorId);
        if (authorProfile?.onboardingComplete) {
          await recordReactionReceived(messageAuthorId, reaction.message.channel.id);
        }
      }
    } catch (error) {
      logger.error({ error, userId: user.id }, 'Failed to record reaction activity');
    }
  }

  /**
   * Handle reaction remove event for activity tracking
   * Note: We don't subtract points for removed reactions (activity is cumulative)
   */
  private async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ): Promise<void> {
    // We don't track reaction removes for activity
    // Activity points are cumulative and don't decrease on reaction removal
    // The decay system handles activity reduction over time
    logger.debug({ userId: user.id, messageId: reaction.message.id }, 'Reaction removed (not tracked)');
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

  // ==========================================================================
  // Role Management Methods (S7-T7)
  // ==========================================================================

  /**
   * Get a guild member by Discord ID
   */
  async getMemberById(discordUserId: string): Promise<GuildMember | null> {
    if (!this.isConnected()) {
      logger.warn('Cannot get member: Discord not connected');
      return null;
    }

    try {
      const guild = this.getGuild();
      return await guild.members.fetch(discordUserId);
    } catch (error) {
      logger.debug({ discordUserId, error }, 'Could not fetch member');
      return null;
    }
  }

  /**
   * Assign a role to a member
   */
  async assignRole(discordUserId: string, roleId: string): Promise<boolean> {
    if (!this.isConnected()) {
      logger.warn('Cannot assign role: Discord not connected');
      return false;
    }

    try {
      const guild = this.getGuild();
      const member = await guild.members.fetch(discordUserId);
      await member.roles.add(roleId);
      logger.info({ discordUserId, roleId }, 'Assigned role to member');
      return true;
    } catch (error) {
      logger.error({ error, discordUserId, roleId }, 'Failed to assign role');
      return false;
    }
  }

  /**
   * Remove a role from a member
   */
  async removeRole(discordUserId: string, roleId: string): Promise<boolean> {
    if (!this.isConnected()) {
      logger.warn('Cannot remove role: Discord not connected');
      return false;
    }

    try {
      const guild = this.getGuild();
      const member = await guild.members.fetch(discordUserId);
      await member.roles.remove(roleId);
      logger.info({ discordUserId, roleId }, 'Removed role from member');
      return true;
    } catch (error) {
      logger.error({ error, discordUserId, roleId }, 'Failed to remove role');
      return false;
    }
  }

  /**
   * Get the bot commands channel (for fallback messages)
   */
  async getBotChannel(): Promise<TextChannel | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const guild = this.getGuild();
      // Try sietch lounge first, then fallback to the-door
      const channelId = config.discord.channels.sietchLounge ?? config.discord.channels.theDoor;
      const channel = await guild.channels.fetch(channelId);
      return channel instanceof TextChannel ? channel : null;
    } catch (error) {
      logger.error({ error }, 'Failed to get bot channel');
      return null;
    }
  }

  /**
   * Send a DM to a user with fallback to channel message
   */
  async sendDMWithFallback(
    user: User,
    content: { embeds?: EmbedBuilder[]; content?: string }
  ): Promise<boolean> {
    try {
      await user.send(content);
      return true;
    } catch (error) {
      logger.warn({ userId: user.id, error }, 'Could not send DM, trying channel fallback');

      // Try sending to bot channel as ephemeral-like message
      const channel = await this.getBotChannel();
      if (channel) {
        try {
          await channel.send({
            content: `<@${user.id}> ` + (content.content ?? ''),
            embeds: content.embeds,
          });
          return true;
        } catch (channelError) {
          logger.error({ error: channelError }, 'Failed to send fallback message');
        }
      }

      return false;
    }
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
    const member = await this.getMemberById(discordUserId);
    if (!member) return;

    const embed = new EmbedBuilder()
      .setTitle(`${badgeEmoji} New Badge Earned!`)
      .setDescription(`Congratulations! You've earned the **${badgeName}** badge.`)
      .addFields({ name: 'Description', value: badgeDescription })
      .setColor(COLORS.GOLD)
      .setFooter({ text: 'Use /badges to view all your badges' })
      .setTimestamp();

    await this.sendDMWithFallback(member.user, { embeds: [embed] });
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
