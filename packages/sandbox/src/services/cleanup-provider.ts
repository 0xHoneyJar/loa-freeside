/**
 * CleanupProvider - Resource Cleanup Management
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Handles cleanup of expired sandboxes and orphaned resources.
 * Designed for idempotent execution (safe to retry on failure).
 *
 * @see SDD §4.5 CleanupProvider
 * @module packages/sandbox/services/cleanup-provider
 */

import type { Logger } from 'pino';
import type postgres from 'postgres';
import type { Redis } from 'ioredis';

import type { Sandbox, SandboxStatus } from '../types.js';
import { SandboxError, SandboxErrorCode } from '../types.js';
import type { SchemaProvisioner } from './schema-provisioner.js';
import type { RouteProvider } from './route-provider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for CleanupProvider
 */
export interface CleanupProviderConfig {
  /** PostgreSQL client (postgres.js) */
  sql: postgres.Sql;

  /** Redis client (ioredis) */
  redis: Redis;

  /** Schema provisioner for schema cleanup */
  schemaProvisioner: SchemaProvisioner;

  /** Route provider for cache invalidation */
  routeProvider: RouteProvider;

  /** Logger instance */
  logger: Logger;

  /** Redis key prefix for sandbox keys */
  redisKeyPrefix?: string;

  /** Batch size for Redis SCAN operations */
  redisScanBatchSize?: number;
}

/**
 * Result of cleaning up a single sandbox
 */
export interface CleanupResult {
  /** Sandbox ID */
  sandboxId: string;

  /** Whether cleanup was successful */
  success: boolean;

  /** Steps completed */
  stepsCompleted: CleanupStep[];

  /** Error if cleanup failed */
  error?: string;

  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Cleanup steps
 */
export type CleanupStep =
  | 'mark_destroying'
  | 'remove_guild_mappings'
  | 'invalidate_cache'
  | 'delete_redis_keys'
  | 'drop_schema'
  | 'mark_destroyed';

/**
 * Orphaned resources found during audit
 */
export interface OrphanedResources {
  /** Orphaned PostgreSQL schemas */
  schemas: string[];

  /** Orphaned Redis key prefixes */
  redisKeyPrefixes: string[];

  /** Total count */
  totalCount: number;
}

/**
 * Cleanup statistics
 */
export interface CleanupStats {
  /** Number of sandboxes cleaned up */
  cleanedUp: number;

  /** Number of cleanup failures */
  failed: number;

  /** Redis keys deleted */
  redisKeysDeleted: number;

  /** Schemas dropped */
  schemasDropped: number;

  /** Total time in milliseconds */
  totalDurationMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_REDIS_KEY_PREFIX = 'sandbox:';
const DEFAULT_SCAN_BATCH_SIZE = 100;

// =============================================================================
// CleanupProvider
// =============================================================================

/**
 * Handles cleanup of expired sandboxes and orphaned resources
 */
export class CleanupProvider {
  private readonly sql: postgres.Sql;
  private readonly redis: Redis;
  private readonly schemaProvisioner: SchemaProvisioner;
  private readonly routeProvider: RouteProvider;
  private readonly logger: Logger;
  private readonly redisKeyPrefix: string;
  private readonly redisScanBatchSize: number;

  constructor(config: CleanupProviderConfig) {
    this.sql = config.sql;
    this.redis = config.redis;
    this.schemaProvisioner = config.schemaProvisioner;
    this.routeProvider = config.routeProvider;
    this.logger = config.logger.child({ component: 'CleanupProvider' });
    this.redisKeyPrefix = config.redisKeyPrefix ?? DEFAULT_REDIS_KEY_PREFIX;
    this.redisScanBatchSize = config.redisScanBatchSize ?? DEFAULT_SCAN_BATCH_SIZE;
  }

  // ===========================================================================
  // Expired Sandbox Cleanup
  // ===========================================================================

