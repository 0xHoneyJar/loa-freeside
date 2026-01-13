/**
 * /naib Slash Command
 *
 * Displays the Naib Council (top 7 BGT holders with seats).
 *
 * Subcommands:
 * - /naib - Shows council overview
 * - /naib current - Shows current Naib members in detail
 * - /naib former - Shows former Naib members (honor roll)
 *
 * Privacy notes:
 * - Does NOT expose wallet addresses
 * - Does NOT expose Discord IDs
 * - Only shows nyms, ranks, and tenure
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { naibService } from '../../services/naib.js';
import { getMemberProfileByDiscordId } from '../../db/index.js';
import {
  buildNaibOverviewEmbed,
  buildNaibCouncilEmbed,
  buildFormerNaibEmbed,
} from '../embeds/naib.js';

/**
 * Slash command definition
 */
export const naibCommand = new SlashCommandBuilder()
  .setName('naib')
  .setDescription('View the Naib Council (top 7 BGT holders)')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('overview')
      .setDescription('Show Naib Council overview')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('current')
      .setDescription('Show current Naib members in detail')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('former')
      .setDescription('Show former Naib members (honor roll)')
  );

/**
 * Handle /naib command execution
 */
export async function handleNaibCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const subcommand = interaction.options.getSubcommand(false) || 'overview';

  try {
    // Check if user has completed onboarding
    const profile = getMemberProfileByDiscordId(discordUserId);
    if (!profile || !profile.onboardingComplete) {
      await interaction.reply({
        content:
          'You need to complete onboarding first to view the Naib Council. ' +
          'Check your DMs for the onboarding wizard.',
        ephemeral: true,
      });
      return;
    }

    // Get Naib data
    const currentNaib = naibService.getPublicCurrentNaib();
    const formerNaib = naibService.getFormerNaib();
    const emptySeats = naibService.getAvailableSeatCount();

    let embed;

    switch (subcommand) {
      case 'current':
        embed = buildNaibCouncilEmbed(currentNaib, emptySeats);
        break;

      case 'former':
        embed = buildFormerNaibEmbed(formerNaib);
        break;

      case 'overview':
      default:
        embed = buildNaibOverviewEmbed(currentNaib, formerNaib, emptySeats);
        break;
    }

    // Send as public message (Naib council is public information)
    await interaction.reply({
      embeds: [embed],
      ephemeral: false,
    });
  } catch (error) {
    logger.error({ error, discordUserId, subcommand }, 'Error handling /naib command');

    const errorMessage = 'An error occurred while loading Naib Council data. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
