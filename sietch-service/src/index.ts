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

async function main() {
  logger.info({ config: { port: config.api.port, host: config.api.host } }, 'Starting Sietch Service');

  // TODO: Initialize database
  // TODO: Initialize Discord bot
  // TODO: Start Express server

  logger.info('Sietch Service started successfully');
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start Sietch Service');
  process.exit(1);
});
