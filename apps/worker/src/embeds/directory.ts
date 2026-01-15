/**
 * Directory Embed Builder
 *
 * Creates Discord embeds for the member directory browser.
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { DirectoryResult, DirectoryMember } from '../data/index.js';

/**
 * Tier emojis
 */
const TIER_EMOJI: Record<string, string> = {
  naib: '👑',
  fedaykin: '⚔️',
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
 * Build directory list embed
 */
export function buildDirectoryEmbed(
  result: DirectoryResult,
  title: string = 'Member Directory'
): DiscordEmbed {
  if (result.members.length === 0) {
    return createEmbed({
      title: `📖 ${title}`,
      description: 'No members found matching the filters.',
      color: Colors.AQUA,
      timestamp: true,
    });
  }

  // Build member lines
  const memberLines = result.members.map((member, index) => {
    const displayIndex = (result.page - 1) * result.pageSize + index + 1;
    const tierEmoji = TIER_EMOJI[member.tier ?? ''] ?? '';
    const tenureEmoji = TENURE_EMOJI[member.tenureCategory] ?? '🌱';
    const badgeDisplay = member.badgeCount > 0 ? ` (${member.badgeCount} badges)` : '';

    return `${displayIndex}. ${tierEmoji} **${member.nym}** ${tenureEmoji}${badgeDisplay}`;
  });

  return createEmbed({
    title: `📖 ${title}`,
    description: memberLines.join('\n'),
    color: Colors.AQUA,
    footer: `Page ${result.page}/${result.totalPages} • ${result.total} total members`,
    timestamp: true,
  });
}

/**
 * Build member preview embed (for selection)
 */
export function buildMemberPreviewEmbed(member: DirectoryMember): DiscordEmbed {
  const tierEmoji = TIER_EMOJI[member.tier ?? ''] ?? '';
  const tenureEmoji = TENURE_EMOJI[member.tenureCategory] ?? '🌱';
  const tierColor = member.tier === 'naib' ? Colors.GOLD : Colors.BLUE;

  const tenureLabel = member.tenureCategory.charAt(0).toUpperCase() + member.tenureCategory.slice(1);

  const memberSince = member.joinedAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return createEmbed({
    title: `${tierEmoji} ${member.nym}`,
    color: tierColor,
    fields: [
      {
        name: 'Tier',
        value: member.tier === 'naib' ? '👑 Naib (Top 7)' : '⚔️ Fedaykin',
        inline: true,
      },
      {
        name: 'Tenure',
        value: `${tenureEmoji} ${tenureLabel}`,
        inline: true,
      },
      {
        name: 'Badges',
        value: `${member.badgeCount} earned`,
        inline: true,
      },
    ],
    footer: `Member since ${memberSince}`,
  });
}

/**
 * Component custom IDs for directory interactions
 */
export const DIRECTORY_INTERACTIONS = {
  prevPage: 'directory_prev',
  nextPage: 'directory_next',
  refresh: 'directory_refresh',
  tierFilter: 'directory_tier',
  sortBy: 'directory_sort',
} as const;

/**
 * Build directory action row components as plain objects
 * These get serialized and sent via REST API
 */
export interface DirectoryFiltersState {
  page: number;
  pageSize: number;
  tier?: 'naib' | 'fedaykin';
  sortBy: 'nym' | 'tenure' | 'badgeCount';
  sortDir: 'asc' | 'desc';
}

/**
 * Build directory components for REST API
 * Returns plain objects compatible with Discord REST API
 */
export function buildDirectoryComponents(
  filters: DirectoryFiltersState,
  currentPage: number,
  totalPages: number
): object[] {
  const rows = [];

  // Row 1: Tier filter dropdown
  rows.push({
    type: 1, // ACTION_ROW
    components: [
      {
        type: 3, // STRING_SELECT
        custom_id: DIRECTORY_INTERACTIONS.tierFilter,
        placeholder: 'Filter by tier',
        options: [
          {
            label: 'All Tiers',
            value: 'all',
            emoji: { name: '👥' },
            default: !filters.tier,
          },
          {
            label: 'Naib (Top 7)',
            value: 'naib',
            emoji: { name: '👑' },
            default: filters.tier === 'naib',
          },
          {
            label: 'Fedaykin',
            value: 'fedaykin',
            emoji: { name: '⚔️' },
            default: filters.tier === 'fedaykin',
          },
        ],
      },
    ],
  });

  // Row 2: Sort dropdown
  rows.push({
    type: 1, // ACTION_ROW
    components: [
      {
        type: 3, // STRING_SELECT
        custom_id: DIRECTORY_INTERACTIONS.sortBy,
        placeholder: 'Sort by',
        options: [
          {
            label: 'Name (A-Z)',
            value: 'nym',
            emoji: { name: '🔤' },
            default: filters.sortBy === 'nym',
          },
          {
            label: 'Tenure (Oldest first)',
            value: 'tenure',
            emoji: { name: '📅' },
            default: filters.sortBy === 'tenure',
          },
          {
            label: 'Badge Count',
            value: 'badgeCount',
            emoji: { name: '🏅' },
            default: filters.sortBy === 'badgeCount',
          },
        ],
      },
    ],
  });

  // Row 3: Pagination buttons
  rows.push({
    type: 1, // ACTION_ROW
    components: [
      {
        type: 2, // BUTTON
        style: 2, // SECONDARY
        custom_id: DIRECTORY_INTERACTIONS.prevPage,
        label: 'Previous',
        emoji: { name: '◀️' },
        disabled: currentPage <= 1,
      },
      {
        type: 2, // BUTTON
        style: 2, // SECONDARY
        custom_id: DIRECTORY_INTERACTIONS.refresh,
        label: 'Refresh',
        emoji: { name: '🔄' },
      },
      {
        type: 2, // BUTTON
        style: 2, // SECONDARY
        custom_id: DIRECTORY_INTERACTIONS.nextPage,
        label: 'Next',
        emoji: { name: '▶️' },
        disabled: currentPage >= totalPages,
      },
    ],
  });

  return rows;
}
