/**
 * Admin Stats Embed Builder
 *
 * Creates Discord embeds for the admin statistics dashboard.
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type {
  CommunityAnalytics,
  TopActiveMember,
  RecentPromotion,
} from '../data/index.js';

/**
 * Admin stats embed data
 */
export interface AdminStatsData {
  analytics: CommunityAnalytics;
  tierDistribution: string;
  topActive: TopActiveMember[];
  recentPromotions: RecentPromotion[];
}

/**
 * Build admin stats dashboard embed
 */
export function buildAdminStatsEmbed(data: AdminStatsData): DiscordEmbed {
  const { analytics, tierDistribution, topActive, recentPromotions } = data;

  const fields = [
    {
      name: '👥 Total Members',
      value: analytics.totalMembers.toString(),
      inline: true,
    },
    {
      name: '💎 Total Conviction',
      value: analytics.totalConviction.toLocaleString('en-US', { maximumFractionDigits: 0 }),
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
    },
  ];

  // Add top active members if any
  if (topActive.length > 0) {
    const topActiveStr = topActive
      .map((member, idx) => `${idx + 1}. **${member.nym}** - ${Math.round(member.activityScore)} activity`)
      .join('\n');
    fields.push({
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
    fields.push({
      name: '⬆️ Recent Promotions',
      value: promotionsStr,
      inline: false,
    });
  }

  return createEmbed({
    title: '📊 Community Analytics Dashboard',
    color: Colors.BLUE,
    fields,
    footer: `Generated at ${analytics.generatedAt.toLocaleString()}`,
    timestamp: true,
  });
}
