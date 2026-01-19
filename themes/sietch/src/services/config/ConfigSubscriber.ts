/**
 * ConfigSubscriber - Pub/Sub Configuration Invalidation Subscriber
 *
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Subscribes to Redis Pub/Sub channels for configuration invalidation.
 * When a message is received, invalidates the local cache.
 *
 * Bot instances use this to receive real-time config updates.
 *
 * @see grimoires/loa/sdd.md §5.2.1 Pub/Sub Design
 * @see grimoires/loa/sprint.md Sprint 120
 */

import type { Redis } from 'ioredis';
import { logger as defaultLogger } from '../../utils/logger.js';
import { recordPropagationLatency } from './cacheMetrics.js';
import type { IConfigCache } from './ConfigCache.js';
import type { InvalidationMessage } from './ConfigPublisher.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigSubscriberConfig {
  /** Redis client for subscribing (must be a dedicated connection) */
  redis: Redis;
  /** Cache to invalidate on messages */
  cache: IConfigCache;
  logger?: typeof defaultLogger;
  /** Channel prefix (default: 'config:sync') */
  channelPrefix?: string;
}

export interface IConfigSubscriber {
  /**
   * Subscribe to config invalidation for a server.
   */
  subscribe(serverId: string): Promise<void>;

  /**
   * Subscribe to config invalidation for multiple servers.
   */
  subscribeAll(serverIds: string[]): Promise<void>;

  /**
   * Unsubscribe from config invalidation for a server.
   */
  unsubscribe(serverId: string): Promise<void>;

  /**
   * Unsubscribe from all channels and clean up.
   */
  shutdown(): Promise<void>;

  /**
   * Get the list of subscribed server IDs.
   */
  getSubscribedServers(): string[];
}

// =============================================================================
// ConfigSubscriber Implementation
// =============================================================================

export class ConfigSubscriber implements IConfigSubscriber {
  private readonly redis: Redis;
  private readonly cache: IConfigCache;
  private readonly logger: typeof defaultLogger;
  private readonly channelPrefix: string;

  /** Set of subscribed server IDs */
  private readonly subscribedServers: Set<string> = new Set();

  /** Flag to track if message handler is registered */
  private messageHandlerRegistered = false;

  constructor(config: ConfigSubscriberConfig) {
    this.redis = config.redis;
    this.cache = config.cache;
    this.logger = config.logger ?? defaultLogger;
    this.channelPrefix = config.channelPrefix ?? 'config:sync';

    // Register message handler once
    this.registerMessageHandler();
  }

  /**
   * Get the channel name for a server.
   */
  private getChannelName(serverId: string): string {
    return `${this.channelPrefix}:${serverId}`;
  }

  /**
   * Extract server ID from channel name.
   */
  private getServerIdFromChannel(channel: string): string | null {
    const prefix = `${this.channelPrefix}:`;
    if (channel.startsWith(prefix)) {
      return channel.slice(prefix.length);
    }
    return null;
  }

  /**
   * Register the message handler for incoming Pub/Sub messages.
   */
  private registerMessageHandler(): void {
    if (this.messageHandlerRegistered) return;

    this.redis.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message).catch((error) => {
        this.logger.error({ error, channel }, 'Error handling config invalidation message');
      });
    });

    this.messageHandlerRegistered = true;
    this.logger.debug('ConfigSubscriber message handler registered');
  }

  /**
   * Handle incoming invalidation message.
   */
  private async handleMessage(channel: string, messageStr: string): Promise<void> {
    const serverId = this.getServerIdFromChannel(channel);
    if (!serverId) {
      this.logger.warn({ channel }, 'Received message on unexpected channel');
      return;
    }

    let message: InvalidationMessage;
    try {
      message = JSON.parse(messageStr);
    } catch (error) {
      this.logger.error({ error, channel, messageStr }, 'Failed to parse invalidation message');
      return;
    }

    // Calculate propagation latency
    const publishTime = new Date(message.timestamp).getTime();
    const now = Date.now();
    const latencyMs = now - publishTime;

    // Record latency metric
    recordPropagationLatency(latencyMs);

    // Invalidate cache
    await this.cache.invalidate(message.serverId);

    this.logger.debug(
      {
        serverId: message.serverId,
        recordId: message.recordId,
        type: message.type,
        latencyMs,
      },
      'Processed config invalidation'
    );
  }

  /**
   * Subscribe to config invalidation for a server.
   */
  async subscribe(serverId: string): Promise<void> {
    if (this.subscribedServers.has(serverId)) {
      this.logger.debug({ serverId }, 'Already subscribed to server');
      return;
    }

    const channel = this.getChannelName(serverId);
    await this.redis.subscribe(channel);
    this.subscribedServers.add(serverId);

    this.logger.info({ serverId, channel }, 'Subscribed to config invalidation');
  }

  /**
   * Subscribe to config invalidation for multiple servers.
   */
  async subscribeAll(serverIds: string[]): Promise<void> {
    const newServerIds = serverIds.filter((id) => !this.subscribedServers.has(id));
    if (newServerIds.length === 0) return;

    const channels = newServerIds.map((id) => this.getChannelName(id));
    await this.redis.subscribe(...channels);

    for (const id of newServerIds) {
      this.subscribedServers.add(id);
    }

    this.logger.info({ count: newServerIds.length }, 'Subscribed to config invalidations');
  }

  /**
   * Unsubscribe from config invalidation for a server.
   */
  async unsubscribe(serverId: string): Promise<void> {
    if (!this.subscribedServers.has(serverId)) {
      return;
    }

    const channel = this.getChannelName(serverId);
    await this.redis.unsubscribe(channel);
    this.subscribedServers.delete(serverId);

    this.logger.info({ serverId, channel }, 'Unsubscribed from config invalidation');
  }

  /**
   * Unsubscribe from all channels and clean up.
   */
  async shutdown(): Promise<void> {
    if (this.subscribedServers.size === 0) return;

    const channels = Array.from(this.subscribedServers).map((id) => this.getChannelName(id));
    await this.redis.unsubscribe(...channels);
    this.subscribedServers.clear();

    this.logger.info('ConfigSubscriber shutdown complete');
  }

  /**
   * Get the list of subscribed server IDs.
   */
  getSubscribedServers(): string[] {
    return Array.from(this.subscribedServers);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ConfigSubscriber instance.
 *
 * NOTE: The Redis client passed must be a dedicated connection.
 * In subscribe mode, Redis clients cannot issue other commands.
 */
export function createConfigSubscriber(
  redis: Redis,
  cache: IConfigCache,
  logger?: typeof defaultLogger
): ConfigSubscriber {
  return new ConfigSubscriber({ redis, cache, logger });
}
