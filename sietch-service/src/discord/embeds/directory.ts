/**
 * Directory and Leaderboard Embed Builders
 *
 * Creates Discord embeds for member directory and leaderboard displays.
 * All displayed data is privacy-filtered.
 */

import { EmbedBuilder, type ColorResolvable } from 'discord.js';
import type {
  PublicProfile,
  LeaderboardEntry,
  DirectoryResult,
  Badge,
} from '../../types/index.js';

/**
 * Colors for embeds
 */
const COLORS = {
  directory: 0x2b7a78 as ColorResolvable, // Teal
  leaderboard: 0xf4a261 as ColorResolvable, // Gold/amber
  naib: 0xffd700 as ColorResolvable, // Gold for Naib
  fedaykin: 0x4169e1 as ColorResolvable, // Royal blue for Fedaykin
};

/**
 * Tier emojis
 */
const TIER_EMOJI = {
  naib: '👑',
  fedaykin: '⚔️',
};

/**
 * Tenure category emojis
 */
const TENURE_EMOJI = {
  og: '🏛️',
  veteran: '⭐',
  elder: '🌟',
  member: '🌱',
};

/**
 * Build directory list embed (paginated)
 */
export function buildDirectoryEmbed(
  result: DirectoryResult,
  title: string = 'Member Directory'
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.directory)
    .setTitle(`📖 ${title}`)
    .setTimestamp();

  // Build member list
  if (result.members.length === 0) {
    embed.setDescription('No members found matching the filters.');
    return embed;
  }

  const memberLines = result.members.map((member, index) => {
    const displayIndex = (result.page - 1) * result.pageSize + index + 1;
    const tierEmoji = TIER_EMOJI[member.tier];
    const tenureEmoji = TENURE_EMOJI[member.tenureCategory];
    const badgeDisplay = member.badgeCount > 0 ? ` (${member.badgeCount} badges)` : '';

    return `${displayIndex}. ${tierEmoji} **${member.nym}** ${tenureEmoji}${badgeDisplay}`;
  });

  embed.setDescription(memberLines.join('\n'));

  // Add pagination info in footer
  embed.setFooter({
    text: `Page ${result.page}/${result.totalPages} • ${result.total} total members`,
  });

  return embed;
}

/**
 * Build directory member preview embed (for selection)
 */
export function buildMemberPreviewEmbed(member: PublicProfile): EmbedBuilder {
  const tierEmoji = TIER_EMOJI[member.tier];
  const tenureEmoji = TENURE_EMOJI[member.tenureCategory];

  const embed = new EmbedBuilder()
    .setColor(member.tier === 'naib' ? COLORS.naib : COLORS.fedaykin)
    .setTitle(`${tierEmoji} ${member.nym}`)
    .setDescription(member.bio ?? '_No bio set_');

  // Add member info
  embed.addFields(
    {
      name: 'Tier',
      value: member.tier === 'naib' ? '👑 Naib (Top 7)' : '⚔️ Fedaykin',
      inline: true,
    },
    {
      name: 'Tenure',
      value: `${tenureEmoji} ${capitalizeFirst(member.tenureCategory)}`,
      inline: true,
    },
    {
      name: 'Badges',
      value: `${member.badgeCount} earned`,
      inline: true,
    }
  );

  // Add PFP if available
  if (member.pfpUrl) {
    embed.setThumbnail(member.pfpUrl);
  }

  // Member since
  const memberSince = member.memberSince instanceof Date
    ? member.memberSince
    : new Date(member.memberSince);
  embed.setFooter({
    text: `Member since ${memberSince.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`,
  });

  return embed;
}

/**
 * Build leaderboard embed
 */
export function buildLeaderboardEmbed(
  entries: LeaderboardEntry[],
  title: string = 'Engagement Leaderboard'
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.leaderboard)
    .setTitle(`🏆 ${title}`)
    .setTimestamp();

  if (entries.length === 0) {
    embed.setDescription('No leaderboard data available yet.');
    return embed;
  }

  // Build leaderboard lines
  const lines = entries.map((entry) => {
    const rankEmoji = getRankEmoji(entry.rank);
    const tierEmoji = TIER_EMOJI[entry.tier];
    const tenureEmoji = TENURE_EMOJI[entry.tenureCategory];

    return `${rankEmoji} ${tierEmoji} **${entry.nym}** ${tenureEmoji} — ${entry.badgeCount} badges`;
  });

  embed.setDescription(lines.join('\n'));

  // Footer with info
  embed.setFooter({
    text: 'Rankings based on badge count • Ties broken by tenure',
  });

  return embed;
}

/**
 * Build leaderboard entry embed (detailed view for a specific member)
 */
export function buildLeaderboardEntryEmbed(
  entry: LeaderboardEntry,
  totalMembers: number
): EmbedBuilder {
  const tierEmoji = TIER_EMOJI[entry.tier];
  const tenureEmoji = TENURE_EMOJI[entry.tenureCategory];
  const rankEmoji = getRankEmoji(entry.rank);

  const embed = new EmbedBuilder()
    .setColor(entry.tier === 'naib' ? COLORS.naib : COLORS.fedaykin)
    .setTitle(`${rankEmoji} Rank #${entry.rank} — ${tierEmoji} ${entry.nym}`)
    .setDescription(`${tenureEmoji} ${capitalizeFirst(entry.tenureCategory)} member`);

  embed.addFields(
    {
      name: '🏅 Badges',
      value: `${entry.badgeCount} earned`,
      inline: true,
    },
    {
      name: '📊 Percentile',
      value: `Top ${((entry.rank / totalMembers) * 100).toFixed(1)}%`,
      inline: true,
    }
  );

  if (entry.pfpUrl) {
    embed.setThumbnail(entry.pfpUrl);
  }

  return embed;
}

/**
 * Build filter options embed (shows available filters)
 */
export function buildFilterOptionsEmbed(
  badges: Badge[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.directory)
    .setTitle('🔍 Directory Filters')
    .setDescription('Use the dropdowns below to filter the member directory.');

  // Tier options
  embed.addFields({
    name: 'Tier',
    value: '👑 Naib (Top 7)\n⚔️ Fedaykin',
    inline: true,
  });

  // Tenure options
  embed.addFields({
    name: 'Tenure',
    value: '🏛️ OG (First 30 days)\n⭐ Veteran (90+ days)\n🌟 Elder (180+ days)\n🌱 Member',
    inline: true,
  });

  // Badge filter note
  if (badges.length > 0) {
    embed.addFields({
      name: 'Badge Filter',
      value: `Filter by ${badges.length} available badges`,
      inline: true,
    });
  }

  return embed;
}

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
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
