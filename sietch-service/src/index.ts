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

import { config } from './config.js';
import { logger } from './utils/logger.js';
import { startServer } from './api/index.js';
import { discordService } from './services/discord.js';

async function main() {
  logger.info({ config: { port: config.api.port, host: config.api.host } }, 'Starting Sietch Service');

  // Start Express API server (initializes database internally)
  await startServer();

  // Initialize Discord bot (non-blocking - errors don't prevent service startup)
  if (config.discord.botToken) {
    try {
      await discordService.connect();
      logger.info('Discord bot connected successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to connect Discord bot - service will continue without Discord');
    }
  } else {
    logger.warn('Discord token not configured - skipping Discord bot initialization');
  }

  logger.info('Sietch Service started successfully');
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Sietch Service');
  process.exit(1);
});
