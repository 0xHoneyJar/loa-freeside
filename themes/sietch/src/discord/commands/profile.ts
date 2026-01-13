import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { profileService } from '../../services/profile.js';
import { onboardingService } from '../../services/onboarding.js';
import { buildOwnProfileEmbed, buildPublicProfileEmbed } from '../embeds/profile.js';
import { logger } from '../../utils/logger.js';

/**
 * /profile command definition
 */
export const profileCommand = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('View or edit your Sietch profile')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('view')
      .setDescription('View a profile')
      .addStringOption((option) =>
        option
          .setName('nym')
          .setDescription('Nym of the member to view (leave empty for your own)')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('edit').setDescription('Edit your profile via DM')
  )
  .toJSON();

/**
 * Handle /profile command execution
 */
export async function handleProfileCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'view':
      await handleProfileView(interaction);
      break;
    case 'edit':
      await handleProfileEdit(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown subcommand',
        ephemeral: true,
      });
  }
}

/**
 * Handle /profile view [nym]
 */
async function handleProfileView(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const targetNym = interaction.options.getString('nym');
  const discordUserId = interaction.user.id;

  try {
    // Check if user has completed onboarding
    const userProfile = profileService.getProfileByDiscordId(discordUserId);

    if (!targetNym || targetNym.trim() === '') {
      // View own profile
      if (!userProfile) {
        // User needs to complete onboarding
        await interaction.reply({
          content:
            "You haven't completed onboarding yet. When you gain access to Sietch, you'll receive a DM to set up your profile.",
          ephemeral: true,
        });
        return;
      }

      // Get full profile with activity stats for owner
      const embed = buildOwnProfileEmbed(userProfile);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
      // View another member's profile (public)
      const targetProfile = profileService.getProfileByNym(targetNym);

      if (!targetProfile) {
        await interaction.reply({
          content: `No member found with nym "${targetNym}"`,
          ephemeral: true,
        });
        return;
      }

      const publicProfile = profileService.getPublicProfile(targetProfile.memberId);
      if (!publicProfile) {
        await interaction.reply({
          content: 'Could not load profile',
          ephemeral: true,
        });
        return;
      }

      const embed = buildPublicProfileEmbed(publicProfile);
      // Public profile view is visible to all
      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    logger.error({ error, discordUserId }, 'Failed to handle profile view');
    await interaction.reply({
      content: 'An error occurred while loading the profile. Please try again.',
      ephemeral: true,
    });
  }
}

/**
 * Handle /profile edit
 */
async function handleProfileEdit(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    const userProfile = profileService.getProfileByDiscordId(discordUserId);

    if (!userProfile) {
      await interaction.reply({
        content:
          "You haven't completed onboarding yet. When you gain access to Sietch, you'll receive a DM to set up your profile.",
        ephemeral: true,
      });
      return;
    }

    // Start edit wizard in DM
    await interaction.reply({
      content: 'Check your DMs! I\'ve sent you a message to edit your profile.',
      ephemeral: true,
    });

    try {
      await onboardingService.startEditWizard(interaction.user, userProfile);
    } catch (dmError) {
      // DMs might be disabled
      logger.warn({ error: dmError, discordUserId }, 'Could not send edit DM');
      await interaction.followUp({
        content:
          "I couldn't send you a DM. Please enable DMs from server members and try again.",
        ephemeral: true,
      });
    }
  } catch (error) {
    logger.error({ error, discordUserId }, 'Failed to handle profile edit');
    await interaction.reply({
      content: 'An error occurred. Please try again.',
      ephemeral: true,
    });
  }
}
