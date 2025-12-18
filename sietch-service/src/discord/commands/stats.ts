/**
 * /stats Slash Command
 *
 * View your personal activity statistics.
 * This is private - only you can see your stats.
 *
 * Usage:
 * - /stats - View your activity stats (ephemeral)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  getMemberProfileByDiscordId,
  getMemberBadgeCount,
} from '../../db/queries.js';
import { getOwnStats } from '../../services/activity.js';
import { buildStatsEmbed } from '../embeds/badge.js';

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

    // Get activity stats (applies pending decay)
    const activity = getOwnStats(discordUserId);

    if (!activity) {
      await interaction.reply({
        content: 'Unable to fetch your activity stats. Please try again later.',
        ephemeral: true,
      });
      return;
    }

    // Get badge count
    const badgeCount = getMemberBadgeCount(profile.memberId);

    // Build and send embed
    const embed = buildStatsEmbed(
      profile.nym,
      activity,
      badgeCount,
      profile.pfpUrl
    );

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
