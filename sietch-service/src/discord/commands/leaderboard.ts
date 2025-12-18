/**
 * /leaderboard Slash Command
 *
 * Shows the engagement leaderboard (top members by badge count).
 *
 * Usage:
 * - /leaderboard - Shows top 20 members (public)
 *
 * Privacy notes:
 * - Does NOT show activity stats
 * - Does NOT expose wallet information
 * - Only shows badge count and tenure
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { leaderboardService } from '../../services/leaderboard.js';
import { directoryService } from '../../services/directory.js';
import { getMemberProfileByDiscordId } from '../../db/queries.js';
import { buildLeaderboardEmbed } from '../embeds/directory.js';

/**
 * Default number of entries to show
 */
const DEFAULT_LEADERBOARD_SIZE = 20;

/**
 * Slash command definition
 */
export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the engagement leaderboard (ranked by badge count)');

/**
 * Handle /leaderboard command execution
 */
export async function handleLeaderboardCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

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

    // Get leaderboard data
    const entries = leaderboardService.getLeaderboard(DEFAULT_LEADERBOARD_SIZE);

    // Get stats for context
    const stats = directoryService.getStats();

    // Build embed
    const embed = buildLeaderboardEmbed(entries);

    // Add member count context
    embed.setFooter({
      text: `Rankings based on badge count • ${stats.total} total members`,
    });

    // Get user's own rank if they're on the leaderboard
    const userRank = leaderboardService.getMemberRank(profile.memberId);
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
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /leaderboard command');

    const errorMessage = 'An error occurred while loading the leaderboard. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
