/**
 * /threshold Slash Command
 *
 * Displays the current entry threshold for joining the Sietch.
 * Shows BGT requirement (position 69) and top waitlist positions.
 *
 * Public visibility - anyone can see entry requirements.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { thresholdService } from '../../services/threshold.js';
import { buildThresholdEmbed } from '../embeds/threshold.js';

/**
 * Slash command definition
 */
export const thresholdCommand = new SlashCommandBuilder()
  .setName('threshold')
  .setDescription('View the entry requirements for joining the Sietch');

/**
 * Handle /threshold command execution
 */
export async function handleThresholdCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    // Get threshold data
    const data = thresholdService.getThresholdData();
    const topWaitlist = thresholdService.getTopWaitlistPositions(5);

    // Build embed
    const embed = buildThresholdEmbed(data, topWaitlist);

    // Send as public message (threshold is public information)
    await interaction.reply({
      embeds: [embed],
      ephemeral: false,
    });

    logger.debug({ discordUserId }, 'Served /threshold command');
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /threshold command');

    const errorMessage = 'An error occurred while loading threshold data. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
