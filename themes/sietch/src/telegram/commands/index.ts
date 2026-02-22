/**
 * Telegram Command Handlers Index (v4.1 - Sprint 33)
 *
 * Registers all command handlers on the bot instance.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { registerStartCommand } from './start.js';
import { registerVerifyCommand } from './verify.js';
import { registerScoreCommand } from './score.js';
import { registerStatusCommand } from './status.js';
import { registerLeaderboardCommand } from './leaderboard.js';
import { registerHelpCommand } from './help.js';
import { registerRefreshCommand } from './refresh.js';
import { registerUnlinkCommand } from './unlink.js';
import { registerAlertsCommand } from './alerts.js';
import { registerInlineQueries } from '../inline.js';
// Cycle 036: Credit Pack Purchase
import { registerBuyCreditsCommand } from './buy-credits.js';

/**
 * Register all command handlers on the bot
 */
export function registerAllCommands(bot: Bot<BotContext>): void {
  // Foundation commands (Sprint 30)
  registerStartCommand(bot);
  registerVerifyCommand(bot);

  // User commands (Sprint 31)
  registerScoreCommand(bot);
  registerStatusCommand(bot);
  registerLeaderboardCommand(bot);
  registerHelpCommand(bot);

  // Utility commands (Sprint 32)
  registerRefreshCommand(bot);
  registerUnlinkCommand(bot);

  // Settings commands (Sprint 33)
  registerAlertsCommand(bot);

  // Inline queries (Sprint 33)
  registerInlineQueries(bot);

  // Cycle 036: Credit Pack Purchase
  registerBuyCreditsCommand(bot);

  // Set bot commands for the menu
  bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot and see welcome message' },
    { command: 'verify', description: 'Link your wallet' },
    { command: 'score', description: 'View your conviction score' },
    { command: 'leaderboard', description: 'See community rankings' },
    { command: 'status', description: 'See linked platforms' },
    { command: 'alerts', description: 'Manage notification settings' },
    { command: 'refresh', description: 'Refresh your score data' },
    { command: 'unlink', description: 'Disconnect your wallet' },
    { command: 'help', description: 'Get help with commands' },
    { command: 'buy_credits', description: 'Purchase a credit pack with crypto' },
  ]).catch((error) => {
    // Non-fatal - bot works without command menu
    console.error('Failed to set bot commands:', error);
  });
}
