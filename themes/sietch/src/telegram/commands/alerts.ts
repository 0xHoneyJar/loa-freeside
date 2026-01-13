/**
 * /alerts Command Handler (v4.1 - Sprint 33)
 *
 * Manages notification preferences for Telegram users.
 * Mirrors Discord's /alerts command functionality.
 *
 * Features:
 * - View current notification settings
 * - Toggle position updates, at-risk warnings, naib alerts
 * - Change alert frequency (1x/2x/3x per week or daily)
 * - Disable all alerts with one button
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { identityService } from '../../services/IdentityService.js';
import { notificationService } from '../../services/notification.js';
import { naibService } from '../../services/naib.js';
import { logger } from '../../utils/logger.js';
import type { AlertFrequency } from '../../types/index.js';

/**
 * Frequency display names
 */
const FREQUENCY_LABELS: Record<AlertFrequency, string> = {
  '1_per_week': '1x per week',
  '2_per_week': '2x per week',
  '3_per_week': '3x per week',
  'daily': 'Daily',
};

/**
 * Format status indicator
 */
function statusEmoji(enabled: boolean): string {
  return enabled ? '✅' : '❌';
}

/**
 * Build the alerts message with current settings
 */
function buildAlertsMessage(
  prefs: {
    positionUpdates: boolean;
    atRiskWarnings: boolean;
    naibAlerts: boolean;
    frequency: AlertFrequency;
    alertsSentThisWeek: number;
  },
  maxAlerts: number,
  isNaib: boolean
): string {
  let message =
    `🔔 *Alert Preferences*\n\n` +
    `Configure which notifications you receive.\n\n` +
    `📊 *Position Updates*\n` +
    `${statusEmoji(prefs.positionUpdates)} ${prefs.positionUpdates ? 'Enabled' : 'Disabled'}\n` +
    `_Regular updates about your ranking position_\n\n` +
    `⚠️ *At-Risk Warnings*\n` +
    `${statusEmoji(prefs.atRiskWarnings)} ${prefs.atRiskWarnings ? 'Enabled' : 'Disabled'}\n` +
    `_Alerts when you're in the bottom 10%_\n\n`;

  if (isNaib) {
    message +=
      `👑 *Naib Alerts*\n` +
      `${statusEmoji(prefs.naibAlerts)} ${prefs.naibAlerts ? 'Enabled' : 'Disabled'}\n` +
      `_Seat threat and status notifications_\n\n`;
  }

  message +=
    `📅 *Frequency*: ${FREQUENCY_LABELS[prefs.frequency]}\n` +
    `📬 Alerts sent this week: ${prefs.alertsSentThisWeek}/${maxAlerts}\n\n` +
    `_Critical alerts (bumps, new seats) are always sent._`;

  return message;
}

/**
 * Build inline keyboard for alerts settings
 */
function buildAlertsKeyboard(
  memberId: string,
  prefs: {
    positionUpdates: boolean;
    atRiskWarnings: boolean;
    naibAlerts: boolean;
    frequency: AlertFrequency;
  },
  isNaib: boolean
) {
  const toggleButtons = [
    [
      {
        text: prefs.positionUpdates ? '❌ Disable Position' : '✅ Enable Position',
        callback_data: `alerts_toggle_position_${memberId}`,
      },
    ],
    [
      {
        text: prefs.atRiskWarnings ? '❌ Disable At-Risk' : '✅ Enable At-Risk',
        callback_data: `alerts_toggle_atrisk_${memberId}`,
      },
    ],
  ];

  if (isNaib) {
    toggleButtons.push([
      {
        text: prefs.naibAlerts ? '❌ Disable Naib' : '✅ Enable Naib',
        callback_data: `alerts_toggle_naib_${memberId}`,
      },
    ]);
  }

  // Frequency buttons
  const frequencyButtons = [
    {
      text: prefs.frequency === '1_per_week' ? '• 1x/wk' : '1x/wk',
      callback_data: `alerts_freq_1_per_week_${memberId}`,
    },
    {
      text: prefs.frequency === '2_per_week' ? '• 2x/wk' : '2x/wk',
      callback_data: `alerts_freq_2_per_week_${memberId}`,
    },
    {
      text: prefs.frequency === '3_per_week' ? '• 3x/wk' : '3x/wk',
      callback_data: `alerts_freq_3_per_week_${memberId}`,
    },
    {
      text: prefs.frequency === 'daily' ? '• Daily' : 'Daily',
      callback_data: `alerts_freq_daily_${memberId}`,
    },
  ];

  return {
    inline_keyboard: [
      ...toggleButtons,
      frequencyButtons,
      [
        {
          text: '🔕 Disable All',
          callback_data: `alerts_disable_all_${memberId}`,
        },
      ],
    ],
  };
}

