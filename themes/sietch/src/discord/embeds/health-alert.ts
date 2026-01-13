/**
 * Health Alert Embed Builder - Sprint 64
 *
 * Creates Discord embeds for incumbent health alerts with action buttons.
 *
 * @module discord/embeds/health-alert
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { HealthAlert } from '../../packages/adapters/coexistence/IncumbentHealthMonitor.js';

// =============================================================================
// Constants
// =============================================================================

/** Color for warning alerts (amber) */
const COLOR_WARNING = 0xf59e0b;

/** Color for critical alerts (red) */
const COLOR_CRITICAL = 0xef4444;

/** Color for info messages (blue) */
const COLOR_INFO = 0x3b82f6;

/** Color for success messages (green) */
const COLOR_SUCCESS = 0x22c55e;

// =============================================================================
// Embed Builders
// =============================================================================

/**
 * Create health alert embed with action buttons
 *
 * @param alert - Health alert data
 * @returns Embed and action row components
 */
export function createHealthAlertEmbed(alert: HealthAlert): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const color = alert.severity === 'critical' ? COLOR_CRITICAL : COLOR_WARNING;

  const embed = new EmbedBuilder()
    .setTitle(alert.title)
    .setColor(color)
    .setDescription(alert.description)
    .addFields(
      {
        name: 'Provider',
        value: formatProviderName(alert.provider),
        inline: true,
      },
      {
        name: 'Severity',
        value: alert.severity === 'critical' ? '🔴 Critical' : '🟠 Warning',
        inline: true,
      }
    )
    .setTimestamp();

  // Add failed checks as a field
  if (alert.failedChecks.length > 0) {
    embed.addFields({
      name: 'Failed Checks',
      value: alert.failedChecks.map((check) => `• ${check}`).join('\n'),
      inline: false,
    });
  }

  // Add recommended action
  embed.addFields({
    name: 'Recommended Action',
    value: alert.recommendedAction,
    inline: false,
  });

  // Build action row with buttons
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  if (alert.includeBackupButton) {
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`health_activate_backup_${alert.communityId}`)
        .setLabel('Activate Arrakis Backup')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛡️')
    );
  }

  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`health_view_details_${alert.communityId}`)
      .setLabel('View Details')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📊')
  );

  actionRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`health_dismiss_${alert.communityId}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️')
  );

  components.push(actionRow);

  return { embed, components };
}

/**
 * Create backup activation confirmation embed
 *
 * @param communityId - Community UUID
 * @param guildName - Guild name for display
 */
export function createBackupConfirmationEmbed(
  communityId: string,
  guildName: string
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirm Backup Activation')
    .setColor(COLOR_WARNING)
    .setDescription(
      `You are about to activate **Arrakis as a backup** for **${guildName}**.\n\n` +
      'This will:\n' +
      '• Transition from **Shadow Mode** to **Parallel Mode**\n' +
      '• Create Arrakis namespaced roles alongside incumbent roles\n' +
      '• Begin assigning members to Arrakis roles based on their on-chain status\n\n' +
      '**This action can be reversed** by rolling back to shadow mode if needed.'
    )
    .addFields({
      name: 'Current Status',
      value: 'Shadow Mode (observation only)',
      inline: true,
    }, {
      name: 'New Status',
      value: 'Parallel Mode (active backup)',
      inline: true,
    })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`health_confirm_backup_${communityId}`)
        .setLabel('Confirm Activation')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`health_cancel_backup_${communityId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌')
    );

  return { embed, components: [actionRow] };
}

/**
 * Create backup activation success embed
 */
export function createBackupSuccessEmbed(guildName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('✅ Backup Activated Successfully')
    .setColor(COLOR_SUCCESS)
    .setDescription(
      `**${guildName}** is now in **Parallel Mode**.\n\n` +
      'Arrakis is now actively managing roles alongside the incumbent bot. ' +
      'Members will be assigned to Arrakis namespaced roles based on their on-chain holdings.\n\n' +
      'You can rollback to shadow mode at any time using `/arrakis-rollback`.'
    )
    .setTimestamp();
}

