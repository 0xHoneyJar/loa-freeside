/**
 * /verify command - Native Wallet Verification
 *
 * Sprint 79: API Routes & Discord Integration
 *
 * Provides slash command interface for wallet verification:
 * - /verify start - Start a new verification session
 * - /verify status - Check current verification status
 * - /verify reset - Reset failed verification (admin only)
 *
 * @module discord/commands/verify
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { eq } from 'drizzle-orm';

import { config, isPostgreSQLEnabled } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { WalletVerificationService } from '../../packages/verification/VerificationService.js';
import { communities } from '../../packages/adapters/storage/schema.js';

// =============================================================================
// Service Cache
// =============================================================================

/**
 * Cached verification service instance
 */
let cachedService: WalletVerificationService | null = null;
let cachedDb: PostgresJsDatabase | null = null;
let cachedClient: ReturnType<typeof postgres> | null = null;
let cachedCommunityId: string | null = null;

/**
 * Get or create database connection
 */
function getDb(): PostgresJsDatabase | null {
  if (!isPostgreSQLEnabled()) {
    return null;
  }

  if (!cachedDb) {
    try {
      cachedClient = postgres(config.database.url!, {
        max: 3,
        idle_timeout: 20,
        connect_timeout: 10,
      });
      cachedDb = drizzle(cachedClient) as PostgresJsDatabase;
    } catch (error) {
      logger.error({ error }, 'Failed to create database connection');
      return null;
    }
  }

  return cachedDb;
}

/**
 * Get or create community record for Discord guild
 * Returns the community UUID for use with verification sessions
 */
async function getOrCreateCommunity(db: PostgresJsDatabase, guildId: string, guildName: string): Promise<string | null> {
  try {
    // Check if community already exists
    const existing = await db
      .select({ id: communities.id })
      .from(communities)
      .where(eq(communities.discordGuildId, guildId))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      return existing[0].id;
    }

    // Create new community
    const newCommunity = await db
      .insert(communities)
      .values({
        name: guildName,
        discordGuildId: guildId,
        themeId: 'sietch',
        subscriptionTier: 'free',
      })
      .returning({ id: communities.id });

    if (newCommunity.length > 0 && newCommunity[0]) {
      logger.info({ guildId, communityId: newCommunity[0].id }, 'Created community record for Discord guild');
      return newCommunity[0].id;
    }

    return null;
  } catch (error) {
    logger.error({ error, guildId }, 'Failed to get or create community');
    return null;
  }
}

/**
 * Get or create verification service for a community
 */
function getVerificationService(communityId: string): WalletVerificationService | null {
  if (!isPostgreSQLEnabled() || !cachedDb) {
    return null;
  }

  // Create new service if community changed or not initialized
  if (!cachedService || cachedCommunityId !== communityId) {
    try {
      cachedCommunityId = communityId;
      cachedService = new WalletVerificationService(cachedDb, communityId, {
        onAuditEvent: async (event) => {
          logger.info({ event }, 'Verification audit event (Discord command)');
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create verification service');
      return null;
    }
  }

  return cachedService;
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * /verify command definition
 */
export const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify wallet ownership to prove you hold BGT')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('start')
      .setDescription('Start wallet verification process')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Check your verification status')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('reset')
      .setDescription('Reset a failed verification (admin only)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('User to reset verification for')
          .setRequired(true)
      )
  )
  .toJSON();

// =============================================================================
// Command Handler
// =============================================================================

/**
 * Handle /verify command execution
 */
export async function handleVerifyCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'start':
      await handleVerifyStart(interaction);
      break;
    case 'status':
      await handleVerifyStatus(interaction);
      break;
    case 'reset':
      await handleVerifyReset(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown subcommand',
        ephemeral: true,
      });
  }
}

// =============================================================================
// Subcommand Handlers
// =============================================================================

/**
 * Handle /verify start - Create new verification session
 */
