/**
 * /refresh Command Handler (v4.1 - Sprint 32)
 *
 * Forces a re-fetch of the user's eligibility data and displays updated score.
 * Rate-limited to prevent abuse.
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
} from '../../db/index.js';
import { formatBigInt } from '../../utils/format.js';

/**
 * Minimum time between refreshes (5 minutes in milliseconds)
 */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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
  return tier === 'naib' ? '\ud83d\udc51' : '\u2694\ufe0f';
}

/**
 * Handle the /refresh command logic
 */
export async function handleRefreshCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'refresh' },
    'Telegram /refresh command received'
  );

  // Check cooldown
  const lastRefresh = ctx.session.lastRefreshAt || 0;
  const timeSinceRefresh = Date.now() - lastRefresh;

  if (timeSinceRefresh < REFRESH_COOLDOWN_MS) {
    const waitTime = Math.ceil((REFRESH_COOLDOWN_MS - timeSinceRefresh) / 60000);
    await ctx.reply(
      `\u23f3 *Please Wait*\n\n` +
      `You can refresh your score again in ${waitTime} minute${waitTime !== 1 ? 's' : ''}.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '\ud83d\udcca View Current Score', callback_data: 'score' }],
          ],
        },
      }
    );
    return;
  }

  // Update session timestamps
  ctx.session.lastCommandAt = Date.now();
  ctx.session.lastRefreshAt = Date.now();

  try {
    // Check if user is verified
    const member = await identityService.getMemberByPlatformId(
      'telegram',
      userId.toString()
    );

    if (!member) {
      await ctx.reply(
        `\u274c *Wallet Not Linked*\n\n` +
        `You need to link your wallet first to refresh your score.\n` +
        `Use /verify to get started.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '\ud83d\udd17 Verify Wallet', callback_data: 'verify' }],
            ],
          },
        }
      );
      return;
    }

    // Send "refreshing" message
    const refreshingMsg = await ctx.reply(
      `\ud83d\udd04 *Refreshing...*\n\n` +
      `Fetching latest eligibility data...`,
      { parse_mode: 'Markdown' }
    );

    // Re-fetch eligibility data
    // Note: This reads from current_eligibility which is updated by the sync task
    // The actual chain sync happens via trigger.dev task every 5 minutes
    const eligibility = getEligibilityByAddress(member.walletAddress);

    // Get member profile for additional info
    const profile = getMemberProfileById(member.memberId);

    // Get badge count
    const badgeCount = getMemberBadgeCount(member.memberId);

    // Get rank from leaderboard service
    const rank = leaderboardService.getMemberRank(member.memberId);

    // Build the refreshed score message
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
        rankDisplay += ' \ud83c\udfc6';
      } else if (eligibility.rank <= 20) {
        rankDisplay += ' \ud83e\udd47';
      }
    } else if (rank) {
      rankDisplay = `#${rank}`;
    }

    // Determine if there's a change indicator
    // (In future, we could store previous values and show delta)
    const lastSyncNote = `\n\n\ud83d\udd52 _Eligibility syncs every 5 minutes from chain_`;

    const refreshedMessage =
      `\u2705 *Score Refreshed*\n\n` +
      `${tierEmoji} *Tier:* ${tierName}\n` +
      `\ud83c\udfc5 *Rank:* ${rankDisplay}\n` +
      `\ud83d\udc8e *BGT Held:* ${bgtDisplay}\n` +
      `\ud83c\udfc6 *Badges:* ${badgeCount}\n\n` +
      `\ud83d\udd17 *Wallet:* \`${walletDisplay}\`` +
      lastSyncNote;

    // Edit the "refreshing" message with the result
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        refreshingMsg.message_id,
        refreshedMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '\ud83c\udfc6 Leaderboard', callback_data: 'leaderboard' },
                { text: '\ud83d\udd17 Status', callback_data: 'status' },
              ],
              [
                { text: '\ud83d\udd04 Refresh Again', callback_data: 'refresh' },
              ],
            ],
          },
        }
      );
    } catch {
      // If edit fails, send new message
      await ctx.reply(refreshedMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '\ud83c\udfc6 Leaderboard', callback_data: 'leaderboard' },
              { text: '\ud83d\udd17 Status', callback_data: 'status' },
            ],
            [
              { text: '\ud83d\udd04 Refresh Again', callback_data: 'refresh' },
            ],
          ],
        },
      });
    }

    logger.info(
      { userId, memberId: member.memberId, rank, badgeCount },
      'Refresh command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /refresh command'
    );

    await ctx.reply(
      `\u274c *Error*\n\n` +
      `Something went wrong while refreshing your score.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Register the /refresh command handler
 */
export function registerRefreshCommand(bot: Bot<BotContext>): void {
  bot.command('refresh', handleRefreshCommand);

  // Also handle callback query for refresh button
  bot.callbackQuery('refresh', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleRefreshCommand(ctx);
  });
}
