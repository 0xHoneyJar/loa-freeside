/**
 * Arrakis Worker - Main Entry Point
 * Sprint S-7: NATS is now the primary message broker
 *
 * This file redirects to main-nats.ts for NATS-based message consumption.
 * RabbitMQ support has been deprecated as of Sprint S-7.
 *
 * For legacy RabbitMQ mode (deprecated), use index-legacy.ts
 */

import pino from 'pino';
import { logSerializers } from './utils/log-sanitizer.js';

// SEC-2.6: Logger with sanitization serializers
const logger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  serializers: {
    ...pino.stdSerializers,
    ...logSerializers,
  },
  transport:
    process.env['NODE_ENV'] === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

async function main(): Promise<void> {
  logger.info('Arrakis Worker starting...');

  // Check if NATS_URL is configured
  if (!process.env['NATS_URL']) {
    logger.error('NATS_URL environment variable is required');
    logger.error('RabbitMQ support has been deprecated as of Sprint S-7');
    logger.error('Please set NATS_URL to use the worker');
    process.exit(1);
  }

  // Dynamically import and run NATS entry point
  // main-nats.ts handles its own shutdown and error handling
  logger.info('Loading NATS worker...');
  await import('./main-nats.js');
}

// Handle uncaught exceptions (before NATS module loads)
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception, shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection, shutting down');
  process.exit(1);
});

// Start the worker
main().catch((error) => {
  logger.fatal({ error }, 'Failed to start worker');
  process.exit(1);
});
