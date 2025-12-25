/**
 * /admin-badge Slash Command
 *
 * Admin command to award or revoke badges.
 *
 * Usage:
 * - /admin-badge award [nym] [badge] [reason] - Award a badge to a member
 * - /admin-badge revoke [nym] [badge] - Revoke a badge from a member
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
  getMemberProfileByNym,
  getMemberBadges,
  searchMembersByNym,
  getAllBadges,
} from '../../db/queries.js';
import {
  adminAwardBadge,
  revokeBadge,
  getAllBadgeDefinitions,
  BADGE_IDS,
} from '../../services/badge.js';
import { buildBadgeAwardEmbed } from '../embeds/badge.js';
import { notificationService } from '../../services/notification.js';

/**
 * Slash command definition
 */
export const adminBadgeCommand = new SlashCommandBuilder()
  .setName('admin-badge')
  .setDescription('Admin: Award or revoke badges')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('award')
      .setDescription('Award a badge to a member')
      .addStringOption((option) =>
        option
          .setName('nym')
          .setDescription('Member nym to award badge to')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('badge')
          .setDescription('Badge to award')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Reason for awarding the badge')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('revoke')
      .setDescription('Revoke a badge from a member')
      .addStringOption((option) =>
        option
          .setName('nym')
          .setDescription('Member nym to revoke badge from')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName('badge')
          .setDescription('Badge to revoke')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/**
 * Handle /admin-badge command execution
 */
export async function handleAdminBadgeCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const adminDiscordId = interaction.user.id;

  try {
    switch (subcommand) {
      case 'award':
        await handleAwardBadge(interaction, adminDiscordId);
        break;
      case 'revoke':
        await handleRevokeBadge(interaction, adminDiscordId);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, subcommand, adminDiscordId }, 'Error handling /admin-badge command');

    const errorMessage = 'An error occurred. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle award subcommand
 */
async function handleAwardBadge(
  interaction: ChatInputCommandInteraction,
  adminDiscordId: string
): Promise<void> {
  const nym = interaction.options.getString('nym', true);
  const badgeId = interaction.options.getString('badge', true);
  const reason = interaction.options.getString('reason', true);

  // Find the target member
  const profile = getMemberProfileByNym(nym);

  if (!profile) {
    await interaction.reply({
      content: `No member found with the nym "${nym}".`,
      ephemeral: true,
    });
    return;
  }

  // Find the badge
  const badges = getAllBadgeDefinitions();
  const badge = badges.find((b) => b.badgeId === badgeId);

  if (!badge) {
    await interaction.reply({
      content: `Badge "${badgeId}" not found.`,
      ephemeral: true,
    });
    return;
  }

  // Award the badge
  const result = adminAwardBadge(profile.memberId, badgeId, adminDiscordId, reason);

  if (!result) {
    await interaction.reply({
      content:
        `Could not award "${badge.name}" to ${nym}. ` +
        'They may already have this badge, or only contribution/special badges can be manually awarded.',
      ephemeral: true,
    });
    return;
  }

  // Success response
  await interaction.reply({
    content: `✅ Awarded **${badge.name}** badge to **${nym}**.\n*Reason: ${reason}*`,
    ephemeral: true,
  });

  logger.info(
    { adminDiscordId, memberId: profile.memberId, badgeId, reason },
    'Admin awarded badge'
  );

  // Send DM notification to the member (Sprint 18)
  try {
    const isWaterSharer = badgeId === BADGE_IDS.waterSharer;

    await notificationService.sendBadgeAward(profile.memberId, {
      badgeId,
      badgeName: badge.name,
      badgeDescription: badge.description || 'A special recognition badge.',
      badgeEmoji: badge.emoji ?? null,
      awardReason: reason,
      isWaterSharer,
    });

    logger.debug(
      { memberId: profile.memberId, badgeId },
      'Badge award DM sent'
    );
  } catch (dmError) {
    // DM failures are non-critical, just log
    logger.warn(
      { error: dmError, memberId: profile.memberId, badgeId },
      'Failed to send badge award DM'
    );
  }
}

/**
 * Handle revoke subcommand
 */
async function handleRevokeBadge(
  interaction: ChatInputCommandInteraction,
  adminDiscordId: string
): Promise<void> {
  const nym = interaction.options.getString('nym', true);
  const badgeId = interaction.options.getString('badge', true);

  // Find the target member
  const profile = getMemberProfileByNym(nym);

  if (!profile) {
    await interaction.reply({
      content: `No member found with the nym "${nym}".`,
      ephemeral: true,
    });
    return;
  }

  // Find the badge
  const badges = getAllBadgeDefinitions();
  const badge = badges.find((b) => b.badgeId === badgeId);

  if (!badge) {
    await interaction.reply({
      content: `Badge "${badgeId}" not found.`,
      ephemeral: true,
    });
    return;
  }

  // Revoke the badge
  const success = revokeBadge(profile.memberId, badgeId, adminDiscordId);

  if (!success) {
    await interaction.reply({
      content: `Could not revoke "${badge.name}" from ${nym}. They may not have this badge.`,
      ephemeral: true,
    });
    return;
  }

  // Success response
  await interaction.reply({
    content: `✅ Revoked **${badge.name}** badge from **${nym}**.`,
    ephemeral: true,
  });

  logger.info(
    { adminDiscordId, memberId: profile.memberId, badgeId },
    'Admin revoked badge'
  );
}

/**
 * Handle autocomplete for nym and badge parameters
 */
export async function handleAdminBadgeAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);
  const subcommand = interaction.options.getSubcommand();

  try {
    if (focusedOption.name === 'nym') {
      // Search for members by nym
      const results = searchMembersByNym(focusedOption.value, 25);

      const choices = results.map((profile) => ({
        name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
        value: profile.nym,
      }));

      await interaction.respond(choices);
    } else if (focusedOption.name === 'badge') {
      // For award: show contribution/special badges only
      // For revoke: show all badges (or filter by what member has)
      let badges = getAllBadgeDefinitions();

      if (subcommand === 'award') {
        // Only show badges that can be manually awarded
        badges = badges.filter(
          (b) => b.category === 'contribution' || b.category === 'special'
        );
      } else if (subcommand === 'revoke') {
        // For revoke, try to show badges the member has
        const nym = interaction.options.getString('nym');
        if (nym) {
          const profile = getMemberProfileByNym(nym);
          if (profile) {
            const memberBadges = getMemberBadges(profile.memberId);
            const memberBadgeIds = new Set(memberBadges.map((b) => b.badgeId));
            badges = badges.filter((b) => memberBadgeIds.has(b.badgeId));
          }
        }
      }

      // Filter by search
      const query = focusedOption.value.toLowerCase();
      const filtered = badges.filter(
        (b) =>
          b.name.toLowerCase().includes(query) ||
          b.badgeId.toLowerCase().includes(query)
      );

      const choices = filtered.slice(0, 25).map((badge) => ({
        name: `${badge.emoji ?? '🏆'} ${badge.name} (${badge.category})`,
        value: badge.badgeId,
      }));

      await interaction.respond(choices);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error({ error }, 'Error handling admin-badge autocomplete');
    await interaction.respond([]);
  }
}
