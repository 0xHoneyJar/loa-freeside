/**
 * /leaderboard Command Handler (v4.1 - Sprint 32)
 *
 * Shows the top members by badge count.
 * Privacy-first: only shows nym and badge count, no wallet info.
 *
 * Sprint 32: Updated to use cached leaderboard for performance.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { leaderboardService } from '../../services/leaderboard.js';
import { identityService } from '../../services/IdentityService.js';
import { logger } from '../../utils/logger.js';

/**
 * Get medal emoji for rank
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
      return `${rank}.`;
  }
}

/**
 * Get tier emoji
 */
function getTierEmoji(tier: 'naib' | 'fedaykin'): string {
  return tier === 'naib' ? '👑' : '⚔️';
}

/**
 * Handle the /leaderboard command logic
 */
export async function handleLeaderboardCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'leaderboard' },
    'Telegram /leaderboard command received'
  );

  // Update session
  ctx.session.lastCommandAt = Date.now();

  try {
    // Get top 10 from leaderboard (cached with 60s TTL)
    const leaderboard = await leaderboardService.getLeaderboard(10);

    if (leaderboard.length === 0) {
      await ctx.reply(
        `🏆 *Sietch Leaderboard*\n\n` +
        `No members on the leaderboard yet.\n` +
        `Be the first to earn badges!`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Build leaderboard message
    let message = `🏆 *Sietch Leaderboard*\n`;
    message += `_Top members by badge count_\n\n`;

    for (const entry of leaderboard) {
      const rankEmoji = getRankEmoji(entry.rank);
      const tierEmoji = getTierEmoji(entry.tier);

      // Format: 🥇 NyM (👑 Naib) - 5 badges
      message += `${rankEmoji} ${entry.nym} ${tierEmoji} - ${entry.badgeCount} badge${entry.badgeCount !== 1 ? 's' : ''}\n`;
    }

    // Check if the requesting user is on the leaderboard
    const member = await identityService.getMemberByPlatformId(
      'telegram',
      userId.toString()
    );

    if (member) {
      const userRank = leaderboardService.getMemberRank(member.memberId);
      if (userRank && userRank > 10) {
        message += `\n---\n`;
        message += `📍 *Your Position:* #${userRank}`;
      } else if (userRank && userRank <= 10) {
        message += `\n---\n`;
        message += `🎉 *You're in the top 10!*`;
      }
    } else {
      message += `\n---\n`;
      message += `💡 Link your wallet with /verify to join!`;
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 My Score', callback_data: 'score' },
            { text: '🔗 My Status', callback_data: 'status' },
          ],
          [
            { text: '🔄 Refresh', callback_data: 'leaderboard' },
          ],
        ],
      },
    });

    logger.info(
      { userId, entriesCount: leaderboard.length },
      'Leaderboard command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /leaderboard command'
    );

    await ctx.reply(
      `❌ *Error*\n\n` +
      `Something went wrong while fetching the leaderboard.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Register the /leaderboard command handler
 */
export function registerLeaderboardCommand(bot: Bot<BotContext>): void {
  bot.command('leaderboard', handleLeaderboardCommand);

  // Also handle callback query for leaderboard button
  bot.callbackQuery('leaderboard', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleLeaderboardCommand(ctx);
  });
}