/**
 * Create backup activation failure embed
 */
export function createBackupFailureEmbed(error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('❌ Backup Activation Failed')
    .setColor(COLOR_CRITICAL)
    .setDescription(
      'Failed to activate Arrakis backup mode.\n\n' +
      `**Error:** ${error}\n\n` +
      'Please try again or contact support if the issue persists.'
    )
    .setTimestamp();
}

/**
 * Create health status summary embed
 *
 * @param stats - Health check statistics
 */
export function createHealthSummaryEmbed(stats: {
  totalCommunities: number;
  healthy: number;
  degraded: number;
  offline: number;
  lastCheckAt: Date;
}): EmbedBuilder {
  const getStatusEmoji = (healthy: number, total: number): string => {
    const ratio = healthy / total;
    if (ratio >= 0.95) return '🟢';
    if (ratio >= 0.8) return '🟡';
    return '🔴';
  };

  const statusEmoji = stats.totalCommunities > 0
    ? getStatusEmoji(stats.healthy, stats.totalCommunities)
    : '⚪';

  return new EmbedBuilder()
    .setTitle(`${statusEmoji} Incumbent Health Overview`)
    .setColor(COLOR_INFO)
    .setDescription('Summary of incumbent bot health across all monitored communities.')
    .addFields(
      {
        name: '🟢 Healthy',
        value: stats.healthy.toString(),
        inline: true,
      },
      {
        name: '🟠 Degraded',
        value: stats.degraded.toString(),
        inline: true,
      },
      {
        name: '🔴 Offline',
        value: stats.offline.toString(),
        inline: true,
      },
      {
        name: 'Total Monitored',
        value: stats.totalCommunities.toString(),
        inline: true,
      },
      {
        name: 'Last Check',
        value: `<t:${Math.floor(stats.lastCheckAt.getTime() / 1000)}:R>`,
        inline: true,
      }
    )
    .setTimestamp();
}

/**
 * Create detailed health report embed for a single community
 */
export function createHealthReportEmbed(report: {
  guildName: string;
  provider: string;
  overallStatus: string;
  botOnline: { passed: boolean; message: string };
  roleUpdate: { passed: boolean; message: string };
  channelActivity: { passed: boolean; message: string };
  checkedAt: Date;
}): EmbedBuilder {
  const statusColor =
    report.overallStatus === 'healthy' ? COLOR_SUCCESS
    : report.overallStatus === 'degraded' ? COLOR_WARNING
    : COLOR_CRITICAL;

  const statusEmoji =
    report.overallStatus === 'healthy' ? '🟢'
    : report.overallStatus === 'degraded' ? '🟠'
    : '🔴';

  return new EmbedBuilder()
    .setTitle(`${statusEmoji} Health Report: ${report.guildName}`)
    .setColor(statusColor)
    .setDescription(`Health check for **${formatProviderName(report.provider)}** incumbent bot.`)
    .addFields(
      {
        name: 'Overall Status',
        value: capitalizeFirst(report.overallStatus),
        inline: true,
      },
      {
        name: 'Provider',
        value: formatProviderName(report.provider),
        inline: true,
      },
      {
        name: '🤖 Bot Online',
        value: `${report.botOnline.passed ? '✅' : '❌'} ${report.botOnline.message}`,
        inline: false,
      },
      {
        name: '📋 Role Updates',
        value: `${report.roleUpdate.passed ? '✅' : '❌'} ${report.roleUpdate.message}`,
        inline: false,
      },
      {
        name: '💬 Channel Activity',
        value: `${report.channelActivity.passed ? '✅' : '❌'} ${report.channelActivity.message}`,
        inline: false,
      }
    )
    .setFooter({ text: 'Last checked' })
    .setTimestamp(report.checkedAt);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format provider name for display
 */
function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    collabland: 'Collab.Land',
    matrica: 'Matrica',
    'guild.xyz': 'Guild.xyz',
    other: 'Other',
  };
  return names[provider] ?? capitalizeFirst(provider);
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
