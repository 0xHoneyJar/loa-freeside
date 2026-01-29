/**
 * /help Command Handler (v4.1 - Sprint 33)
 *
 * Displays help information and available commands.
 * Provides documentation for all bot features.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { logger } from '../../utils/logger.js';

/**
 * Help message content
 */
const HELP_MESSAGE = `
📖 *Sietch Bot Help*

*Available Commands:*

🔗 /verify - Link your wallet
📊 /score - View your conviction score
🔗 /status - See linked platforms
🏆 /leaderboard - View community rankings
🔔 /alerts - Manage notification settings
🔄 /refresh - Refresh your score data
🔓 /unlink - Disconnect your wallet
📖 /help - Show this help message
🏠 /start - Welcome message

*Inline Queries:*
Type @SietchBot in any chat followed by:
• score - Your conviction score
• rank - Your current rank
• leaderboard - Top 5 members

---

*What is the Sietch?*

The Sietch is a BGT holder community on Berachain. Members who claim and hold BGT (without burning) earn ranks and badges.

*Ranks:*
👑 *Naib* - Top 7 BGT holders
⚔️ *Fedaykin* - Ranks 8-69

*How to Join:*
1. Claim BGT from Berachain validators
2. Hold BGT (don't burn it!)
3. Use /verify to link your wallet
4. Check your score with /score

*Need More Help?*
Join our Discord community or visit honeyjar.xyz
`.trim();

/**
 * Handle the /help command logic
 */
export async function handleHelpCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  logger.info(
    { userId, command: 'help' },
    'Telegram /help command received'
  );

  // Update session
  ctx.session.lastCommandAt = Date.now();

  try {
    await ctx.reply(HELP_MESSAGE, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔗 Verify Wallet', callback_data: 'verify' },
            { text: '📊 My Score', callback_data: 'score' },
          ],
          [
            { text: '🏆 Leaderboard', callback_data: 'leaderboard' },
            { text: '🔗 My Status', callback_data: 'status' },
          ],
        ],
      },
    });

    logger.info(
      { userId },
      'Help command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /help command'
    );

    await ctx.reply(
      `❌ *Error*\n\n` +
      `Something went wrong while displaying help.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Register the /help command handler
 */
export function registerHelpCommand(bot: Bot<BotContext>): void {
  bot.command('help', handleHelpCommand);

  // Also handle callback query for help button
  bot.callbackQuery('help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleHelpCommand(ctx);
  });
}
