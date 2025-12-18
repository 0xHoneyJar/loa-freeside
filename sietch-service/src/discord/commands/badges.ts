/**
 * /badges Slash Command
 *
 * View your badges or another member's badges.
 *
 * Usage:
 * - /badges - View your own badges (ephemeral)
 * - /badges [nym] - View another member's badges (public)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  getMemberProfileByDiscordId,
  getMemberProfileByNym,
  getMemberBadges,
  searchMembersByNym,
} from '../../db/queries.js';
import {
  buildOwnBadgesEmbed,
  buildPublicBadgesEmbed,
} from '../embeds/badge.js';

/**
 * Slash command definition
 */
export const badgesCommand = new SlashCommandBuilder()
  .setName('badges')
  .setDescription('View badges earned by you or another member')
  .addStringOption((option) =>
    option
      .setName('nym')
      .setDescription('Member nym to view (leave empty for your own badges)')
      .setRequired(false)
      .setAutocomplete(true)
  );

/**
 * Handle /badges command execution
 */
export async function handleBadgesCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const targetNym = interaction.options.getString('nym');
  const discordUserId = interaction.user.id;

  try {
    // Check if viewing own badges or someone else's
    if (!targetNym) {
      // View own badges (ephemeral)
      await handleOwnBadges(interaction, discordUserId);
    } else {
      // View another member's badges (public)
      await handlePublicBadges(interaction, targetNym);
    }
  } catch (error) {
    logger.error({ error, discordUserId, targetNym }, 'Error handling /badges command');

    const errorMessage = 'An error occurred while fetching badges. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle viewing own badges
 */
async function handleOwnBadges(
  interaction: ChatInputCommandInteraction,
  discordUserId: string
): Promise<void> {
  // Get user's profile
  const profile = getMemberProfileByDiscordId(discordUserId);

  if (!profile) {
    await interaction.reply({
      content:
        'You haven\'t completed onboarding yet. ' +
        'Please complete the onboarding process first to view your badges.',
      ephemeral: true,
    });
    return;
  }

  if (!profile.onboardingComplete) {
    await interaction.reply({
      content:
        'Please complete your onboarding first to access badges. ' +
        'Check your DMs for the onboarding wizard.',
      ephemeral: true,
    });
    return;
  }

  // Get badges
  const badges = getMemberBadges(profile.memberId);

  // Build and send embed
  const embed = buildOwnBadgesEmbed(profile.nym, badges, profile.pfpUrl);

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Handle viewing another member's badges (public)
 */
async function handlePublicBadges(
  interaction: ChatInputCommandInteraction,
  targetNym: string
): Promise<void> {
  // Find the target member
  const targetProfile = getMemberProfileByNym(targetNym);

  if (!targetProfile) {
    await interaction.reply({
      content: `No member found with the nym "${targetNym}".`,
      ephemeral: true,
    });
    return;
  }

  if (!targetProfile.onboardingComplete) {
    await interaction.reply({
      content: 'This member hasn\'t completed onboarding yet.',
      ephemeral: true,
    });
    return;
  }

  // Get badges
  const badges = getMemberBadges(targetProfile.memberId);

  // Build and send embed (public)
  const embed = buildPublicBadgesEmbed(
    targetProfile.nym,
    badges,
    targetProfile.tier,
    targetProfile.pfpUrl
  );

  await interaction.reply({
    embeds: [embed],
    ephemeral: false, // Public view
  });
}

/**
 * Handle autocomplete for nym parameter
 */
export async function handleBadgesAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedValue = interaction.options.getFocused();

  try {
    // Search for members by nym
    const results = searchMembersByNym(focusedValue, 25);

    // Format autocomplete choices
    const choices = results.map((profile) => ({
      name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
      value: profile.nym,
    }));

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ error }, 'Error handling badges autocomplete');
    await interaction.respond([]);
  }
}
