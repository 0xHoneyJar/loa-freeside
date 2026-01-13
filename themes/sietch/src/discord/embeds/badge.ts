/**
 * Badge Embed Builders
 *
 * Discord embed templates for badge display
 */

import { EmbedBuilder } from 'discord.js';
import type { Badge, MemberActivity } from '../../types/index.js';

// Sietch brand colors
const SIETCH_GOLD = 0xd4af37;
const SIETCH_BLUE = 0x4169e1;
const SIETCH_GREEN = 0x2e8b57;
const SIETCH_PURPLE = 0x9932cc;

// Category colors
const CATEGORY_COLORS = {
  tenure: SIETCH_GOLD,
  engagement: SIETCH_GREEN,
  contribution: SIETCH_BLUE,
  special: SIETCH_PURPLE,
} as const;

// Category emojis (fallback when badge doesn't have one)
const CATEGORY_EMOJIS = {
  tenure: '🏆',
  engagement: '⚡',
  contribution: '🤝',
  special: '✨',
} as const;

/**
 * Extended badge info with award date
 */
interface BadgeWithAward extends Badge {
  awardedAt: Date;
  awardedBy?: string | null;
  awardReason?: string | null;
}

/**
 * Build embed for viewing own badges
 */
export function buildOwnBadgesEmbed(
  nym: string,
  badges: BadgeWithAward[],
  pfpUrl?: string | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${nym}'s Badges`)
    .setColor(SIETCH_GOLD)
    .setTimestamp();

  if (pfpUrl) {
    embed.setThumbnail(pfpUrl);
  }

  if (badges.length === 0) {
    embed.setDescription(
      'You haven\'t earned any badges yet.\n\n' +
        '**How to earn badges:**\n' +
        '• Stay active in the community\n' +
        '• Participate in discussions\n' +
        '• Help other members\n' +
        '• Be part of special events'
    );
    return embed;
  }

  // Group badges by category
  const grouped = groupBadgesByCategory(badges);

  // Build fields for each category
  for (const [category, categoryBadges] of Object.entries(grouped)) {
    if (categoryBadges.length === 0) continue;

    const categoryTitle = formatCategoryTitle(category as Badge['category']);
    const categoryEmoji = CATEGORY_EMOJIS[category as Badge['category']];

    const badgeLines = categoryBadges.map((badge) => {
      const emoji = badge.emoji ?? categoryEmoji;
      const awarded = formatDate(badge.awardedAt);
      return `${emoji} **${badge.name}** - ${badge.description}\n*Earned: ${awarded}*`;
    });

    embed.addFields({
      name: `${categoryEmoji} ${categoryTitle}`,
      value: badgeLines.join('\n\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: `Total: ${badges.length} badge${badges.length !== 1 ? 's' : ''} • Sietch`,
  });

  return embed;
}

/**
 * Build embed for viewing another member's badges (public view)
 */
export function buildPublicBadgesEmbed(
  nym: string,
  badges: BadgeWithAward[],
  tier: 'naib' | 'fedaykin',
  pfpUrl?: string | null
): EmbedBuilder {
  const tierEmoji = tier === 'naib' ? '👑' : '⚔️';
  const tierColor = tier === 'naib' ? SIETCH_GOLD : SIETCH_BLUE;

  const embed = new EmbedBuilder()
    .setTitle(`${tierEmoji} ${nym}'s Badges`)
    .setColor(tierColor)
    .setTimestamp();

  if (pfpUrl) {
    embed.setThumbnail(pfpUrl);
  }

  if (badges.length === 0) {
    embed.setDescription('This member hasn\'t earned any badges yet.');
    return embed;
  }

  // Compact view for public - just list badges with emojis
  const badgeList = badges.map((badge) => {
    const emoji = badge.emoji ?? CATEGORY_EMOJIS[badge.category];
    return `${emoji} ${badge.name}`;
  });

  // Split into columns if many badges
  const midpoint = Math.ceil(badgeList.length / 2);
  const leftColumn = badgeList.slice(0, midpoint).join('\n');
  const rightColumn = badgeList.slice(midpoint).join('\n');

  if (badges.length <= 5) {
    embed.setDescription(badgeList.join('\n'));
  } else {
    embed.addFields(
      { name: '\u200b', value: leftColumn, inline: true },
      { name: '\u200b', value: rightColumn || '\u200b', inline: true }
    );
  }

  embed.setFooter({
    text: `${badges.length} badge${badges.length !== 1 ? 's' : ''} • Sietch`,
  });

  return embed;
}

/**
 * Build embed for badge award notification (DM)
 */
export function buildBadgeAwardEmbed(
  badge: Badge,
  reason?: string
): EmbedBuilder {
  const emoji = badge.emoji ?? CATEGORY_EMOJIS[badge.category];
  const color = CATEGORY_COLORS[badge.category];

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} New Badge Earned!`)
    .setDescription(
      `Congratulations! You've earned the **${badge.name}** badge!\n\n` +
        `*${badge.description}*`
    )
    .setColor(color)
    .setTimestamp();

  if (reason) {
    embed.addFields({
      name: 'Reason',
      value: reason,
      inline: false,
    });
  }

  embed.addFields({
    name: 'Category',
    value: formatCategoryTitle(badge.category),
    inline: true,
  });

  embed.setFooter({
    text: 'Use /badges to view all your badges • Sietch',
  });

  return embed;
}

