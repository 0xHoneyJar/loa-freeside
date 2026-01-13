/**
 * Incumbent Health Job - Sprint 64
 *
 * Scheduled job that monitors incumbent bot health across all communities.
 * Runs hourly by default, checking:
 * - Bot online presence
 * - Role update freshness
 * - Verification channel activity
 *
 * Triggers alerts and can recommend backup activation.
 *
 * @module packages/jobs/coexistence/IncumbentHealthJob
 */

import type { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import {
  IncumbentHealthMonitor,
  createIncumbentHealthMonitor,
  type HealthReport,
  type HealthAlert,
  type NotifyAdminCallback,
  type ActivateBackupCallback,
  type HealthMonitorConfig,
} from '../../adapters/coexistence/IncumbentHealthMonitor.js';
import type { ICoexistenceStorage } from '../../core/ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Job Constants
// =============================================================================

/** Default job interval (1 hour) */
export const DEFAULT_JOB_INTERVAL_MS = 60 * 60 * 1000;

/** Job name for logging */
export const JOB_NAME = 'incumbent-health-check';

// =============================================================================
// Job Types
// =============================================================================

/**
 * Job run result
 */
export interface HealthJobResult {
  /** Total communities checked */
  totalChecked: number;
  /** Communities with healthy status */
  healthy: number;
  /** Communities with degraded status */
  degraded: number;
  /** Communities with offline status */
  offline: number;
  /** Alerts sent (not throttled) */
  alertsSent: number;
  /** Alerts throttled */
  alertsThrottled: number;
  /** Errors encountered */
  errors: number;
  /** Job duration in ms */
  durationMs: number;
  /** Individual reports (for debugging) */
  reports: HealthReport[];
}

/**
 * Job configuration options
 */
export interface HealthJobConfig {
  /** Override job interval (ms) */
  intervalMs?: number;
  /** Health monitor configuration */
  monitorConfig?: HealthMonitorConfig;
  /** Dry run mode (no alerts sent) */
  dryRun?: boolean;
  /** Maximum communities to process per run (for rate limiting) */
  maxCommunitiesPerRun?: number;
}

/**
 * Callback for creating health alert embed
 */
export type CreateAlertEmbedCallback = (
  alert: HealthAlert
) => { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] };

// =============================================================================
// Implementation
// =============================================================================

/**
 * Incumbent Health Job
 *
 * Monitors incumbent bot health and sends alerts when issues are detected.
 */
