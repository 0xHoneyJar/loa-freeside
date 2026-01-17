/**
 * Arrakis Worker - NATS Entry Point
 * Sprint S-6: Worker Migration to NATS
 *
 * Main entry point for NATS-based message consumption.
 * Uses NATS JetStream instead of RabbitMQ for message routing.
 *
 * Set NATS_URL environment variable to enable NATS mode.
 * Falls back to RabbitMQ if NATS_URL is not set (legacy mode).
 */

import pino from 'pino';
import { getConfig } from './config.js';
import { DiscordRestService } from './services/DiscordRest.js';
import { StateManager } from './services/StateManager.js';
import { createNatsClient, type NatsClient } from './services/NatsClient.js';
import {
  createCommandNatsConsumer,
  createEventNatsConsumer,
  createEligibilityNatsConsumer,
  type CommandNatsConsumer,
  type EventNatsConsumer,
  type EligibilityNatsConsumer,
} from './consumers/index.js';
import { registerAllCommandHandlers } from './handlers/registration.js';
import { createNatsHealthServer, type NatsHealthChecker } from './health-nats.js';
import { logSerializers } from './utils/log-sanitizer.js';

// Initialize logger first with sanitization serializers (SEC-2.6)
const env = process.env;
const logger = pino({
  level: env['LOG_LEVEL'] || 'info',
  serializers: {
    ...pino.stdSerializers,
    ...logSerializers,
  },
  transport:
    env['NODE_ENV'] === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// Track start time for uptime
const startTime = Date.now();

// Global state for health checks
let natsClient: NatsClient | null = null;
let commandConsumer: CommandNatsConsumer | null = null;
let eventConsumer: EventNatsConsumer | null = null;
let eligibilityConsumer: EligibilityNatsConsumer | null = null;
let stateManager: StateManager | null = null;
let healthServer: ReturnType<typeof createNatsHealthServer> | null = null;

/**
 * Main entry point for NATS mode
 */
async function main(): Promise<void> {
  logger.info('Starting Arrakis Worker service (NATS mode)');

  // Load configuration
  const config = getConfig();
  logger.info({ env: config.nodeEnv }, 'Configuration loaded');

  // Validate NATS configuration
  if (!config.natsUrl) {
    throw new Error('NATS_URL is required for NATS mode. Use index.ts for RabbitMQ mode.');
  }

  // Initialize Discord REST service
  const discordRest = new DiscordRestService(config.discordApplicationId, logger);
  if (config.discordBotToken) {
    discordRest.setToken(config.discordBotToken);
  }
  logger.info('Discord REST service initialized');

  // Initialize State Manager (Redis)
  stateManager = new StateManager(config.redisUrl, logger);
  await stateManager.connect();
  logger.info('State Manager connected to Redis');

  // Initialize NATS client
  natsClient = createNatsClient(logger);
  await natsClient.connect();
  logger.info('NATS client connected');

  // Ensure streams exist
  await natsClient.ensureStreams();
  logger.info('NATS streams initialized');

  // Ensure consumers exist
  await natsClient.ensureConsumers();
  logger.info('NATS consumers initialized');

  // Register command handlers
  const commandHandlers = registerAllCommandHandlers(discordRest);
  logger.info({ handlerCount: commandHandlers.size }, 'Command handlers registered');

  // Create NATS consumers
  commandConsumer = createCommandNatsConsumer(discordRest, commandHandlers, logger);
  eventConsumer = createEventNatsConsumer(undefined, undefined, logger);
  eligibilityConsumer = createEligibilityNatsConsumer(discordRest, undefined, logger);

  // Initialize consumers (create durable consumers in NATS if needed)
  const jsm = natsClient.getJetStreamManager();
  await Promise.all([
    commandConsumer.initialize(jsm),
    eventConsumer.initialize(jsm),
    eligibilityConsumer.initialize(jsm),
  ]);
  logger.info('NATS consumers initialized');

  // Start consuming
  const js = natsClient.getJetStream();
  await Promise.all([
    commandConsumer.start(js),
    eventConsumer.start(js),
    eligibilityConsumer.start(js),
  ]);
  logger.info('NATS consumers started processing messages');

  // Create health checker
  const healthChecker: NatsHealthChecker = {
    getNatsStatus: () => ({
      connected: natsClient?.isConnected() ?? false,
    }),
    getCommandConsumerStats: () => commandConsumer?.getStats() ?? { processed: 0, errored: 0, running: false },
    getEventConsumerStats: () => eventConsumer?.getStats() ?? { processed: 0, errored: 0, running: false },
    getEligibilityConsumerStats: () => eligibilityConsumer?.getStats() ?? { processed: 0, errored: 0, running: false },
    getRedisStatus: () => stateManager?.isConnected() ?? false,
    getRedisLatency: () => stateManager?.ping() ?? Promise.resolve(null),
    getStartTime: () => startTime,
  };

  // Start health server
  healthServer = createNatsHealthServer(config.healthPort, config.memoryThresholdMb, healthChecker, logger);
  logger.info({ port: config.healthPort }, 'Health check server started');

  logger.info('Worker service (NATS mode) fully initialized and ready');
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown');

  // Stop health server first
  if (healthServer) {
    healthServer.close();
    logger.info('Health server closed');
  }

  // Stop consumers (but keep connections open to finish in-flight)
  const stopPromises: Promise<void>[] = [];

  if (commandConsumer) {
    stopPromises.push(commandConsumer.stop());
  }
  if (eventConsumer) {
    stopPromises.push(eventConsumer.stop());
  }
  if (eligibilityConsumer) {
    stopPromises.push(eligibilityConsumer.stop());
  }

  await Promise.all(stopPromises);
  logger.info('NATS consumers stopped');

  // Close connections
  await Promise.all([
    natsClient?.close(),
    stateManager?.close(),
  ]);

  logger.info('All connections closed, worker shutdown complete');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
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
  logger.fatal({ error }, 'Failed to start worker (NATS mode)');
  process.exit(1);
});
