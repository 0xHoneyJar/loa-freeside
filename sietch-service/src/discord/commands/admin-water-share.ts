/**
 * /admin-water-share Slash Command (v3.0 - Sprint 18)
 *
 * Admin command to manage Water Sharer grants.
 *
 * Usage:
 * - /admin-water-share list - List all active grants
 * - /admin-water-share revoke [grant_id] - Revoke a grant (cascades)
 * - /admin-water-share lineage [nym] - View badge lineage for a member
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getMemberProfileByNym, searchMembersByNym } from '../../db/queries.js';
import {
  listAllActiveGrants,
  getGrantById,
  revokeGrant,
  getBadgeLineage,
} from '../../services/WaterSharerService.js';

/**
 * Slash command definition
 */
export const adminWaterShareCommand = new SlashCommandBuilder()
  .setName('admin-water-share')
  .setDescription('Admin: Manage Water Sharer grants')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List all active Water Sharer grants')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('revoke')
      .setDescription('Revoke a Water Sharer grant (cascades to downstream)')
      .addStringOption((option) =>
        option
          .setName('grant_id')
          .setDescription('The grant ID to revoke')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('lineage')
      .setDescription('View badge lineage for a member')
      .addStringOption((option) =>
        option
          .setName('nym')
          .setDescription('Member nym to check lineage for')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/**
 * Handle /admin-water-share command execution
 */
export async function handleAdminWaterShareCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const adminDiscordId = interaction.user.id;

  try {
    switch (subcommand) {
      case 'list':
        await handleListGrants(interaction);
        break;
      case 'revoke':
        await handleRevokeGrant(interaction, adminDiscordId);
        break;
      case 'lineage':
        await handleLineage(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          ephemeral: true,
        });
    }
  } catch (error) {
    logger.error({ error, subcommand, adminDiscordId }, 'Error handling /admin-water-share command');

    const errorMessage = 'An error occurred. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

/**
 * Handle list subcommand
 */
async function handleListGrants(interaction: ChatInputCommandInteraction): Promise<void> {
  const grants = listAllActiveGrants();

  if (grants.length === 0) {
    await interaction.reply({
      content: '💧 No active Water Sharer grants found.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('💧 Active Water Sharer Grants')
    .setColor(0x3498DB) // Water blue
    .setTimestamp();

  // Group by granter for cleaner display
  const grantList = grants
    .slice(0, 25) // Limit to 25 for embed field limits
    .map((g) => {
      const date = g.grant.grantedAt.toISOString().split('T')[0];
      return `**${g.granter.nym}** → **${g.recipient.nym}**\n\`${g.grant.id.slice(0, 8)}...\` (${date})`;
    })
    .join('\n\n');

  embed.setDescription(grantList);
  embed.setFooter({ text: `Total active grants: ${grants.length}` });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Handle revoke subcommand
 */
async function handleRevokeGrant(
  interaction: ChatInputCommandInteraction,
  adminDiscordId: string
): Promise<void> {
  const grantId = interaction.options.getString('grant_id', true);

  // Get grant info before revoking
  const grantInfo = getGrantById(grantId);
  if (!grantInfo) {
    await interaction.reply({
      content: `❌ Grant \`${grantId}\` not found or already revoked.`,
      ephemeral: true,
    });
    return;
  }

  // Revoke the grant (cascades)
  const revokeCount = revokeGrant(grantId, adminDiscordId);

  if (revokeCount === 0) {
    await interaction.reply({
      content: `❌ Could not revoke grant \`${grantId}\`. It may already be revoked.`,
      ephemeral: true,
    });
    return;
  }

  const cascadeNote = revokeCount > 1
    ? `\n\n⚠️ **${revokeCount - 1} downstream grant(s)** were also revoked via cascade.`
    : '';

  await interaction.reply({
    content:
      `✅ Revoked Water Sharer grant.\n\n` +
      `**Granter:** ${grantInfo.granter.nym}\n` +
      `**Recipient:** ${grantInfo.recipient.nym}\n` +
      `**Grant ID:** \`${grantId}\`${cascadeNote}`,
    ephemeral: true,
  });

  logger.info(
    { adminDiscordId, grantId, revokeCount },
    'Admin revoked Water Sharer grant'
  );
}

/**
 * Handle lineage subcommand
 */
async function handleLineage(interaction: ChatInputCommandInteraction): Promise<void> {
  const nym = interaction.options.getString('nym', true);

  const profile = getMemberProfileByNym(nym);
  if (!profile) {
    await interaction.reply({
      content: `❌ No member found with the nym "${nym}".`,
      ephemeral: true,
    });
    return;
  }

  const lineage = getBadgeLineage(profile.memberId);
  if (!lineage) {
    await interaction.reply({
      content: `❌ Could not fetch lineage for "${nym}".`,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`💧 Water Sharer Lineage: ${nym}`)
    .setColor(0x3498DB)
    .setTimestamp();

  let description = '';

  if (lineage.receivedFrom) {
    const date = lineage.receivedFrom.grantedAt.toISOString().split('T')[0];
    description += `**Received from:** ${lineage.receivedFrom.nym} (${date})\n`;
  } else {
    description += '**Received from:** _(Admin awarded or not received)_\n';
  }

  if (lineage.sharedTo) {
    const date = lineage.sharedTo.grantedAt.toISOString().split('T')[0];
    description += `**Shared to:** ${lineage.sharedTo.nym} (${date})`;
  } else {
    description += '**Shared to:** _(Not yet shared)_';
  }

  embed.setDescription(description);

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Handle autocomplete for grant_id and nym parameters
 */
export async function handleAdminWaterShareAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  try {
    if (focusedOption.name === 'grant_id') {
      const grants = listAllActiveGrants();
      const query = focusedOption.value.toLowerCase();

      const filtered = grants.filter(
        (g) =>
          g.grant.id.toLowerCase().includes(query) ||
          g.granter.nym.toLowerCase().includes(query) ||
          g.recipient.nym.toLowerCase().includes(query)
      );

      const choices = filtered.slice(0, 25).map((g) => ({
        name: `${g.granter.nym} → ${g.recipient.nym} (${g.grant.id.slice(0, 8)}...)`,
        value: g.grant.id,
      }));

      await interaction.respond(choices);
    } else if (focusedOption.name === 'nym') {
      const results = searchMembersByNym(focusedOption.value, 25);

      const choices = results.map((profile) => ({
        name: `${profile.nym} (${profile.tier === 'naib' ? '👑' : '⚔️'})`,
        value: profile.nym,
      }));

      await interaction.respond(choices);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error({ error }, 'Error handling admin-water-share autocomplete');
    await interaction.respond([]);
  }
}