  /**
   * Find and cleanup all expired sandboxes
   *
   * This is the main entry point for scheduled cleanup jobs.
   *
   * @returns Cleanup statistics
   */
  async cleanupExpired(): Promise<CleanupStats> {
    const startTime = Date.now();
    this.logger.info('Starting expired sandbox cleanup');

    const stats: CleanupStats = {
      cleanedUp: 0,
      failed: 0,
      redisKeysDeleted: 0,
      schemasDropped: 0,
      totalDurationMs: 0,
    };

    try {
      // Find expired sandboxes
      const expired = await this.findExpired();
      this.logger.info({ count: expired.length }, 'Found expired sandboxes');

      // Cleanup each sandbox
      for (const sandbox of expired) {
        const result = await this.cleanupSandbox(sandbox.id);

        if (result.success) {
          stats.cleanedUp++;
          if (result.stepsCompleted.includes('drop_schema')) {
            stats.schemasDropped++;
          }
        } else {
          stats.failed++;
          this.logger.error(
            { sandboxId: sandbox.id, error: result.error },
            'Failed to cleanup sandbox'
          );
        }
      }

      stats.totalDurationMs = Date.now() - startTime;

      this.logger.info(
        {
          ...stats,
          expiredFound: expired.length,
        },
        'Expired sandbox cleanup completed'
      );

      return stats;
    } catch (error) {
      stats.totalDurationMs = Date.now() - startTime;
      this.logger.error({ error, stats }, 'Expired sandbox cleanup failed');
      throw error;
    }
  }

  /**
   * Find sandboxes that have expired
   */
  private async findExpired(): Promise<Sandbox[]> {
    const rows = await this.sql<SandboxRow[]>`
      SELECT s.*,
        COALESCE(
          (SELECT array_agg(guild_id) FROM sandbox_guild_mapping WHERE sandbox_id = s.id),
          ARRAY[]::varchar[]
        ) as guild_ids
      FROM sandboxes s
      WHERE (s.status = 'running' AND s.expires_at < NOW())
         OR s.status = 'expired'
      ORDER BY s.expires_at ASC
    `;

    return rows.map((row) => this.rowToSandbox(row));
  }

  // ===========================================================================
  // Single Sandbox Cleanup
  // ===========================================================================

  /**
   * Cleanup a single sandbox's resources
   *
   * Steps (idempotent):
   * 1. Mark sandbox as 'destroying'
   * 2. Remove guild mappings (and invalidate cache)
   * 3. Delete Redis keys with sandbox prefix
   * 4. Drop PostgreSQL schema
   * 5. Mark sandbox as 'destroyed'
   *
   * Each step is idempotent and safe to retry.
   *
   * @param sandboxId - Sandbox UUID to cleanup
   * @returns Cleanup result
   */
  async cleanupSandbox(sandboxId: string): Promise<CleanupResult> {
    const startTime = Date.now();
    const stepsCompleted: CleanupStep[] = [];

    this.logger.info({ sandboxId }, 'Starting sandbox cleanup');

    try {
      // Step 1: Mark as destroying
      await this.markStatus(sandboxId, 'destroying');
      stepsCompleted.push('mark_destroying');

      // Step 2: Remove guild mappings and invalidate cache
      const guildIds = await this.routeProvider.getGuildsForSandbox(sandboxId);
      if (guildIds.length > 0) {
        await this.sql`
          DELETE FROM sandbox_guild_mapping
          WHERE sandbox_id = ${sandboxId}::uuid
        `;
        stepsCompleted.push('remove_guild_mappings');

        // Invalidate cache for all guilds
        await this.routeProvider.invalidateSandboxRoutes(sandboxId);
        stepsCompleted.push('invalidate_cache');
      }

      // Step 3: Delete Redis keys
      const redisKeysDeleted = await this.cleanupRedisKeys(sandboxId);
      if (redisKeysDeleted > 0) {
        stepsCompleted.push('delete_redis_keys');
      }

      // Step 4: Drop PostgreSQL schema
      const schemaResult = await this.schemaProvisioner.dropSchema(sandboxId);
      if (schemaResult.existed) {
        stepsCompleted.push('drop_schema');
      }

      // Step 5: Mark as destroyed
      await this.markDestroyed(sandboxId);
      stepsCompleted.push('mark_destroyed');

      const result: CleanupResult = {
        sandboxId,
        success: true,
        stepsCompleted,
        durationMs: Date.now() - startTime,
      };

      this.logger.info(
        { sandboxId, stepsCompleted, durationMs: result.durationMs },
        'Sandbox cleanup completed successfully'
      );

      return result;
    } catch (error) {
      const result: CleanupResult = {
        sandboxId,
        success: false,
        stepsCompleted,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };

      this.logger.error(
        { sandboxId, stepsCompleted, error, durationMs: result.durationMs },
        'Sandbox cleanup failed'
      );

      return result;
    }
  }

