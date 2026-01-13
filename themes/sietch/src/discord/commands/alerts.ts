/**
 * /alerts Slash Command
 *
 * Manages notification preferences for the user.
 * Shows current settings and provides toggles for each alert type.
 *
 * Ephemeral visibility - only the user can see their settings.
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getMemberProfileByDiscordId } from '../../db/index.js';
import { notificationService } from '../../services/notification.js';
import { naibService } from '../../services/naib.js';
import type { AlertFrequency } from '../../types/index.js';

/**
 * Frequency display names
 */
const FREQUENCY_LABELS: Record<AlertFrequency, string> = {
  '1_per_week': '1x per week',
  '2_per_week': '2x per week',
  '3_per_week': '3x per week',
  'daily': 'Daily',
};

/**
 * Slash command definition
 */
export const alertsCommand = new SlashCommandBuilder()
  .setName('alerts')
  .setDescription('Manage your notification preferences');

/**
 * Handle /alerts command execution
 */
export async function handleAlertsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;

  try {
    // Get member profile
    const member = getMemberProfileByDiscordId(discordUserId);

    if (!member) {
      await interaction.reply({
        content: '❌ You are not a member of the Sietch. Use `/onboard` to begin the onboarding process.',
        ephemeral: true,
      });
      return;
    }

    // Get current preferences
    const prefs = notificationService.getPreferences(member.memberId);
    const isNaib = naibService.isCurrentNaib(member.memberId);
    const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle('🔔 Alert Preferences')
      .setColor(0x4169e1)
      .setDescription(
        'Configure which notifications you receive and how often.\n' +
        'Toggle settings below to customize your experience.'
      )
      .setTimestamp();

    // Current settings
    const statusEmoji = (enabled: boolean) => enabled ? '✅' : '❌';

    embed.addFields({
      name: '📊 Position Updates',
      value: `${statusEmoji(prefs.positionUpdates)} ${prefs.positionUpdates ? 'Enabled' : 'Disabled'}\n` +
        `Regular updates about your ranking position`,
      inline: true,
    });

    embed.addFields({
      name: '⚠️ At-Risk Warnings',
      value: `${statusEmoji(prefs.atRiskWarnings)} ${prefs.atRiskWarnings ? 'Enabled' : 'Disabled'}\n` +
        `Alerts when you're in the bottom 10%`,
      inline: true,
    });

    if (isNaib) {
      embed.addFields({
        name: '👑 Naib Alerts',
        value: `${statusEmoji(prefs.naibAlerts)} ${prefs.naibAlerts ? 'Enabled' : 'Disabled'}\n` +
          `Seat threat and status notifications`,
        inline: true,
      });
    }

    embed.addFields({
      name: '📅 Frequency',
      value: `**${FREQUENCY_LABELS[prefs.frequency]}**\n` +
        `${prefs.alertsSentThisWeek}/${maxAlerts} alerts sent this week`,
      inline: false,
    });

    // Build toggle buttons
    const toggleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`alerts_toggle_position_${member.memberId}`)
        .setLabel(prefs.positionUpdates ? 'Disable Position' : 'Enable Position')
        .setStyle(prefs.positionUpdates ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('📊'),
      new ButtonBuilder()
        .setCustomId(`alerts_toggle_atrisk_${member.memberId}`)
        .setLabel(prefs.atRiskWarnings ? 'Disable At-Risk' : 'Enable At-Risk')
        .setStyle(prefs.atRiskWarnings ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('⚠️')
    );

    // Add Naib toggle for Naib members
    if (isNaib) {
      toggleRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`alerts_toggle_naib_${member.memberId}`)
          .setLabel(prefs.naibAlerts ? 'Disable Naib' : 'Enable Naib')
          .setStyle(prefs.naibAlerts ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setEmoji('👑')
      );
    }

    // Build frequency select menu
    const frequencyRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`alerts_frequency_${member.memberId}`)
        .setPlaceholder('Change alert frequency')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('1x per week')
            .setDescription('Receive at most 1 position update per week')
            .setValue('1_per_week')
            .setDefault(prefs.frequency === '1_per_week'),
          new StringSelectMenuOptionBuilder()
            .setLabel('2x per week')
            .setDescription('Receive at most 2 position updates per week')
            .setValue('2_per_week')
            .setDefault(prefs.frequency === '2_per_week'),
          new StringSelectMenuOptionBuilder()
            .setLabel('3x per week')
            .setDescription('Receive at most 3 position updates per week')
            .setValue('3_per_week')
            .setDefault(prefs.frequency === '3_per_week'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Daily')
            .setDescription('Receive position updates every day')
            .setValue('daily')
            .setDefault(prefs.frequency === 'daily')
        )
    );

    // Build disable all button
    const disableRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`alerts_disable_all_${member.memberId}`)
        .setLabel('Disable All Alerts')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔕')
    );

    embed.setFooter({
      text: 'Changes take effect immediately • Critical alerts (bumps, new seats) are always sent',
    });

    // Send response
    await interaction.reply({
      embeds: [embed],
      components: [toggleRow, frequencyRow, disableRow],
      ephemeral: true,
    });

    logger.debug(
      { discordUserId, memberId: member.memberId },
      'Served /alerts command'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling /alerts command');

    const errorMessage = 'An error occurred while loading your preferences. Please try again.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
