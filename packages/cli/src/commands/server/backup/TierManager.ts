/**
 * Tier Manager
 *
 * Sprint 166: Backup Foundation - Service Tier Management
 *
 * Manages service tier configuration and rate limiting for backup operations.
 * Tracks usage and enforces daily/weekly limits for free tier.
 *
 * @see SDD grimoires/loa/sdd.md §15.4
 * @module packages/cli/commands/server/backup/TierManager
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

import {
  type ServerTierConfig,
  TierLimitError,
  TIER_LIMITS,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Default tiers table name */
const DEFAULT_TABLE_NAME = 'gaib-server-tiers';

// ============================================================================
// TierManager Implementation
// ============================================================================

/**
 * Configuration for TierManager
 */
export interface TierManagerConfig {
  /** DynamoDB table name */
  tableName: string;
  /** Discord server ID */
  serverId: string;
}

/**
 * Manages service tier configuration and rate limits
 *
 * @example
 * ```typescript
 * const manager = new TierManager(dynamoClient, {
 *   tableName: 'gaib-server-tiers',
 *   serverId: '1234567890',
 * });
 *
 * // Check if backup is allowed
 * await manager.checkBackupLimit();
 *
 * // Record usage
 * await manager.recordBackup();
 * ```
 */
export class TierManager {
  private readonly client: DynamoDBClient;
  private readonly config: TierManagerConfig;

  constructor(client: DynamoDBClient, config: TierManagerConfig) {
    this.client = client;
    this.config = config;
  }

  // ============================================================================
  // Tier Operations
  // ============================================================================

  /**
   * Get the tier for the current server (defaults to free)
   */
  async getTier(): Promise<'free' | 'premium'> {
    const config = await this.getServerConfig();
    return config?.tier ?? 'free';
  }