  // ===========================================================================
  // Redis Key Cleanup
  // ===========================================================================

  /**
   * Delete Redis keys matching sandbox prefix
   *
   * Uses SCAN to avoid blocking on large keyspaces.
   *
   * @param sandboxId - Sandbox UUID
   * @returns Number of keys deleted
   */
  async cleanupRedisKeys(sandboxId: string): Promise<number> {
    const pattern = `${this.redisKeyPrefix}${sandboxId}:*`;
    let deleted = 0;
    let cursor = '0';

    this.logger.debug({ sandboxId, pattern }, 'Starting Redis key cleanup');

    try {
      do {
        // SCAN with pattern matching
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          this.redisScanBatchSize
        );

        cursor = newCursor;

        // Delete keys in batch
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;

          this.logger.debug(
            { sandboxId, batchSize: keys.length, totalDeleted: deleted },
            'Deleted Redis key batch'
          );
        }
      } while (cursor !== '0');

      this.logger.info(
        { sandboxId, keysDeleted: deleted },
        'Redis key cleanup completed'
      );

      return deleted;
    } catch (error) {
      this.logger.error(
        { sandboxId, error, deleted },
        'Redis key cleanup failed'
      );
      throw new SandboxError(
        SandboxErrorCode.CLEANUP_FAILED,
        `Failed to cleanup Redis keys: ${error instanceof Error ? error.message : String(error)}`,
        { sandboxId, deleted, originalError: String(error) }
      );
    }
  }

  // ===========================================================================
  // Orphaned Resource Detection
  // ===========================================================================

