/**
 * /status Command Handler (v4.1 - Sprint 31)
 *
 * Shows all linked platforms for the user's wallet.
 * Displays Discord, Telegram, and any other connected accounts.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { identityService } from '../../services/IdentityService.js';
import { logger } from '../../utils/logger.js';
import { formatRelativeTime } from '../../utils/format.js';

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Handle the /status command logic
 */
export async function handleStatusCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'status' },
    'Telegram /status command received'
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
        `You need to link your wallet first to view your status.\n` +
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

    // Get platform status for the member
    const platformStatus = await identityService.getPlatformStatus(member.memberId);

    // Build the status message
    const walletDisplay = truncateAddress(member.walletAddress);

    let statusMessage = `🔗 *Platform Status*\n\n`;
    statusMessage += `💎 *Wallet:* \`${walletDisplay}\`\n\n`;
    statusMessage += `*Connected Platforms:*\n`;

    // Discord status
    if (platformStatus.discord) {
      const discordLinked = platformStatus.discord.linkedAt
        ? formatRelativeTime(platformStatus.discord.linkedAt)
        : 'Unknown';
      statusMessage += `✅ Discord - Linked ${discordLinked}\n`;
    } else {
      statusMessage += `❌ Discord - Not linked\n`;
    }

    // Telegram status
    if (platformStatus.telegram) {
      const telegramLinked = platformStatus.telegram.linkedAt
        ? formatRelativeTime(platformStatus.telegram.linkedAt)
        : 'Unknown';
      statusMessage += `✅ Telegram - Linked ${telegramLinked}\n`;
    } else {
      statusMessage += `❌ Telegram - Not linked\n`;
    }

    // Summary
    const linkedCount = [
      platformStatus.discord,
      platformStatus.telegram,
    ].filter(Boolean).length;

    statusMessage += `\n*Total:* ${linkedCount}/2 platforms connected`;

    // Add helpful tip if not all platforms connected
    if (linkedCount < 2) {
      statusMessage += `\n\n💡 *Tip:* Link more platforms to increase your presence in the Sietch community!`;
    }

    await ctx.reply(statusMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 View Score', callback_data: 'score' },
            { text: '🏆 Leaderboard', callback_data: 'leaderboard' },
          ],
          [
            { text: '📖 Help', callback_data: 'help' },
          ],
        ],
      },
    });

    logger.info(
      { userId, memberId: member.memberId, linkedCount },
      'Status command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /status command'
    );

    await ctx.reply(
      `❌ *Error*\n\n` +
      `Something went wrong while fetching your status.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Register the /status command handler
 */
export function registerStatusCommand(bot: Bot<BotContext>): void {
  bot.command('status', handleStatusCommand);

  // Also handle callback query for status button
  bot.callbackQuery('status', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleStatusCommand(ctx);
  });
}
