/**
 * Unified Tracing Module - Cross-Service Request Tracing
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides request-scoped trace context for distributed tracing,
 * logging correlation, and database query attribution.
 *
 * @module packages/infrastructure/tracing
 *
 * @example
 * ```typescript
 * import {
 *   createTraceContext,
 *   runWithTrace,
 *   getCurrentTrace,
 *   withSpan,
 *   traceMiddleware
 * } from '../packages/infrastructure/tracing';
 *
 * // Express middleware usage
 * app.use(traceMiddleware());
 *
 * // Manual trace context
 * const ctx = createTraceContext({ tenantId: 'guild-123' });
 * await runWithTraceAsync(ctx, async () => {
 *   // All operations here have trace context
 *   const trace = getCurrentTrace();
 *   console.log('Trace ID:', trace?.traceId);
 * });
 *
 * // Span tracking for operations
 * const result = await withSpan('database.query', async () => {
 *   return await db.query('SELECT * FROM users');
 * });
 * ```
 */

// Core types
export type {
  TraceContext,
  Span,
  CreateTraceOptions,
  CreateSpanOptions,
} from './TraceContext.js';

// Constants
export { TRACE_HEADERS } from './TraceContext.js';

// Utility functions
export { generateId, generateSpanId } from './TraceContext.js';

// Core trace functions
export {
  createTraceContext,
  getCurrentTrace,
  getTraceId,
  getSpanId,
  runWithTrace,
  runWithTraceAsync,
} from './TraceContext.js';

// Span functions
export { createSpan, withSpan } from './TraceContext.js';

// Attribute functions
export {
  setTraceAttribute,
  setTenantId,
  setUserId,
} from './TraceContext.js';

// HTTP header functions
export {
  extractTraceFromHeaders,
  injectTraceHeaders,
  getTraceLogFields,
} from './TraceContext.js';

// SQL helper
export { getTraceSqlComment } from './TraceContext.js';

// Express middleware
export { traceMiddleware } from './TraceContext.js';

// Database tracing
export {
  TracedDatabase,
  createTracedDatabase,
} from './TracedDatabase.js';

export type {
  QueryStats,
  QueryStatsCallback,
  TracedDatabaseOptions,
} from './TracedDatabase.js';

// Redis tracing
export {
  withRedisTrace,
  withRedisTraceSync,
  createTracedRedisOps,
  parseRedisKey,
} from './TracedRedis.js';

export type {
  RedisOperationStats,
  RedisStatsCallback,
  TracedRedisOptions,
} from './TracedRedis.js';
