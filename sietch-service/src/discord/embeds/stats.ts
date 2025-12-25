/**
 * Stats Embed Builders (Sprint 19)
 *
 * Enhanced stats embeds with tier progress information
 */

import { EmbedBuilder } from 'discord.js';
import type { PersonalStats } from '../../types/index.js';
import type { TierProgressionEntry } from '../../services/StatsService.js';
import { TIER_INFO } from '../../services/TierService.js';

// Sietch brand colors
const SIETCH_GOLD = 0xd4af37;
const SIETCH_BLUE = 0x4169e1;
const SIETCH_GREEN = 0x2e8b57;

/**
 * Build enhanced personal stats embed with tier progress
 */
export function buildPersonalStatsEmbed(
  stats: PersonalStats,
  pfpUrl?: string | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${stats.nym}'s Stats`)
    .setColor(SIETCH_BLUE)
    .setTimestamp();

  if (pfpUrl) {
    embed.setThumbnail(pfpUrl);
  }

  // Tier and progression
  const tierInfo = TIER_INFO[stats.tier];
  const tierDisplayName = tierInfo.name;

  let tierProgressText = `**${tierDisplayName}**`;

  if (stats.tierProgress.nextTier) {
    const nextTierInfo = TIER_INFO[stats.tierProgress.nextTier];
    const nextTierName = nextTierInfo.name;

    if (stats.tierProgress.isRankBased) {
      // For Fedaykin -> Naib, show rank requirement
      tierProgressText += `\nNext: **${nextTierName}** (rank-based)`;
    } else if (stats.tierProgress.bgtToNextTierFormatted) {
      // For BGT-based progression, show distance
      const distanceRounded = Math.round(stats.tierProgress.bgtToNextTierFormatted);
      tierProgressText += `\nNext: **${nextTierName}** (${distanceRounded} BGT needed)`;
    }
  } else {
    tierProgressText += '\n*At maximum tier*';
  }

  embed.addFields({
    name: '🏔️ Tier',
    value: tierProgressText,
    inline: true,
  });

  // Tenure
  const tenureEmoji = {
    og: '👑',
    veteran: '⭐',
    elder: '✨',
    member: '🆕',
  }[stats.tenureCategory];

  const tenureLabel = stats.tenureCategory.charAt(0).toUpperCase() + stats.tenureCategory.slice(1);

  embed.addFields({
    name: '⏳ Tenure',
    value: `${tenureEmoji} **${tenureLabel}**\nSince ${formatDate(stats.memberSince)}`,
    inline: true,
  });

  // Badge count
  embed.addFields({
    name: '🏆 Badges',
    value: `**${stats.badgeCount}** earned`,
    inline: true,
  });

  // Activity this week
  embed.addFields({
    name: '💬 Activity This Week',
    value: `**${stats.messagesThisWeek}** messages`,
    inline: true,
  });

  // Streaks
  embed.addFields({
    name: '🔥 Current Streak',
    value: `**${stats.currentStreak}** day${stats.currentStreak !== 1 ? 's' : ''}`,
    inline: true,
  });

  embed.addFields({
    name: '🏅 Longest Streak',
    value: `**${stats.longestStreak}** day${stats.longestStreak !== 1 ? 's' : ''}`,
    inline: true,
  });

  // Top badges (show up to 3)
  if (stats.badges.length > 0) {
    const topBadges = stats.badges.slice(0, 3);
    const badgeText = topBadges
      .map((badge) => `${badge.emoji ?? '🎖️'} ${badge.name}`)
      .join('\n');

    embed.addFields({
      name: '🎖️ Recent Badges',
      value: badgeText + (stats.badges.length > 3 ? `\n*+${stats.badges.length - 3} more*` : ''),
      inline: false,
    });
  }

  embed.setFooter({
    text: 'Your stats are private • Use /badges to see all badges',
  });

  return embed;
}

/**
 * Build tier progression leaderboard embed
 */
export function buildTierLeaderboardEmbed(
  entries: TierProgressionEntry[],
  userEntry?: TierProgressionEntry | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🏆 Tier Progression Leaderboard')
    .setDescription('Members closest to their next tier promotion')
    .setColor(SIETCH_GOLD)
    .setTimestamp();

  if (entries.length === 0) {
    embed.setDescription('No progression data available.');
    return embed;
  }

  // Build leaderboard entries
  const leaderboardText = entries
    .map((entry) => {
      const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
      const currentTierName = TIER_INFO[entry.currentTier].name;
      const nextTierName = TIER_INFO[entry.nextTier].name;

      return (
        `${medal} **${entry.nym}**\n` +
        `   ${currentTierName} → ${nextTierName} (${entry.distanceToNextTier} BGT away)`
      );
    })
    .join('\n\n');

  embed.addFields({
    name: 'Top Progressors',
    value: leaderboardText,
    inline: false,
  });

  // Show user's position if they're not in the top list
  if (userEntry && !entries.find((e) => e.memberId === userEntry.memberId)) {
    const currentTierName = TIER_INFO[userEntry.currentTier].name;
    const nextTierName = TIER_INFO[userEntry.nextTier].name;

    embed.addFields({
      name: 'Your Position',
      value: (
        `**Rank ${userEntry.rank}**\n` +
        `${currentTierName} → ${nextTierName} (${userEntry.distanceToNextTier} BGT away)`
      ),
      inline: false,
    });
  }

  embed.setFooter({
    text: 'Excludes Fedaykin and Naib (rank-based tiers) • BGT values rounded for privacy',
  });

  return embed;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
}
