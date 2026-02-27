/**
 * Incumbent Health Monitor - Sprint 64
 *
 * Monitors incumbent bot health and triggers alerts/backup activation.
 *
 * Health Checks:
 * - Bot online presence (alert: 1h)
 * - Role update freshness (alert: 48h, critical: 72h)
 * - Verification channel activity (alert: 168h / 7 days)
 *
 * Features:
 * - Health report per guild
 * - Alert throttling (4 hour cooldown)
 * - Emergency backup activation (shadow → parallel)
 * - Admin notification via DM and audit channel
 *
 * @module packages/adapters/coexistence/IncumbentHealthMonitor
 */

import type { Client, Guild, GuildMember, TextChannel, Message } from 'discord.js';
import type { ICoexistenceStorage, StoredCommunityBasic } from '../../core/ports/ICoexistenceStorage.js';
import type { HealthStatus, IncumbentProvider, CoexistenceMode } from '../storage/schema.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Health Check Constants (Sprint 64)
// =============================================================================

/** Bot online presence alert threshold (1 hour) */
export const BOT_ONLINE_ALERT_MS = 60 * 60 * 1000;

/** Role update freshness alert threshold (48 hours) */
export const ROLE_UPDATE_ALERT_MS = 48 * 60 * 60 * 1000;

/** Role update freshness critical threshold (72 hours) */
export const ROLE_UPDATE_CRITICAL_MS = 72 * 60 * 60 * 1000;

/** Verification channel activity alert threshold (168 hours / 7 days) */
export const CHANNEL_ACTIVITY_ALERT_MS = 168 * 60 * 60 * 1000;

/** Alert throttle cooldown (4 hours) */
export const ALERT_THROTTLE_MS = 4 * 60 * 60 * 1000;

/** Minimum messages to consider channel active */
export const MIN_CHANNEL_ACTIVITY_MESSAGES = 1;

// =============================================================================
// Health Check Types
// =============================================================================

/**
 * Individual health check result
 */
export interface HealthCheckResult {
  /** Check passed or failed */
  passed: boolean;
  /** Severity: 'ok' | 'warning' | 'critical' */
  severity: 'ok' | 'warning' | 'critical';
  /** Human-readable message */
  message: string;
  /** Last observed timestamp (if available) */
  lastObserved?: Date;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Complete health report for a guild
 */
export interface HealthReport {
  /** Community/Guild ID */
  communityId: string;
  /** Discord Guild ID */
  guildId: string;
  /** Incumbent provider type */
  provider: IncumbentProvider;
  /** Overall health status */
  overallStatus: HealthStatus;
  /** Individual check results */
  checks: {
    botOnline: HealthCheckResult;
    roleUpdateFreshness: HealthCheckResult;
    channelActivity: HealthCheckResult;
  };
  /** Timestamp of this report */
  checkedAt: Date;
  /** Whether alert was throttled */
  alertThrottled: boolean;
  /** Last alert timestamp */
  lastAlertAt?: Date;
}

/**
 * Alert message for admin notification
 */
export interface HealthAlert {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Provider name */
  provider: IncumbentProvider;
  /** Alert severity */
  severity: 'warning' | 'critical';
  /** Alert title */
  title: string;
  /** Alert description */
  description: string;
  /** Failed checks summary */
  failedChecks: string[];
  /** Recommended action */
  recommendedAction: string;
  /** Include backup activation button */
  includeBackupButton: boolean;
}

/**
 * Callback for sending admin alerts
 */
export type NotifyAdminCallback = (
  guildId: string,
  alert: HealthAlert
) => Promise<void>;

/**
 * Callback for activating emergency backup
 */
export type ActivateBackupCallback = (
  communityId: string,
  guildId: string,
  reason: string
) => Promise<{ success: boolean; error?: string }>;

// =============================================================================
// Health Monitor Configuration
// =============================================================================

/**
 * Health monitor configuration options
 */
export interface HealthMonitorConfig {
  /** Override bot online threshold (ms) */
  botOnlineThresholdMs?: number;
  /** Override role update alert threshold (ms) */
  roleUpdateAlertMs?: number;
  /** Override role update critical threshold (ms) */
  roleUpdateCriticalMs?: number;
  /** Override channel activity threshold (ms) */
  channelActivityAlertMs?: number;
  /** Override alert throttle (ms) */
  alertThrottleMs?: number;
  /** Dry run mode (no alerts sent) */
  dryRun?: boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Incumbent Health Monitor
 *
 * Monitors incumbent bot health and manages alerting/backup activation.
 */
export class IncumbentHealthMonitor {
  private readonly logger: ILogger;
  private readonly config: Required<HealthMonitorConfig>;

