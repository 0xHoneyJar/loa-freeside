/**
 * Worker Service Entry Point
 *
 * Runs scheduled background jobs for coexistence mode:
 * - IncumbentHealthJob: Checks incumbent bot health hourly
 *
 * This worker runs separately from the API server and requires:
 * - Discord bot token (for Discord client)
 * - PostgreSQL connection (for CoexistenceStorage)
 *
 * Note: ShadowSyncJob and RollbackWatcherJob are class-based without start/stop
 * methods - they're designed for trigger.dev integration. IncumbentHealthJob
 * has interval-based scheduling built in.
 *
 * @module jobs/worker
 */

import { Client, GatewayIntentBits } from 'discord.js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { initDatabase } from '../db/index.js';
import { createCoexistenceStorage } from '../packages/adapters/coexistence/index.js';
import {
  createIncumbentHealthJob,
  type HealthJobConfig,
} from '../packages/jobs/coexistence/index.js';
import type { ICoexistenceStorage } from '../packages/core/ports/ICoexistenceStorage.js';

// =============================================================================
// Worker State
// =============================================================================

let discordClient: Client | null = null;
let coexistenceStorage: ICoexistenceStorage | null = null;
let postgresClient: ReturnType<typeof postgres> | null = null;
let isShuttingDown = false;

// Job instances (for graceful shutdown)
let healthJob: ReturnType<typeof createIncumbentHealthJob> | null = null;

// =============================================================================
// Discord Client Setup
// =============================================================================

/**
 * Initialize Discord client for worker
 */
async function initDiscordClient(): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
    ],
  });

  return new Promise((resolve, reject) => {
    client.once('ready', () => {
      logger.info({ user: client.user?.tag }, 'Worker Discord client ready');
      resolve(client);
    });

    client.once('error', (error) => {
      logger.error({ error }, 'Worker Discord client error');
      reject(error);
    });

    if (!config.discord.botToken) {
      reject(new Error('DISCORD_BOT_TOKEN not configured'));
      return;
    }

    client.login(config.discord.botToken).catch(reject);
  });
}

// =============================================================================
// Storage Setup
// =============================================================================

/**
 * Initialize coexistence storage with PostgreSQL
 */
async function initStorage(): Promise<ICoexistenceStorage> {
  if (!config.database.url) {
    throw new Error('DATABASE_URL not configured - PostgreSQL required for coexistence jobs');
  }

  // Initialize SQLite for legacy code paths (required by some modules)
  initDatabase();

  // Create PostgreSQL connection
  postgresClient = postgres(config.database.url, {
    max: 5, // Smaller pool for worker
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(postgresClient);

  // Create PostgreSQL-backed coexistence storage
  const storage = createCoexistenceStorage(db);

  logger.info('Coexistence storage initialized with PostgreSQL');
  return storage;
}

// =============================================================================
// Job Configuration
// =============================================================================

/**
 * Get health job configuration from environment
 */
function getHealthJobConfig(): HealthJobConfig {
  return {
    intervalMs: parseInt(process.env.HEALTH_JOB_INTERVAL_MS || '3600000', 10), // 1 hour default
    dryRun: process.env.HEALTH_JOB_DRY_RUN === 'true',
    maxCommunitiesPerRun: parseInt(process.env.HEALTH_JOB_MAX_COMMUNITIES || '100', 10),
  };
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Handle graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, 'Worker received shutdown signal');

  // Stop jobs
  if (healthJob) {
    healthJob.stop();
    logger.info('Incumbent health job stopped');
  }

  // Disconnect Discord
  if (discordClient) {
    discordClient.destroy();
    logger.info('Discord client disconnected');
  }

  // Close PostgreSQL connection
  if (postgresClient) {
    await postgresClient.end();
    logger.info('PostgreSQL connection closed');
  }

  logger.info('Worker shutdown complete');
  process.exit(0);
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  logger.info('Starting worker service');

  // Validate required configuration
  if (!config.discord.botToken) {
    throw new Error('DISCORD_BOT_TOKEN is required for worker service');
  }

  if (!config.database.url) {
    throw new Error('DATABASE_URL is required for worker service');
  }

  // Initialize Discord client
  logger.info('Initializing Discord client...');
  discordClient = await initDiscordClient();

  // Initialize storage
  logger.info('Initializing coexistence storage...');
  coexistenceStorage = await initStorage();

  // Get job configuration
  const healthConfig = getHealthJobConfig();

  logger.info({ healthConfig }, 'Job configuration loaded');

  // Create and start the incumbent health job
  // Note: ShadowSyncJob and RollbackWatcherJob are designed for trigger.dev
  // integration (they have run() but not start()/stop()). IncumbentHealthJob
  // has built-in interval scheduling.
  try {
    healthJob = createIncumbentHealthJob(
      coexistenceStorage,
      discordClient,
      undefined, // notifyAdmin callback - can be added later
      undefined, // activateBackup callback - can be added later
      healthConfig
    );
    healthJob.start();
    logger.info('Incumbent health job started');
  } catch (error) {
    logger.error({ error }, 'Failed to start incumbent health job');
    throw error;
  }

  // Set up graceful shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Worker uncaught exception');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Worker unhandled rejection');
  });

  logger.info('Worker service started successfully');
}

// Run main
main().catch((error) => {
  logger.fatal({ error }, 'Failed to start worker service');
  process.exit(1);
});
