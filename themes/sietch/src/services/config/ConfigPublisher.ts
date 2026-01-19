/**
 * ConfigPublisher - Pub/Sub Configuration Invalidation Publisher
 *
 * Sprint 119: Pub/Sub Publisher
 *
 * Publishes configuration change invalidation messages to Redis Pub/Sub.
 * Bot instances subscribe to receive real-time config updates.
 *
 * Channel format: `config:sync:{serverId}`
 * Message format: `{recordId, type, timestamp, serverId}`
 *
 * @see grimoires/loa/sdd.md §5.2.1 Pub/Sub Design
 * @see grimoires/loa/sprint.md Sprint 119
 */

import type { Redis } from 'ioredis';
import { logger as defaultLogger } from '../../utils/logger.js';
import { recordConfigInvalidation, recordConfigPublishError } from './configMetrics.js';
import type { ConfigRecord, RecordableType } from '../../db/types/config.types.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigPublisherConfig {
  redis: Redis;
  logger?: typeof defaultLogger;
  /** Channel prefix (default: 'config:sync') */
  channelPrefix?: string;
}

/**
 * Invalidation message published to Redis Pub/Sub
 */
export interface InvalidationMessage {
  /** Unique record ID */
  recordId: string;
  /** Type of config change */
  type: RecordableType;
  /** ISO timestamp when change occurred */
  timestamp: string;
  /** Discord server ID */
  serverId: string;
}

export interface IConfigPublisher {
  /**
   * Publish invalidation message for a config record.
   * Non-blocking: logs errors but doesn't throw.
   */
  publishInvalidation(record: ConfigRecord): Promise<void>;

  /**
   * Publish multiple invalidation messages.
   * Non-blocking: logs errors but doesn't throw.
   */
  publishInvalidations(records: ConfigRecord[]): Promise<void>;

  /**
   * Get the channel name for a server.
   */
  getChannelName(serverId: string): string;
}

// =============================================================================
// ConfigPublisher Implementation
// =============================================================================

export class ConfigPublisher implements IConfigPublisher {
  private readonly redis: Redis;
  private readonly logger: typeof defaultLogger;
  private readonly channelPrefix: string;

  constructor(config: ConfigPublisherConfig) {
    this.redis = config.redis;
    this.logger = config.logger ?? defaultLogger;
    this.channelPrefix = config.channelPrefix ?? 'config:sync';
  }

  /**
   * Get the Redis channel name for a server.
   */
  getChannelName(serverId: string): string {
    return `${this.channelPrefix}:${serverId}`;
  }

  /**
   * Publish invalidation message for a config record.
   *
   * Error handling: Logs failures but doesn't throw.
   * This ensures writes succeed even if Pub/Sub is unavailable.
   */
  async publishInvalidation(record: ConfigRecord): Promise<void> {
    const channel = this.getChannelName(record.serverId);

    const message: InvalidationMessage = {
      recordId: record.id,
      type: record.recordableType,
      timestamp: record.createdAt.toISOString(),
      serverId: record.serverId,
    };

    try {
      const subscribers = await this.redis.publish(channel, JSON.stringify(message));

      // Record metric
      recordConfigInvalidation(record.recordableType);

      this.logger.debug(
        {
          channel,
          recordId: record.id,
          type: record.recordableType,
          subscribers,
        },
        'Published config invalidation'
      );
    } catch (error) {
      // Record error metric
      recordConfigPublishError(record.recordableType);

      // Log but don't throw - writes should succeed even if Pub/Sub fails
      this.logger.error(
        {
          error,
          channel,
          recordId: record.id,
          type: record.recordableType,
        },
        'Failed to publish config invalidation'
      );
    }
  }

  /**
   * Publish multiple invalidation messages.
   *
   * Publishes in parallel for efficiency. Logs individual failures.
   */
  async publishInvalidations(records: ConfigRecord[]): Promise<void> {
    if (records.length === 0) return;

    // Publish all in parallel
    await Promise.all(
      records.map((record) => this.publishInvalidation(record))
    );

    this.logger.info(
      {
        serverId: records[0]?.serverId,
        count: records.length,
      },
      'Published config invalidations batch'
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ConfigPublisher instance.
 *
 * Returns null if Redis is not available, allowing graceful degradation.
 */
export function createConfigPublisher(
  redis?: Redis,
  logger?: typeof defaultLogger
): ConfigPublisher | null {
  if (!redis) {
    (logger ?? defaultLogger).warn('ConfigPublisher: Redis not available, Pub/Sub disabled');
    return null;
  }

  return new ConfigPublisher({ redis, logger });
}
