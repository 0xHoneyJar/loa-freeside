/**
 * Drift Check Job
 *
 * Sprint 124: Drift API & Scheduled Check
 *
 * Scheduled job that runs daily at 00:00 UTC to check all active servers
 * for ghost roles (deleted Discord roles still in config).
 *
 * Alert: Info alert if ghost roles count > 0 for 1 hour
 *
 * @see grimoires/loa/sdd.md §4.3 DriftDetector
 * @module jobs/driftCheck
 */

import type { Guild, Client, TextChannel } from 'discord.js';
import { logger as defaultLogger } from '../utils/logger.js';
import type { IConfigService } from '../services/config/ConfigService.js';
import {
  createDriftDetector,
  clearAllDriftCache,
  type DriftReport,
  type IDriftDetector,
} from '../services/config/DriftDetector.js';
import {
  recordDriftJobRun,
  recordDriftJobError,
  getDriftJobMetricsPrometheus,
} from './driftCheckMetrics.js';

// =============================================================================
// Types
// =============================================================================

export interface DriftCheckJobConfig {
  /** Discord guild for role lookups */
  guild: Guild;
  /** Discord client for sending notifications */
  client?: Client;
  /** ConfigService for fetching configurations */
  configService: IConfigService;
  /** List of active server IDs to check */
  getActiveServerIds: () => Promise<string[]>;
  /** Optional: Send Discord DM on drift detection */
  sendNotifications?: boolean;
  /** Optional: Admin user ID to notify */
  adminUserId?: string;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

export interface DriftCheckResult {
  /** Job run timestamp */
  startedAt: Date;
  /** Job completion timestamp */
  completedAt: Date;
  /** Number of servers checked */
  serversChecked: number;
  /** Number of servers with drift */
  serversWithDrift: number;
  /** Total ghost roles found */
  totalGhostRoles: number;
  /** Total renamed roles found */
  totalRenamedRoles: number;
  /** Per-server reports */
  reports: DriftReport[];
  /** Errors encountered */
  errors: Array<{ serverId: string; error: string }>;
}

export interface IDriftCheckJob {
  run(): Promise<DriftCheckResult>;
  start(): void;
  stop(): void;
  getLastResult(): DriftCheckResult | null;
  isRunning(): boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Run at 00:00 UTC daily */
const DEFAULT_SCHEDULE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Milliseconds until next 00:00 UTC */
function msUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0); // Next midnight
  return midnight.getTime() - now.getTime();
}

// =============================================================================
// DriftCheckJob Implementation
// =============================================================================

export class DriftCheckJob implements IDriftCheckJob {
  private readonly guild: Guild;
  private readonly client?: Client;
  private readonly configService: IConfigService;
  private readonly getActiveServerIds: () => Promise<string[]>;
  private readonly sendNotifications: boolean;
  private readonly adminUserId?: string;
  private readonly logger: typeof defaultLogger;
  private readonly driftDetector: IDriftDetector;

  private intervalId: NodeJS.Timeout | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private running = false;
  private lastResult: DriftCheckResult | null = null;

  constructor(config: DriftCheckJobConfig) {
    this.guild = config.guild;
    this.client = config.client;
    this.configService = config.configService;
    this.getActiveServerIds = config.getActiveServerIds;
    this.sendNotifications = config.sendNotifications ?? false;
    this.adminUserId = config.adminUserId;
    this.logger = config.logger ?? defaultLogger;

    this.driftDetector = createDriftDetector({
      guild: this.guild,
      logger: this.logger,
    });
  }

