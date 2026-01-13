/**
 * TracedRedis Unit Tests
 *
 * Sprint 69: Unified Tracing & Resilience
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withRedisTrace,
  withRedisTraceSync,
  createTracedRedisOps,
  parseRedisKey,
  createTraceContext,
  runWithTrace,
  runWithTraceAsync,
  RedisOperationStats,
} from '../../../../../src/packages/infrastructure/tracing';

describe('TracedRedis', () => {
  describe('withRedisTrace', () => {
    it('executes async operation and returns result', async () => {
      const result = await withRedisTrace('get', 'test-key', async () => {
        return 'test-value';
      });

      expect(result).toBe('test-value');
    });

    it('tracks operation stats with trace context', async () => {
      const stats: RedisOperationStats[] = [];
      const ctx = createTraceContext({ tenantId: 'test-guild' });

      await runWithTraceAsync(ctx, async () => {
        await withRedisTrace(
          'get',
          'user:123',
          async () => 'value',
          { onOperationStats: (s) => stats.push(s) }
        );
      });

      expect(stats).toHaveLength(1);
      expect(stats[0].operation).toBe('get');
      expect(stats[0].key).toBe('user:123');
      expect(stats[0].traceId).toBe(ctx.traceId);
      expect(stats[0].success).toBe(true);
      expect(stats[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('tracks error on failure', async () => {
      const stats: RedisOperationStats[] = [];

      await expect(
        withRedisTrace(
          'get',
          'error-key',
          async () => {
            throw new Error('Redis connection failed');
          },
          { onOperationStats: (s) => stats.push(s) }
        )
      ).rejects.toThrow('Redis connection failed');

      expect(stats).toHaveLength(1);
      expect(stats[0].success).toBe(false);
      expect(stats[0].error).toBe('Redis connection failed');
    });

    it('logs slow operations', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await withRedisTrace(
        'get',
        'slow-key',
        async () => 'value',
        { slowOperationThreshold: 0.0001 } // Very low threshold
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SLOW REDIS]')
      );

      consoleSpy.mockRestore();
    });

    it('does not log when below threshold', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await withRedisTrace(
        'get',
        'fast-key',
        async () => 'value',
        { slowOperationThreshold: 10000 } // 10 seconds
      );

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('works without trace context', async () => {
      const stats: RedisOperationStats[] = [];

      await withRedisTrace(
        'set',
        'no-trace-key',
        async () => {},
        { onOperationStats: (s) => stats.push(s) }
      );

      expect(stats).toHaveLength(1);
      expect(stats[0].traceId).toBeUndefined();
    });
  });

  describe('withRedisTraceSync', () => {
    it('executes sync operation and returns result', () => {
      const result = withRedisTraceSync('prepare', 'pipeline', () => {
        return { commands: ['GET', 'SET'] };
      });

      expect(result).toEqual({ commands: ['GET', 'SET'] });
    });

    it('tracks operation stats', () => {
      const stats: RedisOperationStats[] = [];
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        withRedisTraceSync(
          'build',
          'pipeline:1',
          () => 'built',
          { onOperationStats: (s) => stats.push(s) }
        );
      });

      expect(stats).toHaveLength(1);
      expect(stats[0].operation).toBe('build');
      expect(stats[0].key).toBe('pipeline:1');
      expect(stats[0].success).toBe(true);
    });

    it('tracks error on failure', () => {
      const stats: RedisOperationStats[] = [];

      expect(() =>
        withRedisTraceSync(
          'error',
          'error-key',
          () => {
            throw new Error('Sync error');
          },
          { onOperationStats: (s) => stats.push(s) }
        )
      ).toThrow('Sync error');

      expect(stats[0].success).toBe(false);
      expect(stats[0].error).toBe('Sync error');
    });
  });

  describe('createTracedRedisOps', () => {
    let mockRedis: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      del: ReturnType<typeof vi.fn>;
      exists: ReturnType<typeof vi.fn>;
    };
    let stats: RedisOperationStats[];

    beforeEach(() => {
      mockRedis = {
        get: vi.fn().mockResolvedValue('mock-value'),
        set: vi.fn().mockResolvedValue(undefined),
        del: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
      };
      stats = [];
    });

    it('wraps get operation', async () => {
      const traced = createTracedRedisOps(mockRedis, {
        onOperationStats: (s) => stats.push(s),
      });

      const result = await traced.get('user:123');

      expect(result).toBe('mock-value');
      expect(mockRedis.get).toHaveBeenCalledWith('user:123');
      expect(stats[0].operation).toBe('get');
      expect(stats[0].key).toBe('user:123');
    });

    it('wraps set operation', async () => {
      const traced = createTracedRedisOps(mockRedis, {
        onOperationStats: (s) => stats.push(s),
      });

      await traced.set('user:123', 'new-value', 300);

      expect(mockRedis.set).toHaveBeenCalledWith('user:123', 'new-value', 300);
      expect(stats[0].operation).toBe('set');
    });

    it('wraps del operation', async () => {
      const traced = createTracedRedisOps(mockRedis, {
        onOperationStats: (s) => stats.push(s),
      });

      await traced.del('user:123');

      expect(mockRedis.del).toHaveBeenCalledWith('user:123');
      expect(stats[0].operation).toBe('del');
    });

    it('wraps exists operation', async () => {
      const traced = createTracedRedisOps(mockRedis, {
        onOperationStats: (s) => stats.push(s),
      });

      const result = await traced.exists('user:123');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('user:123');
      expect(stats[0].operation).toBe('exists');
    });

    it('provides trace headers when in context', () => {
      const traced = createTracedRedisOps(mockRedis);
      const ctx = createTraceContext();

      runWithTrace(ctx, () => {
        const headers = traced.getTraceHeaders();

        expect(headers['x-trace-id']).toBe(ctx.traceId);
        expect(headers['x-span-id']).toBeDefined();
      });
    });

    it('returns empty headers when not in context', () => {
      const traced = createTracedRedisOps(mockRedis);
      const headers = traced.getTraceHeaders();

      expect(headers).toEqual({});
    });
  });

  describe('parseRedisKey', () => {
    it('parses simple key', () => {
      const result = parseRedisKey('simple');

      expect(result).toEqual({ prefix: 'simple' });
    });

    it('parses key with identifier', () => {
      const result = parseRedisKey('entitlement:guild-123');

      expect(result).toEqual({
        prefix: 'entitlement',
        identifier: 'guild-123',
      });
    });

    it('parses key with subtype and identifier', () => {
      const result = parseRedisKey('webhook:event:evt_123');

      expect(result).toEqual({
        prefix: 'webhook',
        subtype: 'event',
        identifier: 'evt_123',
      });
    });

    it('preserves colons in identifier', () => {
      const result = parseRedisKey('lock:processing:tenant:123:action:456');

      expect(result).toEqual({
        prefix: 'lock',
        subtype: 'processing',
        identifier: 'tenant:123:action:456',
      });
    });

    it('handles leaderboard key pattern', () => {
      const result = parseRedisKey('leaderboard:top10');

      expect(result).toEqual({
        prefix: 'leaderboard',
        identifier: 'top10',
      });
    });
  });
});