  /**
   * Set the tier for the current server
   */
  async setTier(tier: 'free' | 'premium'): Promise<void> {
    const now = new Date().toISOString();

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.config.tableName,
        Key: marshall({
          PK: `SERVER#${this.config.serverId}`,
        }),
        UpdateExpression: 'SET tier = :tier, updatedAt = :now, serverId = :sid',
        ExpressionAttributeValues: marshall({
          ':tier': tier,
          ':now': now,
          ':sid': this.config.serverId,
        }),
      })
    );
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Check if a backup is allowed for the server's tier
   * @throws TierLimitError if limit exceeded
   */
  async checkBackupLimit(): Promise<void> {
    const tier = await this.getTier();

    if (tier === 'premium') {
      return; // No limits for premium
    }

    const config = await this.getServerConfig();
    const limits = TIER_LIMITS[tier];

    // Reset counter if it's a new day
    const today = new Date().toISOString().split('T')[0];
    const lastBackupDay = config?.lastBackupAt?.split('T')[0];

    if (lastBackupDay !== today) {
      // New day, counter resets
      return;
    }

    if ((config?.backupsToday ?? 0) >= limits.dailyBackups) {
      throw new TierLimitError(
        `Free tier limit reached: ${limits.dailyBackups} on-demand backup per day. ` +
          'Upgrade to premium for unlimited backups.',
        {
          tier,
          limit: limits.dailyBackups,
          used: config?.backupsToday ?? 0,
        }
      );
    }
  }

  /**
   * Check if a snapshot is allowed for the server's tier
   * @throws TierLimitError if limit exceeded
   */
  async checkSnapshotLimit(): Promise<void> {
    const tier = await this.getTier();

    if (tier === 'premium') {
      return; // No limits for premium
    }

    const config = await this.getServerConfig();
    const limits = TIER_LIMITS[tier];

    // Reset counter if it's a new week (Sunday)
    const today = new Date();
    const weekStart = this.getWeekStart(today);
    const lastSnapshotWeek = config?.lastSnapshotAt
      ? this.getWeekStart(new Date(config.lastSnapshotAt))
      : null;

    if (!lastSnapshotWeek || weekStart > lastSnapshotWeek) {
      // New week, counter resets
      return;
    }

    if ((config?.snapshotsThisWeek ?? 0) >= limits.weeklySnapshots) {
      throw new TierLimitError(
        `Free tier limit reached: ${limits.weeklySnapshots} snapshots per week. ` +
          'Upgrade to premium for unlimited snapshots.',
        {
          tier,
          limit: limits.weeklySnapshots,
          used: config?.snapshotsThisWeek ?? 0,
        }
      );
    }
  }

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Record a backup (for rate limiting)
   */
  async recordBackup(): Promise<void> {
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const config = await this.getServerConfig();
    const lastBackupDay = config?.lastBackupAt?.split('T')[0];

    // Reset counter if new day
    const newCount = lastBackupDay === today ? (config?.backupsToday ?? 0) + 1 : 1;

    await this.updateUsage({
      backupsToday: newCount,
      lastBackupAt: now,
    });
  }

  /**
   * Record a snapshot (for rate limiting)
   */
  async recordSnapshot(): Promise<void> {
    const now = new Date().toISOString();
    const today = new Date();

    const config = await this.getServerConfig();
    const weekStart = this.getWeekStart(today);
    const lastSnapshotWeek = config?.lastSnapshotAt
      ? this.getWeekStart(new Date(config.lastSnapshotAt))
      : null;

    // Reset counter if new week
    const newCount =
      lastSnapshotWeek && weekStart.getTime() === lastSnapshotWeek.getTime()
        ? (config?.snapshotsThisWeek ?? 0) + 1
        : 1;

    await this.updateUsage({
      snapshotsThisWeek: newCount,
      lastSnapshotAt: now,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get server configuration from DynamoDB
   */
  private async getServerConfig(): Promise<ServerTierConfig | null> {
    try {
      const result = await this.client.send(
        new GetItemCommand({
          TableName: this.config.tableName,
          Key: marshall({
            PK: `SERVER#${this.config.serverId}`,
          }),
        })
      );

      if (!result.Item) {
        return null;
      }

      return unmarshall(result.Item) as ServerTierConfig;
    } catch (error) {
      // Table might not exist yet, treat as free tier with no usage
      return null;
    }
  }

  /**
   * Update usage counters
   */
  private async updateUsage(updates: {
    backupsToday?: number;
    lastBackupAt?: string;
    snapshotsThisWeek?: number;
    lastSnapshotAt?: string;
  }): Promise<void> {
    const now = new Date().toISOString();

    const updateExpressions: string[] = ['updatedAt = :now', 'serverId = :sid'];
    const expressionValues: Record<string, unknown> = {
      ':now': now,
      ':sid': this.config.serverId,
    };

    if (updates.backupsToday !== undefined) {
      updateExpressions.push('backupsToday = :bt');
      expressionValues[':bt'] = updates.backupsToday;
    }

    if (updates.lastBackupAt !== undefined) {
      updateExpressions.push('lastBackupAt = :lba');
      expressionValues[':lba'] = updates.lastBackupAt;
    }

    if (updates.snapshotsThisWeek !== undefined) {
      updateExpressions.push('snapshotsThisWeek = :stw');
      expressionValues[':stw'] = updates.snapshotsThisWeek;
    }

    if (updates.lastSnapshotAt !== undefined) {
      updateExpressions.push('lastSnapshotAt = :lsa');
      expressionValues[':lsa'] = updates.lastSnapshotAt;
    }

    // Ensure tier defaults to 'free' if not set
    updateExpressions.push('tier = if_not_exists(tier, :defaultTier)');
    expressionValues[':defaultTier'] = 'free';

    // Ensure createdAt is set
    updateExpressions.push('createdAt = if_not_exists(createdAt, :now)');

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.config.tableName,
        Key: marshall({
          PK: `SERVER#${this.config.serverId}`,
        }),
        UpdateExpression: 'SET ' + updateExpressions.join(', '),
        ExpressionAttributeValues: marshall(expressionValues),
      })
    );
  }

  /**
   * Get the start of the week (Sunday midnight UTC)
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get the limits for a tier
   */
  getLimits(tier: 'free' | 'premium'): typeof TIER_LIMITS['free'] {
    return TIER_LIMITS[tier];
  }
}