  /**
   * Find orphaned resources (resources without parent sandbox)
   *
   * This is useful for audit and manual cleanup.
   */
  async findOrphanedResources(): Promise<OrphanedResources> {
    this.logger.info('Starting orphaned resource detection');

    // Get all sandbox IDs from control plane
    const sandboxes = await this.sql<{ id: string; status: string }[]>`
      SELECT id, status FROM sandboxes
      WHERE status NOT IN ('destroyed')
    `;

    const activeSandboxIds = new Set(sandboxes.map((s) => s.id));

    // Find orphaned schemas
    const allSchemas = await this.schemaProvisioner.listSchemas();
    const orphanedSchemas: string[] = [];

    for (const schemaName of allSchemas) {
      try {
        // Extract the short ID from schema name
        const shortId = schemaName.replace('sandbox_', '');

        // Check if any active sandbox has this short ID prefix
        const isActive = Array.from(activeSandboxIds).some((id) =>
          id.replace(/-/g, '').startsWith(shortId)
        );

        if (!isActive) {
          orphanedSchemas.push(schemaName);
        }
      } catch {
        // Skip schemas that don't match our pattern
      }
    }

    // Find orphaned Redis key prefixes
    const orphanedRedisKeyPrefixes: string[] = [];

    // Sample Redis keys to find sandbox prefixes
    let cursor = '0';
    const foundPrefixes = new Set<string>();
    const maxIterations = 100; // Limit iterations for safety
    let iterations = 0;

    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.redisKeyPrefix}*`,
        'COUNT',
        this.redisScanBatchSize
      );

      cursor = newCursor;
      iterations++;

      for (const key of keys) {
        // Extract sandbox ID from key: sandbox:{sandboxId}:...
        const match = key.match(/^sandbox:([a-f0-9-]+):/);
        if (match) {
          foundPrefixes.add(match[1]);
        }
      }
    } while (cursor !== '0' && iterations < maxIterations);

    // Check each found prefix against active sandboxes
    for (const prefix of foundPrefixes) {
      if (!activeSandboxIds.has(prefix)) {
        orphanedRedisKeyPrefixes.push(prefix);
      }
    }

    const result: OrphanedResources = {
      schemas: orphanedSchemas,
      redisKeyPrefixes: orphanedRedisKeyPrefixes,
      totalCount: orphanedSchemas.length + orphanedRedisKeyPrefixes.length,
    };

    this.logger.info(
      {
        orphanedSchemas: orphanedSchemas.length,
        orphanedRedisKeys: orphanedRedisKeyPrefixes.length,
        total: result.totalCount,
      },
      'Orphaned resource detection completed'
    );

    return result;
  }

  /**
   * Cleanup orphaned resources
   *
   * WARNING: This is destructive. Only call after verifying orphaned resources.
   */
  async cleanupOrphanedResources(): Promise<{
    schemasDropped: string[];
    redisKeysDeleted: number;
  }> {
    const orphaned = await this.findOrphanedResources();
    const schemasDropped: string[] = [];
    let redisKeysDeleted = 0;

    this.logger.warn(
      { orphaned },
      'Starting orphaned resource cleanup - THIS IS DESTRUCTIVE'
    );

    // Drop orphaned schemas
    for (const schemaName of orphaned.schemas) {
      try {
        const shortId = schemaName.replace('sandbox_', '');
        await this.schemaProvisioner.dropSchema(shortId);
        schemasDropped.push(schemaName);
      } catch (error) {
        this.logger.error(
          { schemaName, error },
          'Failed to drop orphaned schema'
        );
      }
    }

    // Delete orphaned Redis keys
    for (const sandboxId of orphaned.redisKeyPrefixes) {
      try {
        const deleted = await this.cleanupRedisKeys(sandboxId);
        redisKeysDeleted += deleted;
      } catch (error) {
        this.logger.error(
          { sandboxId, error },
          'Failed to cleanup orphaned Redis keys'
        );
      }
    }

    this.logger.info(
      { schemasDropped: schemasDropped.length, redisKeysDeleted },
      'Orphaned resource cleanup completed'
    );

    return { schemasDropped, redisKeysDeleted };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async markStatus(sandboxId: string, status: SandboxStatus): Promise<void> {
    await this.sql`
      UPDATE sandboxes
      SET status = ${status}::sandbox_status
      WHERE id = ${sandboxId}::uuid
        AND status NOT IN ('destroyed')
    `;

    await this.createAuditEntry(sandboxId, 'status_changed', 'system', {
      to: status,
      reason: 'cleanup',
    });
  }

  private async markDestroyed(sandboxId: string): Promise<void> {
    await this.sql`
      UPDATE sandboxes
      SET status = 'destroyed', destroyed_at = NOW()
      WHERE id = ${sandboxId}::uuid
    `;

    await this.createAuditEntry(sandboxId, 'sandbox_destroyed', 'system', {
      reason: 'expired',
    });
  }

  private async createAuditEntry(
    sandboxId: string,
    eventType: string,
    actor: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.sql`
      INSERT INTO sandbox_audit_log (sandbox_id, event_type, actor, details)
      VALUES (${sandboxId}::uuid, ${eventType}, ${actor}, ${JSON.stringify(details)})
    `;
  }

  private rowToSandbox(row: SandboxRow): Sandbox {
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      status: row.status as SandboxStatus,
      schemaName: row.schema_name,
      discordTokenId: row.discord_token_id,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      destroyedAt: row.destroyed_at ? new Date(row.destroyed_at) : null,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
      metadata: row.metadata as Sandbox['metadata'],
      guildIds: row.guild_ids ?? [],
    };
  }
}

// =============================================================================
// Internal Types
// =============================================================================

interface SandboxRow {
  id: string;
  name: string;
  owner: string;
  status: string;
  schema_name: string;
  discord_token_id: string | null;
  created_at: string;
  expires_at: string;
  destroyed_at: string | null;
  last_activity_at: string | null;
  metadata: unknown;
  guild_ids: string[] | null;
}
