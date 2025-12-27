/**
 * Telegram Inline Query Handler (v4.1 - Sprint 33)
 *
 * Handles inline queries like @SietchBot score
 * Allows users to quickly look up their stats in any chat.
 *
 * Supported queries:
 * - "" (empty) - Shows quick stats if verified
 * - "score" - Shows conviction score
 * - "rank" - Shows current rank
 * - "leaderboard" - Shows top 5 members
 */

import type { Bot } from 'grammy';
import { InlineQueryResultBuilder } from 'grammy';
import type { BotContext } from './bot.js';
import { identityService } from '../services/IdentityService.js';
import { leaderboardService } from '../services/leaderboard.js';
import { logger } from '../utils/logger.js';
import {
  getEligibilityByAddress,
  getMemberProfileById,
  getMemberBadgeCount,
} from '../db/queries.js';
import { formatBigInt } from '../utils/format.js';

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get tier emoji
 */
function getTierEmoji(tier: 'naib' | 'fedaykin'): string {
  return tier === 'naib' ? '👑' : '⚔️';
}

/**
 * Build score inline result for a verified member
 */
async function buildScoreResult(
  member: { memberId: string; walletAddress: string }
) {
  const eligibility = getEligibilityByAddress(member.walletAddress);
  const profile = getMemberProfileById(member.memberId);
  const badgeCount = getMemberBadgeCount(member.memberId);
  const rank = leaderboardService.getMemberRank(member.memberId);

  const tier = profile?.tier || 'fedaykin';
  const tierEmoji = getTierEmoji(tier);
  const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

  let bgtDisplay = '0';
  if (eligibility?.bgtHeld) {
    bgtDisplay = formatBigInt(eligibility.bgtHeld, 18, 2);
  }

  let rankDisplay = 'Not ranked';
  if (eligibility?.rank) {
    rankDisplay = `#${eligibility.rank}`;
    if (eligibility.rank <= 7) {
      rankDisplay += ' 🏆';
    } else if (eligibility.rank <= 20) {
      rankDisplay += ' 🥇';
    }
  } else if (rank) {
    rankDisplay = `#${rank}`;
  }

  const walletDisplay = truncateAddress(member.walletAddress);

  const messageText =
    `📊 My Conviction Score\n\n` +
    `${tierEmoji} Tier: ${tierName}\n` +
    `🏅 Rank: ${rankDisplay}\n` +
    `💎 BGT: ${bgtDisplay}\n` +
    `🏆 Badges: ${badgeCount}\n` +
    `🔗 Wallet: ${walletDisplay}`;

  return InlineQueryResultBuilder.article(
    'score',
    '📊 My Conviction Score',
    {
      description: `${tierEmoji} ${tierName} • Rank ${rankDisplay} • ${bgtDisplay} BGT`,
      thumbnail_url: 'https://i.imgur.com/YvWZQN2.png',
    }
  ).text(messageText);
}

/**
 * Build rank inline result
 */
async function buildRankResult(
  member: { memberId: string; walletAddress: string }
) {
  const eligibility = getEligibilityByAddress(member.walletAddress);
  const rank = eligibility?.rank || leaderboardService.getMemberRank(member.memberId);

  let rankDisplay = 'Not ranked';
  let description = 'You are not currently ranked';

  if (rank) {
    rankDisplay = `#${rank}`;
    if (rank <= 7) {
      description = `Naib Council member (Top 7)`;
    } else if (rank <= 21) {
      description = `Fedaykin Elite (Top 21)`;
    } else if (rank <= 69) {
      description = `Eligible member (Top 69)`;
    } else {
      description = `Keep accumulating BGT to climb!`;
    }
  }

  const messageText =
    `🏅 My Sietch Rank\n\n` +
    `Current Position: ${rankDisplay}\n` +
    `${description}`;

  return InlineQueryResultBuilder.article(
    'rank',
    `🏅 My Rank: ${rankDisplay}`,
    { description }
  ).text(messageText);
}

/**
 * Build leaderboard inline result
 */
async function buildLeaderboardResult() {
  const entries = await leaderboardService.getLeaderboard(5);

  let leaderboardText = '🏆 Sietch Leaderboard (Top 5)\n\n';

  if (entries.length === 0) {
    leaderboardText += 'No members yet.';
  } else {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    entries.forEach((entry, index) => {
      const medal = medals[index] || `${index + 1}.`;
      const tierEmoji = entry.tier === 'naib' ? '👑' : '⚔️';
      leaderboardText += `${medal} ${entry.nym} ${tierEmoji} - ${entry.badgeCount} badges\n`;
    });
  }

  return InlineQueryResultBuilder.article(
    'leaderboard',
    '🏆 Sietch Leaderboard',
    { description: 'Top 5 members by badge count' }
  ).text(leaderboardText);
}

/**
 * Build "not verified" result
 */
function buildNotVerifiedResult() {
  return InlineQueryResultBuilder.article(
    'not_verified',
    '🔗 Verify Your Wallet',
    { description: 'Link your wallet to view your stats' }
  ).text(
    '🔗 Wallet Not Linked\n\n' +
    'To view your Sietch stats, open @SietchBot and use /verify to link your wallet.'
  );
}

/**
 * Build help result with available queries
 */
function buildHelpResult() {
  return InlineQueryResultBuilder.article(
    'help',
    '❓ How to Use',
    { description: 'Available inline queries' }
  ).text(
    '🤖 Sietch Bot Inline Queries\n\n' +
    'Type @SietchBot followed by:\n' +
    '• (empty) - Quick stats\n' +
    '• score - Conviction score\n' +
    '• rank - Current rank\n' +
    '• leaderboard - Top 5 members\n\n' +
    'Example: @SietchBot score'
  );
}

/**
 * Register inline query handler
 */
export function registerInlineQueries(bot: Bot<BotContext>): void {
  bot.on('inline_query', async (ctx) => {
    const userId = ctx.from?.id;
    const query = ctx.inlineQuery.query.toLowerCase().trim();

    logger.info(
      { userId, query },
      'Inline query received'
    );

    try {
      // Build results array
      const results = [];

      // Check if user is verified
      const member = userId
        ? await identityService.getMemberByPlatformId('telegram', userId.toString())
        : null;

      // Route based on query
      if (query === '' || query === 'score') {
        if (member) {
          results.push(await buildScoreResult(member));
        } else {
          results.push(buildNotVerifiedResult());
        }
      }

      if (query === '' || query === 'rank') {
        if (member) {
          results.push(await buildRankResult(member));
        }
      }

      if (query === '' || query === 'leaderboard' || query === 'top') {
        results.push(await buildLeaderboardResult());
      }

      if (query === '' || query === 'help') {
        results.push(buildHelpResult());
      }

      // If no results matched, show help
      if (results.length === 0) {
        results.push(buildHelpResult());
      }

      await ctx.answerInlineQuery(results, {
        cache_time: 30, // Cache for 30 seconds
        is_personal: true, // Results are personalized
      });

      logger.debug(
        { userId, query, resultCount: results.length },
        'Inline query answered'
      );
    } catch (error) {
      logger.error(
        { error, userId, query },
        'Error handling inline query'
      );

      // Return help on error
      await ctx.answerInlineQuery([buildHelpResult()], {
        cache_time: 0,
        is_personal: true,
      });
    }
  });
}
