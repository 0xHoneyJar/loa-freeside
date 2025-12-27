/**
 * /leaderboard Slash Command (Enhanced for Sprint 19)
 *
 * Shows leaderboards:
 * - /leaderboard badges - Engagement leaderboard (badge count)
 * - /leaderboard tiers - Tier progression (closest to promotion)
 *
 * Privacy notes:
 * - Does NOT show activity stats
 * - Does NOT expose exact wallet amounts
 * - BGT values rounded for privacy on tier leaderboard
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { leaderboardService, statsService } from '../../services/index.js';
import { directoryService } from '../../services/directory.js';
import { getMemberProfileByDiscordId } from '../../db/queries.js';
import { buildLeaderboardEmbed } from '../embeds/directory.js';
import { buildTierLeaderboardEmbed } from '../embeds/stats.js';

/**
 * Default number of entries to show
 */
const DEFAULT_LEADERBOARD_SIZE = 10;

/**
 * Slash command definition
 */
export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View community leaderboards')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('badges')
      .setDescription('View badge leaderboard (ranked by badge count)')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('tiers')
      .setDescription('View tier progression leaderboard (closest to promotion)')
  );

/**
 * Handle /leaderboard command execution
 */
export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand();

  try {
    // Check if user has completed onboarding
    const profile = getMemberProfileByDiscordId(discordUserId);
    if (!profile || !profile.onboardingComplete) {
      await interaction.reply({
        content:
          'You need to complete onboarding first to view the leaderboard. ' +
          'Check your DMs for the onboarding wizard.',
        ephemeral: true,
      });
      return;
    }

    // Handle subcommands
    if (subcommand === 'badges') {
      await handleBadgesLeaderboard(interaction, profile.memberId);
    } else if (subcommand === 'tiers') {
      await handleTiersLeaderboard(interaction, profile.memberId);
    } else {
      // Fallback - should not happen with proper command definition
      await interaction.reply({
        content: 'Unknown subcommand. Use /leaderboard badges or /leaderboard tiers',
        ephemeral: true,
      });
    }
  } catch (error) {
    logger.error({ error, discordUserId, subcommand }, 'Error handling /leaderboard command');

    const errorMessage = 'An error occurred while loading the leaderboard. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle /leaderboard badges subcommand
 */
async function handleBadgesLeaderboard(
  interaction: ChatInputCommandInteraction,
  memberId: string
): Promise<void> {
  // Get badge leaderboard data (cached with 60s TTL)
  const entries = await leaderboardService.getLeaderboard(DEFAULT_LEADERBOARD_SIZE);

  // Get stats for context
  const stats = directoryService.getStats();

  // Build embed
  const embed = buildLeaderboardEmbed(entries);

  // Add member count context
  embed.setFooter({
    text: `Rankings based on badge count • ${stats.total} total members`,
  });

  // Get user's own rank if they're on the leaderboard
  const userRank = leaderboardService.getMemberRank(memberId);
  if (userRank !== null) {
    const isInTop = userRank <= DEFAULT_LEADERBOARD_SIZE;
    if (!isInTop) {
      embed.addFields({
        name: 'Your Position',
        value: `You are ranked **#${userRank}** of ${stats.total} members`,
        inline: false,
      });
    }
  }

  // Send as public message (leaderboard is public)
  await interaction.reply({
    embeds: [embed],
    ephemeral: false,
  });

  logger.debug({ memberId }, 'Badge leaderboard viewed');
}

/**
 * Handle /leaderboard tiers subcommand
 */
async function handleTiersLeaderboard(
  interaction: ChatInputCommandInteraction,
  memberId: string
): Promise<void> {
  // Get tier progression leaderboard
  const entries = statsService.getTierLeaderboard(DEFAULT_LEADERBOARD_SIZE);

  if (entries.length === 0) {
    await interaction.reply({
      content:
        'No tier progression data available. ' +
        'Tier leaderboard excludes Fedaykin and Naib (rank-based tiers).',
      ephemeral: true,
    });
    return;
  }

  // Get user's own tier progression rank (if not in top 10)
  const userRank = statsService.getMemberTierProgressionRank(memberId);
  const userEntry =
    userRank !== null
      ? statsService.getTierLeaderboard(1000).find((e) => e.memberId === memberId)
      : null;

  // Build embed
  const embed = buildTierLeaderboardEmbed(entries, userEntry);

  // Send as public message (leaderboard is public)
  await interaction.reply({
    embeds: [embed],
    ephemeral: false,
  });

  logger.debug({ memberId }, 'Tier progression leaderboard viewed');
}
