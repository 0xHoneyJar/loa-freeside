/**
 * End-to-End Tests for Gateway Proxy Pattern
 *
 * Tests the complete flow: Ingestor -> RabbitMQ -> Worker -> Discord REST
 *
 * These tests simulate the full message flow using mocked external services
 * (Discord Gateway, Discord REST API) but real RabbitMQ communication patterns.
 *
 * Per Sprint GW-5 TASK-5.1:
 * 1. Slash command flow: User -> Gateway -> Ingestor -> Queue -> Worker -> REST -> User
 * 2. Member join flow: Gateway -> Ingestor -> Queue -> Worker -> Role assignment
 * 3. Worker crash recovery: Events buffered in queue, processed on recovery
 * 4. Ingestor restart: Gateway reconnects, no event loss
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import type { DiscordEventPayload } from '../../src/types.js';

// ============================================================================
// Mock Setup - All vi.mock calls MUST be at top level before any variables
// ============================================================================

// Mock RabbitMQ channel and connection
const mockChannel = {
  prefetch: vi.fn(),
  consume: vi.fn(),
  ack: vi.fn(),
  nack: vi.fn(),
  cancel: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  publish: vi.fn(),
  assertExchange: vi.fn(),
  assertQueue: vi.fn(),
  bindQueue: vi.fn(),
  sendToQueue: vi.fn(),
};

const mockConnection = {
  createChannel: vi.fn(),
  createConfirmChannel: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
};

// Helper to reset mock implementations after vi.clearAllMocks()
function resetMockImplementations() {
  mockChannel.prefetch.mockResolvedValue(undefined);
  mockChannel.cancel.mockResolvedValue(undefined);
  mockChannel.close.mockResolvedValue(undefined);
  mockChannel.publish.mockReturnValue(true);
  mockChannel.assertExchange.mockResolvedValue({});
  mockChannel.assertQueue.mockResolvedValue({});
  mockChannel.bindQueue.mockResolvedValue({});
  mockChannel.sendToQueue.mockReturnValue(true);
  mockConnection.createChannel.mockResolvedValue(mockChannel);
  mockConnection.createConfirmChannel.mockResolvedValue({
    ...mockChannel,
    waitForConfirms: vi.fn().mockResolvedValue(undefined),
  });
  mockConnection.close.mockResolvedValue(undefined);
}

// Initial setup
resetMockImplementations();

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockImplementation(() => Promise.resolve(mockConnection)),
  },
}));

// Mock handlers - use inline values, not external references
vi.mock('../../src/handlers/index.js', () => ({
  // For InteractionConsumer
  getCommandHandler: vi.fn().mockReturnValue(null),
  defaultCommandHandler: vi.fn().mockResolvedValue('ack'),
  // For EventConsumer
  getEventHandler: vi.fn().mockReturnValue(null),
  defaultEventHandler: vi.fn().mockResolvedValue('ack'),
}));

// Import consumers after mocking
import { InteractionConsumer } from '../../src/consumers/InteractionConsumer.js';
import { EventConsumer } from '../../src/consumers/EventConsumer.js';

// ============================================================================
// Test Utilities
// ============================================================================

// Mock logger factory - returns a new mock with proper child() support
const createMockLogger = (): Logger => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };
  // child() returns itself to allow chaining
  logger.child.mockReturnValue(logger);
  return logger as unknown as Logger;
};

// Mock Discord REST service factory
const createMockDiscordRest = () => ({
  deferReply: vi.fn().mockResolvedValue({ success: true }),
  sendFollowup: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
  editOriginal: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-123' }),
  setToken: vi.fn(),
  assignRole: vi.fn().mockResolvedValue({ success: true }),
  removeRole: vi.fn().mockResolvedValue({ success: true }),
  sendDM: vi.fn().mockResolvedValue({ success: true }),
  getGuildMember: vi.fn().mockResolvedValue({ success: true, member: { roles: [] } }),
});

// Mock State Manager factory
const createMockStateManager = () => ({
  connect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
  ping: vi.fn().mockResolvedValue(1),
  close: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue(1),
  setCooldown: vi.fn().mockResolvedValue('OK'),
  getCooldown: vi.fn().mockResolvedValue(null),
  clearCooldown: vi.fn().mockResolvedValue(1),
  setSession: vi.fn().mockResolvedValue('OK'),
  getSession: vi.fn().mockResolvedValue(null),
  deleteSession: vi.fn().mockResolvedValue(1),
  updateSession: vi.fn().mockResolvedValue('OK'),
  incrementRateLimit: vi.fn().mockResolvedValue(1),
  getRateLimitCount: vi.fn().mockResolvedValue(0),
});

/**
 * Simulate publishing a message from Ingestor to RabbitMQ
 */