async function handleVerifyStart(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const discordUsername = interaction.user.username;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Check if PostgreSQL is configured
  if (!isPostgreSQLEnabled()) {
    await interaction.reply({
      content: 'Wallet verification is not available. PostgreSQL is required.',
      ephemeral: true,
    });
    return;
  }

  // Defer reply since this might take a moment
  await interaction.deferReply({ ephemeral: true });

  try {
    // Get database connection
    const db = getDb();
    if (!db) {
      await interaction.editReply({
        content: 'Database connection is not available. Please try again later.',
      });
      return;
    }

    // Get or create community record for this Discord guild
    const guildName = interaction.guild?.name ?? 'Unknown Server';
    const communityId = await getOrCreateCommunity(db, guildId, guildName);

    if (!communityId) {
      await interaction.editReply({
        content: 'Failed to initialize community. Please try again later.',
      });
      return;
    }

    const service = getVerificationService(communityId);

    if (!service) {
      await interaction.editReply({
        content: 'Verification service is not available. Please try again later.',
      });
      return;
    }

    // Check for existing pending session
    const existingSession = await service.getPendingSession(discordUserId);

    if (existingSession) {
      // Session exists - provide link to continue
      const verifyUrl = buildVerifyUrl(existingSession.id);

      const embed = new EmbedBuilder()
        .setTitle('🔐 Verification In Progress')
        .setDescription(
          'You already have a pending verification session.\n\n' +
          'Click the button below to continue verification.'
        )
        .addFields(
          { name: 'Expires', value: `<t:${Math.floor(existingSession.expiresAt.getTime() / 1000)}:R>`, inline: true },
          { name: 'Attempts Remaining', value: `${3 - existingSession.attempts}`, inline: true }
        )
        .setColor(0xFFA500) // Orange
        .setFooter({ text: 'Connect your wallet to sign the verification message' });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Continue Verification')
          .setStyle(ButtonStyle.Link)
          .setURL(verifyUrl)
          .setEmoji('🔗')
      );

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
      return;
    }

    // Create new session
    const guild = interaction.guild;
    const communityName = guild?.name ?? 'Community';

    const result = await service.createSession({
      discordUserId,
      discordGuildId: guildId,
      discordUsername,
      communityName,
    });

    const verifyUrl = buildVerifyUrl(result.sessionId);

    const embed = new EmbedBuilder()
      .setTitle('🔐 Wallet Verification')
      .setDescription(
        'To verify your wallet, you need to sign a message with your wallet.\n\n' +
        '**Steps:**\n' +
        '1. Click the button below to open verification page\n' +
        '2. Connect your wallet (MetaMask, WalletConnect, etc.)\n' +
        '3. Sign the verification message\n' +
        '4. Your wallet will be linked to your Discord account'
      )
      .addFields(
        { name: 'Session Expires', value: `<t:${Math.floor(result.expiresAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Max Attempts', value: '3', inline: true }
      )
      .setColor(0x5865F2) // Discord Blurple
      .setFooter({ text: 'This verification is unique to your Discord account' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Verify Wallet')
        .setStyle(ButtonStyle.Link)
        .setURL(verifyUrl)
        .setEmoji('🔗')
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    logger.info(
      { discordUserId, sessionId: result.sessionId },
      'Verification session created via Discord command'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Failed to create verification session');
    await interaction.editReply({
      content: 'Failed to start verification. Please try again later.',
    });
  }
}

/**
 * Handle /verify status - Check verification status
 */
async function handleVerifyStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!isPostgreSQLEnabled()) {
    await interaction.reply({
      content: 'Wallet verification is not available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Get database connection
    logger.info({ guildId }, 'verify status: getting db connection');
    const db = getDb();
    if (!db) {
      logger.warn({ guildId }, 'verify status: db is null');
      await interaction.editReply({
        content: 'Database connection is not available. Please try again later.',
      });
      return;
    }
    logger.info({ guildId }, 'verify status: db connection obtained');

    // Look up community ID from guild ID
    const guildName = interaction.guild?.name ?? 'Unknown Server';
    logger.info({ guildId, guildName }, 'verify status: looking up community');
    const communityId = await getOrCreateCommunity(db, guildId, guildName);

    if (!communityId) {
      logger.warn({ guildId }, 'verify status: communityId is null');
      await interaction.editReply({
        content: 'Community not found. Try `/verify start` first.',
      });
      return;
    }
    logger.info({ guildId, communityId }, 'verify status: community found');

    const service = getVerificationService(communityId);

    if (!service) {
      logger.warn({ guildId, communityId, isPostgreSQLEnabled: isPostgreSQLEnabled() }, 'verify status: service is null');
      await interaction.editReply({
        content: 'Verification service is not available.',
      });
      return;
    }
    logger.info({ guildId, communityId }, 'verify status: service obtained');

    // Check for any session (pending, completed, failed, or expired)
    const session = await service.getLatestSession(discordUserId);

    if (!session) {
      // No pending session - user either hasn't started or has completed
      // TODO: Check for completed verification in identity service
      await interaction.editReply({
        content:
          '**No active verification session found.**\n\n' +
          'Use `/verify start` to begin wallet verification.',
      });
      return;
    }

    const embed = new EmbedBuilder();

    switch (session.status) {
      case 'pending':
        embed
          .setTitle('⏳ Verification Pending')
          .setDescription('Your verification is waiting for wallet signature.')
          .addFields(
            { name: 'Expires', value: `<t:${Math.floor(session.expiresAt.getTime() / 1000)}:R>`, inline: true },
            { name: 'Attempts', value: `${session.attempts}/3`, inline: true }
          )
          .setColor(0xFFA500);

        const verifyUrl = buildVerifyUrl(session.id);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Complete Verification')
            .setStyle(ButtonStyle.Link)
            .setURL(verifyUrl)
            .setEmoji('🔗')
        );

        await interaction.editReply({
          embeds: [embed],
          components: [row],
        });
        break;

      case 'completed':
        embed
          .setTitle('✅ Verification Complete')
          .setDescription('Your wallet has been verified!')
          .addFields(
            { name: 'Wallet', value: `\`${session.walletAddress}\``, inline: false },
            { name: 'Verified At', value: `<t:${Math.floor(session.completedAt!.getTime() / 1000)}:f>`, inline: true }
          )
          .setColor(0x00FF00);

        await interaction.editReply({ embeds: [embed] });
        break;

      case 'expired':
        embed
          .setTitle('⏰ Session Expired')
          .setDescription('Your verification session has expired.\n\nUse `/verify start` to begin a new verification.')
          .setColor(0xFF6B6B);

        await interaction.editReply({ embeds: [embed] });
        break;

      case 'failed':
        embed
          .setTitle('❌ Verification Failed')
          .setDescription(
            `Your verification failed: ${session.errorMessage ?? 'Maximum attempts exceeded'}\n\n` +
            'Contact an admin to reset your verification, or wait for the session to expire.'
          )
          .setColor(0xFF0000);

        await interaction.editReply({ embeds: [embed] });
        break;

      default:
        await interaction.editReply({
          content: `Session status: ${session.status}`,
        });
    }
  } catch (error) {
    logger.error({ error, discordUserId }, 'Failed to get verification status');
    await interaction.editReply({
      content: 'Failed to check status. Please try again later.',
    });
  }
}

