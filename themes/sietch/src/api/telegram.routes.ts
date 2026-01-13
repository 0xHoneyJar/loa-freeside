/**
 * Telegram API Routes (v4.1 - Sprint 30)
 *
 * Handles:
 * - Telegram bot webhook endpoint
 * - Health check for bot status
 * - Collab.Land verification callback
 *
 * Security:
 * - Webhook secret validation required in production (webhook mode)
 * - Collab.Land callback should be secured via network-level controls or signature verification
 */

import { Router, type Request, type Response } from 'express';
import { config, isTelegramEnabled, isTelegramWebhookMode } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  telegramWebhookHandler,
  getTelegramBotInfo,
  sendTelegramMessage,
} from '../telegram/bot.js';
import { identityService } from '../services/IdentityService.js';

export const telegramRouter = Router();

// =============================================================================
// Middleware
// =============================================================================

/**
 * Validate Telegram webhook secret token
 * Telegram sends this in the X-Telegram-Bot-Api-Secret-Token header
 *
 * SECURITY: In webhook mode (production), the webhook secret MUST be configured.
 * This prevents unauthenticated requests from being processed.
 */
function validateTelegramWebhook(req: Request, res: Response, next: Function): void {
  if (!isTelegramEnabled()) {
    res.status(503).json({ error: 'Telegram bot is disabled' });
    return;
  }

  // CRITICAL: If in webhook mode, secret MUST be configured and validated
  if (isTelegramWebhookMode()) {
    if (!config.telegram.webhookSecret) {
      logger.error('Telegram webhook secret not configured but webhook mode is enabled');
      res.status(500).json({ error: 'Server misconfiguration' });
      return;
    }

    const secretToken = req.headers['x-telegram-bot-api-secret-token'];
    if (secretToken !== config.telegram.webhookSecret) {
      logger.warn(
        { receivedToken: secretToken ? '***' : 'none' },
        'Invalid Telegram webhook secret token'
      );
      res.status(403).json({ error: 'Invalid webhook secret' });
      return;
    }
  }

  // In polling mode (development), skip webhook validation
  // since requests come from Grammy's polling mechanism, not Telegram servers

  next();
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /telegram/webhook
 *
 * Telegram Bot API webhook endpoint.
 * Receives updates from Telegram and processes them.
 */
telegramRouter.post('/webhook', validateTelegramWebhook, (req, res) => {
  logger.debug(
    { updateId: req.body?.update_id },
    'Received Telegram webhook update'
  );

  telegramWebhookHandler(req, res);
});

/**
 * GET /telegram/health
 *
 * Health check endpoint for Telegram bot.
 * Returns bot status and info.
 */
telegramRouter.get('/health', async (_req, res) => {
  if (!isTelegramEnabled()) {
    res.json({
      status: 'disabled',
      message: 'Telegram bot is not enabled',
    });
    return;
  }

  try {
    const botInfo = await getTelegramBotInfo();

    if (botInfo) {
      res.json({
        status: 'healthy',
        bot: {
          id: botInfo.id,
          username: botInfo.username,
          firstName: botInfo.firstName,
          canReadMessages: botInfo.canReadMessages,
        },
        webhookConfigured: !!config.telegram.webhookUrl,
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        message: 'Could not get bot info',
      });
    }
  } catch (error) {
    logger.error({ error }, 'Telegram health check failed');
    res.status(503).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /telegram/verify/callback
 *
 * Collab.Land verification callback endpoint.
 * Called when a user completes wallet verification.
 *
 * SECURITY NOTICE:
 * This endpoint accepts wallet addresses from Collab.Land callbacks.
 * In production, one or more of these security measures MUST be implemented:
 *
 * 1. Network-level protection:
 *    - Restrict endpoint to internal network/VPC only
 *    - Use IP allowlisting for Collab.Land servers
 *    - Place behind API gateway with authentication
 *
 * 2. Signature verification (preferred):
 *    - Implement Collab.Land's HMAC signature verification
 *    - Verify signature header against shared secret
 *    - Reject requests with invalid/missing signatures
 *
 * 3. Callback token validation:
 *    - Include random token in callback URL during session creation
 *    - Verify token matches on callback receipt
 *
 * Without these protections, an attacker could link arbitrary wallets
 * to Telegram accounts by sending forged callback requests.
 */
telegramRouter.post('/verify/callback', async (req, res) => {
  try {
    const { sessionId, walletAddress, signature, hmac } = req.body;

    if (!sessionId || !walletAddress) {
      res.status(400).json({
        error: 'Missing required fields: sessionId, walletAddress',
      });
      return;
    }

    logger.info(
      { sessionId, walletAddress: walletAddress.slice(0, 10) + '...' },
      'Received Telegram verification callback'
    );

    /**
     * SECURITY: Collab.Land callback verification options:
     * - Option A: HMAC verification with shared secret (config.collabland.webhookSecret)
     * - Option B: IP allowlist verification via X-Forwarded-For header
     * - Option C: Internal network verification (VPC/firewall rules)
     *
     * Currently using Option C (network-level protection) with warning logs.
     * See docs/security/telegram-verification.md for implementation details.
     */
    if (!signature && !hmac) {
      logger.warn(
        { sessionId },
        'Collab.Land callback received without signature - ensure network-level protection is in place'
      );
    }

    // Complete the verification
    const result = await identityService.completeVerification(
      sessionId,
      walletAddress
    );

    // Send success message to the Telegram user
    const truncatedWallet = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    const sent = await sendTelegramMessage(
      result.telegramUserId,
      `✅ *Wallet Linked Successfully!*\n\n` +
        `Your Telegram account is now linked to:\n` +
        `\`${truncatedWallet}\`\n\n` +
        `Use /score to see your conviction score.`,
      { parseMode: 'Markdown' }
    );

    if (!sent) {
      logger.warn(
        { telegramUserId: result.telegramUserId },
        'Could not send verification success message to user'
      );
    }

    res.json({
      success: true,
      memberId: result.memberId,
      message: 'Wallet linked successfully',
    });
  } catch (error) {
    logger.error({ error }, 'Telegram verification callback failed');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // If we have a session ID, mark it as failed
    if (req.body?.sessionId) {
      try {
        await identityService.failVerification(req.body.sessionId, errorMessage);
      } catch (failError) {
        // Ignore secondary errors
      }
    }

    res.status(400).json({
      error: errorMessage,
    });
  }
});

/**
 * GET /telegram/session/:sessionId
 *
 * Get verification session status.
 * Used by frontend to poll for verification completion.
 */
telegramRouter.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await identityService.getVerificationSession(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString(),
      // Don't expose wallet address until completed
      walletLinked: session.status === 'completed',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get verification session');
    res.status(500).json({ error: 'Internal server error' });
  }
});
