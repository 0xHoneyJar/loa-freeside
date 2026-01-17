/**
 * PostgreSQL Score Sync Service
 * Sprint S-10: Write-Behind Cache
 *
 * Handles syncing score data from ScyllaDB to PostgreSQL.
 * This is the sync function used by WriteBehindCache.
 *
 * PostgreSQL serves as:
 * - Backup store for disaster recovery
 * - Analytics source (JOINs with profile metadata)
 * - Source of truth for profile relationships
 */

import type { Logger } from 'pino';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql } from 'drizzle-orm';
import type * as schema from '../data/schema.js';
import { profiles } from '../data/schema.js';
import type { PendingSyncItem, SyncBatchResult, PostgresSyncFn } from './WriteBehindCache.js';
import { recordCommand } from './TenantMetrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface PostgresScoreSyncConfig {
  /** Use a transaction for batch updates */
  useTransaction: boolean;
  /** Log individual sync operations */
  verboseLogging: boolean;
}

// --------------------------------------------------------------------------
// Default Configuration
// --------------------------------------------------------------------------

const DEFAULT_CONFIG: PostgresScoreSyncConfig = {
  useTransaction: true,
  verboseLogging: false,
};

// --------------------------------------------------------------------------
// PostgreSQL Score Sync Service
// --------------------------------------------------------------------------

export class PostgresScoreSync {
  private readonly log: Logger;
  private readonly db: PostgresJsDatabase<typeof schema>;
  private readonly config: PostgresScoreSyncConfig;

  constructor(
    db: PostgresJsDatabase<typeof schema>,
    logger: Logger,
    config: Partial<PostgresScoreSyncConfig> = {}
  ) {
    this.db = db;
    this.log = logger.child({ component: 'PostgresScoreSync' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Sync a batch of score items to PostgreSQL
   * This is the PostgresSyncFn implementation for WriteBehindCache
   */
  async syncBatch(items: PendingSyncItem[]): Promise<SyncBatchResult> {
    if (items.length === 0) {
      return { success: 0, failed: 0 };
    }

    const start = Date.now();
    let success = 0;
    let failed = 0;

    try {
      if (this.config.useTransaction) {
        // Process all items in a transaction
        await this.db.transaction(async (tx) => {
          for (const item of items) {
            try {
              await this.syncItem(tx as unknown as PostgresJsDatabase<typeof schema>, item);
              success++;
            } catch (error) {
              failed++;
              this.log.warn(
                { error, profileId: item.profileId, communityId: item.communityId },
                'Failed to sync item in transaction'
              );
              // Continue with other items even if one fails
            }
          }
        });
      } else {
        // Process items individually
        for (const item of items) {
          try {
            await this.syncItem(this.db, item);
            success++;
          } catch (error) {
            failed++;
            this.log.warn(
              { error, profileId: item.profileId, communityId: item.communityId },
              'Failed to sync item'
            );
          }
        }
      }

      const duration = Date.now() - start;
      recordCommand('_system', 'enterprise', 'postgres_sync_batch', failed === 0 ? 'success' : 'partial', duration);

      if (this.config.verboseLogging || failed > 0) {
        this.log.info(
          { success, failed, total: items.length, durationMs: duration },
          'Batch sync completed'
        );
      }

      return { success, failed };
    } catch (error) {
      const duration = Date.now() - start;
      recordCommand('_system', 'enterprise', 'postgres_sync_batch', 'error', duration);
      this.log.error({ error, itemCount: items.length }, 'Batch sync failed completely');

      return { success: 0, failed: items.length };
    }
  }

  /**
   * Sync a single item to PostgreSQL
   */
  private async syncItem(
    db: PostgresJsDatabase<typeof schema>,
    item: PendingSyncItem
  ): Promise<void> {
    // Convert string scores to integers for PostgreSQL
    const convictionScore = Math.round(parseFloat(item.convictionScore) || 0);
    const activityScore = Math.round(parseFloat(item.activityScore) || 0);

    // Update the profile with new scores
    const result = await db
      .update(profiles)
      .set({
        convictionScore,
        activityScore,
        currentRank: item.currentRank,
        updatedAt: item.updatedAt,
      })
      .where(
        and(
          eq(profiles.communityId, item.communityId),
          eq(profiles.id, item.profileId)
        )
      )
      .returning({ id: profiles.id });

    if (result.length === 0) {
      // Profile might not exist - log but don't fail
      // This can happen if profile was deleted between ScyllaDB write and PG sync
      this.log.debug(
        { profileId: item.profileId, communityId: item.communityId },
        'Profile not found in PostgreSQL during sync'
      );
    } else if (this.config.verboseLogging) {
      this.log.debug(
        {
          profileId: item.profileId,
          convictionScore,
          activityScore,
          currentRank: item.currentRank
        },
        'Score synced to PostgreSQL'
      );
    }
  }

  /**
   * Get the sync function for WriteBehindCache
   */
  getSyncFn(): PostgresSyncFn {
    return (items: PendingSyncItem[]) => this.syncBatch(items);
  }

  /**
   * Verify sync status for a profile
   * Compares ScyllaDB score with PostgreSQL score
   */
  async verifySyncStatus(
    communityId: string,
    profileId: string,
    scyllaScore: { conviction: string; activity: string; rank: number }
  ): Promise<{
    inSync: boolean;
    pgScore: { conviction: number; activity: number; rank: number | null } | null;
    drift: { conviction: number; activity: number; rank: number } | null;
  }> {
    const pgProfile = await this.db
      .select({
        convictionScore: profiles.convictionScore,
        activityScore: profiles.activityScore,
        currentRank: profiles.currentRank,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.communityId, communityId),
          eq(profiles.id, profileId)
        )
      )
      .limit(1);

    if (pgProfile.length === 0) {
      return { inSync: false, pgScore: null, drift: null };
    }

    const pg = pgProfile[0]!;
    const scyllaConviction = Math.round(parseFloat(scyllaScore.conviction) || 0);
    const scyllaActivity = Math.round(parseFloat(scyllaScore.activity) || 0);

    const convictionDrift = scyllaConviction - pg.convictionScore;
    const activityDrift = scyllaActivity - pg.activityScore;
    const rankDrift = scyllaScore.rank - (pg.currentRank ?? 0);

    const inSync = convictionDrift === 0 && activityDrift === 0 && rankDrift === 0;

    return {
      inSync,
      pgScore: {
        conviction: pg.convictionScore,
        activity: pg.activityScore,
        rank: pg.currentRank,
      },
      drift: inSync ? null : {
        conviction: convictionDrift,
        activity: activityDrift,
        rank: rankDrift,
      },
    };
  }

  /**
   * Get sync metrics for monitoring
   */
  async getSyncMetrics(communityId: string): Promise<{
    totalProfiles: number;
    profilesWithScores: number;
  }> {
    const result = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        withScores: sql<number>`count(*) FILTER (WHERE ${profiles.convictionScore} > 0 OR ${profiles.activityScore} > 0)::int`,
      })
      .from(profiles)
      .where(eq(profiles.communityId, communityId));

    return {
      totalProfiles: result[0]?.total ?? 0,
      profilesWithScores: result[0]?.withScores ?? 0,
    };
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createPostgresScoreSync(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  config?: Partial<PostgresScoreSyncConfig>
): PostgresScoreSync {
  return new PostgresScoreSync(db, logger, config);
}
