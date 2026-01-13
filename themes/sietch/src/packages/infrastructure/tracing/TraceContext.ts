/**
 * Unified Trace Context - Cross-Service Request Tracing
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Implements request-scoped trace context using AsyncLocalStorage for
 * automatic propagation across async operations.
 *
 * Features:
 * - Automatic trace ID propagation via AsyncLocalStorage
 * - Span hierarchy for operation tracking
 * - HTTP header extraction/injection (x-trace-id, x-span-id)
 * - Integration with logging infrastructure
 *
 * @module packages/infrastructure/tracing/TraceContext
 */

import { AsyncLocalStorage } from 'async_hooks';
import * as crypto from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Trace context data structure
 */
export interface TraceContext {
  /** Request-scoped trace ID (UUID) */
  traceId: string;
  /** Operation-scoped span ID (UUID) */
  spanId: string;
  /** Parent span ID for nested operations */
  parentSpanId?: string;
  /** Tenant/community ID for multi-tenant tracing */
  tenantId?: string;
  /** User ID for user-scoped tracing */
  userId?: string;
  /** Request start timestamp */
  startTime: number;
  /** Custom attributes for the trace */
  attributes: Record<string, string | number | boolean>;
}

/**
 * Span data for operation tracking
 */
export interface Span {
  /** Span ID */
  spanId: string;
  /** Parent span ID */
  parentSpanId?: string;
  /** Operation name */
  operationName: string;
  /** Start timestamp (ms) */
  startTime: number;
  /** End timestamp (ms) */
  endTime?: number;
  /** Duration (ms) */
  duration?: number;
  /** Status */
  status: 'ok' | 'error';
  /** Span attributes */
  attributes: Record<string, string | number | boolean>;
}

/**
 * Options for creating trace context
 */
export interface CreateTraceOptions {
  /** Existing trace ID (from incoming request) */
  traceId?: string;
  /** Parent span ID (from incoming request) */
  parentSpanId?: string;
  /** Tenant ID */
  tenantId?: string;
  /** User ID */
  userId?: string;
}

/**
 * Options for creating a span
 */
export interface CreateSpanOptions {
  /** Operation name */
  operationName: string;
  /** Additional attributes */
  attributes?: Record<string, string | number | boolean>;
}

// =============================================================================
// Constants
// =============================================================================

/** HTTP header names for trace propagation */
export const TRACE_HEADERS = {
  TRACE_ID: 'x-trace-id',
  SPAN_ID: 'x-span-id',
  PARENT_SPAN_ID: 'x-parent-span-id',
  TENANT_ID: 'x-tenant-id',
} as const;

// =============================================================================
// AsyncLocalStorage Instance
// =============================================================================

/**
 * AsyncLocalStorage for automatic trace context propagation
 */
const traceStorage = new AsyncLocalStorage<TraceContext>();

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a new trace/span ID (UUID v4 format)
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a shorter ID for spans (16 hex chars)
 */
export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Create a new trace context
 *
 * @param options - Options for creating the trace
 * @returns New trace context
 */
export function createTraceContext(options?: CreateTraceOptions): TraceContext {
  const traceId = options?.traceId || generateId();
  const spanId = generateSpanId();

  return {
    traceId,
    spanId,
    parentSpanId: options?.parentSpanId,
    tenantId: options?.tenantId,
    userId: options?.userId,
    startTime: Date.now(),
    attributes: {},
  };
}

/**
 * Get the current trace context from AsyncLocalStorage
 *
 * @returns Current trace context or undefined if not in a trace
 */
export function getCurrentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Get the current trace ID (convenience function)
 *
 * @returns Trace ID or 'no-trace' if not in a trace context
 */
export function getTraceId(): string {
  const trace = getCurrentTrace();
  return trace?.traceId ?? 'no-trace';
}

/**
 * Get the current span ID (convenience function)
 *
 * @returns Span ID or 'no-span' if not in a trace context
 */
export function getSpanId(): string {
  const trace = getCurrentTrace();
  return trace?.spanId ?? 'no-span';
}

/**
 * Run a function within a trace context
 *
 * @param context - Trace context to use
 * @param fn - Function to run
 * @returns Result of the function
 */
export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}

/**
 * Run an async function within a trace context
 *
 * @param context - Trace context to use
 * @param fn - Async function to run
 * @returns Promise with the result
 */
export async function runWithTraceAsync<T>(
  context: TraceContext,
  fn: () => Promise<T>
): Promise<T> {
  return traceStorage.run(context, fn);
}

/**
 * Create a child span within the current trace
 *
 * @param options - Span options
 * @returns Span object and a function to end the span
 */