  /**
   * Run drift check for all active servers.
   */
  async run(): Promise<DriftCheckResult> {
    if (this.running) {
      throw new Error('Drift check job is already running');
    }

    this.running = true;
    const startedAt = new Date();

    this.logger.info('Starting daily drift check job');
    recordDriftJobRun();

    const reports: DriftReport[] = [];
    const errors: Array<{ serverId: string; error: string }> = [];
    let totalGhostRoles = 0;
    let totalRenamedRoles = 0;

    try {
      // Clear all caches to ensure fresh checks
      clearAllDriftCache();

      // Get active servers
      const serverIds = await this.getActiveServerIds();
      this.logger.info({ serverCount: serverIds.length }, 'Checking servers for drift');

      // Check each server
      for (const serverId of serverIds) {
        try {
          const config = await this.configService.getCurrentConfiguration(serverId);

          // Skip if no role mappings configured
          if (Object.keys(config.roleMappings).length === 0) {
            continue;
          }

          const report = await this.driftDetector.checkServerDrift(serverId, config);
          reports.push(report);

          if (report.hasDrift) {
            totalGhostRoles += report.deletedRolesCount;
            totalRenamedRoles += report.renamedRolesCount;

            this.logger.warn(
              {
                serverId,
                deletedRoles: report.deletedRolesCount,
                renamedRoles: report.renamedRolesCount,
              },
              'Drift detected in server'
            );

            // Send notification if enabled and has ghost roles
            if (this.sendNotifications && report.deletedRolesCount > 0) {
              await this.sendDriftNotification(report);
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ serverId, error: errorMessage });
          recordDriftJobError();

          this.logger.error(
            { error, serverId },
            'Error checking drift for server'
          );
        }
      }

      const completedAt = new Date();
      const serversWithDrift = reports.filter((r) => r.hasDrift).length;

      const result: DriftCheckResult = {
        startedAt,
        completedAt,
        serversChecked: serverIds.length,
        serversWithDrift,
        totalGhostRoles,
        totalRenamedRoles,
        reports,
        errors,
      };

      this.lastResult = result;

      this.logger.info(
        {
          duration: completedAt.getTime() - startedAt.getTime(),
          serversChecked: result.serversChecked,
          serversWithDrift,
          totalGhostRoles,
          totalRenamedRoles,
          errorCount: errors.length,
        },
        'Drift check job completed'
      );

      return result;
    } finally {
      this.running = false;
    }
  }

  /**
   * Start scheduled drift checks (runs at 00:00 UTC daily).
   */
  start(): void {
    if (this.intervalId || this.timeoutId) {
      this.logger.warn('Drift check job already scheduled');
      return;
    }

    // Schedule first run at next midnight UTC
    const msUntilFirst = msUntilMidnightUTC();
    this.logger.info(
      { msUntilFirst, hoursUntilFirst: Math.round(msUntilFirst / 3600000) },
      'Scheduling drift check job for midnight UTC'
    );

    this.timeoutId = setTimeout(() => {
      // Run first check
      this.run().catch((error) => {
        this.logger.error({ error }, 'Scheduled drift check failed');
      });

      // Then run every 24 hours
      this.intervalId = setInterval(() => {
        this.run().catch((error) => {
          this.logger.error({ error }, 'Scheduled drift check failed');
        });
      }, DEFAULT_SCHEDULE_MS);
    }, msUntilFirst);

    this.logger.info('Drift check job scheduled');
  }

  /**
   * Stop scheduled drift checks.
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.info('Drift check job stopped');
  }

  /**
   * Get the last run result.
   */
  getLastResult(): DriftCheckResult | null {
    return this.lastResult;
  }

  /**
   * Check if job is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Send drift notification via Discord DM.
   */
  private async sendDriftNotification(report: DriftReport): Promise<void> {
    if (!this.client || !this.adminUserId) {
      return;
    }

    try {
      const user = await this.client.users.fetch(this.adminUserId);
      if (!user) {
        this.logger.warn({ adminUserId: this.adminUserId }, 'Admin user not found for notification');
        return;
      }

      const ghostRoleList = report.items
        .filter((i) => i.type === 'ROLE_DELETED')
        .slice(0, 5) // Limit to 5 for readability
        .map((i) => `• ${i.configRoleName} (tier: ${i.tierId})`)
        .join('\n');

      const message = [
        `⚠️ **Ghost Roles Detected**`,
        ``,
        `Server: \`${report.serverId}\``,
        `Ghost roles found: **${report.deletedRolesCount}**`,
        ``,
        report.deletedRolesCount > 5
          ? `Top 5 affected roles:`
          : `Affected roles:`,
        ghostRoleList,
        ``,
        `These Discord roles have been deleted but are still referenced in the configuration.`,
        `Please update your role mappings in the dashboard.`,
      ].join('\n');

      await user.send(message);

      this.logger.info(
        { serverId: report.serverId, adminUserId: this.adminUserId },
        'Drift notification sent'
      );
    } catch (error) {
      this.logger.error(
        { error, serverId: report.serverId },
        'Failed to send drift notification'
      );
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a DriftCheckJob instance.
 */
export function createDriftCheckJob(config: DriftCheckJobConfig): DriftCheckJob {
  return new DriftCheckJob(config);
}

// Re-export metrics
export { getDriftJobMetricsPrometheus } from './driftCheckMetrics.js';
