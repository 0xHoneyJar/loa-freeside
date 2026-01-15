/**
 * Badge Embed Builder
 *
 * Creates Discord embeds for badge display.
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { BadgeWithAward } from '../data/index.js';

/**
 * Category colors
 */
const CATEGORY_COLORS: Record<string, number> = {
  tenure: Colors.GOLD,
  engagement: Colors.GREEN,
  contribution: Colors.BLUE,
  special: Colors.PURPLE,
};

/**
 * Category emojis (fallback when badge doesn't have one)
 */
const CATEGORY_EMOJIS: Record<string, string> = {
  tenure: '🏆',
  engagement: '⚡',
  contribution: '🤝',
  special: '✨',
};

/**
 * Category titles
 */
const CATEGORY_TITLES: Record<string, string> = {
  tenure: 'Tenure Badges',
  engagement: 'Engagement Badges',
  contribution: 'Contribution Badges',
  special: 'Special Badges',
};

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group badges by category
 */
function groupBadgesByCategory(badges: BadgeWithAward[]): Record<string, BadgeWithAward[]> {
  const grouped: Record<string, BadgeWithAward[]> = {
    tenure: [],
    engagement: [],
    contribution: [],
    special: [],
  };

  for (const badge of badges) {
    const category = badge.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(badge);
  }

  return grouped;
}

/**
 * Build own badges embed (with award dates)
 */
export function buildOwnBadgesEmbed(
  nym: string,
  badges: BadgeWithAward[],
  pfpUrl?: string | null
): DiscordEmbed {
  if (badges.length === 0) {
    return createEmbed({
      title: `${nym}'s Badges`,
      description:
        "You haven't earned any badges yet.\n\n" +
        '**How to earn badges:**\n' +
        '• Stay active in the community\n' +
        '• Participate in discussions\n' +
        '• Help other members\n' +
        '• Be part of special events',
      color: Colors.GOLD,
      thumbnail: pfpUrl ?? undefined,
      timestamp: true,
    });
  }

  // Group badges by category
  const grouped = groupBadgesByCategory(badges);

  // Build fields for each category
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  for (const [category, categoryBadges] of Object.entries(grouped)) {
    if (categoryBadges.length === 0) continue;

    const categoryEmoji = CATEGORY_EMOJIS[category] ?? '🏅';
    const categoryTitle = CATEGORY_TITLES[category] ?? 'Badges';

    const badgeLines = categoryBadges.map((badge) => {
      const emoji = badge.emoji ?? categoryEmoji;
      const awarded = formatDate(badge.awardedAt);
      return `${emoji} **${badge.name}** - ${badge.description}\n*Earned: ${awarded}*`;
    });

    fields.push({
      name: `${categoryEmoji} ${categoryTitle}`,
      value: badgeLines.join('\n\n'),
      inline: false,
    });
  }

  return createEmbed({
    title: `${nym}'s Badges`,
    color: Colors.GOLD,
    thumbnail: pfpUrl ?? undefined,
    fields,
    footer: `Total: ${badges.length} badge${badges.length !== 1 ? 's' : ''} • Sietch`,
    timestamp: true,
  });
}

/**
 * Build public badges embed (compact view)
 */
export function buildPublicBadgesEmbed(
  nym: string,
  badges: BadgeWithAward[],
  tier: string | null,
  pfpUrl?: string | null
): DiscordEmbed {
  const tierEmoji = tier === 'naib' ? '👑' : '⚔️';
  const tierColor = tier === 'naib' ? Colors.GOLD : Colors.BLUE;

  if (badges.length === 0) {
    return createEmbed({
      title: `${tierEmoji} ${nym}'s Badges`,
      description: "This member hasn't earned any badges yet.",
      color: tierColor,
      thumbnail: pfpUrl ?? undefined,
      timestamp: true,
    });
  }

  // Compact view - just list badges with emojis
  const badgeList = badges.map((badge) => {
    const emoji = badge.emoji ?? CATEGORY_EMOJIS[badge.category] ?? '🏅';
    return `${emoji} ${badge.name}`;
  });

  // Show as description for few badges, fields for many
  if (badges.length <= 5) {
    return createEmbed({
      title: `${tierEmoji} ${nym}'s Badges`,
      description: badgeList.join('\n'),
      color: tierColor,
      thumbnail: pfpUrl ?? undefined,
      footer: `${badges.length} badge${badges.length !== 1 ? 's' : ''} • Sietch`,
      timestamp: true,
    });
  }

  // Split into columns for many badges
  const midpoint = Math.ceil(badgeList.length / 2);
  const leftColumn = badgeList.slice(0, midpoint).join('\n');
  const rightColumn = badgeList.slice(midpoint).join('\n');

  return createEmbed({
    title: `${tierEmoji} ${nym}'s Badges`,
    color: tierColor,
    thumbnail: pfpUrl ?? undefined,
    fields: [
      { name: '\u200b', value: leftColumn, inline: true },
      { name: '\u200b', value: rightColumn || '\u200b', inline: true },
    ],
    footer: `${badges.length} badge${badges.length !== 1 ? 's' : ''} • Sietch`,
    timestamp: true,
  });
}
