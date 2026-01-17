/**
 * NATS Instrumentation
 * Sprint S-13: Distributed Tracing
 *
 * Automatic instrumentation for NATS JetStream message processing.
 * Creates spans for message consumption and propagates trace context.
 */

import pino from 'pino';
import type { JsMsg } from 'nats';
import type { SpanAttributes, TraceContext } from './types.js';
import { SpanKind, SpanNames, AttributeKeys, SpanStatus } from './types.js';
import { Span } from './Span.js';
import { getTracer } from './Tracer.js';
import {
  extractTraceContextFromHeaders,
  injectTraceContextToHeaders,
  createTraceContext,
  runWithTraceContext,
} from './TraceContext.js';

const logger = pino({ name: 'tracing:nats' });

/**
 * Extract headers from NATS message
 */
function extractHeaders(msg: JsMsg): Record<string, string> {
  const headers: Record<string, string> = {};

  if (msg.headers) {
    for (const [key, values] of msg.headers) {
      // NATS headers can have multiple values, take the first
      if (values.length > 0) {
        headers[key] = values[0];
      }
    }
  }

  return headers;
}

/**
 * NATS message attributes for spans
 */
export interface NatsMessageAttributes {
  /** Stream name */
  stream?: string;
  /** Consumer name */
  consumer?: string;
  /** Subject */
  subject: string;
  /** Sequence number */
  seq?: number;
  /** Redelivery count */
  redeliveryCount?: number;
}

/**
 * Create span attributes for NATS message
 */
function createNatsAttributes(
  attrs: NatsMessageAttributes,
  operation: 'consume' | 'publish' | 'ack'
): SpanAttributes {
  return {
    [AttributeKeys.MESSAGING_SYSTEM]: 'nats',
    [AttributeKeys.MESSAGING_DESTINATION]: attrs.subject,
    [AttributeKeys.MESSAGING_OPERATION]: operation,
    ...(attrs.stream && { 'messaging.nats.stream': attrs.stream }),
    ...(attrs.consumer && { [AttributeKeys.MESSAGING_CONSUMER_ID]: attrs.consumer }),
    ...(attrs.seq && { 'messaging.nats.sequence': attrs.seq }),
    ...(attrs.redeliveryCount && { 'messaging.nats.redelivery_count': attrs.redeliveryCount }),
  };
}

/**
 * Instrumented message handler type
 */
export type InstrumentedHandler<T = unknown> = (
  msg: JsMsg,
  span: Span,
  parentContext?: TraceContext
) => Promise<T>;

/**
 * Wrap a NATS message handler with tracing
 */
export function instrumentNatsHandler<T>(
  handlerName: string,
  handler: InstrumentedHandler<T>,
  messageAttrs: Omit<NatsMessageAttributes, 'subject' | 'seq' | 'redeliveryCount'>
): (msg: JsMsg) => Promise<T> {
  const tracer = getTracer();

  return async (msg: JsMsg): Promise<T> => {
    // Extract trace context from message headers
    const headers = extractHeaders(msg);
    const parentContext = extractTraceContextFromHeaders(headers);

    // Create attributes for this message
    const attrs: NatsMessageAttributes = {
      ...messageAttrs,
      subject: msg.subject,
      seq: msg.seq,
      redeliveryCount: msg.info?.redelivered ? 1 : 0,
    };

    // Create consume span
    const span = tracer.startSpan(SpanNames.NATS_CONSUME, {
      kind: SpanKind.CONSUMER,
      parentContext,
      attributes: createNatsAttributes(attrs, 'consume'),
    });

    return span.runAsync(async () => {
      try {
        // Add handler-specific attribute
        span.setAttribute('messaging.handler', handlerName);

        // Call the actual handler with span and parent context
        const result = await handler(msg, span, parentContext);

        span.setOk();
        return result;
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error);
        } else {
          span.setError(String(error));
        }
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Create a child span for command processing
 */
export function createCommandSpan(
  commandName: string,
  guildId: string,
  userId: string,
  channelId?: string,
  additionalAttrs?: SpanAttributes
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.COMMAND_PROCESS, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [AttributeKeys.DISCORD_COMMAND]: commandName,
      [AttributeKeys.DISCORD_GUILD_ID]: guildId,
      [AttributeKeys.DISCORD_USER_ID]: userId,
      ...(channelId && { [AttributeKeys.DISCORD_CHANNEL_ID]: channelId }),
      ...additionalAttrs,
    },
  });
}

/**
 * Create a span for eligibility check
 */
export function createEligibilitySpan(
  userId: string,
  guildId: string,
  checkType: string
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.ELIGIBILITY_CHECK, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [AttributeKeys.DISCORD_USER_ID]: userId,
      [AttributeKeys.DISCORD_GUILD_ID]: guildId,
      'eligibility.check_type': checkType,
    },
  });
}

/**
 * Create a span for RPC calls
 */
export function createRpcSpan(
  method: string,
  service: string,
  additionalAttrs?: SpanAttributes
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.RPC_CALL, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeKeys.RPC_METHOD]: method,
      [AttributeKeys.RPC_SERVICE]: service,
      ...additionalAttrs,
    },
  });
}

/**
 * Create a span for cache operations
 */
export function createCacheSpan(
  operation: 'get' | 'set' | 'invalidate',
  key: string
): Span {
  const tracer = getTracer();

  const spanName =
    operation === 'get'
      ? SpanNames.CACHE_GET
      : operation === 'set'
        ? SpanNames.CACHE_SET
        : SpanNames.CACHE_INVALIDATE;

  return tracer.startSpan(spanName, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [AttributeKeys.CACHE_KEY]: key,
    },
  });
}

/**
 * Create a span for database operations
 */
export function createDbSpan(
  operation: string,
  system: 'postgresql' | 'scylladb' | 'redis',
  statement?: string
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.DB_QUERY, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeKeys.DB_SYSTEM]: system,
      [AttributeKeys.DB_OPERATION]: operation,
      ...(statement && { [AttributeKeys.DB_STATEMENT]: statement }),
    },
  });
}

/**
 * Create a span for Discord REST API calls
 */
export function createDiscordRestSpan(
  method: string,
  endpoint: string
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.DISCORD_REST, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeKeys.HTTP_METHOD]: method,
      [AttributeKeys.HTTP_URL]: endpoint,
    },
  });
}

/**
 * Inject trace context into headers for outgoing NATS messages
 */
export function injectTraceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const context = getTracer().getCurrentContext();

  if (context) {
    return injectTraceContextToHeaders(context, headers);
  }

  return headers;
}

/**
 * Run a function with trace context extracted from NATS message
 */
export function runWithNatsContext<T>(msg: JsMsg, fn: () => T): T {
  const headers = extractHeaders(msg);
  const parentContext = extractTraceContextFromHeaders(headers);

  if (parentContext) {
    const childContext = createTraceContext(parentContext);
    return runWithTraceContext(childContext, fn);
  }

  // No trace context, create new root
  const rootContext = createTraceContext();
  return runWithTraceContext(rootContext, fn);
}

/**
 * Log span summary for debugging
 */
export function logSpanSummary(span: Span): void {
  const data = span.getData();
  logger.debug(
    {
      name: data.name,
      traceId: data.context.traceId,
      spanId: data.context.spanId,
      parentSpanId: data.context.parentSpanId,
      duration: data.endTime ? data.endTime - data.startTime : 'ongoing',
      status: SpanStatus[data.status],
      eventCount: data.events.length,
    },
    'Span summary'
  );
}
