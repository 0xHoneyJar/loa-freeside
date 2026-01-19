/**
 * ConfigSubscriber Tests
 *
 * Sprint 120: Pub/Sub Subscriber + Cache
 *
 * Tests Pub/Sub subscription, message handling, and cache invalidation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConfigSubscriber,
  createConfigSubscriber,
} from '../../../src/services/config/ConfigSubscriber.js';
import {
  getCacheMetricsRaw,
  resetCacheMetrics,
} from '../../../src/services/config/cacheMetrics.js';
import type { IConfigCache } from '../../../src/services/config/ConfigCache.js';
import type { InvalidationMessage } from '../../../src/services/config/ConfigPublisher.js';

// =============================================================================
// Mock Redis with Pub/Sub
// =============================================================================

function createMockRedis() {
  const messageHandlers: Array<(channel: string, message: string) => void> = [];
  const subscribedChannels: Set<string> = new Set();

  return {
    subscribe: vi.fn(async (...channels: string[]) => {
      for (const channel of channels) {
        subscribedChannels.add(channel);
      }
    }),
    unsubscribe: vi.fn(async (...channels: string[]) => {
      for (const channel of channels) {
        subscribedChannels.delete(channel);
      }
    }),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'message') {
        messageHandlers.push(handler);
      }
    }),
    // Helper to simulate incoming messages
    simulateMessage: (channel: string, message: string) => {
      for (const handler of messageHandlers) {
        handler(channel, message);
      }
    },
    subscribedChannels,
    messageHandlers,
  };
}

function createMockCache(): IConfigCache & { invalidateCalls: string[] } {
  const invalidateCalls: string[] = [];

  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(async (serverId: string) => {
      invalidateCalls.push(serverId);
    }),
    clear: vi.fn().mockResolvedValue(undefined),
    invalidateCalls,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createInvalidationMessage(overrides: Partial<InvalidationMessage> = {}): InvalidationMessage {
  return {
    recordId: 'record-123',
    type: 'ThresholdChange',
    timestamp: new Date().toISOString(),
    serverId: 'server-456',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ConfigSubscriber', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockCache: ReturnType<typeof createMockCache>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let subscriber: ConfigSubscriber;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockCache = createMockCache();
    mockLogger = createMockLogger();
    resetCacheMetrics();

    subscriber = new ConfigSubscriber({
      redis: mockRedis as any,
      cache: mockCache,
      logger: mockLogger as any,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Subscription Tests
  // ===========================================================================

  describe('subscribe', () => {
    it('should subscribe to server channel', async () => {
      await subscriber.subscribe('server-123');

      expect(mockRedis.subscribe).toHaveBeenCalledWith('config:sync:server-123');
      expect(subscriber.getSubscribedServers()).toContain('server-123');
    });

    it('should not duplicate subscriptions', async () => {
      await subscriber.subscribe('server-123');
      await subscriber.subscribe('server-123');

      expect(mockRedis.subscribe).toHaveBeenCalledTimes(1);
    });

    it('should use custom channel prefix', async () => {
      const customSubscriber = new ConfigSubscriber({
        redis: mockRedis as any,
        cache: mockCache,
        channelPrefix: 'custom:config',
      });

      await customSubscriber.subscribe('server-123');

      expect(mockRedis.subscribe).toHaveBeenCalledWith('custom:config:server-123');
    });
  });

  describe('subscribeAll', () => {
    it('should subscribe to multiple servers', async () => {
      await subscriber.subscribeAll(['server-1', 'server-2', 'server-3']);

      expect(mockRedis.subscribe).toHaveBeenCalledWith(
        'config:sync:server-1',
        'config:sync:server-2',
        'config:sync:server-3'
      );
      expect(subscriber.getSubscribedServers()).toHaveLength(3);
    });

    it('should skip already subscribed servers', async () => {
      await subscriber.subscribe('server-1');
      mockRedis.subscribe.mockClear();

      await subscriber.subscribeAll(['server-1', 'server-2']);

      expect(mockRedis.subscribe).toHaveBeenCalledWith('config:sync:server-2');
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe from server channel', async () => {
      await subscriber.subscribe('server-123');
      await subscriber.unsubscribe('server-123');

      expect(mockRedis.unsubscribe).toHaveBeenCalledWith('config:sync:server-123');
      expect(subscriber.getSubscribedServers()).not.toContain('server-123');
    });

    it('should handle unsubscribe from non-subscribed server', async () => {
      await subscriber.unsubscribe('nonexistent');

      expect(mockRedis.unsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should unsubscribe from all channels', async () => {
      await subscriber.subscribeAll(['server-1', 'server-2']);
      await subscriber.shutdown();

      expect(mockRedis.unsubscribe).toHaveBeenCalled();
      expect(subscriber.getSubscribedServers()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Message Handling Tests
  // ===========================================================================

  describe('message handling', () => {
    it('should invalidate cache on message', async () => {
      await subscriber.subscribe('server-456');

      const message = createInvalidationMessage();
      mockRedis.simulateMessage('config:sync:server-456', JSON.stringify(message));

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockCache.invalidateCalls).toContain('server-456');
    });

    it('should record propagation latency metric', async () => {
      await subscriber.subscribe('server-456');

      // Message from 100ms ago
      const message = createInvalidationMessage({
        timestamp: new Date(Date.now() - 100).toISOString(),
      });
      mockRedis.simulateMessage('config:sync:server-456', JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const metrics = getCacheMetricsRaw();
      expect(metrics.propagationLatency.count).toBe(1);
      expect(metrics.propagationLatency.sum).toBeGreaterThanOrEqual(100);
    });

    it('should handle invalid JSON message', async () => {
      await subscriber.subscribe('server-456');

      mockRedis.simulateMessage('config:sync:server-456', 'invalid json');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockCache.invalidateCalls).toHaveLength(0);
    });

    it('should handle message on unexpected channel', async () => {
      await subscriber.subscribe('server-456');

      const message = createInvalidationMessage();
      mockRedis.simulateMessage('unexpected:channel', JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockCache.invalidateCalls).toHaveLength(0);
    });

    it('should log message details', async () => {
      await subscriber.subscribe('server-456');

      const message = createInvalidationMessage({
        recordId: 'record-xyz',
        type: 'FeatureGateChange',
      });
      mockRedis.simulateMessage('config:sync:server-456', JSON.stringify(message));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'server-456',
          recordId: 'record-xyz',
          type: 'FeatureGateChange',
        }),
        'Processed config invalidation'
      );
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createConfigSubscriber', () => {
  it('should create subscriber instance', () => {
    const mockRedis = createMockRedis();
    const mockCache = createMockCache();
    const mockLogger = createMockLogger();

    const subscriber = createConfigSubscriber(
      mockRedis as any,
      mockCache,
      mockLogger as any
    );

    expect(subscriber).toBeInstanceOf(ConfigSubscriber);
  });
});
