/**
 * /start Command Handler (v4.1 - Sprint 30)
 *
 * Welcome message and introduction to the Sietch Telegram bot.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { logger } from '../../utils/logger.js';

/**
 * Welcome message with Dune-themed introduction
 */
const WELCOME_MESSAGE = `
*Welcome to the Sietch*

You have found your way to the desert stronghold. Here, the Fremen track conviction through the spice.

*What is Sietch?*
Sietch is the cross-platform community for BGT holders on Berachain. Track your conviction score, climb the leaderboard, and earn recognition across Discord and Telegram.

*Getting Started*
To access your score and community features, you need to link your wallet:

1. Use /verify to start the verification process
2. Connect your wallet via Collab.Land
3. Once verified, use /score to see your conviction

*Available Commands*
/verify - Link your wallet
/score - View your conviction score (requires verification)
/leaderboard - See community rankings
/tier - Check your subscription tier
/status - See your linked platforms
/help - Get help

_May your water discipline be strong._
`.trim();

/**
 * Register the /start command handler
 */
export function registerStartCommand(bot: Bot<BotContext>): void {
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;

    logger.info(
      { userId, username, command: 'start' },
      'Telegram /start command received'
    );

    // Update session
    ctx.session.lastCommandAt = Date.now();

    try {
      await ctx.reply(WELCOME_MESSAGE, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Verify Wallet',
                callback_data: 'verify',
              },
            ],
            [
              {
                text: '📊 View Leaderboard',
                callback_data: 'leaderboard',
              },
            ],
          ],
        },
      });
    } catch (error) {
      logger.error(
        { error, userId },
        'Failed to send /start welcome message'
      );
      throw error;
    }
  });

  // Handle callback query for verify button
  bot.callbackQuery('verify', async (ctx) => {
    // Answer the callback to remove loading state
    await ctx.answerCallbackQuery();

    // Redirect to /verify command logic
    // Import verify handler dynamically to avoid circular dependency
    const { handleVerifyCommand } = await import('./verify.js');
    await handleVerifyCommand(ctx);
  });

  // Handle callback query for leaderboard button
  bot.callbackQuery('leaderboard', async (ctx) => {
    await ctx.answerCallbackQuery();
    // For now, just acknowledge - full implementation in Sprint 31
    await ctx.reply(
      '📊 Leaderboard functionality coming soon!\n\nUse /verify first to link your wallet.',
      { parse_mode: 'Markdown' }
    );
  });
}
