import pino from 'pino';
import { getConfig } from './config.js';
import { createDiscordClient, connectDiscord, disconnectDiscord } from './client.js';
import { Publisher } from './publisher.js';
import { wireEventHandlers } from './handlers.js';
import { HealthServer } from './health.js';

/**
 * Ingestor Service Entry Point
 *
 * Lightweight Discord Gateway listener that publishes events to RabbitMQ.
 * Per SDD Section 3.2.1 - zero business logic, serialize and publish only.
 */
async function main(): Promise<void> {
  // Load configuration
  const config = getConfig();

  // Create logger
  const logger = pino({
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

  logger.info(
    {
      nodeEnv: config.nodeEnv,
      shardId: config.shardId,
      shardCount: config.shardCount,
    },
    'Starting Ingestor service'
  );

  // Create components
  const client = createDiscordClient(config, logger);
  const publisher = new Publisher(config, logger);
  const healthServer = new HealthServer(config, client, publisher, logger);

  // Graceful shutdown handler
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown...');

    try {
      // Stop accepting new events
      await healthServer.stop();

      // Disconnect from Discord
      await disconnectDiscord(client, logger);

      // Close RabbitMQ connection
      await publisher.close();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Error during shutdown'
      );
      process.exit(1);
    }
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      'Unhandled rejection'
    );
    process.exit(1);
  });

  try {
    // Connect to RabbitMQ first (fail fast if queue unavailable)
    await publisher.connect();

    // Wire event handlers before connecting to Discord
    wireEventHandlers(client, publisher, logger);

    // Start health server before connecting to Discord
    await healthServer.start();

    // Connect to Discord Gateway
    await connectDiscord(client, config.discordToken, logger);

    logger.info('Ingestor service started successfully');

    // Log memory usage periodically
    setInterval(() => {
      const mem = process.memoryUsage();
      logger.debug(
        {
          heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
          heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
          rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        },
        'Memory usage'
      );
    }, 60000);
  } catch (error) {
    logger.fatal(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to start Ingestor service'
    );
    process.exit(1);
  }
}

// Start the service
main();
