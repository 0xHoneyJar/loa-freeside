/**
 * Alert Interaction Handlers
 *
 * Handles button clicks and select menu interactions for the /alerts command.
 * Updates notification preferences based on user actions.
 */

import {
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getMemberProfileByDiscordId } from '../../db/index.js';
import { notificationService } from '../../services/notification.js';
import type { AlertFrequency } from '../../types/index.js';

/**
 * Handle alert toggle button interactions
 */
export async function handleAlertToggle(
  interaction: ButtonInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const customId = interaction.customId;

  try {
    // Parse the custom ID: alerts_toggle_{type}_{memberId}
    const parts = customId.split('_');
    if (parts.length < 4) {
      await interaction.reply({
        content: '❌ Invalid interaction.',
        ephemeral: true,
      });
      return;
    }

    const toggleType = parts[2]; // position, atrisk, naib
    const memberId = parts[3];

    // Verify user owns this preference
    const member = getMemberProfileByDiscordId(discordUserId);
    if (!member || member.memberId !== memberId) {
      await interaction.reply({
        content: '❌ You cannot modify these preferences.',
        ephemeral: true,
      });
      return;
    }

    // Get current preferences
    const prefs = notificationService.getPreferences(memberId);

    // Toggle the appropriate setting
    let updateMessage = '';
    switch (toggleType) {
      case 'position':
        notificationService.updatePreferences(memberId, {
          positionUpdates: !prefs.positionUpdates,
        });
        updateMessage = prefs.positionUpdates
          ? '📊 Position updates **disabled**'
          : '📊 Position updates **enabled**';
        break;

      case 'atrisk':
        notificationService.updatePreferences(memberId, {
          atRiskWarnings: !prefs.atRiskWarnings,
        });
        updateMessage = prefs.atRiskWarnings
          ? '⚠️ At-risk warnings **disabled**'
          : '⚠️ At-risk warnings **enabled**';
        break;

      case 'naib':
        notificationService.updatePreferences(memberId, {
          naibAlerts: !prefs.naibAlerts,
        });
        updateMessage = prefs.naibAlerts
          ? '👑 Naib alerts **disabled**'
          : '👑 Naib alerts **enabled**';
        break;

      default:
        await interaction.reply({
          content: '❌ Unknown toggle type.',
          ephemeral: true,
        });
        return;
    }

    // Update the message
    await interaction.update({
      content: `✅ ${updateMessage}\n\nUse \`/alerts\` to see your updated preferences.`,
      embeds: [],
      components: [],
    });

    logger.info(
      { discordUserId, memberId, toggleType },
      'Alert preference toggled'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling alert toggle');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle alert frequency select menu interactions
 */
export async function handleAlertFrequency(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const customId = interaction.customId;

  try {
    // Parse the custom ID: alerts_frequency_{memberId}
    const parts = customId.split('_');
    if (parts.length < 3) {
      await interaction.reply({
        content: '❌ Invalid interaction.',
        ephemeral: true,
      });
      return;
    }

    const memberId = parts[2];

    // Verify user owns this preference
    const member = getMemberProfileByDiscordId(discordUserId);
    if (!member || member.memberId !== memberId) {
      await interaction.reply({
        content: '❌ You cannot modify these preferences.',
        ephemeral: true,
      });
      return;
    }

    // Get selected frequency
    const frequency = interaction.values[0] as AlertFrequency;

    // Update preference
    notificationService.updatePreferences(memberId, { frequency });

    // Frequency labels
    const labels: Record<AlertFrequency, string> = {
      '1_per_week': '1x per week',
      '2_per_week': '2x per week',
      '3_per_week': '3x per week',
      'daily': 'Daily',
    };

    // Update the message
    await interaction.update({
      content: `✅ Alert frequency updated to **${labels[frequency]}**\n\nUse \`/alerts\` to see your updated preferences.`,
      embeds: [],
      components: [],
    });

    logger.info(
      { discordUserId, memberId, frequency },
      'Alert frequency updated'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling alert frequency');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Handle disable all alerts button
 */
export async function handleDisableAllAlerts(
  interaction: ButtonInteraction
): Promise<void> {
  const discordUserId = interaction.user.id;
  const customId = interaction.customId;

  try {
    // Parse the custom ID: alerts_disable_all_{memberId}
    const parts = customId.split('_');
    if (parts.length < 4) {
      await interaction.reply({
        content: '❌ Invalid interaction.',
        ephemeral: true,
      });
      return;
    }

    const memberId = parts[3];

    // Verify user owns this preference
    const member = getMemberProfileByDiscordId(discordUserId);
    if (!member || member.memberId !== memberId) {
      await interaction.reply({
        content: '❌ You cannot modify these preferences.',
        ephemeral: true,
      });
      return;
    }

    // Disable all alerts
    notificationService.updatePreferences(memberId, {
      positionUpdates: false,
      atRiskWarnings: false,
      naibAlerts: false,
    });

    // Build confirmation embed
    const embed = new EmbedBuilder()
      .setTitle('🔕 All Alerts Disabled')
      .setColor(0xff6b6b)
      .setDescription(
        'All optional alerts have been disabled.\n\n' +
        '**Note:** Critical notifications (Naib bump, new seat assignment, waitlist eligibility) will still be sent as they are important account updates.\n\n' +
        'Use `/alerts` to re-enable notifications at any time.'
      )
      .setTimestamp();

    await interaction.update({
      embeds: [embed],
      components: [],
    });

    logger.info(
      { discordUserId, memberId },
      'All alerts disabled'
    );
  } catch (error) {
    logger.error({ error, discordUserId }, 'Error handling disable all alerts');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: '❌ An error occurred. Please try again.',
        ephemeral: true,
      });
    }
  }
}

/**
 * Check if an interaction is an alert interaction
 */
export function isAlertInteraction(customId: string): boolean {
  return customId.startsWith('alerts_');
}

/**
 * Route alert interactions to the appropriate handler
 */
export async function handleAlertInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<boolean> {
  const customId = interaction.customId;

  if (!isAlertInteraction(customId)) {
    return false;
  }

  if (customId.startsWith('alerts_toggle_')) {
    await handleAlertToggle(interaction as ButtonInteraction);
    return true;
  }

  if (customId.startsWith('alerts_frequency_')) {
    await handleAlertFrequency(interaction as StringSelectMenuInteraction);
    return true;
  }

  if (customId.startsWith('alerts_disable_all_')) {
    await handleDisableAllAlerts(interaction as ButtonInteraction);
    return true;
  }

  return false;
}