export class IncumbentHealthJob {
  private readonly logger: ILogger;
  private readonly monitor: IncumbentHealthMonitor;
  private readonly config: Required<HealthJobConfig>;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    notifyAdmin?: NotifyAdminCallback,
    activateBackup?: ActivateBackupCallback,
    config: HealthJobConfig = {},
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'IncumbentHealthJob' });
    this.config = {
      intervalMs: config.intervalMs ?? DEFAULT_JOB_INTERVAL_MS,
      monitorConfig: config.monitorConfig ?? {},
      dryRun: config.dryRun ?? false,
      maxCommunitiesPerRun: config.maxCommunitiesPerRun ?? 100,
    };

    // Create monitor instance
    this.monitor = createIncumbentHealthMonitor(
      storage,
      discordClient,
      notifyAdmin,
      activateBackup,
      {
        ...this.config.monitorConfig,
        dryRun: this.config.dryRun,
      },
      this.logger
    );
  }

  /**
   * Start the scheduled job
   */
  start(): void {
    if (this.intervalHandle) {
      this.logger.warn('Job already started');
      return;
    }

    this.logger.info('Starting incumbent health job', {
      intervalMs: this.config.intervalMs,
      dryRun: this.config.dryRun,
    });

    // Run immediately on start
    this.run().catch((error) => {
      this.logger.error('Initial job run failed', { error });
    });

    // Schedule recurring runs
    this.intervalHandle = setInterval(() => {
      this.run().catch((error) => {
        this.logger.error('Scheduled job run failed', { error });
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the scheduled job
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info('Incumbent health job stopped');
    }
  }

  /**
   * Run a single health check cycle
   */
  async run(): Promise<HealthJobResult> {
    // Prevent concurrent runs
    if (this.isRunning) {
      this.logger.warn('Job already running, skipping');
      return {
        totalChecked: 0,
        healthy: 0,
        degraded: 0,
        offline: 0,
        alertsSent: 0,
        alertsThrottled: 0,
        errors: 0,
        durationMs: 0,
        reports: [],
      };
    }

    this.isRunning = true;
    const startTime = Date.now();

    const result: HealthJobResult = {
      totalChecked: 0,
      healthy: 0,
      degraded: 0,
      offline: 0,
      alertsSent: 0,
      alertsThrottled: 0,
      errors: 0,
      durationMs: 0,
      reports: [],
    };

    try {
      this.logger.info('Starting health check cycle');

      // Get all communities to check
      const reports = await this.monitor.checkAllCommunities();

      // Process results
      for (const report of reports) {
        result.totalChecked++;
        result.reports.push(report);

        switch (report.overallStatus) {
          case 'healthy':
            result.healthy++;
            break;
          case 'degraded':
            result.degraded++;
            if (!report.alertThrottled) {
              result.alertsSent++;
            } else {
              result.alertsThrottled++;
            }
            break;
          case 'offline':
            result.offline++;
            if (!report.alertThrottled) {
              result.alertsSent++;
            } else {
              result.alertsThrottled++;
            }
            break;
        }
      }

      result.durationMs = Date.now() - startTime;

      this.logger.info('Health check cycle completed', {
        totalChecked: result.totalChecked,
        healthy: result.healthy,
        degraded: result.degraded,
        offline: result.offline,
        alertsSent: result.alertsSent,
        alertsThrottled: result.alertsThrottled,
        durationMs: result.durationMs,
      });

      return result;
    } catch (error) {
      result.errors++;
      result.durationMs = Date.now() - startTime;
      this.logger.error('Health check cycle failed', { error, durationMs: result.durationMs });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run health check for a single community
   */
  async checkCommunity(communityId: string): Promise<HealthReport | null> {
    return this.monitor.checkHealth(communityId);
  }

  /**
   * Get the underlying health monitor
   */
  getMonitor(): IncumbentHealthMonitor {
    return this.monitor;
  }

  /**
   * Check if job is currently running
   */
  isJobRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Check if job is scheduled
   */
  isScheduled(): boolean {
    return this.intervalHandle !== null;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an IncumbentHealthJob instance
 */
export function createIncumbentHealthJob(
  storage: ICoexistenceStorage,
  discordClient: Client,
  notifyAdmin?: NotifyAdminCallback,
  activateBackup?: ActivateBackupCallback,
  config?: HealthJobConfig,
  logger?: ILogger
): IncumbentHealthJob {
  return new IncumbentHealthJob(
    storage,
    discordClient,
    notifyAdmin,
    activateBackup,
    config,
    logger
  );
}

// =============================================================================
// Trigger.dev Task Definition
// =============================================================================

/**
 * Task payload for trigger.dev integration
 */
export interface HealthJobPayload {
  /** Optional community ID to check (if not provided, checks all) */
  communityId?: string;
  /** Dry run mode */
  dryRun?: boolean;
}

/**
 * Create trigger.dev task definition
 *
 * Usage with trigger.dev:
 * ```ts
 * import { task, schedules } from '@trigger.dev/sdk/v3';
 * import { createHealthCheckTask } from './IncumbentHealthJob.js';
 *
 * const healthCheckTask = createHealthCheckTask(storage, discordClient, notifyAdmin);
 *
 * export const incumbentHealthCheck = task({
 *   id: 'incumbent-health-check',
 *   run: healthCheckTask,
 * });
 *
 * // Schedule hourly
 * schedules.create({
 *   id: 'incumbent-health-hourly',
 *   cron: '0 * * * *', // Every hour
 *   task: incumbentHealthCheck,
 * });
 * ```
 */
export function createHealthCheckTask(
  storage: ICoexistenceStorage,
  discordClient: Client,
  notifyAdmin?: NotifyAdminCallback,
  activateBackup?: ActivateBackupCallback,
  logger?: ILogger
): (payload: HealthJobPayload) => Promise<HealthJobResult> {
  const monitor = createIncumbentHealthMonitor(
    storage,
    discordClient,
    notifyAdmin,
    activateBackup,
    {},
    logger
  );

  return async (payload: HealthJobPayload): Promise<HealthJobResult> => {
    const startTime = Date.now();
    const result: HealthJobResult = {
      totalChecked: 0,
      healthy: 0,
      degraded: 0,
      offline: 0,
      alertsSent: 0,
      alertsThrottled: 0,
      errors: 0,
      durationMs: 0,
      reports: [],
    };

    try {
      let reports: HealthReport[];

      if (payload.communityId) {
        // Check single community
        const report = await monitor.checkHealth(payload.communityId);
        reports = report ? [report] : [];
      } else {
        // Check all communities
        reports = await monitor.checkAllCommunities();
      }

      // Process results
      for (const report of reports) {
        result.totalChecked++;
        result.reports.push(report);

        switch (report.overallStatus) {
          case 'healthy':
            result.healthy++;
            break;
          case 'degraded':
            result.degraded++;
            if (!report.alertThrottled) result.alertsSent++;
            else result.alertsThrottled++;
            break;
          case 'offline':
            result.offline++;
            if (!report.alertThrottled) result.alertsSent++;
            else result.alertsThrottled++;
            break;
        }
      }

      result.durationMs = Date.now() - startTime;
      return result;
    } catch (error) {
      result.errors++;
      result.durationMs = Date.now() - startTime;
      throw error;
    }
  };
}
