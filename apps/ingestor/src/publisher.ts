import amqp, { type Channel, type ConfirmChannel, type Connection } from 'amqplib';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { DiscordEventPayload, PublisherStatus } from './types.js';

/**
 * RabbitMQ Publisher for Discord events
 * Implements connection management, message publishing, and auto-reconnection
 */
export class Publisher {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelayMs = 5000;
  private isShuttingDown = false;
  private publishCount = 0;
  private errorCount = 0;
  private lastPublishTime?: number;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {}

  /**
   * Connect to RabbitMQ and create channel
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Publisher is shutting down');
    }

    try {
      this.logger.info({ url: this.maskUrl(this.config.rabbitmqUrl) }, 'Connecting to RabbitMQ...');

      // Connect with heartbeat for connection health
      this.connection = await amqp.connect(this.config.rabbitmqUrl, {
        heartbeat: 30,
      });

      // Handle connection events
      this.connection.on('error', (err) => {
        this.logger.error({ error: err.message }, 'RabbitMQ connection error');
        this.scheduleReconnect();
      });

      this.connection.on('close', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ connection closed unexpectedly');
          this.scheduleReconnect();
        }
      });

      // Create confirm channel for publish confirmations
      this.channel = await this.connection.createConfirmChannel();

      // Handle channel events
      this.channel.on('error', (err) => {
        this.logger.error({ error: err.message }, 'RabbitMQ channel error');
        this.channel = null;
      });

      this.channel.on('close', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ channel closed unexpectedly');
          this.channel = null;
        }
      });

      // Assert exchange exists (should be created by setup-topology.sh)
      await this.channel.assertExchange(this.config.exchangeName, 'topic', {
        durable: true,
      });

      this.reconnectAttempts = 0;
      this.logger.info('Connected to RabbitMQ successfully');
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to connect to RabbitMQ'
      );
      throw error;
    }
  }

  /**
   * Publish a Discord event to RabbitMQ
   */
  async publish(event: DiscordEventPayload, priority?: number): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    const routingKey = event.eventType;
    const content = Buffer.from(JSON.stringify(event));

    try {
      // Publish with confirmation
      await new Promise<void>((resolve, reject) => {
        const published = this.channel!.publish(
          this.config.exchangeName,
          routingKey,
          content,
          {
            persistent: true, // deliveryMode: 2
            contentType: 'application/json',
            timestamp: event.timestamp,
            messageId: event.eventId,
            priority: priority,
            headers: {
              shardId: event.shardId,
              guildId: event.guildId,
            },
          },
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );

        if (!published) {
          reject(new Error('Channel write buffer full'));
        }
      });

      this.publishCount++;
      this.lastPublishTime = Date.now();

      this.logger.debug(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          guildId: event.guildId,
          priority,
        },
        'Event published to RabbitMQ'
      );
    } catch (error) {
      this.errorCount++;
      this.logger.error(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to publish event'
      );
      throw error;
    }
  }

  /**
   * Check if publisher is healthy
   */
  isHealthy(): boolean {
    return this.connection !== null && this.channel !== null && !this.isShuttingDown;
  }

  /**
   * Get publisher status for health checks
   */
  getStatus(): PublisherStatus {
    return {
      connected: this.connection !== null,
      channelOpen: this.channel !== null,
      lastPublishTime: this.lastPublishTime,
      publishCount: this.publishCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Close connection gracefully
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Closing RabbitMQ connection...');

    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.logger.info('RabbitMQ connection closed');
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Error closing RabbitMQ connection'
      );
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.logger.error('Max reconnection attempts reached');
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    this.logger.info(
      { attempt: this.reconnectAttempts, maxAttempts: this.maxReconnectAttempts, delayMs: delay },
      'Scheduling RabbitMQ reconnection'
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Reconnection failed'
        );
      }
    }, delay);
  }

  /**
   * Mask sensitive parts of URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return '***masked***';
    }
  }
}
