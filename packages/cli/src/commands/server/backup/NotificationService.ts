/**
 * Notification Service
 *
 * Sprint 171: Polish & Notifications - SNS Notifications
 *
 * Sends notifications via SNS for backup events and publishes
 * CloudWatch metrics for monitoring.
 *
 * @see SDD grimoires/loa/sdd.md §15.5
 * @module packages/cli/commands/server/backup/NotificationService
 */

import {
  SNSClient,
  PublishCommand,
  type MessageAttributeValue,
} from '@aws-sdk/client-sns';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';

import type { BackupResult } from './types.js';
import type { SnapshotResult } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Default AWS region */
const DEFAULT_REGION = 'us-east-1';

/** CloudWatch namespace for Gaib backups */
const CLOUDWATCH_NAMESPACE = 'Gaib/Backups';

// ============================================================================
// Types
// ============================================================================

/**
 * NotificationService configuration
 */
export interface NotificationServiceConfig {
  /** SNS topic ARN for notifications */
  topicArn: string;
  /** Discord server ID */
  serverId: string;
  /** AWS region */
  region: string;
  /** Enable notifications */
  enabled: boolean;
}

/**
 * Backup completion event
 */
export interface BackupCompleteEvent {
  type: 'backup' | 'snapshot';
  serverId: string;
  backupId: string;
  timestamp: string;
  serial: number;
  size: number;
  message?: string;
}

/**
 * Backup failure event
 */
export interface BackupFailureEvent {
  type: 'backup' | 'snapshot';
  serverId: string;
  timestamp: string;
  error: string;
  errorCode?: string;
}

// ============================================================================
// NotificationService Implementation
// ============================================================================

/**
 * Sends notifications and publishes metrics for backup events
 *
 * @example
 * ```typescript
 * const service = NotificationService.create({
 *   serverId: '1234567890',
 * });
 *
 * // Notify backup complete
 * await service.notifyBackupComplete({
 *   id: 'backup-123',
 *   timestamp: '2026-01-29T12:00:00Z',
 *   serial: 42,
 *   size: 1024,
 *   checksum: '...',
 * });
 *
 * // Publish metric
 * await service.publishMetric('BackupSuccess', 1);
 * ```
 */
export class NotificationService {
  private readonly snsClient: SNSClient;
  private readonly cloudwatchClient: CloudWatchClient;
  private readonly config: NotificationServiceConfig;

  constructor(config: NotificationServiceConfig) {
    this.config = config;
    this.snsClient = new SNSClient({ region: config.region });
    this.cloudwatchClient = new CloudWatchClient({ region: config.region });
  }

  /**
   * Create NotificationService from environment variables
   */
  static create(options: {
    serverId: string;
    topicArn?: string;
    enabled?: boolean;
  }): NotificationService {
    const region = process.env.AWS_REGION ?? DEFAULT_REGION;
    const accountId = process.env.AWS_ACCOUNT_ID ?? '000000000000';

    return new NotificationService({
      serverId: options.serverId,
      topicArn:
        options.topicArn ??
        process.env.GAIB_NOTIFICATIONS_TOPIC ??
        `arn:aws:sns:${region}:${accountId}:gaib-backup-notifications`,
      region,
      enabled:
        options.enabled ??
        process.env.GAIB_NOTIFICATIONS_ENABLED === 'true',
    });
  }

  // ============================================================================
  // Notification Methods
  // ============================================================================

  /**
   * Notify backup completion
   */
  async notifyBackupComplete(backup: BackupResult): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const event: BackupCompleteEvent = {
      type: 'backup',
      serverId: this.config.serverId,
      backupId: backup.id,
      timestamp: backup.timestamp,
      serial: backup.serial,
      size: backup.size,
    };

    await this.publish({
      subject: `[Gaib] Backup Complete - Server ${this.config.serverId}`,
      message: this.formatBackupCompleteMessage(event),
      attributes: {
        type: { DataType: 'String', StringValue: 'backup_complete' },
        serverId: { DataType: 'String', StringValue: this.config.serverId },
        backupId: { DataType: 'String', StringValue: backup.id },
      },
    });

