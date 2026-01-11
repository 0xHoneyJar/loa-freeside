// @ts-nocheck
// TODO: Fix interface mismatches with ICoexistenceStorage (StoredCommunityBasic vs string)
/**
 * RollbackWatcherJob - Scheduled Auto-Rollback Monitoring
 *
 * Sprint 63: Migration Engine - Rollback & Takeover
 *
 * Runs every hour (configurable) to check all communities in parallel/primary mode
 * for auto-rollback conditions:
 * - >5% access loss in 1 hour window
 * - >10% error rate in 15 minute window
 *
 * Integration: Designed for trigger.dev or any cron scheduler.
 *
 * CRITICAL: This job monitors metrics and triggers rollbacks when thresholds are exceeded.
 * Admins are notified when auto-rollback occurs.
 *
 * @module packages/jobs/coexistence/RollbackWatcherJob
 */

import type {
  ICoexistenceStorage,
  CoexistenceMode,
} from '../../core/ports/ICoexistenceStorage.js';
import {
  MigrationEngine,
  type RollbackResult,
  type NotifyAdminCallback,
  type RenameRolesCallback,
  ACCESS_LOSS_WINDOW_MS,
  ERROR_RATE_WINDOW_MS,
} from '../../adapters/coexistence/MigrationEngine.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the rollback watcher job
 */
export interface RollbackWatcherJobConfig {
  /** Run interval in minutes (default: 60 - hourly) */
  intervalMinutes?: number;
  /** Maximum communities to process per run (default: 100) */
  maxCommunitiesPerRun?: number;
  /** Enable admin notifications (default: true) */
  enableNotifications?: boolean;
  /** Dry run mode - check but don't actually rollback (default: false) */
  dryRun?: boolean;
}

/**
 * Result of a complete watcher job run
 */
export interface RollbackWatcherJobResult {
  /** Timestamp of job start */
  startedAt: Date;
  /** Timestamp of job completion */
  completedAt: Date;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Number of communities checked */
  communitiesChecked: number;
  /** Number of communities with issues detected */
  issuesDetected: number;
  /** Number of rollbacks triggered */
  rollbacksTriggered: number;
  /** Individual rollback results */
  rollbackResults: RollbackDetail[];
  /** Communities where max rollbacks reached */
  maxRollbacksReached: string[];
  /** Whether job completed successfully */
  success: boolean;
  /** Error message if job-level failure */
  error?: string;
}

/**
 * Details of a rollback (triggered or would-be in dry run)
 */
export interface RollbackDetail {
  communityId: string;
  guildId: string;
  trigger: 'access_loss' | 'error_rate';
  reason: string;
  previousMode: CoexistenceMode;
  newMode: CoexistenceMode;
  rollbackCount: number;
  dryRun: boolean;
  result?: RollbackResult;
}

/**
 * Community with guild mapping for watcher
 */
export interface WatcherCommunityMapping {
  communityId: string;
  guildId: string;
  adminUserId: string;
}

/**
 * Callback to get community-to-guild mappings with admin info
 */
export type GetWatcherCommunityMappings = (
  communityIds: string[]
) => Promise<WatcherCommunityMapping[]>;

/**
 * Callback to get access metrics for a community
 *
 * Returns previous and current member counts for access comparison.
 */
export type GetAccessCounts = (
  communityId: string,
  windowMs: number
) => Promise<{ previousCount: number; currentCount: number }>;

/**
 * Callback to get error metrics for a community
 *
 * Returns total and failed operations within the window.
 */
export type GetErrorCounts = (
  communityId: string,
  windowMs: number
) => Promise<{ totalOperations: number; failedOperations: number }>;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Rollback Watcher Job
 *
 * Scheduled job that monitors all communities in parallel/primary mode
 * and triggers auto-rollback when thresholds are exceeded.
 */