export function createSpan(options: CreateSpanOptions): {
  span: Span;
  endSpan: (status?: 'ok' | 'error', attributes?: Record<string, string | number | boolean>) => Span;
} {
  const currentTrace = getCurrentTrace();
  const parentSpanId = currentTrace?.spanId;
  const spanId = generateSpanId();
  const startTime = Date.now();

  const span: Span = {
    spanId,
    parentSpanId,
    operationName: options.operationName,
    startTime,
    status: 'ok',
    attributes: options.attributes || {},
  };

  // Update current trace's span ID for nested spans
  if (currentTrace) {
    currentTrace.spanId = spanId;
    currentTrace.parentSpanId = parentSpanId;
  }

  const endSpan = (
    status: 'ok' | 'error' = 'ok',
    additionalAttributes?: Record<string, string | number | boolean>
  ): Span => {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (additionalAttributes) {
      span.attributes = { ...span.attributes, ...additionalAttributes };
    }

    // Restore parent span ID
    if (currentTrace && parentSpanId) {
      currentTrace.spanId = parentSpanId;
      currentTrace.parentSpanId = undefined;
    }

    return span;
  };

  return { span, endSpan };
}

/**
 * Wrap a function with span tracking
 *
 * @param operationName - Name of the operation
 * @param fn - Function to wrap
 * @returns Wrapped function result
 */
export async function withSpan<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  const { span, endSpan } = createSpan({ operationName });

  try {
    const result = await fn();
    endSpan('ok');
    return result;
  } catch (error) {
    endSpan('error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Set an attribute on the current trace
 *
 * @param key - Attribute key
 * @param value - Attribute value
 */
export function setTraceAttribute(
  key: string,
  value: string | number | boolean
): void {
  const trace = getCurrentTrace();
  if (trace) {
    trace.attributes[key] = value;
  }
}

/**
 * Set the tenant ID on the current trace
 *
 * @param tenantId - Tenant/community ID
 */
export function setTenantId(tenantId: string): void {
  const trace = getCurrentTrace();
  if (trace) {
    trace.tenantId = tenantId;
  }
}

/**
 * Set the user ID on the current trace
 *
 * @param userId - User ID
 */
export function setUserId(userId: string): void {
  const trace = getCurrentTrace();
  if (trace) {
    trace.userId = userId;
  }
}

// =============================================================================
// HTTP Header Helpers
// =============================================================================

/**
 * Extract trace context from HTTP headers
 *
 * @param headers - HTTP headers object
 * @returns CreateTraceOptions extracted from headers
 */
export function extractTraceFromHeaders(
  headers: Record<string, string | string[] | undefined>
): CreateTraceOptions {
  const getHeader = (name: string): string | undefined => {
    const value = headers[name] || headers[name.toLowerCase()];
    return typeof value === 'string' ? value : value?.[0];
  };

  return {
    traceId: getHeader(TRACE_HEADERS.TRACE_ID),
    parentSpanId: getHeader(TRACE_HEADERS.SPAN_ID),
    tenantId: getHeader(TRACE_HEADERS.TENANT_ID),
  };
}

/**
 * Inject trace context into HTTP headers for outgoing requests
 *
 * @param headers - Headers object to inject into
 * @returns Modified headers object
 */
export function injectTraceHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const trace = getCurrentTrace();

  if (trace) {
    headers[TRACE_HEADERS.TRACE_ID] = trace.traceId;
    headers[TRACE_HEADERS.SPAN_ID] = trace.spanId;
    if (trace.tenantId) {
      headers[TRACE_HEADERS.TENANT_ID] = trace.tenantId;
    }
  }

  return headers;
}

/**
 * Get trace context as a log-friendly object
 *
 * @returns Object with trace fields for logging
 */
export function getTraceLogFields(): Record<string, string | undefined> {
  const trace = getCurrentTrace();

  if (!trace) {
    return { traceId: 'no-trace' };
  }

  return {
    traceId: trace.traceId,
    spanId: trace.spanId,
    parentSpanId: trace.parentSpanId,
    tenantId: trace.tenantId,
    userId: trace.userId,
  };
}

// =============================================================================
// SQL Comment Helper
// =============================================================================

/**
 * Generate a SQL comment with trace context for query correlation
 *
 * @returns SQL comment string (e.g., "/ * traceId: xxx, spanId: yyy * /")
 */
export function getTraceSqlComment(): string {
  const trace = getCurrentTrace();

  if (!trace) {
    return '';
  }

  const parts = [`traceId: ${trace.traceId}`, `spanId: ${trace.spanId}`];

  if (trace.tenantId) {
    parts.push(`tenantId: ${trace.tenantId}`);
  }

  return `/* ${parts.join(', ')} */`;
}

// =============================================================================
// Express Middleware
// =============================================================================

/**
 * Express middleware to inject trace context
 *
 * @returns Express middleware function
 */
export function traceMiddleware() {
  return (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    // Extract trace context from incoming headers
    const options = extractTraceFromHeaders(req.headers as Record<string, string>);

    // Create trace context
    const context = createTraceContext(options);

    // Set response headers for downstream correlation
    res.setHeader(TRACE_HEADERS.TRACE_ID, context.traceId);

    // Run the rest of the request in the trace context
    runWithTrace(context, () => {
      next();
    });
  };
}
