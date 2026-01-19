/**
 * ConfigPublisher Tests
 *
 * Sprint 119: Pub/Sub Publisher
 *
 * Tests Pub/Sub message publishing, error handling, and metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ConfigPublisher,
  createConfigPublisher,
  type InvalidationMessage,
} from '../../../src/services/config/ConfigPublisher.js';
import {
  getConfigMetricsRaw,
  resetConfigMetrics,
} from '../../../src/services/config/configMetrics.js';
import type { ConfigRecord } from '../../../src/db/types/config.types.js';

// =============================================================================
// Mock Redis
// =============================================================================

function createMockRedis() {
  const publishedMessages: Array<{ channel: string; message: string }> = [];

  return {
    publish: vi.fn(async (channel: string, message: string) => {
      publishedMessages.push({ channel, message });
      return 1; // Number of subscribers
    }),
    publishedMessages,
    // Add a method to make publish fail
    setPublishError: (error: Error) => {
      const redis = createMockRedis();
      redis.publish = vi.fn().mockRejectedValue(error);
      return redis;
    },
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

function createTestRecord(overrides: Partial<ConfigRecord> = {}): ConfigRecord {
  return {
    id: 'record-123',
    serverId: 'server-456',
    userId: 'user-789',
    action: 'CREATE',
    recordableType: 'ThresholdChange',
    recordableId: 'change-abc',
    schemaVersion: 1,
    createdAt: new Date('2026-01-20T12:00:00Z'),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ConfigPublisher', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let publisher: ConfigPublisher;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    resetConfigMetrics();

    publisher = new ConfigPublisher({
      redis: mockRedis as any,
      logger: mockLogger as any,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Channel Name Tests
  // ===========================================================================

  describe('getChannelName', () => {
    it('should generate channel name with default prefix', () => {
      const channel = publisher.getChannelName('server-123');
      expect(channel).toBe('config:sync:server-123');
    });

    it('should use custom channel prefix', () => {
      const customPublisher = new ConfigPublisher({
        redis: mockRedis as any,
        logger: mockLogger as any,
        channelPrefix: 'custom:config',
      });

      const channel = customPublisher.getChannelName('server-123');
      expect(channel).toBe('custom:config:server-123');
    });
  });

  // ===========================================================================
  // Message Format Tests
  // ===========================================================================

  describe('publishInvalidation', () => {
    it('should publish message with correct format', async () => {
      const record = createTestRecord();

      await publisher.publishInvalidation(record);

      expect(mockRedis.publish).toHaveBeenCalledTimes(1);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'config:sync:server-456',
        expect.any(String)
      );

      // Verify message format
      const publishedMessage = JSON.parse(
        mockRedis.publishedMessages[0].message
      ) as InvalidationMessage;

      expect(publishedMessage).toEqual({
        recordId: 'record-123',
        type: 'ThresholdChange',
        timestamp: '2026-01-20T12:00:00.000Z',
        serverId: 'server-456',
      });
    });

    it('should publish to correct channel per server', async () => {
      const record1 = createTestRecord({ serverId: 'server-aaa' });
      const record2 = createTestRecord({ serverId: 'server-bbb' });

      await publisher.publishInvalidation(record1);
      await publisher.publishInvalidation(record2);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'config:sync:server-aaa',
        expect.any(String)
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'config:sync:server-bbb',
        expect.any(String)
      );
    });

    it('should handle all recordable types', async () => {
      const types = ['ThresholdChange', 'FeatureGateChange', 'RoleMapChange'] as const;

      for (const type of types) {
        const record = createTestRecord({ recordableType: type });
        await publisher.publishInvalidation(record);
      }

      expect(mockRedis.publish).toHaveBeenCalledTimes(3);

      // Verify each type was published correctly
      for (let i = 0; i < types.length; i++) {
        const message = JSON.parse(
          mockRedis.publishedMessages[i].message
        ) as InvalidationMessage;
        expect(message.type).toBe(types[i]);
      }
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('should not throw on publish error', async () => {
      const error = new Error('Redis connection failed');
      mockRedis.publish.mockRejectedValue(error);

      const record = createTestRecord();

      // Should not throw
      await expect(publisher.publishInvalidation(record)).resolves.not.toThrow();

      // Should log error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          channel: 'config:sync:server-456',
          recordId: 'record-123',
        }),
        'Failed to publish config invalidation'
      );
    });

    it('should continue with other records if one fails', async () => {
      const records = [
        createTestRecord({ id: 'record-1' }),
        createTestRecord({ id: 'record-2' }),
        createTestRecord({ id: 'record-3' }),
      ];

      // Make second publish fail
      mockRedis.publish
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce(1);

      await publisher.publishInvalidations(records);

      // All three should have been attempted
      expect(mockRedis.publish).toHaveBeenCalledTimes(3);

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Metrics Tests
  // ===========================================================================

  describe('metrics', () => {
    it('should increment invalidation metric on success', async () => {
      const record = createTestRecord({ recordableType: 'ThresholdChange' });

      await publisher.publishInvalidation(record);

      const metrics = getConfigMetricsRaw();
      expect(metrics.invalidationsPublished.get('ThresholdChange')).toBe(1);
    });

    it('should increment error metric on failure', async () => {
      mockRedis.publish.mockRejectedValue(new Error('Failed'));

      const record = createTestRecord({ recordableType: 'FeatureGateChange' });

      await publisher.publishInvalidation(record);

      const metrics = getConfigMetricsRaw();
      expect(metrics.publishErrors.get('FeatureGateChange')).toBe(1);
    });

    it('should track metrics by type', async () => {
      await publisher.publishInvalidation(createTestRecord({ recordableType: 'ThresholdChange' }));
      await publisher.publishInvalidation(createTestRecord({ recordableType: 'ThresholdChange' }));
      await publisher.publishInvalidation(createTestRecord({ recordableType: 'FeatureGateChange' }));

      const metrics = getConfigMetricsRaw();
      expect(metrics.invalidationsPublished.get('ThresholdChange')).toBe(2);
      expect(metrics.invalidationsPublished.get('FeatureGateChange')).toBe(1);
    });
  });

  // ===========================================================================
  // Batch Publishing Tests
  // ===========================================================================

  describe('publishInvalidations', () => {
    it('should publish all records in batch', async () => {
      const records = [
        createTestRecord({ id: 'record-1' }),
        createTestRecord({ id: 'record-2' }),
        createTestRecord({ id: 'record-3' }),
      ];

      await publisher.publishInvalidations(records);

      expect(mockRedis.publish).toHaveBeenCalledTimes(3);
    });

    it('should handle empty batch', async () => {
      await publisher.publishInvalidations([]);

      expect(mockRedis.publish).not.toHaveBeenCalled();
    });

    it('should log batch info', async () => {
      const records = [
        createTestRecord({ id: 'record-1', serverId: 'server-123' }),
        createTestRecord({ id: 'record-2', serverId: 'server-123' }),
      ];

      await publisher.publishInvalidations(records);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: 'server-123',
          count: 2,
        }),
        'Published config invalidations batch'
      );
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createConfigPublisher', () => {
  it('should return null if redis is not provided', () => {
    const mockLogger = createMockLogger();
    const publisher = createConfigPublisher(undefined, mockLogger as any);

    expect(publisher).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'ConfigPublisher: Redis not available, Pub/Sub disabled'
    );
  });

  it('should return ConfigPublisher if redis is provided', () => {
    const mockRedis = createMockRedis();
    const mockLogger = createMockLogger();

    const publisher = createConfigPublisher(mockRedis as any, mockLogger as any);

    expect(publisher).toBeInstanceOf(ConfigPublisher);
  });
});
