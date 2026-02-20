/**
 * Telegram /buy_credits Command (Cycle 036, Task 3.6)
 *
 * Same flow as Discord /buy-credits but for the Telegram surface.
 * Uses grammy command handler pattern.
 *
 * @see SDD §4.1 Credit Pack Purchase
 * @see Sprint 3, Task 3.6
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { logger } from '../../utils/logger.js';
import {
  CREDIT_PACK_TIERS,
  resolveCreditPack,
  DEFAULT_MARKUP_FACTOR,
} from '../../packages/core/billing/credit-packs.js';
import type { ICryptoPaymentProvider } from '../../packages/core/ports/ICryptoPaymentProvider.js';
import { config } from '../../config.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Amount → tier ID mapping */
const AMOUNT_TO_TIER: Record<number, string> = {
  5: 'starter',
  10: 'standard',
  25: 'premium',
};

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

let cryptoProvider: ICryptoPaymentProvider | null = null;

/**
 * Initialize buy-credits command dependencies.
 */
export function initTelegramBuyCredits(deps: {
  cryptoProvider: ICryptoPaymentProvider;
}): void {
  cryptoProvider = deps.cryptoProvider;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Format micro-credits as human-readable string using pure BigInt math. */
function formatCreditsFromMicro(creditsMicro: bigint): string {
  const whole = creditsMicro / 1_000_000n;
  const oneDecimal = (creditsMicro % 1_000_000n) / 100_000n;
  return `${whole}.${oneDecimal.toString()}`;
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

/**
 * Register the /buy_credits command on the bot.
 */
export function registerBuyCreditsCommand(bot: Bot<BotContext>): void {
  bot.command('buy_credits', async (ctx) => {
    const text = ctx.message?.text ?? '';
    const args = text.split(/\s+/).slice(1);
    const amountStr = args[0];

    // Parse amount
    const amount = amountStr ? parseInt(amountStr, 10) : 0;
    const tierId = AMOUNT_TO_TIER[amount];

    if (!tierId) {
      await ctx.reply(
        '💳 *Credit Packs*\n\n' +
        'Usage: `/buy_credits <amount>`\n\n' +
        '• `/buy_credits 5` — Starter ($5, 5.0M credits)\n' +
        '• `/buy_credits 10` — Standard ($10, 10.5M credits, 5% bonus)\n' +
        '• `/buy_credits 25` — Premium ($25, 27.5M credits, 10% bonus)',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    // Check feature flag
    if (!config.billing?.cryptoPaymentsEnabled) {
      await ctx.reply('Credit purchases are not currently available. Please try again later.');
      return;
    }

    if (!cryptoProvider) {
      await ctx.reply('Payment service is not available. Please try again later.');
      return;
    }

    // Resolve tier
    const resolved = resolveCreditPack(tierId, DEFAULT_MARKUP_FACTOR);
    if (!resolved) {
      await ctx.reply('Credit pack configuration error. Please contact support.');
      return;
    }

    // Validate base URL
    const baseUrl = config.server?.publicUrl ?? config.server?.baseUrl;
    if (!baseUrl) {
      logger.error({ event: 'tg-buy-credits.no-base-url' }, 'Server base URL not configured');
      await ctx.reply('Payment service is misconfigured. Please contact support.');
      return;
    }

    try {
      // Create payment
      const payment = await cryptoProvider.createPayment({
        communityId: ctx.chat?.id?.toString() || 'direct',
        tier: tierId as any,
        ipnCallbackUrl: `${baseUrl}/api/crypto/webhook`,
        metadata: {
          telegram_user_id: ctx.from?.id?.toString() || '',
          telegram_chat_id: ctx.chat?.id?.toString() || '',
          pack_id: tierId,
          credits_micro: resolved.creditsMicro.toString(),
        },
      });

      // Format expiration
      const expiresAt = payment.expiresAt instanceof Date
        ? payment.expiresAt
        : new Date(payment.expiresAt);
      const expiresMin = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));

      // Build response message
      const message = [
        `💳 *Credit Pack: ${resolved.tier.name}*`,
        '',
        `Send exactly \`${payment.payAmount} ${payment.payCurrency.toUpperCase()}\` to:`,
        '',
        `\`${payment.payAddress}\``,
        '',
        `💰 Price: $${amount} USD`,
        `⚡ Credits: ${formatCreditsFromMicro(resolved.creditsMicro)}`,
        `🔑 Payment ID: \`${payment.paymentId}\``,
        `⏱ Expires in: ~${expiresMin} minutes`,
        '',
        '_Credits will be added automatically once payment is confirmed._',
      ].join('\n');

      await ctx.reply(message, { parse_mode: 'Markdown' });

      logger.info({
        event: 'tg-buy-credits.created',
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        tierId,
        amount,
        paymentId: payment.paymentId,
        creditsMicro: resolved.creditsMicro.toString(),
      }, 'Telegram /buy_credits payment created');

    } catch (err) {
      logger.error({
        event: 'tg-buy-credits.error',
        userId: ctx.from?.id,
        tierId,
        amount,
        err,
      }, 'Failed to create credit pack payment');

      await ctx.reply('Failed to create payment. Please try again later.');
    }
  });
}
