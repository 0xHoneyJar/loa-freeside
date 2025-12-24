/**
 * /stats Slash Command (Enhanced for Sprint 19)
 *
 * View your personal activity statistics including:
 * - Tier and progression
 * - Activity this week and streaks
 * - Badges earned
 * - Member tenure
 *
 * This is private - only you can see your stats.
 *
 * Usage:
 * - /stats - View your comprehensive activity stats (ephemeral)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getMemberProfileByDiscordId } from '../../db/queries.js';
import { statsService } from '../../services/index.js';
import { buildPersonalStatsEmbed } from '../embeds/stats.js';

/**
 * Slash command definition
 */
export const statsCommand = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View your personal activity statistics (private)');

/**
 * Handle /stats command execution
 */
export async function handleStatsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    // Get user's profile
    const profile = getMemberProfileByDiscordId(discordUserId);

    if (!profile) {
      await interaction.reply({
        content:
          'You haven\'t completed onboarding yet. ' +
          'Please complete the onboarding process first to view your stats.',
        ephemeral: true,
      });
      return;
    }

    if (!profile.onboardingComplete) {
      await interaction.reply({
        content:
          'Please complete your onboarding first to access your stats. ' +
          'Check your DMs for the onboarding wizard.',
        ephemeral: true,
      });
      return;
    }

    // Get comprehensive personal stats
    const stats = statsService.getPersonalStats(discordUserId);

    if (!stats) {
      await interaction.reply({
        content: 'Unable to fetch your stats. Please try again later.',
        ephemeral: true,
      });
      return;
    }

    // Build and send embed
    const embed = buildPersonalStatsEmbed(stats, profile.pfpUrl);

    await interaction.reply({
      embeds: [embed],
      ephemeral: true, // Private - only visible to the user
    });

    logger.debug({ discordUserId, memberId: profile.memberId }, 'Stats viewed');
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /stats command');

    await interaction.reply({
      content: 'An error occurred while fetching your stats. Please try again.',
      ephemeral: true,
    });
  }
}
