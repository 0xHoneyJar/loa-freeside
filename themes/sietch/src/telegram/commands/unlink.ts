/**
 * /unlink Command Handler (v4.1 - Sprint 32)
 *
 * Allows users to disconnect their Telegram account from their wallet.
 * Requires confirmation to prevent accidental unlinking.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { identityService } from '../../services/IdentityService.js';
import { logger } from '../../utils/logger.js';

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Handle the /unlink command logic
 */
export async function handleUnlinkCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'unlink' },
    'Telegram /unlink command received'
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
        `\u274c *No Wallet Linked*\n\n` +
        `Your Telegram account is not linked to any wallet.\n` +
        `Use /verify to link a wallet.`,
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

    // Show confirmation prompt
    const walletDisplay = truncateAddress(member.walletAddress);

    await ctx.reply(
      `\u26a0\ufe0f *Unlink Wallet?*\n\n` +
      `This will disconnect your Telegram account from:\n` +
      `\`${walletDisplay}\`\n\n` +
      `*What happens when you unlink:*\n` +
      `\u2022 You won't be able to use /score or /status\n` +
      `\u2022 You can re-link anytime with /verify\n` +
      `\u2022 Your member profile remains intact\n\n` +
      `Are you sure you want to unlink?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '\u274c Cancel', callback_data: 'unlink_cancel' },
              { text: '\u2705 Yes, Unlink', callback_data: 'unlink_confirm' },
            ],
          ],
        },
      }
    );

    logger.info(
      { userId, memberId: member.memberId },
      'Unlink confirmation shown'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /unlink command'
    );

    await ctx.reply(
      `\u274c *Error*\n\n` +
      `Something went wrong while processing your request.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle unlink confirmation
 */
async function handleUnlinkConfirm(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId },
    'Unlink confirmed by user'
  );

  try {
    // Get member to unlink
    const member = await identityService.getMemberByPlatformId(
      'telegram',
      userId.toString()
    );

    if (!member) {
      await ctx.reply(
        `\u274c *No Wallet Linked*\n\n` +
        `Your Telegram account is not linked to any wallet.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Perform unlink
    await identityService.unlinkTelegram(member.memberId);

    const walletDisplay = truncateAddress(member.walletAddress);

    await ctx.reply(
      `\u2705 *Wallet Unlinked*\n\n` +
      `Your Telegram account has been disconnected from:\n` +
      `\`${walletDisplay}\`\n\n` +
      `You can link a wallet again anytime with /verify.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '\ud83d\udd17 Link New Wallet', callback_data: 'verify' }],
            [{ text: '\ud83c\udfe0 Start', callback_data: 'start' }],
          ],
        },
      }
    );

    logger.info(
      { userId, memberId: member.memberId, walletAddress: member.walletAddress },
      'Telegram account unlinked successfully'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error confirming unlink'
    );

    await ctx.reply(
      `\u274c *Error*\n\n` +
      `Something went wrong while unlinking your wallet.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle unlink cancellation
 */
async function handleUnlinkCancel(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  logger.info(
    { userId },
    'Unlink cancelled by user'
  );

  await ctx.reply(
    `\ud83d\udc4d *Unlink Cancelled*\n\n` +
    `Your wallet link remains unchanged.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '\ud83d\udcca View Score', callback_data: 'score' },
            { text: '\ud83d\udd17 View Status', callback_data: 'status' },
          ],
        ],
      },
    }
  );
}

/**
 * Register the /unlink command handler
 */
export function registerUnlinkCommand(bot: Bot<BotContext>): void {
  bot.command('unlink', handleUnlinkCommand);

  // Callback for unlink confirmation
  bot.callbackQuery('unlink_confirm', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleUnlinkConfirm(ctx);
  });

  // Callback for unlink cancellation
  bot.callbackQuery('unlink_cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleUnlinkCancel(ctx);
  });
}
