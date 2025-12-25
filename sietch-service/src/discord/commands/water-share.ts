/**
 * /water-share Slash Command (v3.0 - Sprint 17)
 *
 * Water Sharer badge sharing command.
 *
 * Usage:
 * - /water-share @user - Share your Water Sharer badge with the mentioned member
 * - /water-share status - View your Water Sharer badge status
 *
 * Key Concepts:
 * - Water Sharer badge holders can share their badge with ONE other existing member
 * - Recipients must already be onboarded members
 * - All responses are ephemeral (only visible to the caller)
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  userMention,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getMemberProfileByDiscordId, getMemberProfileByNym, searchMembersByNym } from '../../db/queries.js';
import {
  canShare,
  shareBadge,
  getShareStatusByDiscordId,
  WATER_SHARER_ERRORS,
} from '../../services/WaterSharerService.js';

/**
 * Slash command definition
 */
export const waterShareCommand = new SlashCommandBuilder()
  .setName('water-share')
  .setDescription('Share your Water Sharer badge with another member')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('share')
      .setDescription('Share your badge with another member')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription('The member to share your badge with')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('View your Water Sharer badge status')
  );

/**
 * Handle /water-share command execution
 */
export async function handleWaterShareCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const callerDiscordId = interaction.user.id;

  try {
    switch (subcommand) {
      case 'share':
        await handleShare(interaction, callerDiscordId);
        break;
      case 'status':
        await handleStatus(interaction, callerDiscordId);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, subcommand, callerDiscordId }, 'Error handling /water-share command');

    const errorMessage = 'An error occurred. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle share subcommand
 */
async function handleShare(
  interaction: ChatInputCommandInteraction,
  callerDiscordId: string
): Promise<void> {
  const targetUser = interaction.options.getUser('member', true);

  // Get caller's member profile
  const callerProfile = getMemberProfileByDiscordId(callerDiscordId);
  if (!callerProfile) {
    await interaction.reply({
      content: '❌ You must complete onboarding before sharing your badge. Use `/register` to get started.',
      ephemeral: true,
    });
    return;
  }

  // Check if caller can share
  const canShareResult = canShare(callerProfile.memberId);
  if (!canShareResult.canShare) {
    await interaction.reply({
      content: `❌ ${canShareResult.reason}`,
      ephemeral: true,
    });
    return;
  }

  // Get recipient's member profile
  const recipientProfile = getMemberProfileByDiscordId(targetUser.id);
  if (!recipientProfile) {
    await interaction.reply({
      content: `❌ ${userMention(targetUser.id)} has not completed onboarding yet. They must be an existing member of the Sietch.`,
      ephemeral: true,
    });
    return;
  }

  // Cannot share to self
  if (callerProfile.memberId === recipientProfile.memberId) {
    await interaction.reply({
      content: '❌ You cannot share the badge with yourself.',
      ephemeral: true,
    });
    return;
  }

  // Attempt to share the badge
  const result = shareBadge(callerProfile.memberId, recipientProfile.memberId);

  if (!result.success) {
    // Map errors to user-friendly messages
    let errorMessage = result.errorMessage || 'Failed to share badge.';

    switch (result.error) {
      case WATER_SHARER_ERRORS.GRANTER_NO_BADGE:
        errorMessage = 'You do not have the Water Sharer badge.';
        break;
      case WATER_SHARER_ERRORS.GRANTER_ALREADY_SHARED:
        errorMessage = 'You have already shared your badge with someone. Each Water Sharer can only share once.';
        break;
      case WATER_SHARER_ERRORS.RECIPIENT_NOT_ONBOARDED:
        errorMessage = `${userMention(targetUser.id)} has not completed onboarding yet.`;
        break;
      case WATER_SHARER_ERRORS.RECIPIENT_ALREADY_HAS_BADGE:
        errorMessage = `${userMention(targetUser.id)} already has the Water Sharer badge.`;
        break;
      case WATER_SHARER_ERRORS.RECIPIENT_ALREADY_RECEIVED:
        errorMessage = `${userMention(targetUser.id)} has already received this badge from someone else.`;
        break;
    }

    await interaction.reply({
      content: `❌ ${errorMessage}`,
      ephemeral: true,
    });
    return;
  }

  // Success!
  const embed = new EmbedBuilder()
    .setColor(0x3498DB) // Water blue
    .setTitle('💧 Water Sharer Badge Shared!')
    .setDescription(
      `You have shared your **Water Sharer** badge with **${recipientProfile.nym}**!\n\n` +
      `They now have access to The Oasis and can share the badge with one other member.`
    )
    .addFields(
      { name: 'Recipient', value: `${recipientProfile.nym}`, inline: true },
      { name: 'Your Status', value: 'Badge shared (cannot share again)', inline: true }
    )
    .setFooter({ text: 'The water of life flows through the Sietch' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });

  logger.info(
    { granterDiscordId: callerDiscordId, recipientDiscordId: targetUser.id, granterNym: callerProfile.nym, recipientNym: recipientProfile.nym },
    'Water Sharer badge shared via /water-share command'
  );
}

/**
 * Handle status subcommand
 */
async function handleStatus(
  interaction: ChatInputCommandInteraction,
  callerDiscordId: string
): Promise<void> {
  const status = getShareStatusByDiscordId(callerDiscordId);

  if (!status) {
    await interaction.reply({
      content: '❌ You must complete onboarding to check your Water Sharer status. Use `/register` to get started.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(status.hasBadge ? 0x3498DB : 0x95A5A6) // Water blue if has badge, grey if not
    .setTitle('💧 Water Sharer Status');

  if (!status.hasBadge) {
    embed.setDescription(
      'You do not have the Water Sharer badge.\n\n' +
      'This badge is awarded by admins or shared by other Water Sharers.'
    );
  } else {
    let description = 'You have the **Water Sharer** badge!\n\n';

    if (status.canShare) {
      description += '✅ **You can share your badge** with one other member.\n' +
                    'Use `/water-share share @member` to share it.';
    } else if (status.sharedWith) {
      description += `You have already shared your badge with **${status.sharedWith.nym}**.`;
    }

    if (status.receivedFrom) {
      description += `\n\n_Badge received from **${status.receivedFrom.nym}**_`;
    }

    embed.setDescription(description);

    // Add fields
    const fields: { name: string; value: string; inline: boolean }[] = [];

    fields.push({
      name: 'Can Share',
      value: status.canShare ? '✅ Yes' : '❌ No',
      inline: true,
    });

    if (status.sharedWith) {
      fields.push({
        name: 'Shared With',
        value: status.sharedWith.nym,
        inline: true,
      });
    }

    if (status.receivedFrom) {
      fields.push({
        name: 'Received From',
        value: status.receivedFrom.nym,
        inline: true,
      });
    }

    embed.addFields(fields);
  }

  embed.setFooter({ text: 'The water of life flows through the Sietch' });
  embed.setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}