/**
 * Handle the /alerts command logic
 */
export async function handleAlertsCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, command: 'alerts' },
    'Telegram /alerts command received'
  );

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
        `You need to link your wallet first to manage alerts.\n` +
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

    // Get current preferences
    const prefs = notificationService.getPreferences(member.memberId);
    const isNaib = naibService.isCurrentNaib(member.memberId);
    const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

    const message = buildAlertsMessage(prefs, maxAlerts, isNaib);
    const keyboard = buildAlertsKeyboard(member.memberId, prefs, isNaib);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    logger.info(
      { userId, memberId: member.memberId },
      'Alerts command completed'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /alerts command'
    );

    await ctx.reply(
      `❌ *Error*\n\n` +
      `Something went wrong while loading your preferences.\n` +
      `Please try again later.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Handle toggle position updates callback
 */
async function handleTogglePosition(ctx: BotContext, memberId: string): Promise<void> {
  const prefs = notificationService.getPreferences(memberId);
  const newValue = !prefs.positionUpdates;

  notificationService.updatePreferences(memberId, { positionUpdates: newValue });

  logger.info(
    { memberId, positionUpdates: newValue },
    'Toggled position updates'
  );

  await refreshAlertsMessage(ctx, memberId);
}

/**
 * Handle toggle at-risk warnings callback
 */
async function handleToggleAtRisk(ctx: BotContext, memberId: string): Promise<void> {
  const prefs = notificationService.getPreferences(memberId);
  const newValue = !prefs.atRiskWarnings;

  notificationService.updatePreferences(memberId, { atRiskWarnings: newValue });

  logger.info(
    { memberId, atRiskWarnings: newValue },
    'Toggled at-risk warnings'
  );

  await refreshAlertsMessage(ctx, memberId);
}

/**
 * Handle toggle naib alerts callback
 */
async function handleToggleNaib(ctx: BotContext, memberId: string): Promise<void> {
  const prefs = notificationService.getPreferences(memberId);
  const newValue = !prefs.naibAlerts;

  notificationService.updatePreferences(memberId, { naibAlerts: newValue });

  logger.info(
    { memberId, naibAlerts: newValue },
    'Toggled naib alerts'
  );

  await refreshAlertsMessage(ctx, memberId);
}

/**
 * Handle frequency change callback
 */
async function handleFrequencyChange(
  ctx: BotContext,
  memberId: string,
  frequency: AlertFrequency
): Promise<void> {
  notificationService.updatePreferences(memberId, { frequency });

  logger.info(
    { memberId, frequency },
    'Changed alert frequency'
  );

  await refreshAlertsMessage(ctx, memberId);
}

/**
 * Handle disable all alerts callback
 */
async function handleDisableAll(ctx: BotContext, memberId: string): Promise<void> {
  notificationService.updatePreferences(memberId, {
    positionUpdates: false,
    atRiskWarnings: false,
    naibAlerts: false,
  });

  logger.info(
    { memberId },
    'Disabled all alerts'
  );

  await refreshAlertsMessage(ctx, memberId);
}

/**
 * Verify the user making the callback is authorized to modify the given memberId
 * Prevents IDOR attacks where User A's forwarded message could let User B modify A's preferences
 */
async function verifyCallbackAuthorization(
  ctx: BotContext,
  memberId: string
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) {
    logger.warn({ memberId }, 'Callback without user ID');
    return false;
  }

  const member = await identityService.getMemberByPlatformId('telegram', userId.toString());
  if (!member || member.memberId !== memberId) {
    logger.warn(
      { userId, attemptedMemberId: memberId, actualMemberId: member?.memberId },
      'Unauthorized callback attempt - IDOR blocked'
    );
    return false;
  }

  return true;
}

/**
 * Refresh the alerts message with updated preferences
 */
async function refreshAlertsMessage(ctx: BotContext, memberId: string): Promise<void> {
  try {
    const prefs = notificationService.getPreferences(memberId);
    const isNaib = naibService.isCurrentNaib(memberId);
    const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

    const message = buildAlertsMessage(prefs, maxAlerts, isNaib);
    const keyboard = buildAlertsKeyboard(memberId, prefs, isNaib);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error(
      { error, memberId },
      'Error refreshing alerts message'
    );
  }
}

/**
 * Register the /alerts command handler
 */
export function registerAlertsCommand(bot: Bot<BotContext>): void {
  bot.command('alerts', handleAlertsCommand);

  // Callback query for alerts button from other messages
  bot.callbackQuery('alerts', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAlertsCommand(ctx);
  });

  // Toggle position updates
  bot.callbackQuery(/^alerts_toggle_position_(.+)$/, async (ctx) => {
    const memberId = ctx.match?.[1];
    if (!memberId || !(await verifyCallbackAuthorization(ctx, memberId))) {
      await ctx.answerCallbackQuery('Unauthorized');
      return;
    }
    await ctx.answerCallbackQuery('Updating...');
    await handleTogglePosition(ctx, memberId);
  });

  // Toggle at-risk warnings
  bot.callbackQuery(/^alerts_toggle_atrisk_(.+)$/, async (ctx) => {
    const memberId = ctx.match?.[1];
    if (!memberId || !(await verifyCallbackAuthorization(ctx, memberId))) {
      await ctx.answerCallbackQuery('Unauthorized');
      return;
    }
    await ctx.answerCallbackQuery('Updating...');
    await handleToggleAtRisk(ctx, memberId);
  });

  // Toggle naib alerts
  bot.callbackQuery(/^alerts_toggle_naib_(.+)$/, async (ctx) => {
    const memberId = ctx.match?.[1];
    if (!memberId || !(await verifyCallbackAuthorization(ctx, memberId))) {
      await ctx.answerCallbackQuery('Unauthorized');
      return;
    }
    await ctx.answerCallbackQuery('Updating...');
    await handleToggleNaib(ctx, memberId);
  });

  // Frequency changes
  bot.callbackQuery(/^alerts_freq_(1_per_week|2_per_week|3_per_week|daily)_(.+)$/, async (ctx) => {
    const frequency = ctx.match?.[1] as AlertFrequency | undefined;
    const memberId = ctx.match?.[2];
    if (!frequency || !memberId || !(await verifyCallbackAuthorization(ctx, memberId))) {
      await ctx.answerCallbackQuery('Unauthorized');
      return;
    }
    await ctx.answerCallbackQuery('Updating...');
    await handleFrequencyChange(ctx, memberId, frequency);
  });

  // Disable all
  bot.callbackQuery(/^alerts_disable_all_(.+)$/, async (ctx) => {
    const memberId = ctx.match?.[1];
    if (!memberId || !(await verifyCallbackAuthorization(ctx, memberId))) {
      await ctx.answerCallbackQuery('Unauthorized');
      return;
    }
    await ctx.answerCallbackQuery('All alerts disabled');
    await handleDisableAll(ctx, memberId);
  });
}
