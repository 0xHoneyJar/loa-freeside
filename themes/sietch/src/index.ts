/**
 * Sietch Service Entry Point
 *
 * Token-gated Discord community service for top BGT holders.
 * This service:
 * - Queries Berachain RPC for BGT eligibility data
 * - Caches results in SQLite
 * - Exposes REST API for Collab.Land integration
 * - Manages Discord notifications
 */

import { config, isTelegramEnabled, getMissingTelegramConfig } from './config.js';
import { logger } from './utils/logger.js';
import { startServer } from './api/index.js';
import { discordService } from './services/discord.js';
import { startTelegramBot } from './telegram/bot.js';

async function main() {
  logger.info({ config: { port: config.api.port, host: config.api.host } }, 'Starting Sietch Service');

  // Start Express API server (initializes database internally)
  await startServer();

  // Initialize Discord bot (non-blocking - errors don't prevent service startup)
  // Sprint GW-5: Gateway Proxy mode delegates Gateway to Ingestor service
  if (config.features.gatewayProxyEnabled) {
    logger.info('Gateway Proxy mode enabled - Discord Gateway handled by Ingestor');
    logger.info('Events will flow: Ingestor -> RabbitMQ -> Worker');
    // In Gateway Proxy mode, sietch doesn't connect to Discord Gateway
    // The Ingestor service handles the WebSocket connection and publishes events to RabbitMQ
    // Worker service consumes from RabbitMQ and responds via Discord REST API
  } else if (config.discord.botToken) {
    try {
      await discordService.connect();
      logger.info('Discord bot connected successfully (legacy mode)');
    } catch (error) {
      logger.error({ error }, 'Failed to connect Discord bot - service will continue without Discord');
    }
  } else {
    logger.warn('Discord token not configured - skipping Discord bot initialization');
  }

  // Initialize Telegram bot (v4.1 - Sprint 30)
  if (isTelegramEnabled()) {
    try {
      await startTelegramBot();
      logger.info('Telegram bot started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start Telegram bot - service will continue without Telegram');
    }
  } else {
    const missing = getMissingTelegramConfig();
    if (missing.length > 0) {
      logger.warn({ missing }, 'Telegram bot not configured - skipping initialization');
    } else {
      logger.info('Telegram bot disabled in configuration');
    }
  }

  logger.info('Sietch Service started successfully');
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Sietch Service');
  process.exit(1);
});
