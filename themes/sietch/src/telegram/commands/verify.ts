/**
 * /verify Command Handler (v4.1 - Sprint 30, Updated Sprint 172)
 *
 * Initiates wallet verification via in-house EIP-191 signature verification.
 * Creates a verification session and provides user with a link to verify.
 */

import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { identityService } from '../../services/IdentityService.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * Truncate wallet address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Handle the /verify command logic
 * Exported separately so it can be called from callback queries
 */
export async function handleVerifyCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username;

  if (!userId) {
    await ctx.reply('Could not identify your Telegram account. Please try again.');
    return;
  }

  logger.info(
    { userId, username, command: 'verify' },
    'Telegram /verify command received'
  );

  // Update session
  ctx.session.lastCommandAt = Date.now();

  try {
    // Check if user is already verified
    const existingMember = await identityService.getMemberByPlatformId(
      'telegram',
      userId.toString()
    );

    if (existingMember) {
      // User is already verified
      const walletDisplay = truncateAddress(existingMember.walletAddress);
      await ctx.reply(
        `✅ *Wallet Already Linked*\n\n` +
        `Your Telegram account is linked to wallet:\n` +
        `\`${walletDisplay}\`\n\n` +
        `Use /score to see your conviction score.\n` +
        `Use /status to see all linked platforms.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 View Score', callback_data: 'score' },
                { text: '🔗 View Status', callback_data: 'status' },
              ],
            ],
          },
        }
      );
      return;
    }

    // Check for pending verification session
    const pendingSession = await identityService.getPendingSession(userId.toString());

    if (pendingSession) {
      // User has an active verification in progress
      const expiresIn = Math.ceil(
        (pendingSession.expiresAt.getTime() - Date.now()) / 60000
      );

      await ctx.reply(
        `⏳ *Verification In Progress*\n\n` +
        `You already have a pending verification.\n` +
        `Session expires in ${expiresIn} minute${expiresIn !== 1 ? 's' : ''}.\n\n` +
        `Click the button below to continue verification:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🔗 Continue Verification',
                  url: `${config.verification.baseUrl}/verify/${pendingSession.id}?platform=telegram`,
                },
              ],
              [
                {
                  text: '🔄 Start New Verification',
                  callback_data: 'verify_new',
                },
              ],
            ],
          },
        }
      );
      return;
    }

    // Create new verification session
    const { sessionId, verifyUrl } = await identityService.createVerificationSession(
      userId.toString(),
      username
    );

    // Store session ID in user's session for tracking
    ctx.session.pendingVerificationId = sessionId;
    ctx.session.verificationAttempts = (ctx.session.verificationAttempts || 0) + 1;

    await ctx.reply(
      `🔗 *Wallet Verification*\n\n` +
      `To link your wallet and access your conviction score, verify by signing a message.\n\n` +
      `*Steps:*\n` +
      `1. Click the button below\n` +
      `2. Connect your wallet (MetaMask, etc.)\n` +
      `3. Sign the verification message\n` +
      `4. Return here for confirmation\n\n` +
      `⏱️ This link expires in 15 minutes.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Verify Wallet',
                url: verifyUrl,
              },
            ],
            [
              {
                text: '❓ Help',
                callback_data: 'verify_help',
              },
            ],
          ],
        },
      }
    );

    logger.info(
      { userId, sessionId },
      'Telegram verification session created'
    );
  } catch (error) {
    logger.error(
      { error, userId },
      'Error in /verify command'
    );

    // Check for rate limiting error
    if (error instanceof Error && error.message.includes('Too many')) {
      await ctx.reply(
        `⚠️ *Rate Limited*\n\n` +
        `${error.message}\n\n` +
        `You can retry in about an hour.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ *Verification Error*\n\n` +
        `Something went wrong while setting up verification.\n` +
        `Please try again later or contact support.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}

/**
 * Register the /verify command handler
 */
export function registerVerifyCommand(bot: Bot<BotContext>): void {
  // Main /verify command
  bot.command('verify', handleVerifyCommand);

  // Callback for starting new verification (cancels existing)
  bot.callbackQuery('verify_new', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleVerifyCommand(ctx);
  });

  // Callback for help button
  bot.callbackQuery('verify_help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `ℹ️ *Verification Help*\n\n` +
      `*What is wallet verification?*\n` +
      `Linking your wallet allows us to check your BGT holdings and calculate your conviction score.\n\n` +
      `*Is it safe?*\n` +
      `Yes! Signing a verification message only proves wallet ownership. It cannot access your funds or make transactions.\n\n` +
      `*What wallet should I use?*\n` +
      `Use the wallet that holds your BGT tokens on Berachain.\n\n` +
      `*What if verification fails?*\n` +
      `Try again with /verify. If issues persist, contact support.\n\n` +
      `*Can I change my linked wallet?*\n` +
      `Contact support to unlink and re-verify with a different wallet.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Note: 'score' and 'status' callbacks are now handled by their respective command files
  // See score.ts and status.ts
}
