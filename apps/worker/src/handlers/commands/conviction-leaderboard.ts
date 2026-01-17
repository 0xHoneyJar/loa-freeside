/**
 * Conviction Leaderboard Command Handler - Hot-Path Version
 * Sprint S-9: Hot-Path Migration
 *
 * New handler for conviction-based leaderboard using ScyllaDB.
 * This provides a fast, scalable alternative to PostgreSQL-based leaderboards.
 *
 * The conviction leaderboard ranks members by their conviction score,
 * which is the primary metric for Fedaykin eligibility.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { HotPathService } from '../../services/HotPathService.js';
import type { TenantContextManager } from '../../services/TenantContext.js';
import { getCommunityByGuildId, getProfileByDiscordId } from '../../data/index.js';
import { createErrorEmbed, Colors, createEmbed, type DiscordEmbed } from '../../embeds/index.js';

const DEFAULT_LEADERBOARD_SIZE = 10;

/**
 * Tier emojis for display
 */
const TIER_EMOJI: Record<string, string> = {
  diamond: '💎',
  platinum: '🏆',
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
  naib: '👑',
  fedaykin: '⚔️',
};

/**
 * Get rank display
 */
function getRankDisplay(rank: number): string {
  switch (rank) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `\`#${rank.toString().padStart(2, ' ')}\``;
  }
}

/**
 * Format score for display
 */
function formatScore(score: string): string {
  const num = parseFloat(score);
  if (isNaN(num)) return score;

  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  }
  return num.toFixed(2);
}

/**
 * Build conviction leaderboard embed
 */
function buildConvictionLeaderboardEmbed(
  entries: Array<{
    rank: number;
    profileId: string;
    displayName: string;
    score: string;
    tier: string;
  }>,
  userRank: { rank: number; score: string; tier: string } | null
): DiscordEmbed {
  if (entries.length === 0) {
    return createEmbed({
      title: '📊 Conviction Leaderboard',
      description: 'No leaderboard data available yet.',
      color: Colors.GOLD,
      timestamp: true,
    });
  }

  // Build leaderboard lines
  const lines = entries.map((entry) => {
    const rankDisplay = getRankDisplay(entry.rank);
    const tierEmoji = TIER_EMOJI[entry.tier] ?? '⭐';
    const scoreDisplay = formatScore(entry.score);

    return `${rankDisplay} ${tierEmoji} **${entry.displayName}** — ${scoreDisplay} conviction`;
  });

  const fields: DiscordEmbed['fields'] = [];

  // Add user's position if not in top list
  if (userRank && userRank.rank > entries.length) {
    const tierEmoji = TIER_EMOJI[userRank.tier] ?? '⭐';
    fields.push({
      name: '📍 Your Position',
      value: `**#${userRank.rank}** ${tierEmoji} — ${formatScore(userRank.score)} conviction`,
      inline: false,
    });
  } else if (userRank) {
    fields.push({
      name: '📍 Your Position',
      value: `You are ranked **#${userRank.rank}** in the leaderboard above`,
      inline: false,
    });
  }

  return createEmbed({
    title: '📊 Conviction Leaderboard',
    description: lines.join('\n'),
    color: Colors.GOLD,
    fields: fields.length > 0 ? fields : undefined,
    footer: 'Rankings based on conviction score • Updates in real-time',
    timestamp: true,
  });
}

/**
 * Handle conviction leaderboard command using hot-path ScyllaDB
 */
export function createConvictionLeaderboardHandler(
  discord: DiscordRestService,
  hotPath: HotPathService,
  tenantManager: TenantContextManager
) {
  return async function handleConvictionLeaderboard(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    if (!interactionId || !interactionToken) {
      logger.warn('Missing interaction credentials for conviction leaderboard command');
      return 'ack';
    }

    if (!guildId) {
      logger.warn('Missing guildId for conviction leaderboard command');
      return 'ack';
    }

    const log = logger.child({ command: 'conviction-leaderboard', guildId, hotPath: true });

    try {
      // Defer reply - PUBLIC (not ephemeral)
      const deferResult = await discord.deferReply(interactionId, interactionToken, false);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer conviction leaderboard reply');
        return 'ack';
      }

      // Get community (PostgreSQL)
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured for Arrakis.')],
        });
        return 'ack';
      }

      // Create tenant context
      const ctx = await tenantManager.createContext(guildId, userId);

      // Get top entries from hot path (ScyllaDB)
      const entries = await hotPath.getTopEntries(ctx, 'conviction', DEFAULT_LEADERBOARD_SIZE);

      // Get user's rank if userId provided
      let userRank = null;
      if (userId) {
        const profile = await getProfileByDiscordId(community.id, userId);
        if (profile) {
          userRank = await hotPath.getProfileRank(ctx, profile.id, 'conviction');
        }
      }

      // Build and send embed
      const embed = buildConvictionLeaderboardEmbed(entries, userRank);
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info(
        {
          entriesCount: entries.length,
          hasUserRank: userRank !== null,
        },
        'Conviction leaderboard served (hot-path)'
      );

      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling conviction leaderboard command');

      try {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while loading the leaderboard.')],
        });
      } catch {
        // Ignore followup errors
      }

      return 'ack';
    }
  };
}
