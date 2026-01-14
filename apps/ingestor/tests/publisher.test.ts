import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Publisher } from '../src/publisher.js';
import type { Config } from '../src/config.js';
import type { DiscordEventPayload } from '../src/types.js';

// Mock amqplib
vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn(),
  },
}));

import amqp from 'amqplib';

describe('Publisher', () => {
  const mockConfig: Config = {
    discordToken: 'test-token',
    shardId: 0,
    shardCount: 1,
    rabbitmqUrl: 'amqps://localhost:5671',
    exchangeName: 'arrakis.events',
    interactionQueue: 'arrakis.interactions',
    eventQueue: 'arrakis.events.guild',
    healthPort: 8080,
    memoryThresholdMb: 75,
    nodeEnv: 'development',
    logLevel: 'info',
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as any;

  let mockChannel: any;
  let mockConnection: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockChannel = {
      assertExchange: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn((exchange, routingKey, content, options, callback) => {
        if (callback) callback(null);
        return true;
      }),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    mockConnection = {
      createConfirmChannel: vi.fn().mockResolvedValue(mockChannel),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    (amqp.connect as any).mockResolvedValue(mockConnection);
  });

  describe('connect', () => {
    it('should connect to RabbitMQ', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      expect(amqp.connect).toHaveBeenCalledWith(mockConfig.rabbitmqUrl, { heartbeat: 30 });
      expect(mockConnection.createConfirmChannel).toHaveBeenCalled();
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        mockConfig.exchangeName,
        'topic',
        { durable: true }
      );
    });

    it('should log connection success', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      expect(mockLogger.info).toHaveBeenCalledWith('Connected to RabbitMQ successfully');
    });

    it('should mask password in URL logging', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const connectingCall = mockLogger.info.mock.calls.find(
        (call: any[]) => call[0]?.url
      );
      expect(connectingCall).toBeDefined();
      // Password should be masked
      expect(connectingCall[0].url).not.toContain('password');
    });
  });

  describe('publish', () => {
    it('should publish event with correct routing key', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const event: DiscordEventPayload = {
        eventId: 'test-uuid',
        eventType: 'interaction.command.check-eligibility',
        timestamp: Date.now(),
        shardId: 0,
        guildId: '123456789',
        userId: '987654321',
        data: {},
      };

      await publisher.publish(event, 10);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        mockConfig.exchangeName,
        'interaction.command.check-eligibility',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          contentType: 'application/json',
          priority: 10,
        }),
        expect.any(Function)
      );
    });

    it('should serialize event to JSON', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const event: DiscordEventPayload = {
        eventId: 'test-uuid',
        eventType: 'member.join',
        timestamp: Date.now(),
        shardId: 0,
        guildId: '123456789',
        userId: '987654321',
        data: { username: 'testuser' },
      };

      await publisher.publish(event);

      const publishedContent = mockChannel.publish.mock.calls[0][2];
      const parsed = JSON.parse(publishedContent.toString());
      expect(parsed.eventId).toBe('test-uuid');
      expect(parsed.data.username).toBe('testuser');
    });

    it('should increment publish count on success', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const event: DiscordEventPayload = {
        eventId: 'test-uuid',
        eventType: 'member.join',
        timestamp: Date.now(),
        shardId: 0,
        guildId: '123456789',
        data: {},
      };

      await publisher.publish(event);

      const status = publisher.getStatus();
      expect(status.publishCount).toBe(1);
    });

    it('should throw when channel not available', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);

      const event: DiscordEventPayload = {
        eventId: 'test-uuid',
        eventType: 'member.join',
        timestamp: Date.now(),
        shardId: 0,
        guildId: '123456789',
        data: {},
      };

      await expect(publisher.publish(event)).rejects.toThrow('RabbitMQ channel not available');
    });

    it('should increment error count on failure', async () => {
      mockChannel.publish.mockImplementation(
        (exchange: string, routingKey: string, content: Buffer, options: any, callback: any) => {
          callback(new Error('Publish failed'));
          return true;
        }
      );

      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const event: DiscordEventPayload = {
        eventId: 'test-uuid',
        eventType: 'member.join',
        timestamp: Date.now(),
        shardId: 0,
        guildId: '123456789',
        data: {},
      };

      await expect(publisher.publish(event)).rejects.toThrow('Publish failed');

      const status = publisher.getStatus();
      expect(status.errorCount).toBe(1);
    });
  });

  describe('isHealthy', () => {
    it('should return true when connected', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      expect(publisher.isHealthy()).toBe(true);
    });

    it('should return false when not connected', () => {
      const publisher = new Publisher(mockConfig, mockLogger);

      expect(publisher.isHealthy()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();

      const status = publisher.getStatus();

      expect(status.connected).toBe(true);
      expect(status.channelOpen).toBe(true);
      expect(status.publishCount).toBe(0);
      expect(status.errorCount).toBe(0);
    });
  });

  describe('close', () => {
    it('should close channel and connection', async () => {
      const publisher = new Publisher(mockConfig, mockLogger);
      await publisher.connect();
      await publisher.close();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
      expect(publisher.isHealthy()).toBe(false);
    });
  });
});
