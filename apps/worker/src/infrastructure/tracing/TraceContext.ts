/**
 * Trace Context Manager
 * Sprint S-13: Distributed Tracing
 *
 * Manages trace context propagation using AsyncLocalStorage.
 * Provides W3C Trace Context compliant context propagation.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import type { TraceContext, SpanAttributes } from './types.js';
import { TraceFlags } from './types.js';

/**
 * Context store for async operations
 */
interface ContextStore {
  /** Current trace context */
  trace: TraceContext;
  /** Baggage items for cross-service propagation */
  baggage: Map<string, string>;
  /** Additional attributes to propagate */
  attributes: SpanAttributes;
}

/**
 * Singleton AsyncLocalStorage for trace context
 */
const asyncLocalStorage = new AsyncLocalStorage<ContextStore>();

/**
 * Generate a random trace ID (32 hex characters)
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a random span ID (16 hex characters)
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Create a new trace context
 */
export function createTraceContext(
  parentContext?: TraceContext,
  sampled: boolean = true
): TraceContext {
  return {
    traceId: parentContext?.traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: parentContext?.spanId,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    traceState: parentContext?.traceState,
  };
}

/**
 * Parse W3C Traceparent header
 * Format: 00-{traceId}-{spanId}-{traceFlags}
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, flagsHex] = parts;

  // Validate version (currently only 00 is supported)
  if (version !== '00') {
    return null;
  }

  // Validate trace ID (32 hex chars, not all zeros)
  if (!/^[0-9a-f]{32}$/.test(traceId) || traceId === '0'.repeat(32)) {
    return null;
  }

  // Validate span ID (16 hex chars, not all zeros)
  if (!/^[0-9a-f]{16}$/.test(spanId) || spanId === '0'.repeat(16)) {
    return null;
  }

  // Parse trace flags
  const traceFlags = parseInt(flagsHex, 16);
  if (isNaN(traceFlags)) {
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags,
  };
}

/**
 * Format trace context as W3C Traceparent header
 */
export function formatTraceparent(context: TraceContext): string {
  const flags = context.traceFlags.toString(16).padStart(2, '0');
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

/**
 * Parse W3C Tracestate header
 * Format: key1=value1,key2=value2
 */
export function parseTracestate(header: string): string {
  // Tracestate is passed through as-is
  return header;
}

/**
 * Get current trace context from async local storage
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  const store = asyncLocalStorage.getStore();
  return store?.trace;
}

/**
 * Get current context store
 */
export function getCurrentContextStore(): ContextStore | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Run a function with a specific trace context
 */
export function runWithTraceContext<T>(
  context: TraceContext,
  fn: () => T,
  baggage?: Map<string, string>,
  attributes?: SpanAttributes
): T {
  const store: ContextStore = {
    trace: context,
    baggage: baggage ?? new Map(),
    attributes: attributes ?? {},
  };
  return asyncLocalStorage.run(store, fn);
}

/**
 * Run an async function with a specific trace context
 */
export async function runWithTraceContextAsync<T>(
  context: TraceContext,
  fn: () => Promise<T>,
  baggage?: Map<string, string>,
  attributes?: SpanAttributes
): Promise<T> {
  const store: ContextStore = {
    trace: context,
    baggage: baggage ?? new Map(),
    attributes: attributes ?? {},
  };
  return asyncLocalStorage.run(store, fn);
}

/**
 * Get baggage value from current context
 */
export function getBaggage(key: string): string | undefined {
  const store = asyncLocalStorage.getStore();
  return store?.baggage.get(key);
}

/**
 * Set baggage value in current context
 */
export function setBaggage(key: string, value: string): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.baggage.set(key, value);
  }
}

/**
 * Get all baggage from current context
 */
export function getAllBaggage(): Map<string, string> {
  const store = asyncLocalStorage.getStore();
  return store?.baggage ?? new Map();
}

/**
 * Get attribute from current context
 */
export function getContextAttribute(key: string): SpanAttributes[string] {
  const store = asyncLocalStorage.getStore();
  return store?.attributes[key];
}

/**
 * Set attribute in current context
 */
export function setContextAttribute(key: string, value: SpanAttributes[string]): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.attributes[key] = value;
  }
}

/**
 * Create a correlation ID from trace context
 * Format: {traceId}-{spanId} (shortened for logging)
 */
export function getCorrelationId(): string {
  const context = getCurrentTraceContext();
  if (!context) {
    return `orphan-${generateSpanId()}`;
  }
  // Use first 8 chars of traceId + spanId for readable correlation
  return `${context.traceId.slice(0, 8)}-${context.spanId.slice(0, 8)}`;
}

/**
 * Check if current trace is sampled
 */
export function isTraceSampled(): boolean {
  const context = getCurrentTraceContext();
  if (!context) {
    return false;
  }
  return (context.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
}

/**
 * Extract trace context from NATS message headers
 */
export function extractTraceContextFromHeaders(headers?: Record<string, string>): TraceContext | undefined {
  if (!headers) {
    return undefined;
  }

  const traceparent = headers['traceparent'] ?? headers['Traceparent'];
  if (!traceparent) {
    return undefined;
  }

  const context = parseTraceparent(traceparent);
  if (context) {
    const tracestate = headers['tracestate'] ?? headers['Tracestate'];
    if (tracestate) {
      context.traceState = parseTracestate(tracestate);
    }
  }

  return context ?? undefined;
}

/**
 * Inject trace context into headers for propagation
 */
export function injectTraceContextToHeaders(
  context: TraceContext,
  headers: Record<string, string> = {}
): Record<string, string> {
  headers['traceparent'] = formatTraceparent(context);
  if (context.traceState) {
    headers['tracestate'] = context.traceState;
  }
  return headers;
}
