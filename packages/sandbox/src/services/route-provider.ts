/**
 * RouteProvider - Event Routing Management
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 *
 * Manages the mapping between Discord guild IDs and sandbox IDs
 * for event routing. Maintains Redis cache for fast lookups.
 *
 * @see SDD §4.3 RouteProvider
 * @module packages/sandbox/services/route-provider
 */

import type { Logger } from 'pino';
import type postgres from 'postgres';
import type { Redis } from 'ioredis';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for RouteProvider
 */
export interface RouteProviderConfig {
  /** PostgreSQL client (postgres.js) */
  sql: postgres.Sql;

  /** Redis client (ioredis) */
  redis: Redis;

  /** Logger instance */
  logger: Logger;

  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
}

/**
 * Route lookup result
 */
export interface RouteLookupResult {
  /** Sandbox ID (null if not mapped) */
  sandboxId: string | null;

  /** Whether result came from cache */
  cached: boolean;

  /** Lookup latency in milliseconds */
  latencyMs: number;
}

/**
 * Route mapping entry
 */
export interface RouteMapping {
  guildId: string;
  sandboxId: string;
  createdAt: Date;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CACHE_TTL_MS = 60_000; // 1 minute
const CACHE_KEY_PREFIX = 'sandbox:route:';
const NULL_SENTINEL = '__NULL__'; // Sentinel value to cache "not found"

// =============================================================================
// RouteProvider
// =============================================================================

/**
 * Manages guild-to-sandbox routing with Redis caching
 */
export class RouteProvider {
  private readonly sql: postgres.Sql;
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly cacheTtlMs: number;

