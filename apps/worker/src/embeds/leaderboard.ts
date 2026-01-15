/**
 * Leaderboard Embed Builders
 *
 * Creates Discord embeds for leaderboard displays:
 * - Badge leaderboard (ranked by badge count)
 * - Tier progression leaderboard (closest to promotion)
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { BadgeLeaderboardEntry, TierProgressionEntry } from '../data/index.js';

/**
 * Tier emojis
 */
const TIER_EMOJI: Record<string, string> = {
  naib: '👑',
  fedaykin: '⚔️',
  sayyadina: '🌟',
  sietch: '🏔️',
  stillsuit: '💧',
  fremen: '🌱',
};

/**
 * Tenure category emojis
 */
const TENURE_EMOJI: Record<string, string> = {
  og: '🏛️',
  veteran: '⭐',
  elder: '🌟',
  member: '🌱',
};

/**
 * Tier display names
 */
const TIER_NAMES: Record<string, string> = {
  naib: 'Naib',
  fedaykin: 'Fedaykin',
  sayyadina: 'Sayyadina',
  sietch: 'Sietch',
  stillsuit: 'Stillsuit',
  fremen: 'Fremen',
};

/**
 * Get rank emoji based on position
 */
function getRankEmoji(rank: number): string {
  switch (rank) {
    case 1:
      return '🥇';
    case 2:
      return '🥈';
    case 3:
      return '🥉';
    default:
      return `\`#${rank.toString().padStart(2, ' ')}\``;
  }
}

/**
 * Build badge leaderboard embed
 */
export function buildBadgeLeaderboardEmbed(
  entries: BadgeLeaderboardEntry[],
  totalMembers: number,
  userRank?: number | null
): DiscordEmbed {
  if (entries.length === 0) {
    return createEmbed({
      title: '🏆 Engagement Leaderboard',
      description: 'No leaderboard data available yet.',
      color: Colors.GOLD,
      timestamp: true,
    });
  }

  // Build leaderboard lines
  const lines = entries.map((entry) => {
    const rankEmoji = getRankEmoji(entry.rank);
    const tierEmoji = TIER_EMOJI[entry.tier ?? 'fremen'] ?? '🌱';
    const tenureEmoji = TENURE_EMOJI[entry.tenureCategory] ?? '🌱';

    return `${rankEmoji} ${tierEmoji} **${entry.nym}** ${tenureEmoji} — ${entry.badgeCount} badges`;
  });

  const fields = [];

  // Add user's position if not in top list
  if (userRank !== null && userRank !== undefined && userRank > entries.length) {
    fields.push({
      name: 'Your Position',
      value: `You are ranked **#${userRank}** of ${totalMembers} members`,
      inline: false,
    });
  }

  return createEmbed({
    title: '🏆 Engagement Leaderboard',
    description: lines.join('\n'),
    color: Colors.GOLD,
    fields,
    footer: `Rankings based on badge count • ${totalMembers} total members`,
    timestamp: true,
  });
}

/**
 * Build tier progression leaderboard embed
 */
export function buildTierProgressionEmbed(
  entries: TierProgressionEntry[],
  userEntry?: TierProgressionEntry | null
): DiscordEmbed {
  if (entries.length === 0) {
    return createEmbed({
      title: '🏆 Tier Progression Leaderboard',
      description:
        'No tier progression data available.\n' +
        'Tier leaderboard excludes Fedaykin and Naib (rank-based tiers).',
      color: Colors.GOLD,
      timestamp: true,
    });
  }

  // Build leaderboard entries
  const lines = entries.map((entry) => {
    const rankEmoji = getRankEmoji(entry.rank);
    const currentTierName = TIER_NAMES[entry.currentTier] ?? entry.currentTier;
    const nextTierName = TIER_NAMES[entry.nextTier] ?? entry.nextTier;

    return (
      `${rankEmoji} **${entry.nym}**\n` +
      `   ${currentTierName} → ${nextTierName} (${entry.distanceToNextTier} BGT away)`
    );
  });

  const fields = [
    {
      name: 'Top Progressors',
      value: lines.join('\n\n'),
      inline: false,
    },
  ];

  // Show user's position if they're not in the top list
  if (userEntry && !entries.find((e) => e.profileId === userEntry.profileId)) {
    const currentTierName = TIER_NAMES[userEntry.currentTier] ?? userEntry.currentTier;
    const nextTierName = TIER_NAMES[userEntry.nextTier] ?? userEntry.nextTier;

    fields.push({
      name: 'Your Position',
      value:
        `**Rank ${userEntry.rank}**\n` +
        `${currentTierName} → ${nextTierName} (${userEntry.distanceToNextTier} BGT away)`,
      inline: false,
    });
  }

  return createEmbed({
    title: '🏆 Tier Progression Leaderboard',
    description: 'Members closest to their next tier promotion',
    color: Colors.GOLD,
    fields,
    footer: 'Excludes Fedaykin and Naib (rank-based tiers) • BGT values rounded for privacy',
    timestamp: true,
  });
}
