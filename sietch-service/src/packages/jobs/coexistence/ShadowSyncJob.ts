// @ts-nocheck
// TODO: Fix interface mismatches - ICoexistenceStorage changed
/**
 * ShadowSyncJob - Scheduled Shadow Mode Synchronization
 *
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 *
 * Runs every 6 hours (configurable) to sync all communities in shadow mode.
 * Processes communities in batches to avoid overwhelming Discord API.
 *
 * Integration: Designed for trigger.dev or any cron scheduler.
 *
 * CRITICAL: This job NEVER performs Discord mutations.
 * It only reads guild information and updates shadow observations.
 *
 * @module packages/jobs/coexistence/ShadowSyncJob
 */

import type { Client } from 'discord.js';
import type {
  ICoexistenceStorage,
  DivergenceSummary,
} from '../../core/ports/ICoexistenceStorage.js';
import {
  ShadowLedger,
  type GetArrakisPredictions,
  type ShadowSyncResult,
} from '../../adapters/coexistence/ShadowLedger.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the shadow sync job
 */
export interface ShadowSyncJobConfig {
  /** Run interval in hours (default: 6) */
  intervalHours?: number;
  /** Maximum communities to process per run (default: 50) */
  maxCommunitiesPerRun?: number;
  /** Members per batch within a guild (default: 100) */
  memberBatchSize?: number;
  /** Skip members synced within this many hours (default: 6) */
  skipRecentHours?: number;
  /** Enable admin digest notifications (default: true) */
  enableDigest?: boolean;
  /** Minimum accuracy change to trigger alert (default: 5%) */
  accuracyAlertThreshold?: number;
}

/**
 * Result of a complete sync job run
 */
export interface ShadowSyncJobResult {
  /** Timestamp of job start */
  startedAt: Date;
  /** Timestamp of job completion */
  completedAt: Date;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Number of communities processed */
  communitiesProcessed: number;
  /** Number of communities that failed */
  communitiesFailed: number;
  /** Total members processed across all communities */
  totalMembersProcessed: number;
  /** Total new divergences detected */
  totalNewDivergences: number;
  /** Individual community results */
  communityResults: ShadowSyncResult[];
  /** Communities with significant accuracy changes */
  accuracyAlerts: AccuracyAlert[];
  /** Whether job completed successfully */
  success: boolean;
  /** Error message if job-level failure */
  error?: string;
}

/**
 * Alert for significant accuracy changes
 */
export interface AccuracyAlert {
  communityId: string;
  previousAccuracy: number;
  currentAccuracy: number;
  change: number;
  direction: 'improved' | 'degraded';
}

/**
 * Community with guild mapping for sync
 */
export interface CommunityGuildMapping {
  communityId: string;
  guildId: string;
  previousAccuracy?: number;
}

/**
 * Callback to get community-to-guild mappings
 *
 * The job doesn't know about the community table structure.
 * This callback allows integration with the actual data model.
 */
export type GetCommunityGuildMappings = (
  communityIds: string[]
) => Promise<CommunityGuildMapping[]>;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Shadow Sync Job
 *
 * Scheduled job that syncs all communities in shadow mode.
 */