    await this.publishMetric('BackupSuccess', 1);
    await this.publishMetric('BackupSize', backup.size, 'Bytes');
  }

  /**
   * Notify backup failure
   */
  async notifyBackupFailed(error: Error & { code?: string }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const event: BackupFailureEvent = {
      type: 'backup',
      serverId: this.config.serverId,
      timestamp: new Date().toISOString(),
      error: error.message,
      errorCode: error.code,
    };

    await this.publish({
      subject: `[Gaib] Backup Failed - Server ${this.config.serverId}`,
      message: this.formatBackupFailureMessage(event),
      attributes: {
        type: { DataType: 'String', StringValue: 'backup_failed' },
        serverId: { DataType: 'String', StringValue: this.config.serverId },
        errorCode: { DataType: 'String', StringValue: error.code ?? 'UNKNOWN' },
      },
    });

    await this.publishMetric('BackupErrors', 1);
  }

  /**
   * Notify snapshot completion
   */
  async notifySnapshotComplete(snapshot: SnapshotResult): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const totalSize =
      snapshot.manifest.files.state.compressedSize +
      snapshot.manifest.files.config.compressedSize +
      snapshot.manifest.files.themeRegistry.compressedSize;

    const event: BackupCompleteEvent = {
      type: 'snapshot',
      serverId: this.config.serverId,
      backupId: snapshot.id,
      timestamp: snapshot.timestamp,
      serial: snapshot.manifest.serial,
      size: totalSize,
      message: snapshot.manifest.message,
    };

    await this.publish({
      subject: `[Gaib] Snapshot Complete - Server ${this.config.serverId}`,
      message: this.formatSnapshotCompleteMessage(event, snapshot),
      attributes: {
        type: { DataType: 'String', StringValue: 'snapshot_complete' },
        serverId: { DataType: 'String', StringValue: this.config.serverId },
        snapshotId: { DataType: 'String', StringValue: snapshot.id },
      },
    });

    await this.publishMetric('SnapshotSuccess', 1);
    await this.publishMetric('SnapshotSize', totalSize, 'Bytes');
  }

  /**
   * Notify snapshot failure
   */
  async notifySnapshotFailed(error: Error & { code?: string }): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const event: BackupFailureEvent = {
      type: 'snapshot',
      serverId: this.config.serverId,
      timestamp: new Date().toISOString(),
      error: error.message,
      errorCode: error.code,
    };

    await this.publish({
      subject: `[Gaib] Snapshot Failed - Server ${this.config.serverId}`,
      message: this.formatBackupFailureMessage(event),
      attributes: {
        type: { DataType: 'String', StringValue: 'snapshot_failed' },
        serverId: { DataType: 'String', StringValue: this.config.serverId },
        errorCode: { DataType: 'String', StringValue: error.code ?? 'UNKNOWN' },
      },
    });

    await this.publishMetric('SnapshotErrors', 1);
  }

  // ============================================================================
  // Metrics Methods
  // ============================================================================

  /**
   * Publish a CloudWatch metric
   */
  async publishMetric(
    name: string,
    value: number,
    unit: string = 'Count'
  ): Promise<void> {
    try {
      await this.cloudwatchClient.send(
        new PutMetricDataCommand({
          Namespace: CLOUDWATCH_NAMESPACE,
          MetricData: [
            {
              MetricName: name,
              Value: value,
              Unit: unit,
              Dimensions: [
                {
                  Name: 'ServerId',
                  Value: this.config.serverId,
                },
              ],
              Timestamp: new Date(),
            },
          ],
        })
      );
    } catch (error) {
      // Don't fail the operation if metrics fail
      console.warn('Failed to publish metric:', error);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Publish message to SNS
   */
  private async publish(options: {
    subject: string;
    message: string;
    attributes: Record<string, MessageAttributeValue>;
  }): Promise<void> {
    try {
      await this.snsClient.send(
        new PublishCommand({
          TopicArn: this.config.topicArn,
          Subject: options.subject,
          Message: options.message,
          MessageAttributes: options.attributes,
        })
      );
    } catch (error) {
      // Don't fail the operation if notifications fail
      console.warn('Failed to send notification:', error);
    }
  }

  /**
   * Format backup complete message
   */
  private formatBackupCompleteMessage(event: BackupCompleteEvent): string {
    return `Gaib Backup Complete

Server ID: ${event.serverId}
Backup ID: ${event.backupId}
Timestamp: ${event.timestamp}
Serial: ${event.serial}
Size: ${this.formatBytes(event.size)}
${event.message ? `Message: ${event.message}` : ''}

This backup will be retained according to your tier's retention policy.
`;
  }

  /**
   * Format backup failure message
   */
  private formatBackupFailureMessage(event: BackupFailureEvent): string {
    return `Gaib ${event.type === 'snapshot' ? 'Snapshot' : 'Backup'} Failed

Server ID: ${event.serverId}
Timestamp: ${event.timestamp}
Error: ${event.error}
${event.errorCode ? `Error Code: ${event.errorCode}` : ''}

Please check the Gaib CLI logs for more details.
Common issues:
- AWS credentials not configured
- Insufficient permissions
- State file not found
`;
  }

  /**
   * Format snapshot complete message
   */
  private formatSnapshotCompleteMessage(
    event: BackupCompleteEvent,
    snapshot: SnapshotResult
  ): string {
    return `Gaib Snapshot Complete

Server ID: ${event.serverId}
Snapshot ID: ${event.backupId}
Timestamp: ${event.timestamp}
Serial: ${event.serial}
Total Size: ${this.formatBytes(event.size)}
${event.message ? `Message: ${event.message}` : ''}

Discord Resources:
- Roles: ${snapshot.manifest.discord.roleCount}
- Channels: ${snapshot.manifest.discord.channelCount}
- Categories: ${snapshot.manifest.discord.categoryCount}

${snapshot.manifest.theme ? `Theme: ${snapshot.manifest.theme.name}@${snapshot.manifest.theme.version}` : ''}

This snapshot will be retained according to your tier's retention policy.
`;
  }

  /**
   * Format bytes as human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Check if notifications are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the configuration
   */
  getConfig(): NotificationServiceConfig {
    return { ...this.config };
  }
}