  // In-memory alert throttle tracking (guildId -> lastAlertTime)
  private readonly alertThrottleMap = new Map<string, Date>();

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    private readonly notifyAdmin?: NotifyAdminCallback,
    private readonly activateBackup?: ActivateBackupCallback,
    config: HealthMonitorConfig = {},
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'IncumbentHealthMonitor' });
    this.config = {
      botOnlineThresholdMs: config.botOnlineThresholdMs ?? BOT_ONLINE_ALERT_MS,
      roleUpdateAlertMs: config.roleUpdateAlertMs ?? ROLE_UPDATE_ALERT_MS,
      roleUpdateCriticalMs: config.roleUpdateCriticalMs ?? ROLE_UPDATE_CRITICAL_MS,
      channelActivityAlertMs: config.channelActivityAlertMs ?? CHANNEL_ACTIVITY_ALERT_MS,
      alertThrottleMs: config.alertThrottleMs ?? ALERT_THROTTLE_MS,
      dryRun: config.dryRun ?? false,
    };
  }

  /**
   * Check health for a specific community
   *
   * @param communityId - Community UUID
   * @returns Health report
   */
  async checkHealth(communityId: string): Promise<HealthReport | null> {
    // Get incumbent config
    const incumbentConfig = await this.storage.getIncumbentConfig(communityId);
    if (!incumbentConfig) {
      this.logger.debug('No incumbent config found', { communityId });
      return null;
    }

    // Get migration state to find guild ID
    const migrationState = await this.storage.getMigrationState(communityId);
    if (!migrationState) {
      this.logger.debug('No migration state found', { communityId });
      return null;
    }

    // Get guild ID from community
    const community = await this.storage.getCommunity(communityId);
    if (!community?.discordGuildId) {
      this.logger.debug('No Discord guild ID found', { communityId });
      return null;
    }

    const guildId = community.discordGuildId;

    // Fetch Discord guild
    let guild: Guild;
    try {
      guild = await this.discordClient.guilds.fetch(guildId);
    } catch (error) {
      this.logger.warn('Failed to fetch guild', { guildId, error });
      return null;
    }

    // Run health checks
    const botOnlineCheck = await this.checkBotOnline(guild, incumbentConfig.botId);
    const roleUpdateCheck = await this.checkRoleUpdateFreshness(
      communityId,
      incumbentConfig.lastHealthCheck
    );
    const channelActivityCheck = await this.checkChannelActivity(
      guild,
      incumbentConfig.verificationChannelId
    );

    // Determine overall status
    const overallStatus = this.calculateOverallStatus(
      botOnlineCheck,
      roleUpdateCheck,
      channelActivityCheck
    );

    // Check alert throttling
    const lastAlertAt = this.alertThrottleMap.get(guildId);
    const now = new Date();
    const alertThrottled = lastAlertAt
      ? now.getTime() - lastAlertAt.getTime() < this.config.alertThrottleMs
      : false;

    const report: HealthReport = {
      communityId,
      guildId,
      provider: incumbentConfig.provider,
      overallStatus,
      checks: {
        botOnline: botOnlineCheck,
        roleUpdateFreshness: roleUpdateCheck,
        channelActivity: channelActivityCheck,
      },
      checkedAt: now,
      alertThrottled,
      lastAlertAt,
    };

    // Update health status in storage
    await this.storage.updateIncumbentHealth({
      communityId,
      healthStatus: overallStatus,
      lastHealthCheck: now,
    });

    // Send alert if needed
    if (overallStatus !== 'healthy' && !alertThrottled && !this.config.dryRun) {
      await this.sendHealthAlert(report);
    }

    this.logger.info('Health check completed', {
      communityId,
      guildId,
      overallStatus,
      alertThrottled,
    });

    return report;
  }

  /**
   * Check if incumbent bot is online in the guild
   */
  async checkBotOnline(guild: Guild, botId?: string | null): Promise<HealthCheckResult> {
    if (!botId) {
      return {
        passed: true,
        severity: 'ok',
        message: 'No bot ID configured for monitoring',
        context: { reason: 'no_bot_id' },
      };
    }

    try {
      // Ensure members are cached
      await guild.members.fetch();

      const botMember = guild.members.cache.get(botId);

      if (!botMember) {
        return {
          passed: false,
          severity: 'critical',
          message: 'Incumbent bot not found in guild',
          context: { botId, guildId: guild.id },
        };
      }

      // Check presence (online status)
      const presence = botMember.presence;
      const isOnline = presence?.status !== 'offline' && presence?.status !== undefined;

      if (!isOnline) {
        return {
          passed: false,
          severity: 'warning',
          message: 'Incumbent bot appears offline',
          lastObserved: new Date(),
          context: { botId, status: presence?.status ?? 'unknown' },
        };
      }

      return {
        passed: true,
        severity: 'ok',
        message: 'Incumbent bot is online',
        lastObserved: new Date(),
        context: { botId, status: presence.status },
      };
    } catch (error) {
      this.logger.warn('Failed to check bot online status', { guild: guild.id, botId, error });
      return {
        passed: false,
        severity: 'warning',
        message: 'Unable to verify bot online status',
        context: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Check role update freshness based on last health check
   */
  async checkRoleUpdateFreshness(
    communityId: string,
    lastHealthCheck?: Date | null
  ): Promise<HealthCheckResult> {
    const now = new Date();

    // If no last health check, consider it a warning (new monitoring)
    if (!lastHealthCheck) {
      return {
        passed: true,
        severity: 'ok',
        message: 'First health check - no previous data',
        context: { reason: 'first_check' },
      };
    }

    const timeSinceLastCheck = now.getTime() - lastHealthCheck.getTime();

    // Critical: >72 hours
    if (timeSinceLastCheck > this.config.roleUpdateCriticalMs) {
      return {
        passed: false,
        severity: 'critical',
        message: `Role updates stale for ${Math.floor(timeSinceLastCheck / (60 * 60 * 1000))} hours`,
        lastObserved: lastHealthCheck,
        context: { timeSinceLastCheck, threshold: 'critical' },
      };
    }

    // Warning: >48 hours
    if (timeSinceLastCheck > this.config.roleUpdateAlertMs) {
      return {
        passed: false,
        severity: 'warning',
        message: `Role updates stale for ${Math.floor(timeSinceLastCheck / (60 * 60 * 1000))} hours`,
        lastObserved: lastHealthCheck,
        context: { timeSinceLastCheck, threshold: 'alert' },
      };
    }

    return {
      passed: true,
      severity: 'ok',
      message: 'Role updates are fresh',
      lastObserved: lastHealthCheck,
      context: { timeSinceLastCheck },
    };
  }

  /**
   * Check verification channel activity
   */
  async checkChannelActivity(
    guild: Guild,
    channelId?: string | null
  ): Promise<HealthCheckResult> {
    if (!channelId) {
      return {
        passed: true,
        severity: 'ok',
        message: 'No verification channel configured for monitoring',
        context: { reason: 'no_channel_id' },
      };
    }

    try {
      const channel = await guild.channels.fetch(channelId);

      if (!channel) {
        return {
          passed: false,
          severity: 'warning',
          message: 'Verification channel not found',
          context: { channelId },
        };
      }

      if (!channel.isTextBased()) {
        return {
          passed: true,
          severity: 'ok',
          message: 'Channel is not text-based, skipping activity check',
          context: { channelType: channel.type },
        };
      }

      // Fetch recent messages
      const textChannel = channel as TextChannel;
      const messages = await textChannel.messages.fetch({ limit: 10 });

      // Check for recent activity (within threshold)
      const now = new Date();
      const threshold = new Date(now.getTime() - this.config.channelActivityAlertMs);

      const recentMessages = messages.filter(
        (msg: Message) => msg.createdAt > threshold
      );

      if (recentMessages.size < MIN_CHANNEL_ACTIVITY_MESSAGES) {
        // Find the most recent message timestamp
        const lastMessage = messages.first();
        return {
          passed: false,
          severity: 'warning',
          message: `No verification activity in ${Math.floor(this.config.channelActivityAlertMs / (60 * 60 * 1000))} hours`,
          lastObserved: lastMessage?.createdAt,
          context: {
            channelId,
            recentMessageCount: recentMessages.size,
            totalFetched: messages.size,
          },
        };
      }

      return {
        passed: true,
        severity: 'ok',
        message: 'Verification channel is active',
        lastObserved: recentMessages.first()?.createdAt,
        context: { channelId, recentMessageCount: recentMessages.size },
      };
    } catch (error) {
      this.logger.warn('Failed to check channel activity', { guild: guild.id, channelId, error });
      return {
        passed: false,
        severity: 'warning',
        message: 'Unable to verify channel activity',
        context: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /**
   * Calculate overall health status from individual checks
   */
  private calculateOverallStatus(
    botOnlineCheck: HealthCheckResult,
    roleUpdateCheck: HealthCheckResult,
    channelActivityCheck: HealthCheckResult
  ): HealthStatus {
    const checks = [botOnlineCheck, roleUpdateCheck, channelActivityCheck];

    // Any critical = offline
    if (checks.some((c) => c.severity === 'critical')) {
      return 'offline';
    }

    // Any warning = degraded
    if (checks.some((c) => c.severity === 'warning')) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Send health alert to admin
   */
  private async sendHealthAlert(report: HealthReport): Promise<void> {
    if (!this.notifyAdmin) {
      this.logger.debug('No notifyAdmin callback configured');
      return;
    }

    const failedChecks: string[] = [];

    if (!report.checks.botOnline.passed) {
      failedChecks.push(`Bot Online: ${report.checks.botOnline.message}`);
    }
    if (!report.checks.roleUpdateFreshness.passed) {
      failedChecks.push(`Role Updates: ${report.checks.roleUpdateFreshness.message}`);
    }
    if (!report.checks.channelActivity.passed) {
      failedChecks.push(`Channel Activity: ${report.checks.channelActivity.message}`);
    }

    const severity = report.overallStatus === 'offline' ? 'critical' : 'warning';
    const includeBackupButton = report.overallStatus === 'offline';

    const alert: HealthAlert = {
      communityId: report.communityId,
      guildId: report.guildId,
      provider: report.provider,
      severity,
      title: severity === 'critical'
        ? '🚨 Incumbent Bot Critical - Immediate Action Required'
        : '⚠️ Incumbent Bot Health Warning',
      description: `The ${report.provider} bot in your server may be experiencing issues.`,
      failedChecks,
      recommendedAction: severity === 'critical'
        ? 'Consider activating Arrakis as a backup to ensure your members retain access.'
        : 'Monitor the situation. If issues persist, consider activating Arrakis backup.',
      includeBackupButton,
    };

    try {
      await this.notifyAdmin(report.guildId, alert);
      this.alertThrottleMap.set(report.guildId, new Date());
      this.logger.info('Health alert sent', { guildId: report.guildId, severity });
    } catch (error) {
      this.logger.error('Failed to send health alert', { guildId: report.guildId, error });
    }
  }

  /**
   * Activate emergency backup (transition shadow → parallel)
   *
   * @param communityId - Community UUID
   * @param guildId - Discord guild ID
   * @param adminId - Admin who initiated the activation
   * @returns Activation result
   */
  async activateEmergencyBackup(
    communityId: string,
    guildId: string,
    adminId: string
  ): Promise<{ success: boolean; error?: string; newMode?: CoexistenceMode }> {
    // Check current migration state
    const migrationState = await this.storage.getMigrationState(communityId);

    if (!migrationState) {
      return { success: false, error: 'Migration state not found' };
    }

    // Can only activate backup from shadow mode
    if (migrationState.currentMode !== 'shadow') {
      return {
        success: false,
        error: `Cannot activate backup from ${migrationState.currentMode} mode. Only shadow → parallel is supported.`,
      };
    }

    // Use provided callback if available
    if (this.activateBackup) {
      const result = await this.activateBackup(
        communityId,
        guildId,
        `Emergency backup activated by admin ${adminId}`
      );
      if (result.success) {
        return { success: true, newMode: 'parallel' };
      }
      return result;
    }

    // Default implementation: update migration state
    try {
      await this.storage.updateMigrationState({
        communityId,
        currentMode: 'parallel',
        parallelEnabledAt: new Date(),
      });

      this.logger.info('Emergency backup activated', {
        communityId,
        guildId,
        adminId,
        previousMode: 'shadow',
        newMode: 'parallel',
      });

      return { success: true, newMode: 'parallel' };
    } catch (error) {
      this.logger.error('Failed to activate emergency backup', { communityId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check health for all communities in shadow/parallel mode
   *
   * @returns Array of health reports
   */
  async checkAllCommunities(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];

    // Get all communities in monitoring-eligible modes
    const communities = await this.storage.getCommunitiesByMode(['shadow', 'parallel', 'primary']);

    for (const community of communities) {
      try {
        const report = await this.checkHealth(community.id);
        if (report) {
          reports.push(report);
        }
      } catch (error) {
        this.logger.error('Failed to check health for community', {
          communityId: community.id,
          error,
        });
      }
    }

    return reports;
  }

  /**
   * Clear alert throttle for a guild (for testing or manual reset)
   */
  clearAlertThrottle(guildId: string): void {
    this.alertThrottleMap.delete(guildId);
  }

  /**
   * Get current alert throttle state
   */
  getAlertThrottleState(): Map<string, Date> {
    return new Map(this.alertThrottleMap);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an IncumbentHealthMonitor instance
 */
export function createIncumbentHealthMonitor(
  storage: ICoexistenceStorage,
  discordClient: Client,
  notifyAdmin?: NotifyAdminCallback,
  activateBackup?: ActivateBackupCallback,
  config?: HealthMonitorConfig,
  logger?: ILogger
): IncumbentHealthMonitor {
  return new IncumbentHealthMonitor(
    storage,
    discordClient,
    notifyAdmin,
    activateBackup,
    config,
    logger
  );
}