export class ShadowSyncJob {
  private readonly logger: ILogger;
  private readonly config: Required<ShadowSyncJobConfig>;
  private readonly shadowLedger: ShadowLedger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    discordClient: Client,
    getPredictions: GetArrakisPredictions,
    private readonly getCommunityMappings: GetCommunityGuildMappings,
    config: ShadowSyncJobConfig = {},
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'ShadowSyncJob' });
    this.config = {
      intervalHours: config.intervalHours ?? 6,
      maxCommunitiesPerRun: config.maxCommunitiesPerRun ?? 50,
      memberBatchSize: config.memberBatchSize ?? 100,
      skipRecentHours: config.skipRecentHours ?? 6,
      enableDigest: config.enableDigest ?? true,
      accuracyAlertThreshold: config.accuracyAlertThreshold ?? 5,
    };

    this.shadowLedger = new ShadowLedger(
      storage,
      discordClient,
      getPredictions,
      this.logger
    );
  }

  /**
   * Run the shadow sync job
   *
   * This is the main entry point called by the scheduler (trigger.dev).
   *
   * @returns Job result summary
   */
  async run(): Promise<ShadowSyncJobResult> {
    const startedAt = new Date();

    this.logger.info('Shadow sync job started', {
      maxCommunities: this.config.maxCommunitiesPerRun,
    });

    const communityResults: ShadowSyncResult[] = [];
    const accuracyAlerts: AccuracyAlert[] = [];
    let communitiesProcessed = 0;
    let communitiesFailed = 0;
    let totalMembersProcessed = 0;
    let totalNewDivergences = 0;

    try {
      // Get all communities in shadow mode
      const shadowCommunityIds = await this.storage.getCommunitiesByMode('shadow');

      if (shadowCommunityIds.length === 0) {
        this.logger.info('No communities in shadow mode');
        return {
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          communitiesProcessed: 0,
          communitiesFailed: 0,
          totalMembersProcessed: 0,
          totalNewDivergences: 0,
          communityResults: [],
          accuracyAlerts: [],
          success: true,
        };
      }

      // Limit to max communities per run
      const communityIdsToProcess = shadowCommunityIds.slice(
        0,
        this.config.maxCommunitiesPerRun
      );

      this.logger.info('Processing shadow communities', {
        total: shadowCommunityIds.length,
        processing: communityIdsToProcess.length,
      });

      // Get guild mappings and previous accuracy
      const mappings = await this.getCommunityMappings(communityIdsToProcess);
      const mappingsByComm = new Map(mappings.map(m => [m.communityId, m]));

      // Get previous accuracy for all communities
      for (const communityId of communityIdsToProcess) {
        const summary = await this.storage.getDivergenceSummary(communityId);
        const mapping = mappingsByComm.get(communityId);
        if (mapping) {
          mapping.previousAccuracy = summary.accuracyPercent;
        }
      }

      // Process each community
      for (const communityId of communityIdsToProcess) {
        const mapping = mappingsByComm.get(communityId);

        if (!mapping) {
          this.logger.warn('No guild mapping for community', { communityId });
          communitiesFailed++;
          continue;
        }

        try {
          const result = await this.shadowLedger.syncGuild({
            communityId,
            guildId: mapping.guildId,
            batchSize: this.config.memberBatchSize,
            skipRecentHours: this.config.skipRecentHours,
          });

          communityResults.push(result);

          if (result.success) {
            communitiesProcessed++;
            totalMembersProcessed += result.membersProcessed;
            totalNewDivergences += result.newDivergences;

            // Check for accuracy alerts
            if (mapping.previousAccuracy !== undefined) {
              const change = result.accuracyPercent - mapping.previousAccuracy;
              if (Math.abs(change) >= this.config.accuracyAlertThreshold) {
                accuracyAlerts.push({
                  communityId,
                  previousAccuracy: mapping.previousAccuracy,
                  currentAccuracy: result.accuracyPercent,
                  change,
                  direction: change > 0 ? 'improved' : 'degraded',
                });
              }
            }
          } else {
            communitiesFailed++;
          }
        } catch (error) {
          this.logger.error('Failed to sync community', {
            communityId,
            error: error instanceof Error ? error.message : String(error),
          });
          communitiesFailed++;
        }
      }

      const completedAt = new Date();

      this.logger.info('Shadow sync job completed', {
        communitiesProcessed,
        communitiesFailed,
        totalMembersProcessed,
        totalNewDivergences,
        accuracyAlerts: accuracyAlerts.length,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });

      return {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        communitiesProcessed,
        communitiesFailed,
        totalMembersProcessed,
        totalNewDivergences,
        communityResults,
        accuracyAlerts,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Shadow sync job failed', { error: errorMessage });

      return {
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        communitiesProcessed,
        communitiesFailed,
        totalMembersProcessed,
        totalNewDivergences,
        communityResults,
        accuracyAlerts,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate admin digest for a community
   *
   * Called after sync to create a summary for admin notification.
   */
  async generateDigest(communityId: string): Promise<AdminDigest> {
    const summary = await this.storage.getDivergenceSummary(communityId);
    const migrationState = await this.storage.getMigrationState(communityId);
    const incumbentConfig = await this.storage.getIncumbentConfig(communityId);

    // Calculate shadow days
    const shadowDays = migrationState?.shadowStartedAt
      ? Math.floor(
          (Date.now() - migrationState.shadowStartedAt.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      : 0;

    // Determine readiness
    const isReady =
      summary.accuracyPercent >= 95 && // 95%+ accuracy
      shadowDays >= 7; // At least 7 days in shadow mode

    return {
      communityId,
      generatedAt: new Date(),
      incumbentProvider: incumbentConfig?.provider ?? 'unknown',
      shadowDays,
      summary,
      isReadyForMigration: isReady,
      readinessReason: isReady
        ? 'Accuracy above 95% for 7+ days'
        : summary.accuracyPercent < 95
        ? `Accuracy ${summary.accuracyPercent.toFixed(1)}% below 95% threshold`
        : `Only ${shadowDays} days in shadow mode (need 7)`,
      recommendations: this.generateRecommendations(summary, shadowDays),
    };
  }

  /**
   * Generate recommendations based on divergence patterns
   */
  private generateRecommendations(
    summary: DivergenceSummary,
    shadowDays: number
  ): string[] {
    const recommendations: string[] = [];

    if (summary.accuracyPercent < 80) {
      recommendations.push(
        'Accuracy is low. Review conviction scoring parameters to better match incumbent access levels.'
      );
    }

    if (summary.arrakisHigherCount > summary.totalMembers * 0.2) {
      recommendations.push(
        'Arrakis would grant MORE access than incumbent for 20%+ of members. Consider tightening tier thresholds.'
      );
    }

    if (summary.arrakisLowerCount > summary.totalMembers * 0.2) {
      recommendations.push(
        'Arrakis would grant LESS access than incumbent for 20%+ of members. Consider relaxing tier thresholds or adjusting conviction decay.'
      );
    }

    if (summary.mismatchCount > summary.totalMembers * 0.1) {
      recommendations.push(
        'High mismatch rate (different roles, not higher/lower). Review role mapping configuration.'
      );
    }

    if (shadowDays < 7) {
      recommendations.push(
        `Continue shadow observation for ${7 - shadowDays} more days before considering migration.`
      );
    }

    if (recommendations.length === 0 && summary.accuracyPercent >= 95) {
      recommendations.push(
        'Shadow mode performance is excellent! Consider scheduling migration when ready.'
      );
    }

    return recommendations;
  }
}

/**
 * Admin digest summary for notification
 */
export interface AdminDigest {
  communityId: string;
  generatedAt: Date;
  incumbentProvider: string;
  shadowDays: number;
  summary: DivergenceSummary;
  isReadyForMigration: boolean;
  readinessReason: string;
  recommendations: string[];
}

/**
 * Factory function to create ShadowSyncJob
 */
export function createShadowSyncJob(
  storage: ICoexistenceStorage,
  discordClient: Client,
  getPredictions: GetArrakisPredictions,
  getCommunityMappings: GetCommunityGuildMappings,
  config?: ShadowSyncJobConfig,
  logger?: ILogger
): ShadowSyncJob {
  return new ShadowSyncJob(
    storage,
    discordClient,
    getPredictions,
    getCommunityMappings,
    config,
    logger
  );
}
