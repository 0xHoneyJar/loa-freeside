/**
 * Traced Redis Wrapper - Redis Operation Tracing
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides a wrapper around Redis operations that automatically
 * adds trace context for operation correlation.
 *
 * Features:
 * - Automatic trace ID in operation metadata
 * - Span tracking for Redis operations
 * - Operation timing metrics
 * - No changes to existing Redis code required
 *
 * @module packages/infrastructure/tracing/TracedRedis
 */

import {
  getCurrentTrace,
  createSpan,
  getTraceId,
  getSpanId,
} from './TraceContext.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis operation statistics
 */
export interface RedisOperationStats {
  /** Operation name (get, set, del, etc.) */
  operation: string;
  /** Redis key */
  key: string;
  /** Execution duration (ms) */
  duration: number;
  /** Trace ID */
  traceId?: string;
  /** Span ID */
  spanId?: string;
  /** Whether operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Redis operation stats callback
 */
export type RedisStatsCallback = (stats: RedisOperationStats) => void;

/**
 * Options for traced Redis operations
 */
export interface TracedRedisOptions {
  /** Callback for operation statistics */
  onOperationStats?: RedisStatsCallback;
  /** Log slow operations above this threshold (ms) */
  slowOperationThreshold?: number;
}

// =============================================================================
// Redis Operation Tracing Functions
// =============================================================================

/**
 * Internal options with defaults applied
 */
interface ResolvedOptions {
  onOperationStats: RedisStatsCallback;
  slowOperationThreshold: number;
}

/**
 * Resolve options with defaults
 */
function resolveOptions(options?: TracedRedisOptions): ResolvedOptions {
  return {
    onOperationStats: options?.onOperationStats ?? (() => {}),
    slowOperationThreshold: options?.slowOperationThreshold ?? 0,
  };
}

/**
 * Wrap a Redis operation with tracing
 *
 * @param operation - Operation name (e.g., 'get', 'set', 'del')
 * @param key - Redis key being operated on
 * @param fn - Async function performing the operation
 * @param options - Tracing options
 * @returns Result of the operation
 *
 * @example
 * ```typescript
 * const value = await withRedisTrace('get', 'user:123', async () => {
 *   return await redis.get('user:123');
 * });
 * ```
 */
export async function withRedisTrace<T>(
  operation: string,
  key: string,
  fn: () => Promise<T>,
  options?: TracedRedisOptions
): Promise<T> {
  const resolvedOptions = resolveOptions(options);
  const trace = getCurrentTrace();
  const { span, endSpan } = createSpan({
    operationName: `redis.${operation}`,
    attributes: {
      'db.system': 'redis',
      'db.operation': operation,
      'redis.key': key,
    },
  });

  const startTime = performance.now();
  let success = true;
  let errorMessage: string | undefined;

  try {
    const result = await fn();
    return result;
  } catch (error) {
    success = false;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const duration = performance.now() - startTime;
    endSpan(success ? 'ok' : 'error');

    // Report stats
    resolvedOptions.onOperationStats({
      operation,
      key,
      duration,
      traceId: trace?.traceId,
      spanId: span.spanId,
      success,
      error: errorMessage,
    });

    // Log slow operations
    if (
      resolvedOptions.slowOperationThreshold > 0 &&
      duration > resolvedOptions.slowOperationThreshold
    ) {
      console.warn(
        `[SLOW REDIS] ${duration.toFixed(2)}ms - ${operation} ${key}`
      );
    }
  }
}

/**
 * Wrap a synchronous Redis operation with tracing
 * (For operations like pipeline building)
 *
 * @param operation - Operation name
 * @param key - Redis key
 * @param fn - Sync function performing the operation
 * @param options - Tracing options
 * @returns Result of the operation
 */
export function withRedisTraceSync<T>(
  operation: string,
  key: string,
  fn: () => T,
  options?: TracedRedisOptions
): T {
  const resolvedOptions = resolveOptions(options);
  const trace = getCurrentTrace();
  const { span, endSpan } = createSpan({
    operationName: `redis.${operation}`,
    attributes: {
      'db.system': 'redis',
      'db.operation': operation,
      'redis.key': key,
    },
  });

  const startTime = performance.now();
  let success = true;
  let errorMessage: string | undefined;

  try {
    const result = fn();
    return result;
  } catch (error) {
    success = false;
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const duration = performance.now() - startTime;
    endSpan(success ? 'ok' : 'error');

    resolvedOptions.onOperationStats({
      operation,
      key,
      duration,
      traceId: trace?.traceId,
      spanId: span.spanId,
      success,
      error: errorMessage,
    });

    if (
      resolvedOptions.slowOperationThreshold > 0 &&
      duration > resolvedOptions.slowOperationThreshold
    ) {
      console.warn(
        `[SLOW REDIS] ${duration.toFixed(2)}ms - ${operation} ${key}`
      );
    }
  }
}

// =============================================================================
// Traced Redis Service Wrapper
// =============================================================================

/**
 * Create a traced version of Redis operations
 *
 * This creates wrapper functions around the common Redis operations
 * that automatically add tracing.
 *
 * @param redis - The underlying Redis service/client
 * @param options - Tracing options
 * @returns Object with traced Redis operations
 *
 * @example
 * ```typescript
 * import { redisService } from '../../services/cache';
 * import { createTracedRedisOps } from '../packages/infrastructure/tracing';
 *
 * const tracedRedis = createTracedRedisOps(redisService, {
 *   slowOperationThreshold: 50,
 *   onOperationStats: (stats) => {
 *     metrics.recordRedisLatency(stats.duration, stats.operation);
 *   }
 * });
 *
 * // Use traced operations
 * const value = await tracedRedis.get('key');
 * await tracedRedis.set('key', 'value', 300);
 * ```
 */
export function createTracedRedisOps(
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
  },
  options?: TracedRedisOptions
): {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getTraceHeaders(): Record<string, string>;
} {
  return {
    async get(key: string): Promise<string | null> {
      return withRedisTrace('get', key, () => redis.get(key), options);
    },

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      return withRedisTrace('set', key, () => redis.set(key, value, ttlSeconds), options);
    },

    async del(key: string): Promise<void> {
      return withRedisTrace('del', key, () => redis.del(key), options);
    },

    async exists(key: string): Promise<boolean> {
      return withRedisTrace('exists', key, () => redis.exists(key), options);
    },

    /**
     * Get trace context headers for cross-service Redis operations
     * Useful when Redis operations span multiple services
     */
    getTraceHeaders(): Record<string, string> {
      const traceId = getTraceId();
      const spanId = getSpanId();

      if (traceId === 'no-trace') {
        return {};
      }

      return {
        'x-trace-id': traceId,
        'x-span-id': spanId,
      };
    },
  };
}

// =============================================================================
// Helper for Key-Based Tracing
// =============================================================================

/**
 * Extract meaningful context from a Redis key for tracing
 *
 * @param key - Redis key
 * @returns Object with parsed key components
 *
 * @example
 * ```typescript
 * parseRedisKey('entitlement:guild-123');
 * // { prefix: 'entitlement', identifier: 'guild-123' }
 *
 * parseRedisKey('webhook:event:evt_123');
 * // { prefix: 'webhook', subtype: 'event', identifier: 'evt_123' }
 * ```
 */
export function parseRedisKey(key: string): {
  prefix: string;
  subtype?: string;
  identifier?: string;
} {
  const parts = key.split(':');

  if (parts.length === 1) {
    return { prefix: parts[0] ?? '' };
  }

  if (parts.length === 2) {
    return { prefix: parts[0] ?? '', identifier: parts[1] ?? '' };
  }

  return {
    prefix: parts[0] ?? '',
    subtype: parts[1] ?? '',
    identifier: parts.slice(2).join(':'),
  };
}
