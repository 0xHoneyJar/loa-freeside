/**
 * /admin-stats Slash Command
 *
 * Admin command to view community analytics dashboard (Sprint 21).
 *
 * Usage:
 * - /admin-stats - Display comprehensive community analytics
 */

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { analyticsService } from '../../services/AnalyticsService.js';

/**
 * Slash command definition
 */
export const adminStatsCommand = new SlashCommandBuilder()
  .setName('admin-stats')
  .setDescription('Admin: View community analytics dashboard')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Handle /admin-stats command execution
 */
export async function handleAdminStatsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const adminDiscordId = interaction.user.id;

  logger.info({ adminDiscordId }, 'Admin stats command invoked');

  // Defer reply since analytics may take a moment
  await interaction.deferReply({ ephemeral: true });

  try {
    // Collect analytics
    const analytics = analyticsService.getCommunityAnalytics();
    const tierDistribution = analyticsService.getTierDistributionSummary();
    const topActive = analyticsService.getTopActiveMembers(5);
    const recentPromotions = analyticsService.getRecentPromotions(5);

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle('📊 Sietch Community Analytics')
      .setColor(0x3498db)
      .setTimestamp(analytics.generatedAt)
      .addFields(
        {
          name: '👥 Total Members',
          value: analytics.totalMembers.toString(),
          inline: true,
        },
        {
          name: '💎 Total BGT',
          value: `${analytics.totalBgt.toLocaleString('en-US', { maximumFractionDigits: 0 })} BGT`,
          inline: true,
        },
        {
          name: '📈 Weekly Active',
          value: analytics.weeklyActive.toString(),
          inline: true,
        },
        {
          name: '🆕 New This Week',
          value: analytics.newThisWeek.toString(),
          inline: true,
        },
        {
          name: '⬆️ Promotions This Week',
          value: analytics.promotionsThisWeek.toString(),
          inline: true,
        },
        {
          name: '🏅 Badges This Week',
          value: analytics.badgesAwardedThisWeek.toString(),
          inline: true,
        },
        {
          name: '📊 Tier Distribution',
          value: tierDistribution || 'No members assigned to tiers',
          inline: false,
        }
      );

    // Add top active members if any
    if (topActive.length > 0) {
      const topActiveStr = topActive
        .map(
          (member, idx) =>
            `${idx + 1}. **${member.nym}** - ${Math.round(member.activityBalance)} activity`
        )
        .join('\n');
      embed.addFields({
        name: '🔥 Most Active (Past 7 Days)',
        value: topActiveStr,
        inline: false,
      });
    }

    // Add recent promotions if any
    if (recentPromotions.length > 0) {
      const promotionsStr = recentPromotions
        .map((promo) => {
          const fromTierName = promo.fromTier.charAt(0).toUpperCase() + promo.fromTier.slice(1);
          const toTierName = promo.toTier.charAt(0).toUpperCase() + promo.toTier.slice(1);
          const daysAgo = Math.floor(
            (Date.now() - promo.changedAt.getTime()) / (1000 * 60 * 60 * 24)
          );
          const timeStr = daysAgo === 0 ? 'Today' : `${daysAgo}d ago`;
          return `**${promo.nym}**: ${fromTierName} → ${toTierName} (${timeStr})`;
        })
        .join('\n');
      embed.addFields({
        name: '⬆️ Recent Promotions',
        value: promotionsStr,
        inline: false,
      });
    }

    embed.setFooter({
      text: 'Sietch v3.0 Analytics',
    });

    await interaction.editReply({
      embeds: [embed],
    });

    logger.info({ adminDiscordId }, 'Admin stats displayed successfully');
  } catch (error) {
    logger.error({ error, adminDiscordId }, 'Failed to generate admin stats');

    await interaction.editReply({
      content: '❌ Failed to generate analytics. Please check logs.',
    });
  }
}