  constructor(config: RouteProviderConfig) {
    this.sql = config.sql;
    this.redis = config.redis;
    this.logger = config.logger.child({ component: 'RouteProvider' });
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  // ===========================================================================
  // Route Lookup
  // ===========================================================================

  /**
   * Get sandbox ID for a guild (with cache)
   *
   * Lookup order:
   * 1. Check Redis cache: sandbox:route:{guildId}
   * 2. If miss: query sandbox_guild_mapping table
   * 3. Cache result (even null to prevent repeated DB hits)
   *
   * Gracefully degrades to database-only if Redis fails.
   *
   * @param guildId - Discord guild ID
   * @returns Sandbox ID or null if not mapped
   */
  async getSandboxForGuild(guildId: string): Promise<RouteLookupResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(guildId);

    // Try cache first (with graceful degradation)
    let cached: string | null = null;
    try {
      cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        const sandboxId = cached === NULL_SENTINEL ? null : cached;
        return {
          sandboxId,
          cached: true,
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      // Redis failure - degrade to database-only lookup
      this.logger.warn({ guildId, error }, 'Redis cache read failed, falling back to database');
    }

    // Cache miss or Redis failure - query database
    const rows = await this.sql<{ sandbox_id: string }[]>`
      SELECT m.sandbox_id
      FROM sandbox_guild_mapping m
      JOIN sandboxes s ON s.id = m.sandbox_id
      WHERE m.guild_id = ${guildId}
        AND s.status = 'running'
    `;

    const sandboxId = rows.length > 0 ? rows[0].sandbox_id : null;

    // Cache the result (best-effort, non-blocking)
    try {
      await this.redis.set(
        cacheKey,
        sandboxId ?? NULL_SENTINEL,
        'PX',
        this.cacheTtlMs
      );
    } catch (error) {
      // Cache write failure is non-fatal
      this.logger.warn({ guildId, error }, 'Redis cache write failed');
    }

    this.logger.debug(
      { guildId, sandboxId, cached: false },
      'Route lookup completed'
    );

    return {
      sandboxId,
      cached: false,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Batch lookup for multiple guilds
   *
   * @param guildIds - Array of guild IDs
   * @returns Map of guild ID to sandbox ID (null if not mapped)
   */
  async getSandboxesForGuilds(
    guildIds: string[]
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const uncachedGuildIds: string[] = [];

    // Check cache for all guilds
    for (const guildId of guildIds) {
      const cacheKey = this.getCacheKey(guildId);
      const cached = await this.redis.get(cacheKey);

      if (cached !== null) {
        results.set(guildId, cached === NULL_SENTINEL ? null : cached);
      } else {
        uncachedGuildIds.push(guildId);
      }
    }

    // Query database for uncached guilds
    if (uncachedGuildIds.length > 0) {
      const rows = await this.sql<{ guild_id: string; sandbox_id: string }[]>`
        SELECT m.guild_id, m.sandbox_id
        FROM sandbox_guild_mapping m
        JOIN sandboxes s ON s.id = m.sandbox_id
        WHERE m.guild_id = ANY(${uncachedGuildIds})
          AND s.status = 'running'
      `;

      // Index results by guild_id
      const dbResults = new Map<string, string>();
      for (const row of rows) {
        dbResults.set(row.guild_id, row.sandbox_id);
      }

      // Cache all uncached guilds (including nulls)
      for (const guildId of uncachedGuildIds) {
        const sandboxId = dbResults.get(guildId) ?? null;
        results.set(guildId, sandboxId);

        await this.redis.set(
          this.getCacheKey(guildId),
          sandboxId ?? NULL_SENTINEL,
          'PX',
          this.cacheTtlMs
        );
      }
    }

    return results;
  }

  // ===========================================================================
  // Route Management
  // ===========================================================================

  /**
   * Register guild to sandbox mapping
   *
   * Updates both PostgreSQL and Redis cache.
   *
   * @param guildId - Discord guild ID
   * @param sandboxId - Sandbox UUID
   */
  async registerMapping(guildId: string, sandboxId: string): Promise<void> {
    // Insert into database (done by SandboxManager, but we update cache)
    await this.redis.set(
      this.getCacheKey(guildId),
      sandboxId,
      'PX',
      this.cacheTtlMs
    );

    this.logger.info({ guildId, sandboxId }, 'Route mapping registered');
  }

  /**
   * Remove guild mapping
   *
   * @param guildId - Discord guild ID
   */
  async removeMapping(guildId: string): Promise<void> {
    // Remove from cache (DB removal done by SandboxManager)
    await this.invalidateCache(guildId);

    this.logger.info({ guildId }, 'Route mapping removed');
  }

  /**
   * Invalidate cache for guild
   *
   * @param guildId - Discord guild ID
   */
  async invalidateCache(guildId: string): Promise<void> {
    await this.redis.del(this.getCacheKey(guildId));

    this.logger.debug({ guildId }, 'Route cache invalidated');
  }

  /**
   * Invalidate cache for all guilds mapped to a sandbox
   *
   * @param sandboxId - Sandbox UUID
   */
  async invalidateSandboxRoutes(sandboxId: string): Promise<void> {
    const guildIds = await this.getGuildsForSandbox(sandboxId);

    for (const guildId of guildIds) {
      await this.invalidateCache(guildId);
    }

    this.logger.info(
      { sandboxId, guildCount: guildIds.length },
      'Invalidated all routes for sandbox'
    );
  }

  // ===========================================================================
  // Route Queries
  // ===========================================================================

  /**
   * Get all guilds mapped to a sandbox
   *
   * @param sandboxId - Sandbox UUID
   * @returns Array of guild IDs
   */
  async getGuildsForSandbox(sandboxId: string): Promise<string[]> {
    const rows = await this.sql<{ guild_id: string }[]>`
      SELECT guild_id
      FROM sandbox_guild_mapping
      WHERE sandbox_id = ${sandboxId}::uuid
    `;

    return rows.map((row) => row.guild_id);
  }

  /**
   * Get all active route mappings
   *
   * @returns Array of route mappings
   */
  async getAllActiveMappings(): Promise<RouteMapping[]> {
    const rows = await this.sql<{
      guild_id: string;
      sandbox_id: string;
      created_at: string;
    }[]>`
      SELECT m.guild_id, m.sandbox_id, m.created_at
      FROM sandbox_guild_mapping m
      JOIN sandboxes s ON s.id = m.sandbox_id
      WHERE s.status = 'running'
      ORDER BY m.created_at DESC
    `;

    return rows.map((row) => ({
      guildId: row.guild_id,
      sandboxId: row.sandbox_id,
      createdAt: new Date(row.created_at),
    }));
  }

  // ===========================================================================
  // Cache Warming
  // ===========================================================================

  /**
   * Warm cache for all active sandboxes
   *
   * Call this at startup to pre-populate the cache.
   */
  async warmCache(): Promise<number> {
    const mappings = await this.getAllActiveMappings();

    for (const mapping of mappings) {
      await this.redis.set(
        this.getCacheKey(mapping.guildId),
        mapping.sandboxId,
        'PX',
        this.cacheTtlMs
      );
    }

    this.logger.info(
      { mappingCount: mappings.length },
      'Route cache warmed'
    );

    return mappings.length;
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * Get route provider statistics
   */
  async getStats(): Promise<{
    totalMappings: number;
    activeSandboxes: number;
  }> {
    const mappingResult = await this.sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM sandbox_guild_mapping
    `;

    const sandboxResult = await this.sql<{ count: string }[]>`
      SELECT COUNT(DISTINCT sandbox_id) as count
      FROM sandbox_guild_mapping m
      JOIN sandboxes s ON s.id = m.sandbox_id
      WHERE s.status = 'running'
    `;

    return {
      totalMappings: parseInt(mappingResult[0].count, 10),
      activeSandboxes: parseInt(sandboxResult[0].count, 10),
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getCacheKey(guildId: string): string {
    return `${CACHE_KEY_PREFIX}${guildId}`;
  }
}