export class RollbackWatcherJob {
  private readonly logger: ILogger;
  private readonly config: Required<RollbackWatcherJobConfig>;
  private readonly migrationEngine: MigrationEngine;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly getCommunityMappings: GetWatcherCommunityMappings,
    private readonly getAccessCounts: GetAccessCounts,
    private readonly getErrorCounts: GetErrorCounts,
    renameRoles?: RenameRolesCallback,
    notifyAdmin?: NotifyAdminCallback,
    config: RollbackWatcherJobConfig = {},
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'RollbackWatcherJob' });
    this.config = {
      intervalMinutes: config.intervalMinutes ?? 60,
      maxCommunitiesPerRun: config.maxCommunitiesPerRun ?? 100,
      enableNotifications: config.enableNotifications ?? true,
      dryRun: config.dryRun ?? false,
    };

    // Create migration engine with callbacks
    this.migrationEngine = new MigrationEngine(
      storage,
      undefined, // applyRoles - not needed for watcher
      undefined, // getGuildMembers - not needed for watcher
      renameRoles,
      notifyAdmin,
      this.logger
    );
  }

  /**
   * Run the rollback watcher job
   *
   * This is the main entry point called by the scheduler (trigger.dev).
   *
   * @returns Job result summary
   */
  async run(): Promise<RollbackWatcherJobResult> {
    const startedAt = new Date();

    this.logger.info('Rollback watcher job started', {
      maxCommunities: this.config.maxCommunitiesPerRun,
      dryRun: this.config.dryRun,
    });

    const rollbackResults: RollbackDetail[] = [];
    const maxRollbacksReached: string[] = [];
    let communitiesChecked = 0;
    let issuesDetected = 0;
    let rollbacksTriggered = 0;

    try {
      // Get communities in parallel or primary mode (candidates for rollback)
      const parallelCommunityIds = await this.storage.getCommunitiesByMode('parallel');
      const primaryCommunityIds = await this.storage.getCommunitiesByMode('primary');
      const candidateCommunityIds = [...parallelCommunityIds, ...primaryCommunityIds];

      if (candidateCommunityIds.length === 0) {
        this.logger.info('No communities in parallel/primary mode');
        return {
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          communitiesChecked: 0,
          issuesDetected: 0,
          rollbacksTriggered: 0,
          rollbackResults: [],
          maxRollbacksReached: [],
          success: true,
        };
      }

      // Limit to max communities per run
      const communityIdsToProcess = candidateCommunityIds.slice(
        0,
        this.config.maxCommunitiesPerRun
      );

      this.logger.info('Checking communities for auto-rollback conditions', {
        total: candidateCommunityIds.length,
        processing: communityIdsToProcess.length,
      });

      // Get mappings with admin info
      const mappings = await this.getCommunityMappings(communityIdsToProcess);
      const mappingsByComm = new Map(mappings.map(m => [m.communityId, m]));

      // Check each community
      for (const communityId of communityIdsToProcess) {
        const mapping = mappingsByComm.get(communityId);

        if (!mapping) {
          this.logger.warn('No mapping for community', { communityId });
          continue;
        }

        try {
          communitiesChecked++;

          // Get metrics
          const accessCounts = await this.getAccessCounts(communityId, ACCESS_LOSS_WINDOW_MS);
          const errorCounts = await this.getErrorCounts(communityId, ERROR_RATE_WINDOW_MS);

          // Calculate metrics
          const accessMetrics = await this.migrationEngine.calculateAccessMetrics(
            communityId,
            accessCounts.previousCount,
            accessCounts.currentCount
          );

          const errorMetrics = await this.migrationEngine.calculateErrorMetrics(
            communityId,
            errorCounts.totalOperations,
            errorCounts.failedOperations
          );

          // Check if auto-rollback should trigger
          const checkResult = await this.migrationEngine.checkAutoRollback(
            communityId,
            accessMetrics,
            errorMetrics
          );

          if (checkResult.maxRollbacksReached) {
            maxRollbacksReached.push(communityId);
            this.logger.warn('Max rollbacks reached for community', {
              communityId,
              reason: checkResult.reason,
            });
            continue;
          }

          if (checkResult.shouldRollback) {
            issuesDetected++;

            const state = await this.storage.getMigrationState(communityId);
            const previousMode = state?.currentMode ?? 'parallel';

            // Determine new mode
            const newMode: CoexistenceMode = previousMode === 'primary' ? 'parallel' : 'shadow';

            // Determine trigger type
            const trigger = checkResult.trigger === 'auto_error_rate' ? 'error_rate' : 'access_loss';

            if (this.config.dryRun) {
              // Dry run - record what would happen
              rollbackResults.push({
                communityId,
                guildId: mapping.guildId,
                trigger,
                reason: checkResult.reason ?? 'Threshold exceeded',
                previousMode,
                newMode,
                rollbackCount: state?.rollbackCount ?? 0,
                dryRun: true,
              });

              this.logger.info('Dry run: would trigger rollback', {
                communityId,
                trigger,
                reason: checkResult.reason,
              });
            } else {
              // Execute rollback
              const result = await this.migrationEngine.executeAutoRollbackIfNeeded(
                communityId,
                mapping.guildId,
                mapping.adminUserId,
                accessMetrics,
                errorMetrics
              );

              if (result) {
                rollbacksTriggered++;
                rollbackResults.push({
                  communityId,
                  guildId: mapping.guildId,
                  trigger,
                  reason: checkResult.reason ?? 'Threshold exceeded',
                  previousMode: result.previousMode,
                  newMode: result.newMode,
                  rollbackCount: result.rollbackCount,
                  dryRun: false,
                  result,
                });

                this.logger.info('Auto-rollback executed', {
                  communityId,
                  previousMode: result.previousMode,
                  newMode: result.newMode,
                  trigger,
                });
              }
            }
          }
        } catch (error) {
          this.logger.error('Failed to check community', {
            communityId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const completedAt = new Date();

      this.logger.info('Rollback watcher job completed', {
        communitiesChecked,
        issuesDetected,
        rollbacksTriggered,
        maxRollbacksReached: maxRollbacksReached.length,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });

      return {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        communitiesChecked,
        issuesDetected,
        rollbacksTriggered,
        rollbackResults,
        maxRollbacksReached,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Rollback watcher job failed', { error: errorMessage });

      return {
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        communitiesChecked,
        issuesDetected,
        rollbacksTriggered,
        rollbackResults,
        maxRollbacksReached,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check a single community (for on-demand checks)
   *
   * Useful for testing or manual invocation.
   */
  async checkCommunity(communityId: string, guildId: string, adminUserId: string): Promise<{
    shouldRollback: boolean;
    reason?: string;
    result?: RollbackResult;
  }> {
    const accessCounts = await this.getAccessCounts(communityId, ACCESS_LOSS_WINDOW_MS);
    const errorCounts = await this.getErrorCounts(communityId, ERROR_RATE_WINDOW_MS);

    const accessMetrics = await this.migrationEngine.calculateAccessMetrics(
      communityId,
      accessCounts.previousCount,
      accessCounts.currentCount
    );

    const errorMetrics = await this.migrationEngine.calculateErrorMetrics(
      communityId,
      errorCounts.totalOperations,
      errorCounts.failedOperations
    );

    const checkResult = await this.migrationEngine.checkAutoRollback(
      communityId,
      accessMetrics,
      errorMetrics
    );

    if (!checkResult.shouldRollback) {
      return { shouldRollback: false };
    }

    if (this.config.dryRun) {
      return {
        shouldRollback: true,
        reason: checkResult.reason,
      };
    }

    const result = await this.migrationEngine.executeAutoRollbackIfNeeded(
      communityId,
      guildId,
      adminUserId,
      accessMetrics,
      errorMetrics
    );

    return {
      shouldRollback: true,
      reason: checkResult.reason,
      result: result ?? undefined,
    };
  }
}

/**
 * Factory function to create RollbackWatcherJob
 */
export function createRollbackWatcherJob(
  storage: ICoexistenceStorage,
  getCommunityMappings: GetWatcherCommunityMappings,
  getAccessCounts: GetAccessCounts,
  getErrorCounts: GetErrorCounts,
  renameRoles?: RenameRolesCallback,
  notifyAdmin?: NotifyAdminCallback,
  config?: RollbackWatcherJobConfig,
  logger?: ILogger
): RollbackWatcherJob {
  return new RollbackWatcherJob(
    storage,
    getCommunityMappings,
    getAccessCounts,
    getErrorCounts,
    renameRoles,
    notifyAdmin,
    config,
    logger
  );
}
