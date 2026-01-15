/**
 * Stats Embed Builders
 *
 * Builds embeds for /stats command responses.
 */

import {
  type DiscordEmbed,
  Colors,
  formatDate,
  createEmbed,
} from './common.js';

/**
 * Tier display names
 */
const TIER_NAMES: Record<string, string> = {
  waiting: 'Waiting Pool',
  initiate: 'Initiate',
  acolyte: 'Acolyte',
  fedaykin: 'Fedaykin',
  naib: 'Naib',
};

/**
 * Tenure emojis
 */
const TENURE_EMOJI: Record<string, string> = {
  og: '\ud83d\udc51',      // crown
  veteran: '\u2b50',       // star
  elder: '\u2728',         // sparkles
  member: '\ud83c\udd95',  // NEW button
};

/**
 * Personal stats data structure
 */
export interface PersonalStatsData {
  nym: string;
  tier: string;
  tenureCategory: string;
  memberSince: Date;
  badgeCount: number;
  messagesThisWeek: number;
  currentStreak: number;
  longestStreak: number;
  badges: Array<{
    name: string;
    emoji?: string;
  }>;
  tierProgress: {
    nextTier: string | null;
    isRankBased: boolean;
    bgtToNextTierFormatted?: number;
  };
  pfpUrl?: string | null;
}

/**
 * Build personal stats embed
 */
export function buildPersonalStatsEmbed(stats: PersonalStatsData): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = [];

  // Tier and progression
  const tierName = TIER_NAMES[stats.tier] ?? stats.tier;
  let tierProgressText = `**${tierName}**`;

  if (stats.tierProgress.nextTier) {
    const nextTierName = TIER_NAMES[stats.tierProgress.nextTier] ?? stats.tierProgress.nextTier;

    if (stats.tierProgress.isRankBased) {
      tierProgressText += `\nNext: **${nextTierName}** (rank-based)`;
    } else if (stats.tierProgress.bgtToNextTierFormatted) {
      const distanceRounded = Math.round(stats.tierProgress.bgtToNextTierFormatted);
      tierProgressText += `\nNext: **${nextTierName}** (${distanceRounded} BGT needed)`;
    }
  } else {
    tierProgressText += '\n*At maximum tier*';
  }

  fields.push({
    name: '\ud83c\udfD4\ufe0f Tier',
    value: tierProgressText,
    inline: true,
  });

  // Tenure
  const tenureEmoji = TENURE_EMOJI[stats.tenureCategory] ?? '\ud83c\udd95';
  const tenureLabel = stats.tenureCategory.charAt(0).toUpperCase() + stats.tenureCategory.slice(1);

  fields.push({
    name: '\u23f3 Tenure',
    value: `${tenureEmoji} **${tenureLabel}**\nSince ${formatDate(stats.memberSince)}`,
    inline: true,
  });

  // Badge count
  fields.push({
    name: '\ud83c\udfc6 Badges',
    value: `**${stats.badgeCount}** earned`,
    inline: true,
  });

  // Activity this week
  fields.push({
    name: '\ud83d\udcac Activity This Week',
    value: `**${stats.messagesThisWeek}** messages`,
    inline: true,
  });

  // Streaks
  fields.push({
    name: '\ud83d\udd25 Current Streak',
    value: `**${stats.currentStreak}** day${stats.currentStreak !== 1 ? 's' : ''}`,
    inline: true,
  });

  fields.push({
    name: '\ud83c\udfc5 Longest Streak',
    value: `**${stats.longestStreak}** day${stats.longestStreak !== 1 ? 's' : ''}`,
    inline: true,
  });

  // Top badges (show up to 3)
  if (stats.badges.length > 0) {
    const topBadges = stats.badges.slice(0, 3);
    const badgeText = topBadges
      .map((badge) => `${badge.emoji ?? '\ud83c\udf96\ufe0f'} ${badge.name}`)
      .join('\n');

    fields.push({
      name: '\ud83c\udf96\ufe0f Recent Badges',
      value: badgeText + (stats.badges.length > 3 ? `\n*+${stats.badges.length - 3} more*` : ''),
      inline: false,
    });
  }

  const embed = createEmbed({
    title: `\ud83d\udcca ${stats.nym}'s Stats`,
    color: Colors.BLUE,
    fields,
    footer: 'Your stats are private \u2022 Use /badges to see all badges',
    thumbnail: stats.pfpUrl ?? undefined,
  });

  return embed;
}
