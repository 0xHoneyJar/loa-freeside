/**
 * Discord /buy-credits Command (Cycle 036, Task 3.5)
 *
 * Creates a NOWPayments invoice for credit pack purchase and returns
 * the checkout details as an ephemeral reply.
 *
 * Flow:
 *   1. User runs /buy-credits <amount>
 *   2. Map amount ($5/$10/$25) to credit pack tier
 *   3. Create NOWPayments invoice via ICryptoPaymentProvider
 *   4. Return payment details as ephemeral embed
 *   5. On IPN 'finished' → CryptoWebhookService mints credits
 *
 * @see SDD §4.1 Credit Pack Purchase
 * @see Sprint 3, Task 3.5
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
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

/** Valid amounts for the command choices */
const AMOUNT_CHOICES = [
  { name: '$5 — Starter (5,000,000 credits)', value: 5 },
  { name: '$10 — Standard (10,500,000 credits, 5% bonus)', value: 10 },
  { name: '$25 — Premium (27,500,000 credits, 10% bonus)', value: 25 },
] as const;

// --------------------------------------------------------------------------
// Command Definition
// --------------------------------------------------------------------------

export const buyCreditsCommand = new SlashCommandBuilder()
  .setName('buy-credits')
  .setDescription('Purchase a credit pack with crypto')
  .addIntegerOption((option) =>
    option
      .setName('amount')
      .setDescription('Credit pack amount in USD')
      .setRequired(true)
      .addChoices(...AMOUNT_CHOICES),
  );

// --------------------------------------------------------------------------
// Dependencies (injected at init)
// --------------------------------------------------------------------------

let cryptoProvider: ICryptoPaymentProvider | null = null;

/**
 * Initialize buy-credits command dependencies.
 */
export function initializeBuyCreditsCommand(deps: {
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
// Handler
// --------------------------------------------------------------------------

export async function handleBuyCreditsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const amount = interaction.options.getInteger('amount', true);
  const tierId = AMOUNT_TO_TIER[amount];

  if (!tierId) {
    await interaction.reply({
      content: `Invalid amount. Choose $5, $10, or $25.`,
      ephemeral: true,
    });
    return;
  }

  // Check feature flag
  if (!config.billing?.cryptoPaymentsEnabled) {
    await interaction.reply({
      content: 'Credit purchases are not currently available. Please try again later.',
      ephemeral: true,
    });
    return;
  }

  if (!cryptoProvider) {
    await interaction.reply({
      content: 'Payment service is not available. Please try again later.',
      ephemeral: true,
    });
    return;
  }

  // Resolve the tier to get credit amount
  const resolved = resolveCreditPack(tierId, DEFAULT_MARKUP_FACTOR);
  if (!resolved) {
    await interaction.reply({
      content: 'Credit pack configuration error. Please contact support.',
      ephemeral: true,
    });
    return;
  }

  // Defer reply (payment creation may take a moment)
  await interaction.deferReply({ ephemeral: true });

  try {
    // Validate base URL for IPN callback
    const baseUrl = config.server?.publicUrl ?? config.server?.baseUrl;
    if (!baseUrl) {
      logger.error({ event: 'buy-credits.no-base-url' }, 'Server base URL not configured');
      await interaction.editReply({
        content: 'Payment service is misconfigured. Please contact support.',
      });
      return;
    }

    // Create payment via NOWPayments
    const payment = await cryptoProvider.createPayment({
      communityId: interaction.guildId || 'direct',
      tier: tierId as any,
      ipnCallbackUrl: `${baseUrl}/api/crypto/webhook`,
      metadata: {
        discord_user_id: interaction.user.id,
        discord_guild_id: interaction.guildId || '',
        pack_id: tierId,
        credits_micro: resolved.creditsMicro.toString(),
      },
    });

    // Build response embed
    const embed = new EmbedBuilder()
      .setTitle(`Credit Pack: ${resolved.tier.name}`)
      .setDescription(
        `Send exactly **${payment.payAmount} ${payment.payCurrency.toUpperCase()}** to the address below.`,
      )
      .addFields(
        {
          name: 'Price',
          value: `$${amount} USD`,
          inline: true,
        },
        {
          name: 'Credits',
          value: `${formatCreditsFromMicro(resolved.creditsMicro)} credits`,
          inline: true,
        },
        {
          name: 'Pay Amount',
          value: `\`${payment.payAmount} ${payment.payCurrency.toUpperCase()}\``,
          inline: false,
        },
        {
          name: 'Pay Address',
          value: `\`${payment.payAddress}\``,
          inline: false,
        },
        {
          name: 'Payment ID',
          value: `\`${payment.paymentId}\``,
          inline: true,
        },
        {
          name: 'Expires',
          value: (() => {
            const expiresAt = payment.expiresAt instanceof Date
              ? payment.expiresAt
              : new Date(payment.expiresAt);
            return `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`;
          })(),
          inline: true,
        },
      )
      .setColor(0x00d4aa)
      .setFooter({
        text: 'Credits will be added automatically once payment is confirmed.',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info({
      event: 'buy-credits.created',
      userId: interaction.user.id,
      guildId: interaction.guildId,
      tierId,
      amount,
      paymentId: payment.paymentId,
      creditsMicro: resolved.creditsMicro.toString(),
    }, 'Discord /buy-credits payment created');

  } catch (err) {
    logger.error({
      event: 'buy-credits.error',
      userId: interaction.user.id,
      tierId,
      amount,
      err,
    }, 'Failed to create credit pack payment');

    await interaction.editReply({
      content: 'Failed to create payment. Please try again later.',
    });
  }
}
