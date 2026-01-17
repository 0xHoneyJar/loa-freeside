/**
 * Sandbox Cleanup Job
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Standalone job that cleans up expired sandboxes.
 * Designed to run on EventBridge schedule (every 15 minutes).
 *
 * Usage:
 *   node --experimental-vm-modules dist/jobs/sandbox-cleanup.js
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string
 *   REDIS_URL - Redis connection string
 *   LOG_LEVEL - Log level (default: info)
 *
 * @see SDD §4.5 CleanupProvider
 * @module apps/worker/jobs/sandbox-cleanup
 */

import pino from 'pino';
import postgres from 'postgres';
import Redis from 'ioredis';

import { CleanupProvider } from '@arrakis/sandbox';
import { SchemaProvisioner } from '@arrakis/sandbox';
import { RouteProvider } from '@arrakis/sandbox';

// =============================================================================
// Configuration
// =============================================================================

interface CleanupJobConfig {
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  cleanupOrphanedResources: boolean;
}

function loadConfig(): CleanupJobConfig {
  const env = process.env;

  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return {
    databaseUrl,
    redisUrl: env['REDIS_URL'] || 'redis://localhost:6379',
    logLevel: env['LOG_LEVEL'] || 'info',
    cleanupOrphanedResources: env['CLEANUP_ORPHANED'] === 'true',
  };
}

// =============================================================================
// Main Job
// =============================================================================

async function main(): Promise<void> {
  const config = loadConfig();

  const logger = pino({
    level: config.logLevel,
    transport:
      process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

  logger.info('Starting sandbox cleanup job');

  // Initialize connections
  const sql = postgres(config.databaseUrl, {
    max: 5,
    idle_timeout: 30,
  });

  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  try {
    // Verify connections
    await sql`SELECT 1`;
    logger.debug('PostgreSQL connection verified');

    await redis.ping();
    logger.debug('Redis connection verified');

    // Initialize providers
    const schemaProvisioner = new SchemaProvisioner({
      sql,
      logger,
    });

    const routeProvider = new RouteProvider({
      sql,
      redis,
      logger,
    });

    const cleanupProvider = new CleanupProvider({
      sql,
      redis,
      schemaProvisioner,
      routeProvider,
      logger,
    });

    // Run cleanup of expired sandboxes
    const stats = await cleanupProvider.cleanupExpired();

    logger.info(
      {
        cleanedUp: stats.cleanedUp,
        failed: stats.failed,
        schemasDropped: stats.schemasDropped,
        durationMs: stats.totalDurationMs,
      },
      'Expired sandbox cleanup completed'
    );

    // Optionally cleanup orphaned resources
    if (config.cleanupOrphanedResources) {
      logger.info('Starting orphaned resource cleanup');

      const orphanedResult = await cleanupProvider.cleanupOrphanedResources();

      logger.info(
        {
          schemasDropped: orphanedResult.schemasDropped.length,
          redisKeysDeleted: orphanedResult.redisKeysDeleted,
        },
        'Orphaned resource cleanup completed'
      );
    }

    // Emit CloudWatch custom metric for monitoring
    if (process.env['AWS_EXECUTION_ENV']) {
      // When running in AWS (Lambda/ECS), metrics can be sent via stdout
      // CloudWatch Logs Insights can parse these
      console.log(
        JSON.stringify({
          _aws: {
            Timestamp: Date.now(),
            CloudWatchMetrics: [
              {
                Namespace: 'Arrakis/Sandbox',
                Dimensions: [['Environment']],
                Metrics: [
                  { Name: 'SandboxesCleanedUp', Unit: 'Count' },
                  { Name: 'CleanupFailures', Unit: 'Count' },
                  { Name: 'CleanupDurationMs', Unit: 'Milliseconds' },
                ],
              },
            ],
          },
          Environment: process.env['NODE_ENV'] || 'production',
          SandboxesCleanedUp: stats.cleanedUp,
          CleanupFailures: stats.failed,
          CleanupDurationMs: stats.totalDurationMs,
        })
      );
    }

    logger.info('Sandbox cleanup job completed successfully');
  } catch (error) {
    logger.error({ error }, 'Sandbox cleanup job failed');
    process.exit(1);
  } finally {
    // Close connections
    await sql.end();
    redis.disconnect();
    logger.info('Connections closed');
  }
}

// =============================================================================
// Entry Point
// =============================================================================

main().catch((error) => {
  console.error('Fatal error in sandbox cleanup job:', error);
  process.exit(1);
});
