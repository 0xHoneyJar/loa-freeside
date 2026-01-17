/**
 * EventRouter Tests
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 *
 * Unit tests for EventRouter service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nats module before importing EventRouter
vi.mock('nats', () => ({
  AckPolicy: { Explicit: 'explicit' },
  DeliverPolicy: { All: 'all' },
  RetentionPolicy: { Limits: 'limits', Interest: 'interest', WorkQueue: 'workqueue' },
  StorageType: { File: 'file', Memory: 'memory' },
}));

import { EventRouter, SANDBOX_STREAM_CONFIG } from '../services/event-router.js';
import type { RouteProvider, RouteLookupResult } from '../services/route-provider.js';
import type { Logger } from 'pino';

// Mock logger
const createMockLogger = (): Logger => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  } as unknown as Logger;
  return logger;
};

// Mock RouteProvider
const createMockRouteProvider = () => {
  const mappings = new Map<string, string | null>();

  return {
    getSandboxForGuild: vi.fn((guildId: string): Promise<RouteLookupResult> => {
      const sandboxId = mappings.get(guildId) ?? null;
      return Promise.resolve({
        sandboxId,
        cached: false,
        latencyMs: 1,
      });
    }),
    _setMapping: (guildId: string, sandboxId: string | null) => {
      mappings.set(guildId, sandboxId);
    },
    _clearMappings: () => mappings.clear(),
  } as unknown as RouteProvider & {
    _setMapping: (guildId: string, sandboxId: string | null) => void;
    _clearMappings: () => void;
  };
};

// Mock JetStream client
const createMockJetStream = () => {
  const publishedMessages: { subject: string; data: Uint8Array }[] = [];

  return {
    publish: vi.fn((subject: string, data: Uint8Array) => {
      publishedMessages.push({ subject, data });
      return Promise.resolve({ stream: 'SANDBOX', seq: 1 });
    }),
    consumers: {
      get: vi.fn(() => ({
        consume: vi.fn(() => Promise.resolve({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true }),
          }),
        })),
      })),
    },
    _getPublished: () => publishedMessages,
    _clearPublished: () => publishedMessages.length = 0,
  };
};

// Mock JetStream manager
const createMockJsm = () => {
  const streams = new Set<string>(['EVENTS']);
  const consumers = new Map<string, { stream: string; name: string }>();

  return {
    streams: {
      info: vi.fn((name: string) => {
        if (streams.has(name)) {
          return Promise.resolve({ state: { messages: 0 } });
        }
        return Promise.reject(new Error('Stream not found'));
      }),
      add: vi.fn((config: { name: string }) => {
        streams.add(config.name);
        return Promise.resolve({ config });
      }),
    },
    consumers: {
      info: vi.fn((stream: string, name: string) => {
        const key = `${stream}:${name}`;
        if (consumers.has(key)) {
          return Promise.resolve(consumers.get(key));
        }
        return Promise.reject(new Error('Consumer not found'));
      }),
      add: vi.fn((stream: string, config: { durable_name: string }) => {
        const key = `${stream}:${config.durable_name}`;
        consumers.set(key, { stream, name: config.durable_name });
        return Promise.resolve({ name: config.durable_name });
      }),
    },
    _hasStream: (name: string) => streams.has(name),
    _hasConsumer: (stream: string, name: string) => consumers.has(`${stream}:${name}`),
  };
};

describe('EventRouter', () => {
  let router: EventRouter;
  let mockJetStream: ReturnType<typeof createMockJetStream>;
  let mockJsm: ReturnType<typeof createMockJsm>;
  let mockRouteProvider: ReturnType<typeof createMockRouteProvider>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockJetStream = createMockJetStream();
    mockJsm = createMockJsm();
    mockRouteProvider = createMockRouteProvider();
    mockLogger = createMockLogger();

    router = new EventRouter({
      jetstream: mockJetStream as any,
      jetstreamManager: mockJsm as any,
      routeProvider: mockRouteProvider,
      logger: mockLogger,
      consumerName: 'test-router',
    });
  });

  describe('ensureSandboxStream', () => {
    it('should create SANDBOX stream if not exists', async () => {
      await router.ensureSandboxStream();

      expect(mockJsm.streams.add).toHaveBeenCalled();
      expect(mockJsm._hasStream('SANDBOX')).toBe(true);
    });

    it('should not recreate existing stream', async () => {
      // Pre-create stream
      await mockJsm.streams.add({ name: 'SANDBOX' } as any);
      mockJsm.streams.add.mockClear();

      await router.ensureSandboxStream();

      // Stream.add should not be called again
      expect(mockJsm.streams.add).not.toHaveBeenCalled();
    });
  });

  describe('ensureConsumer', () => {
    it('should create consumer if not exists', async () => {
      await router.ensureConsumer();

      expect(mockJsm.consumers.add).toHaveBeenCalled();
      expect(mockJsm._hasConsumer('EVENTS', 'test-router')).toBe(true);
    });

    it('should not recreate existing consumer', async () => {
      // Pre-create consumer
      await mockJsm.consumers.add('EVENTS', { durable_name: 'test-router' } as any);
      mockJsm.consumers.add.mockClear();

      await router.ensureConsumer();

      expect(mockJsm.consumers.add).not.toHaveBeenCalled();
    });
  });

  describe('routeDirect', () => {
    it('should route event without guild_id to production', async () => {
      const subject = 'events.READY';
      const event = { t: 'READY', d: { user: { id: '123' } } };

      const result = await router.routeDirect(subject, event);

      expect(result.guildId).toBeNull();
      expect(result.sandboxId).toBeNull();
      expect(result.targetSubject).toBe(subject);

      const published = mockJetStream._getPublished();
      expect(published).toHaveLength(1);
      expect(published[0].subject).toBe('events.READY');
    });

    it('should route event to production when no sandbox mapping', async () => {
      const subject = 'events.MESSAGE_CREATE';
      const guildId = '123456789012345678';
      const event = { t: 'MESSAGE_CREATE', d: { guild_id: guildId, content: 'Hello' } };

      // No sandbox mapping exists

      const result = await router.routeDirect(subject, event);

      expect(result.guildId).toBe(guildId);
      expect(result.sandboxId).toBeNull();
      expect(result.targetSubject).toBe(subject);
    });

    it('should route event to sandbox when mapping exists', async () => {
      const subject = 'events.MESSAGE_CREATE';
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';
      const event = { t: 'MESSAGE_CREATE', d: { guild_id: guildId, content: 'Hello' } };

      // Set up sandbox mapping
      mockRouteProvider._setMapping(guildId, sandboxId);

      const result = await router.routeDirect(subject, event);

      expect(result.guildId).toBe(guildId);
      expect(result.sandboxId).toBe(sandboxId);
      expect(result.targetSubject).toBe(`sandbox.${sandboxId}.${subject}`);

      const published = mockJetStream._getPublished();
      expect(published).toHaveLength(1);
      expect(published[0].subject).toBe(`sandbox.${sandboxId}.events.MESSAGE_CREATE`);
    });

    it('should handle top-level guild_id', async () => {
      const subject = 'events.GUILD_CREATE';
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';
      const event = { t: 'GUILD_CREATE', guild_id: guildId, d: { name: 'Test Guild' } };

      mockRouteProvider._setMapping(guildId, sandboxId);

      const result = await router.routeDirect(subject, event);

      expect(result.guildId).toBe(guildId);
      expect(result.sandboxId).toBe(sandboxId);
    });

    it('should accept JSON string as data', async () => {
      const subject = 'events.MESSAGE_CREATE';
      const event = { t: 'MESSAGE_CREATE', d: { guild_id: '123', content: 'Hello' } };

      const result = await router.routeDirect(subject, JSON.stringify(event));

      expect(result.guildId).toBe('123');
      expect(mockJetStream.publish).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = router.getStats();

      expect(stats.totalProcessed).toBe(0);
      expect(stats.routedToSandbox).toBe(0);
      expect(stats.routedToProduction).toBe(0);
      expect(stats.noGuildId).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.avgLatencyMs).toBe(0);
    });

    it('should track routing statistics', async () => {
      // Route to production (no guild_id)
      await router.routeDirect('events.READY', { t: 'READY' });

      // Route to production (has guild_id, no mapping)
      await router.routeDirect('events.MESSAGE_CREATE', {
        t: 'MESSAGE_CREATE',
        d: { guild_id: 'unmapped-guild' },
      });

      // Route to sandbox
      mockRouteProvider._setMapping('mapped-guild', 'sandbox-1');
      await router.routeDirect('events.MESSAGE_CREATE', {
        t: 'MESSAGE_CREATE',
        d: { guild_id: 'mapped-guild' },
      });

      const stats = router.getStats();

      expect(stats.totalProcessed).toBe(3);
      expect(stats.noGuildId).toBe(1);
      expect(stats.routedToProduction).toBe(1);
      expect(stats.routedToSandbox).toBe(1);
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', async () => {
      // Generate some stats
      await router.routeDirect('events.READY', { t: 'READY' });
      await router.routeDirect('events.READY', { t: 'READY' });

      expect(router.getStats().totalProcessed).toBe(2);

      router.resetStats();

      const stats = router.getStats();
      expect(stats.totalProcessed).toBe(0);
      expect(stats.noGuildId).toBe(0);
      expect(stats.avgLatencyMs).toBe(0);
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      expect(router.isRunning()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should be idempotent when not running', async () => {
      await expect(router.stop()).resolves.toBeUndefined();
    });
  });
});

describe('SANDBOX_STREAM_CONFIG', () => {
  it('should have correct stream name', () => {
    expect(SANDBOX_STREAM_CONFIG.name).toBe('SANDBOX');
  });

  it('should subscribe to sandbox.> subjects', () => {
    expect(SANDBOX_STREAM_CONFIG.subjects).toContain('sandbox.>');
  });

  it('should use memory storage', () => {
    expect(SANDBOX_STREAM_CONFIG.storage).toBe('memory');
  });

  it('should have 3 replicas', () => {
    expect(SANDBOX_STREAM_CONFIG.replicas).toBe(3);
  });

  it('should have 5 minute max age', () => {
    const fiveMinutesNs = 5 * 60 * 1_000_000_000;
    expect(SANDBOX_STREAM_CONFIG.maxAge).toBe(fiveMinutesNs);
  });

  it('should have 500k max messages', () => {
    expect(SANDBOX_STREAM_CONFIG.maxMsgs).toBe(500_000);
  });
});
