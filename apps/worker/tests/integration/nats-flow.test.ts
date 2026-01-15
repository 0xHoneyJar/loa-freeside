/**
 * NATS Integration Tests
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Tests the full message flow through NATS JetStream.
 * Requires NATS server running (docker-compose or local).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, NatsConnection, JetStreamClient, StringCodec } from 'nats';

// Skip if no NATS available
const NATS_URL = process.env['NATS_URL'] || 'nats://localhost:4222';
const SKIP_INTEGRATION = process.env['SKIP_INTEGRATION'] === 'true';

describe.skipIf(SKIP_INTEGRATION)('NATS Integration', () => {
  let nc: NatsConnection;
  let js: JetStreamClient;
  const sc = StringCodec();

  beforeAll(async () => {
    try {
      nc = await connect({ servers: [NATS_URL] });
      js = nc.jetstream();
    } catch (error) {
      console.warn('NATS not available, skipping integration tests');
      throw error;
    }
  });

  afterAll(async () => {
    if (nc) {
      await nc.drain();
    }
  });

  describe('Stream Setup', () => {
    it('should verify COMMANDS stream exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.streams.info('COMMANDS');

      expect(info.config.name).toBe('COMMANDS');
      expect(info.config.subjects).toContain('commands.>');
    });

    it('should verify EVENTS stream exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.streams.info('EVENTS');

      expect(info.config.name).toBe('EVENTS');
      expect(info.config.subjects).toContain('events.>');
    });

    it('should verify ELIGIBILITY stream exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.streams.info('ELIGIBILITY');

      expect(info.config.name).toBe('ELIGIBILITY');
      expect(info.config.subjects).toContain('eligibility.>');
    });
  });

  describe('Message Publishing', () => {
    it('should publish command message', async () => {
      const payload = {
        event_id: `test_${Date.now()}`,
        event_type: 'interaction.command.test',
        shard_id: 0,
        timestamp: Date.now(),
        guild_id: '123456789',
        channel_id: '987654321',
        user_id: '111222333',
        data: {
          interaction_id: 'int_test',
          interaction_type: 'APPLICATION_COMMAND',
          token: 'test_token',
          command_name: 'test',
        },
      };

      const ack = await js.publish(
        'commands.interaction',
        sc.encode(JSON.stringify(payload))
      );

      expect(ack.stream).toBe('COMMANDS');
      expect(ack.seq).toBeGreaterThan(0);
    });

    it('should publish event message', async () => {
      const payload = {
        event_id: `test_${Date.now()}`,
        event_type: 'member.join',
        shard_id: 0,
        timestamp: Date.now(),
        guild_id: '123456789',
        user_id: '111222333',
        data: {
          username: 'testuser',
        },
      };

      const ack = await js.publish(
        'events.member.join',
        sc.encode(JSON.stringify(payload))
      );

      expect(ack.stream).toBe('EVENTS');
      expect(ack.seq).toBeGreaterThan(0);
    });

    it('should publish eligibility check message', async () => {
      const payload = {
        event_id: `test_${Date.now()}`,
        event_type: 'eligibility.check',
        timestamp: Date.now(),
        community_id: 'comm_123',
        guild_id: '123456789',
        user_id: '111222333',
        wallet_address: '0x1234567890abcdef',
        check_type: 'single',
        data: {},
      };

      const ack = await js.publish(
        'eligibility.check.single',
        sc.encode(JSON.stringify(payload))
      );

      expect(ack.stream).toBe('ELIGIBILITY');
      expect(ack.seq).toBeGreaterThan(0);
    });
  });

  describe('Consumer Configuration', () => {
    it('should verify command-worker consumer exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.consumers.info('COMMANDS', 'command-worker');

      expect(info.config.durable_name).toBe('command-worker');
      expect(info.config.max_ack_pending).toBe(50);
    });

    it('should verify event-worker consumer exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.consumers.info('EVENTS', 'event-worker');

      expect(info.config.durable_name).toBe('event-worker');
      expect(info.config.max_ack_pending).toBe(100);
    });

    it('should verify eligibility-worker consumer exists', async () => {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.consumers.info('ELIGIBILITY', 'eligibility-worker');

      expect(info.config.durable_name).toBe('eligibility-worker');
      expect(info.config.max_ack_pending).toBe(200);
    });
  });
});
