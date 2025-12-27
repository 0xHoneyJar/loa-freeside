/**
 * /score Command Handler (v4.1 - Sprint 31)
 *
 * Displays the user's conviction score and BGT holdings.
 * Shows rank, tier, badges earned, and days as member.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { identityService } from '../../services/IdentityService.js';
import { leaderboardService } from '../../services/leaderboard.js';
import { logger } from '../../utils/logger.js';
import {
  getEligibilityByAddress,
  getMemberProfileById,
  getMemberBadgeCount,
} from '../../db/queries.js';
import { formatBigInt } from '../../utils/format.js';

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Calculate days since a date
 */
function daysSince(date: Date): number {
  const now = Date.now();
  const diffMs = now - date.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Get tier emoji
 */
function getTierEmoji(tier: 'naib' | 'fedaykin'): string {
  return tier === 'naib' ? '👑' : '⚔️';
}

/**
 * Handle the /score command logic
 */
export async function handleScoreCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'score' },
    'Telegram /score command received'
  );

  // Update session
  ctx.session.lastCommandAt = Date.now();

  try {
    // Check if user is verified
    const member = await identityService.getMemberByPlatformId(
      'telegram',
      userId.toString()
    );

    if (!member) {
      await ctx.reply(
        `❌ *Wallet Not Linked*\n\n` +
        `You need to link your wallet first to view your score.\n` +
        `Use /verify to get started.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 Verify Wallet', callback_data: 'verify' }],
            ],
          },
        }
      );
      return;
    }

    // Get eligibility data (BGT holdings, rank)
    const eligibility = getEligibilityByAddress(member.walletAddress);

    // Get member profile for additional info
    const profile = getMemberProfileById(member.memberId);

    // Get badge count
    const badgeCount = getMemberBadgeCount(member.memberId);

    // Get rank from leaderboard service
    const rank = leaderboardService.getMemberRank(member.memberId);

    // Calculate tenure
    const tenureDays = profile?.createdAt
      ? daysSince(new Date(profile.createdAt))
      : 0;

    // Build the score message
    const walletDisplay = truncateAddress(member.walletAddress);
    const tier = profile?.tier || 'fedaykin';
    const tierEmoji = getTierEmoji(tier);
    const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

    // Format BGT held
    let bgtDisplay = '0';
    if (eligibility?.bgtHeld) {
      bgtDisplay = formatBigInt(eligibility.bgtHeld, 18, 2);
    }

    // Build rank display
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

    const scoreMessage =
      `📊 *Your Conviction Score*\n\n` +
      `${tierEmoji} *Tier:* ${tierName}\n` +
      `🏅 *Rank:* ${rankDisplay}\n` +
      `💎 *BGT Held:* ${bgtDisplay}\n` +
      `🏆 *Badges:* ${badgeCount}\n` +
      `📅 *Days as Member:* ${tenureDays}\n\n` +
      `🔗 *Wallet:* \`${walletDisplay}\``;

    await ctx.reply(scoreMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🏆 Leaderboard', callback_data: 'leaderboard' },
            { text: '🔗 Status', callback_data: 'status' },
          ],
          [
            { text: '📖 Help', callback_data: 'help' },
          ],
        ],
      },
    });

    logger.info(
      { userId, memberId: member.memberId, rank, badgeCount },
      'Score command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /score command'
    );

    await ctx.reply(
      `❌ *Error*\n\n` +
      `Something went wrong while fetching your score.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Register the /score command handler
 */
export function registerScoreCommand(bot: Bot<BotContext>): void {
  bot.command('score', handleScoreCommand);

  // Also handle callback query for score button
  bot.callbackQuery('score', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleScoreCommand(ctx);
  });
}