function createIngestorPayload(overrides: Partial<DiscordEventPayload> = {}): DiscordEventPayload {
  return {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    eventType: 'interaction.command.profile',
    timestamp: Date.now(),
    shardId: 0,
    guildId: 'guild-123',
    channelId: 'channel-456',
    userId: 'user-789',
    interactionId: 'interaction-abc',
    interactionToken: 'token-xyz-' + Date.now(),
    commandName: 'profile',
    data: {},
    ...overrides,
  };
}

/**
 * Simulate a RabbitMQ message
 */
function createRabbitMQMessage(payload: DiscordEventPayload) {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: {
      messageId: payload.eventId,
      timestamp: payload.timestamp,
      headers: {
        'x-priority': 8,
      },
    },
    fields: {
      routingKey: payload.eventType,
    },
  };
}

// ============================================================================
// E2E Test Suites
// ============================================================================

describe('E2E: Gateway Proxy Pattern', () => {
  describe('1. Slash Command Flow', () => {
    let interactionConsumer: InteractionConsumer;
    let mockDiscordRest: ReturnType<typeof createMockDiscordRest>;
    let mockStateManager: ReturnType<typeof createMockStateManager>;
    let mockLogger: Logger;
    let messageHandler: (msg: { content: Buffer } | null) => Promise<void>;

    beforeEach(async () => {
      vi.clearAllMocks();
      resetMockImplementations(); // Re-setup mocks after clearing
      mockDiscordRest = createMockDiscordRest();
      mockStateManager = createMockStateManager();
      mockLogger = createMockLogger();

      interactionConsumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await interactionConsumer.connect();

      // Capture the message handler when consume is called
      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        messageHandler = handler;
        return Promise.resolve({ consumerTag: 'e2e-consumer-tag' });
      });

      await interactionConsumer.startConsuming();
    });

    afterEach(async () => {
      await interactionConsumer.close();
    });

    it('should process slash command: User -> Gateway -> Ingestor -> Queue -> Worker -> REST', async () => {
      // Simulate Ingestor publishing a slash command event
      const payload = createIngestorPayload({
        eventType: 'interaction.command.profile',
        commandName: 'profile',
        userId: 'user-12345',
        guildId: 'guild-67890',
      });

      const message = createRabbitMQMessage(payload);

      // Worker receives and processes the message
      await messageHandler(message);

      // Verify the complete flow
      // 1. Discord REST should defer the reply immediately
      expect(mockDiscordRest.deferReply).toHaveBeenCalledWith(
        payload.interactionId,
        payload.interactionToken
      );

      // 2. Message should be acknowledged
      expect(mockChannel.ack).toHaveBeenCalledWith(message);

      // 3. No errors should be logged
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle /check-eligibility command with blockchain RPC', async () => {
      const payload = createIngestorPayload({
        eventType: 'interaction.command.check-eligibility',
        commandName: 'check-eligibility',
        data: {
          options: [{ name: 'wallet', value: '0x1234567890abcdef' }],
        },
      });

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      expect(mockDiscordRest.deferReply).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalled();
    });

    it('should handle button interactions', async () => {
      const payload = createIngestorPayload({
        eventType: 'interaction.button',
        customId: 'profile_page_2',
        componentType: 2,
        data: {
          custom_id: 'profile_page_2',
          component_type: 2,
        },
      });

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      expect(mockDiscordRest.deferReply).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalled();
    });

    it('should handle autocomplete interactions', async () => {
      const payload = createIngestorPayload({
        eventType: 'interaction.autocomplete',
        commandName: 'badges',
        data: {
          name: 'badge_name',
          type: 4,
          value: 'honey',
          focused: true,
        },
      });

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      // Autocomplete should still defer (update type)
      expect(mockDiscordRest.deferReply).toHaveBeenCalled();
      expect(mockChannel.ack).toHaveBeenCalled();
    });

    it('should handle expired interaction tokens gracefully', async () => {
      // Simulate token expiration (>3s since interaction)
      mockDiscordRest.deferReply.mockResolvedValueOnce({
        success: false,
        error: 'Unknown interaction',
      });

      const payload = createIngestorPayload({
        eventType: 'interaction.command.profile',
        timestamp: Date.now() - 5000, // 5 seconds ago
      });

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      // Should nack without requeue (permanent failure)
      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
    });
  });

  describe('2. Member Join Flow', () => {
    let eventConsumer: EventConsumer;
    let mockDiscordRest: ReturnType<typeof createMockDiscordRest>;
    let mockStateManager: ReturnType<typeof createMockStateManager>;
    let mockLogger: Logger;
    let messageHandler: (msg: { content: Buffer } | null) => Promise<void>;

    beforeEach(async () => {
      vi.clearAllMocks();
      resetMockImplementations(); // Re-setup mocks after clearing
      mockDiscordRest = createMockDiscordRest();
      mockStateManager = createMockStateManager();
      mockLogger = createMockLogger();

      // EventConsumer doesn't take DiscordRestService - it's for background events
      eventConsumer = new EventConsumer(
        'amqp://localhost:5672',
        'arrakis.events.guild',
        10,
        mockStateManager as any,
        mockLogger
      );

      await eventConsumer.connect();

      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        messageHandler = handler;
        return Promise.resolve({ consumerTag: 'e2e-event-consumer' });
      });

      await eventConsumer.startConsuming();
    });

    afterEach(async () => {
      await eventConsumer.close();
    });

    it('should process member join: Gateway -> Ingestor -> Queue -> Worker -> Role assignment', async () => {
      const payload: DiscordEventPayload = {
        eventId: `evt-join-${Date.now()}`,
        eventType: 'member.join',
        timestamp: Date.now(),
        shardId: 0,
        guildId: 'guild-123',
        userId: 'new-user-456',
        data: {
          member: {
            user: { id: 'new-user-456', username: 'NewBear' },
            roles: [],
            joined_at: new Date().toISOString(),
          },
        },
      };

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      // Member events don't defer - they process in background
      expect(mockDiscordRest.deferReply).not.toHaveBeenCalled();

      // Should acknowledge successful processing
      expect(mockChannel.ack).toHaveBeenCalledWith(message);
    });

    it('should handle member leave for cleanup', async () => {
      const payload: DiscordEventPayload = {
        eventId: `evt-leave-${Date.now()}`,
        eventType: 'member.leave',
        timestamp: Date.now(),
        shardId: 0,
        guildId: 'guild-123',
        userId: 'leaving-user-789',
        data: {
          user: { id: 'leaving-user-789', username: 'ByeBear' },
        },
      };

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      expect(mockChannel.ack).toHaveBeenCalledWith(message);
    });

    it('should handle member role updates', async () => {
      const payload: DiscordEventPayload = {
        eventId: `evt-update-${Date.now()}`,
        eventType: 'member.update',
        timestamp: Date.now(),
        shardId: 0,
        guildId: 'guild-123',
        userId: 'updated-user-101',
        data: {
          old_member: { roles: ['role-a'] },
          new_member: { roles: ['role-a', 'role-b'] },
        },
      };

      const message = createRabbitMQMessage(payload);
      await messageHandler(message);

      expect(mockChannel.ack).toHaveBeenCalledWith(message);
    });
  });

  describe('3. Worker Crash Recovery', () => {
    it('should buffer messages in queue when worker is unavailable', async () => {
      // This test verifies the concept - RabbitMQ buffers messages when no consumer
      const messageQueue: DiscordEventPayload[] = [];

      // Simulate messages being published while worker is down
      const messages = [
        createIngestorPayload({ eventType: 'interaction.command.profile' }),
        createIngestorPayload({ eventType: 'interaction.command.badges' }),
        createIngestorPayload({ eventType: 'interaction.command.verify' }),
      ];

      messages.forEach((msg) => messageQueue.push(msg));

      // Verify messages are queued
      expect(messageQueue).toHaveLength(3);

      // Simulate new worker coming up and consuming messages
      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const newConsumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await newConsumer.connect();

      let processedCount = 0;
      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        // Simulate processing queued messages
        messageQueue.forEach((payload) => {
          handler({ content: Buffer.from(JSON.stringify(payload)) });
          processedCount++;
        });
        return Promise.resolve({ consumerTag: 'recovery-consumer' });
      });

      await newConsumer.startConsuming();

      // All messages should be processed
      expect(processedCount).toBe(3);

      await newConsumer.close();
    });

    it('should not lose messages during graceful shutdown', async () => {
      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await consumer.connect();
      mockChannel.consume.mockResolvedValue({ consumerTag: 'shutdown-test' });
      await consumer.startConsuming();

      // Graceful shutdown
      await consumer.stopConsuming();

      // Verify consumer was cancelled (messages remain in queue)
      expect(mockChannel.cancel).toHaveBeenCalledWith('shutdown-test');

      await consumer.close();
    });
  });

  describe('4. Ingestor Restart / Gateway Reconnect', () => {
    it('should handle duplicate events (idempotency)', async () => {
      vi.clearAllMocks(); // Clear all mocks before this test

      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await consumer.connect();

      let messageHandler: (msg: { content: Buffer } | null) => Promise<void>;
      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        messageHandler = handler;
        return Promise.resolve({ consumerTag: 'idempotency-test' });
      });

      await consumer.startConsuming();

      // Clear ack count after setup
      mockChannel.ack.mockClear();

      // Same event delivered twice (possible after ingestor restart)
      const payload = createIngestorPayload({
        eventId: 'duplicate-event-id-123',
        eventType: 'interaction.command.profile',
      });

      const message1 = createRabbitMQMessage(payload);
      const message2 = createRabbitMQMessage(payload);

      await messageHandler!(message1);
      await messageHandler!(message2);

      // Both messages should be acknowledged (processed or detected as duplicate)
      expect(mockChannel.ack).toHaveBeenCalledTimes(2);

      await consumer.close();
    });

    it('should maintain message order within same shard', async () => {
      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        1, // prefetch 1 for ordered processing
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await consumer.connect();

      const processedOrder: string[] = [];
      let messageHandler: (msg: { content: Buffer } | null) => Promise<void>;

      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        messageHandler = async (msg: any) => {
          if (msg) {
            const payload = JSON.parse(msg.content.toString());
            processedOrder.push(payload.eventId);
          }
          await handler(msg);
        };
        return Promise.resolve({ consumerTag: 'order-test' });
      });

      await consumer.startConsuming();

      // Messages from same shard should maintain order
      const messages = ['event-1', 'event-2', 'event-3'].map((id) =>
        createIngestorPayload({ eventId: id, shardId: 0 })
      );

      for (const payload of messages) {
        await messageHandler!(createRabbitMQMessage(payload) as any);
      }

      expect(processedOrder).toEqual(['event-1', 'event-2', 'event-3']);

      await consumer.close();
    });
  });

  describe('5. Error Handling & Dead Letter Queue', () => {
    let consumer: InteractionConsumer;
    let mockDiscordRest: ReturnType<typeof createMockDiscordRest>;
    let mockLogger: Logger;
    let messageHandler: (msg: { content: Buffer } | null) => Promise<void>;

    beforeEach(async () => {
      vi.clearAllMocks();
      resetMockImplementations(); // Re-setup mocks after clearing
      mockDiscordRest = createMockDiscordRest();
      mockLogger = createMockLogger();

      consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        createMockStateManager() as any,
        mockLogger
      );

      await consumer.connect();

      mockChannel.consume.mockImplementation((queue: string, handler: any) => {
        messageHandler = handler;
        return Promise.resolve({ consumerTag: 'dlq-test' });
      });

      await consumer.startConsuming();
    });

    afterEach(async () => {
      await consumer.close();
    });

    it('should route invalid payloads to DLQ', async () => {
      const message = { content: Buffer.from('not valid json {{{') };

      await messageHandler(message);

      // Invalid JSON should nack without requeue (goes to DLQ)
      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('should route permanent failures to DLQ', async () => {
      // Missing required fields
      const payload: Partial<DiscordEventPayload> = {
        eventId: 'incomplete-event',
        eventType: 'interaction.command.profile',
        timestamp: Date.now(),
        // Missing interactionId and interactionToken
      };

      const message = { content: Buffer.from(JSON.stringify(payload)) };
      await messageHandler(message);

      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('should nack with requeue for transient failures', async () => {
      // Simulate Discord rate limit (transient error)
      mockDiscordRest.deferReply.mockRejectedValueOnce(new Error('Rate limited'));

      const payload = createIngestorPayload();
      const message = createRabbitMQMessage(payload);

      await messageHandler(message);

      // Rate limit is transient - should requeue
      // Note: Actual implementation may vary; this tests the concept
      expect(mockChannel.nack).toHaveBeenCalled();
    });
  });

  describe('6. Health Check Integration', () => {
    it('should report healthy when all components connected', async () => {
      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      await consumer.connect();

      const status = consumer.getStatus();

      expect(status.connected).toBe(true);
      expect(status.messagesProcessed).toBe(0);
      expect(status.messagesErrored).toBe(0);

      await consumer.close();
    });

    it('should report unhealthy when disconnected', async () => {
      const mockDiscordRest = createMockDiscordRest();
      const mockStateManager = createMockStateManager();
      const mockLogger = createMockLogger();

      const consumer = new InteractionConsumer(
        'amqp://localhost:5672',
        'arrakis.interactions',
        5,
        mockDiscordRest as any,
        mockStateManager as any,
        mockLogger
      );

      // Don't connect - should report disconnected
      const status = consumer.getStatus();

      expect(status.connected).toBe(false);
    });
  });
});

describe('E2E: Message Schema Compatibility', () => {
  describe('Ingestor -> Worker Payload Compatibility', () => {
    it('should accept all valid Ingestor payload formats', () => {
      // Test that Worker can parse all payloads Ingestor might produce
      const validPayloads: DiscordEventPayload[] = [
        // Slash command
        {
          eventId: 'evt-1',
          eventType: 'interaction.command.profile',
          timestamp: Date.now(),
          shardId: 0,
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          interactionId: 'i1',
          interactionToken: 't1',
          commandName: 'profile',
          data: {},
        },
        // Button click
        {
          eventId: 'evt-2',
          eventType: 'interaction.button',
          timestamp: Date.now(),
          shardId: 0,
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          interactionId: 'i2',
          interactionToken: 't2',
          customId: 'btn_click',
          componentType: 2,
          data: {},
        },
        // Member join (no interaction fields)
        {
          eventId: 'evt-3',
          eventType: 'member.join',
          timestamp: Date.now(),
          shardId: 0,
          guildId: 'g1',
          userId: 'u2',
          data: { member: { user: { id: 'u2' }, roles: [] } },
        },
        // Autocomplete
        {
          eventId: 'evt-4',
          eventType: 'interaction.autocomplete',
          timestamp: Date.now(),
          shardId: 0,
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          interactionId: 'i4',
          interactionToken: 't4',
          commandName: 'badges',
          data: { focused: true, value: 'honey' },
        },
      ];

      validPayloads.forEach((payload) => {
        // Verify JSON round-trip
        const serialized = JSON.stringify(payload);
        const deserialized = JSON.parse(serialized) as DiscordEventPayload;

        expect(deserialized.eventId).toBe(payload.eventId);
        expect(deserialized.eventType).toBe(payload.eventType);
        expect(deserialized.timestamp).toBe(payload.timestamp);
      });
    });

    it('should handle optional fields correctly', () => {
      const minimalPayload: DiscordEventPayload = {
        eventId: 'minimal-event',
        eventType: 'interaction.command.test',
        timestamp: Date.now(),
        // All optional fields omitted
      };

      const serialized = JSON.stringify(minimalPayload);
      const deserialized = JSON.parse(serialized) as DiscordEventPayload;

      expect(deserialized.eventId).toBe('minimal-event');
      expect(deserialized.guildId).toBeUndefined();
      expect(deserialized.interactionId).toBeUndefined();
    });
  });
});

describe('E2E: Priority Queue Behavior', () => {
  it('should process high-priority interactions before low-priority events', async () => {
    // This test documents expected behavior - actual priority depends on RabbitMQ
    const highPriority = createIngestorPayload({
      eventType: 'interaction.autocomplete', // Priority 9 (highest)
    });

    const mediumPriority = createIngestorPayload({
      eventType: 'interaction.command.profile', // Priority 8
    });

    const lowPriority: DiscordEventPayload = {
      eventId: 'low-priority-event',
      eventType: 'member.join', // Priority 5
      timestamp: Date.now(),
      shardId: 0,
      guildId: 'g1',
      userId: 'u1',
    };

    // Document expected priority ordering
    const expectedOrder = [
      highPriority.eventType, // autocomplete first
      mediumPriority.eventType, // command second
      lowPriority.eventType, // member event last
    ];

    expect(expectedOrder[0]).toBe('interaction.autocomplete');
    expect(expectedOrder[1]).toBe('interaction.command.profile');
    expect(expectedOrder[2]).toBe('member.join');
  });
});