/**
 * Build embed for badge list (all available badges)
 */
export function buildAllBadgesEmbed(badges: Badge[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🏆 Available Badges')
    .setDescription('Earn badges by being active and contributing to the Sietch community.')
    .setColor(SIETCH_GOLD)
    .setTimestamp();

  // Group badges by category
  const grouped: Record<Badge['category'], Badge[]> = {
    tenure: [],
    engagement: [],
    contribution: [],
    special: [],
  };

  for (const badge of badges) {
    grouped[badge.category].push(badge);
  }

  // Build fields for each category
  for (const [category, categoryBadges] of Object.entries(grouped)) {
    if (categoryBadges.length === 0) continue;

    const categoryTitle = formatCategoryTitle(category as Badge['category']);
    const categoryEmoji = CATEGORY_EMOJIS[category as Badge['category']];

    const badgeLines = categoryBadges.map((badge) => {
      const emoji = badge.emoji ?? categoryEmoji;
      return `${emoji} **${badge.name}** - ${badge.description}`;
    });

    embed.addFields({
      name: `${categoryEmoji} ${categoryTitle}`,
      value: badgeLines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: `${badges.length} badges available • Sietch`,
  });

  return embed;
}

/**
 * Build embed for activity stats (own stats only)
 */
export function buildStatsEmbed(
  nym: string,
  activity: MemberActivity,
  badgeCount: number,
  pfpUrl?: string | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${nym}'s Activity Stats`)
    .setColor(SIETCH_GREEN)
    .setTimestamp();

  if (pfpUrl) {
    embed.setThumbnail(pfpUrl);
  }

  // Current activity balance
  embed.addFields({
    name: '⚡ Activity Balance',
    value: `**${activity.activityBalance.toFixed(1)}** points\n*Peak: ${activity.peakBalance.toFixed(1)}*`,
    inline: true,
  });

  // Badge count
  embed.addFields({
    name: '🏆 Badges',
    value: `**${badgeCount}** earned`,
    inline: true,
  });

  // Lifetime stats
  embed.addFields({
    name: '💬 Messages',
    value: activity.totalMessages.toLocaleString(),
    inline: true,
  });

  embed.addFields({
    name: '👍 Reactions Given',
    value: activity.totalReactionsGiven.toLocaleString(),
    inline: true,
  });

  embed.addFields({
    name: '❤️ Reactions Received',
    value: activity.totalReactionsReceived.toLocaleString(),
    inline: true,
  });

  // Last active
  if (activity.lastActiveAt) {
    embed.addFields({
      name: '🕐 Last Active',
      value: formatRelativeTime(activity.lastActiveAt),
      inline: true,
    });
  }

  embed.setFooter({
    text: 'Activity balance decays 10% every 6 hours • Your stats are private',
  });

  return embed;
}

// =============================================================================
// Helper Functions
// =============================================================================

function groupBadgesByCategory(
  badges: BadgeWithAward[]
): Record<Badge['category'], BadgeWithAward[]> {
  const grouped: Record<Badge['category'], BadgeWithAward[]> = {
    tenure: [],
    engagement: [],
    contribution: [],
    special: [],
  };

  for (const badge of badges) {
    grouped[badge.category].push(badge);
  }

  return grouped;
}

function formatCategoryTitle(category: Badge['category']): string {
  const titles = {
    tenure: 'Tenure Badges',
    engagement: 'Engagement Badges',
    contribution: 'Contribution Badges',
    special: 'Special Badges',
  };
  return titles[category];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  return formatDate(date);
}
