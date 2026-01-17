/**
 * Correlation Logger
 * Sprint S-13: Distributed Tracing
 *
 * Provides correlation ID injection into Pino logger instances.
 * Enables trace context to flow through logs for distributed debugging.
 */

import pino from 'pino';
import type { Logger } from 'pino';
import { getCurrentTraceContext, getCorrelationId } from './TraceContext.js';

/**
 * Create a child logger with correlation ID from current trace context
 */
export function withTraceContext(logger: Logger): Logger {
  const context = getCurrentTraceContext();

  if (!context) {
    return logger;
  }

  return logger.child({
    traceId: context.traceId,
    spanId: context.spanId,
    correlationId: getCorrelationId(),
  });
}

/**
 * Create a logger factory that automatically injects correlation IDs
 */
export function createCorrelationLogger(
  name: string,
  baseOptions: pino.LoggerOptions = {}
): () => Logger {
  const baseLogger = pino({
    name,
    ...baseOptions,
  });

  return () => withTraceContext(baseLogger);
}

/**
 * Pino serializer for trace context
 */
export const traceContextSerializer = {
  traceContext: (context: { traceId: string; spanId: string; parentSpanId?: string }) => {
    return {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
    };
  },
};

/**
 * Create a Pino transport hook that adds trace context
 * Use this with pino-pretty or other transports
 */
export function createTraceContextHook() {
  return (logEvent: Record<string, unknown>) => {
    const context = getCurrentTraceContext();

    if (context) {
      logEvent['traceId'] = context.traceId;
      logEvent['spanId'] = context.spanId;
      if (context.parentSpanId) {
        logEvent['parentSpanId'] = context.parentSpanId;
      }
      logEvent['correlationId'] = getCorrelationId();
    }

    return logEvent;
  };
}

/**
 * Mixin function for Pino to add trace context to every log
 * Usage: pino({ mixin: traceContextMixin })
 */
export function traceContextMixin(): Record<string, unknown> {
  const context = getCurrentTraceContext();

  if (!context) {
    return {};
  }

  return {
    traceId: context.traceId,
    spanId: context.spanId,
    correlationId: getCorrelationId(),
  };
}

/**
 * Create a request-scoped logger with trace context
 * Useful for HTTP request handlers
 */
export function createRequestLogger(
  baseLogger: Logger,
  requestAttributes: Record<string, unknown> = {}
): Logger {
  const context = getCurrentTraceContext();
  const correlationId = getCorrelationId();

  return baseLogger.child({
    correlationId,
    ...(context && {
      traceId: context.traceId,
      spanId: context.spanId,
    }),
    ...requestAttributes,
  });
}

/**
 * Wrap a Pino logger to automatically include trace context in all logs
 */
export function wrapLoggerWithTraceContext(logger: Logger): Logger {
  // Create a proxy that intercepts log methods
  return new Proxy(logger, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Intercept log methods
      if (
        typeof value === 'function' &&
        ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(prop as string)
      ) {
        return function (this: Logger, ...args: unknown[]) {
          // Get current trace context
          const contextLogger = withTraceContext(target);
          // Call the original method with trace context
          return (contextLogger[prop as keyof Logger] as Function).apply(
            contextLogger,
            args
          );
        };
      }

      // For child(), wrap the returned logger too
      if (prop === 'child' && typeof value === 'function') {
        return function (this: Logger, bindings: Record<string, unknown>) {
          const childLogger = value.call(target, bindings);
          return wrapLoggerWithTraceContext(childLogger);
        };
      }

      return value;
    },
  });
}

/**
 * Create base logger options with trace context support
 */
export function getTracingLoggerOptions(
  serviceName: string,
  options: pino.LoggerOptions = {}
): pino.LoggerOptions {
  return {
    name: serviceName,
    mixin: traceContextMixin,
    serializers: {
      ...pino.stdSerializers,
      ...traceContextSerializer,
    },
    ...options,
  };
}