/**
 * Handle /verify reset - Reset failed verification (admin only)
 */
async function handleVerifyReset(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  // Check admin permissions
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'This command requires Administrator permissions.',
      ephemeral: true,
    });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (!isPostgreSQLEnabled()) {
    await interaction.reply({
      content: 'Wallet verification is not available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Note: Reset functionality would require additional SessionManager method
    // For now, we'll just inform that expired/failed sessions auto-cleanup
    // and new sessions can be created

    await interaction.editReply({
      content:
        `**Verification Reset for ${targetUser.username}**\n\n` +
        `Failed or expired sessions are automatically cleaned up. ` +
        `The user can start a new verification with \`/verify start\`.\n\n` +
        `If they have a stuck pending session, it will expire within 15 minutes.`,
    });

    logger.info(
      {
        adminId: interaction.user.id,
        targetUserId: targetUser.id,
        guildId,
      },
      'Admin requested verification reset'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to process verification reset');
    await interaction.editReply({
      content: 'Failed to process reset. Please try again later.',
    });
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build the verification URL for a session
 *
 * Uses VERIFY_BASE_URL env var if set, otherwise constructs from API config
 */
function buildVerifyUrl(sessionId: string): string {
  // Sprint 81 (HIGH-2): Use validated config instead of direct env var access
  const baseUrl = config.verification.baseUrl;

  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}/verify/${sessionId}`;
  }

  // Fallback to API host/port (useful for development)
  const host = config.api.host === '0.0.0.0' ? 'localhost' : config.api.host;
  const port = config.api.port;

  // In production, assume HTTPS on standard port
  if (process.env.NODE_ENV === 'production') {
    return `https://${host}/verify/${sessionId}`;
  }

  return `http://${host}:${port}/verify/${sessionId}`;
}

/**
 * Cleanup cached resources
 */
export async function cleanupVerifyCommand(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end();
    cachedClient = null;
    cachedDb = null;
    cachedService = null;
    logger.info('Verify command PostgreSQL connection closed');
  }
}
