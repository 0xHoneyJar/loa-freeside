/**
 * Telegram Bot Module (v4.1 - Sprint 30)
 *
 * Initializes and manages the grammy Telegram bot instance.
 * Supports both webhook mode (production) and polling mode (development).
 */

import { Bot, Context, session, type SessionFlavor, webhookCallback } from 'grammy';
import type { Request, Response } from 'express';
import { config, isTelegramEnabled, isTelegramWebhookMode } from '../config.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Session data stored per user conversation
 */
export interface SessionData {
  /** Number of verification attempts in current window */
  verificationAttempts: number;
  /** Timestamp of last command */
  lastCommandAt: number;
  /** Pending verification session ID */
  pendingVerificationId?: string;
  /** Timestamp of last refresh command (Sprint 32) */
  lastRefreshAt?: number;
}

/**
 * Extended context type with session data
 */
export type BotContext = Context & SessionFlavor<SessionData>;

// =============================================================================
// Bot Instance
// =============================================================================

let bot: Bot<BotContext> | null = null;
let isRunning = false;

/**
 * Create and configure the Telegram bot instance
 */
function createBot(): Bot<BotContext> {
  const token = config.telegram.botToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const newBot = new Bot<BotContext>(token);

  // Session middleware - stores per-user conversation state
  newBot.use(
    session({
      initial: (): SessionData => ({
        verificationAttempts: 0,
        lastCommandAt: 0,
      }),
    })
  );

  // Error handler
  newBot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;

    logger.error(
      {
        error,
        updateId: ctx.update.update_id,
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
      },
      'Telegram bot error'
    );

    // Try to send user-friendly error message
    ctx.reply('Something went wrong. Please try again later.').catch(() => {
      // Ignore errors when sending error message
    });
  });

  return newBot;
}

/**
 * Get the bot instance, creating it if necessary
 */
export function getBot(): Bot<BotContext> {
  if (!bot) {
    bot = createBot();
  }
  return bot;
}

/**
 * Register command handlers on the bot
 * Called after creating the bot to set up all commands
 */
export function registerCommands(): void {
  const b = getBot();

  // Import and register commands dynamically
  // This allows for lazy loading and prevents circular dependencies
  import('./commands/index.js').then(({ registerAllCommands }) => {
    registerAllCommands(b);
    logger.info('Telegram command handlers registered');
  }).catch((error) => {
    logger.error({ error }, 'Failed to register Telegram command handlers');
  });
}

// =============================================================================
// Bot Lifecycle
// =============================================================================

/**
 * Start the Telegram bot
 *
 * In development: uses polling mode (long-polling for updates)
 * In production: webhook mode should be configured via nginx
 */
export async function startTelegramBot(): Promise<void> {
  if (!isTelegramEnabled()) {
    logger.info('Telegram bot is disabled, skipping initialization');
    return;
  }

  if (isRunning) {
    logger.warn('Telegram bot is already running');
    return;
  }

  const b = getBot();
  registerCommands();

  // Give commands time to register
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (isTelegramWebhookMode()) {
    // Production: webhook mode
    // Webhook is set by the API server, bot doesn't poll
    const webhookUrl = config.telegram.webhookUrl!;
    try {
      await b.api.setWebhook(webhookUrl, {
        secret_token: config.telegram.webhookSecret,
        allowed_updates: ['message', 'callback_query', 'inline_query'],
      });
      logger.info({ webhookUrl }, 'Telegram webhook configured');
    } catch (error) {
      logger.error({ error, webhookUrl }, 'Failed to set Telegram webhook');
      throw error;
    }
  } else {
    // Development: polling mode
    logger.info('Starting Telegram bot in polling mode');
    b.start({
      onStart: (botInfo) => {
        logger.info(
          { username: botInfo.username, id: botInfo.id },
          'Telegram bot started in polling mode'
        );
      },
    });
  }

  isRunning = true;
}

/**
 * Stop the Telegram bot
 */
export async function stopTelegramBot(): Promise<void> {
  if (!isRunning || !bot) {
    return;
  }

  logger.info('Stopping Telegram bot...');

  try {
    await bot.stop();
    logger.info('Telegram bot stopped');
  } catch (error) {
    logger.error({ error }, 'Error stopping Telegram bot');
  }

  isRunning = false;
}

/**
 * Check if the Telegram bot is currently running
 */
export function isTelegramBotRunning(): boolean {
  return isRunning;
}

// =============================================================================
// Webhook Handler
// =============================================================================

/**
 * Express middleware for handling Telegram webhook requests
 *
 * Usage in Express:
 *   app.post('/telegram/webhook', telegramWebhookHandler);
 */
export function telegramWebhookHandler(req: Request, res: Response): void {
  if (!isTelegramEnabled()) {
    res.status(503).json({ error: 'Telegram bot is disabled' });
    return;
  }

  const b = getBot();

  // Create grammy webhook callback handler
  // The callback handles update processing and response
  const handler = webhookCallback(b, 'express', {
    secretToken: config.telegram.webhookSecret,
  });

  // Execute the handler
  handler(req, res);
}

/**
 * Get bot info for health checks
 */
export async function getTelegramBotInfo(): Promise<{
  id: number;
  username: string;
  firstName: string;
  canReadMessages: boolean;
} | null> {
  if (!isTelegramEnabled() || !bot) {
    return null;
  }

  try {
    const me = await bot.api.getMe();
    return {
      id: me.id,
      username: me.username || 'unknown',
      firstName: me.first_name,
      canReadMessages: me.can_read_all_group_messages || false,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get Telegram bot info');
    return null;
  }
}

/**
 * Send a message to a specific Telegram user
 * Used for notifications like verification success
 */
export async function sendTelegramMessage(
  telegramUserId: string,
  message: string,
  options?: { parseMode?: 'Markdown' | 'HTML' }
): Promise<boolean> {
  if (!isTelegramEnabled() || !bot) {
    logger.warn('Cannot send Telegram message - bot not enabled');
    return false;
  }

  try {
    await bot.api.sendMessage(telegramUserId, message, {
      parse_mode: options?.parseMode,
    });
    return true;
  } catch (error) {
    logger.error(
      { error, telegramUserId },
      'Failed to send Telegram message'
    );
    return false;
  }
}
