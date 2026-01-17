/**
 * Tracer Implementation
 * Sprint S-13: Distributed Tracing
 *
 * Main tracer class for creating and managing spans.
 * Provides sampling, buffering, and export capabilities.
 */

import pino from 'pino';
import type { TracingConfig, SpanData, SpanAttributes, TraceContext } from './types.js';
import { DEFAULT_TRACING_CONFIG, SpanKind, SpanStatus, AttributeKeys } from './types.js';
import { Span, NoOpSpan, type SpanOptions } from './Span.js';
import {
  getCurrentTraceContext,
  createTraceContext,
  isTraceSampled,
  getCorrelationId,
} from './TraceContext.js';

const logger = pino({ name: 'tracing:tracer' });

/**
 * Span processor interface for custom processing
 */
export interface SpanProcessor {
  onStart(span: SpanData): void;
  onEnd(span: SpanData): void;
  shutdown(): Promise<void>;
}

/**
 * Simple console span processor for development
 */
export class ConsoleSpanProcessor implements SpanProcessor {
  onStart(span: SpanData): void {
    logger.debug({ spanName: span.name, traceId: span.context.traceId }, 'Span started');
  }

  onEnd(span: SpanData): void {
    const duration = span.endTime ? span.endTime - span.startTime : 0;
    logger.debug(
      {
        spanName: span.name,
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        duration,
        status: SpanStatus[span.status],
      },
      'Span ended'
    );
  }

  async shutdown(): Promise<void> {
    // Console processor has no cleanup
  }
}

/**
 * Buffered span processor for batch export
 */
export class BufferedSpanProcessor implements SpanProcessor {
  private buffer: SpanData[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly onFlush: (spans: SpanData[]) => Promise<void>;

  constructor(
    onFlush: (spans: SpanData[]) => Promise<void>,
    maxBufferSize: number = 512,
    flushIntervalMs: number = 5000
  ) {
    this.onFlush = onFlush;
    this.maxBufferSize = maxBufferSize;
    this.flushIntervalMs = flushIntervalMs;
    this.startFlushInterval();
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        logger.warn({ err }, 'Failed to flush spans');
      });
    }, this.flushIntervalMs);

    // Don't block process exit
    this.flushInterval.unref();
  }

  onStart(_span: SpanData): void {
    // BufferedProcessor doesn't act on start
  }

  onEnd(span: SpanData): void {
    this.buffer.push(span);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch((err) => {
        logger.warn({ err }, 'Failed to flush spans on buffer full');
      });
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const spans = this.buffer;
    this.buffer = [];

    try {
      await this.onFlush(spans);
      logger.debug({ count: spans.length }, 'Flushed spans');
    } catch (err) {
      // Re-add spans to buffer on failure (with limit)
      const remaining = this.maxBufferSize - this.buffer.length;
      if (remaining > 0) {
        this.buffer.unshift(...spans.slice(0, remaining));
      }
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

/**
 * Tracer class for creating and managing spans
 */
export class Tracer {
  private readonly config: TracingConfig;
  private readonly processors: SpanProcessor[] = [];
  private readonly noOpSpan: NoOpSpan;
  private readonly resourceAttributes: SpanAttributes;

  constructor(config: Partial<TracingConfig> = {}) {
    this.config = { ...DEFAULT_TRACING_CONFIG, ...config };
    this.noOpSpan = new NoOpSpan();

    // Set resource attributes
    this.resourceAttributes = {
      [AttributeKeys.SERVICE_NAME]: this.config.serviceName,
      [AttributeKeys.SERVICE_VERSION]: this.config.serviceVersion,
      [AttributeKeys.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
    };

    // Add console processor in dev mode
    if (this.config.logSpans) {
      this.addProcessor(new ConsoleSpanProcessor());
    }

    logger.info(
      {
        serviceName: this.config.serviceName,
        enabled: this.config.enabled,
        samplingRate: this.config.samplingRate,
      },
      'Tracer initialized'
    );
  }

  /**
   * Add a span processor
   */
  addProcessor(processor: SpanProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Check if tracing is enabled and should sample
   */
  private shouldSample(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.config.samplingRate >= 1.0) {
      return true;
    }

    if (this.config.samplingRate <= 0.0) {
      return false;
    }

    return Math.random() < this.config.samplingRate;
  }

  /**
   * Create a new span
   */
  startSpan(name: string, options: SpanOptions = {}): Span {
    // Check if we should sample this trace
    const parentContext = options.parentContext ?? getCurrentTraceContext();

    // If parent is sampled, child should be sampled too
    // If no parent, use sampling decision
    const shouldSample = parentContext
      ? (parentContext.traceFlags & 0x01) === 0x01
      : this.shouldSample();

    if (!shouldSample) {
      return this.noOpSpan;
    }

    const span = new Span(
      name,
      {
        ...options,
        attributes: {
          ...this.resourceAttributes,
          ...options.attributes,
        },
      },
      (spanData) => this.onSpanEnd(spanData)
    );

    // Notify processors of span start
    for (const processor of this.processors) {
      try {
        processor.onStart(span.getData());
      } catch (err) {
        logger.warn({ err, processorType: processor.constructor.name }, 'Processor onStart failed');
      }
    }

    return span;
  }

  /**
   * Handle span end
   */
  private onSpanEnd(spanData: SpanData): void {
    for (const processor of this.processors) {
      try {
        processor.onEnd(spanData);
      } catch (err) {
        logger.warn({ err, processorType: processor.constructor.name }, 'Processor onEnd failed');
      }
    }
  }

  /**
   * Create a span with automatic context propagation
   */
  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
    options: SpanOptions = {}
  ): T {
    const span = this.startSpan(name, options);

    try {
      const result = span.run(() => fn(span));
      return result;
    } finally {
      if (!span.isEnded) {
        span.end();
      }
    }
  }

  /**
   * Create an async span with automatic context propagation
   */
  async startActiveSpanAsync<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: SpanOptions = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);

    try {
      const result = await span.runAsync(() => fn(span));
      return result;
    } finally {
      if (!span.isEnded) {
        span.end();
      }
    }
  }

  /**
   * Get correlation ID for current trace
   */
  getCorrelationId(): string {
    return getCorrelationId();
  }

  /**
   * Check if current trace is sampled
   */
  isCurrentTraceSampled(): boolean {
    return isTraceSampled();
  }

  /**
   * Get current trace context
   */
  getCurrentContext(): TraceContext | undefined {
    return getCurrentTraceContext();
  }

  /**
   * Create a new root trace context
   */
  createRootContext(): TraceContext {
    return createTraceContext(undefined, this.shouldSample());
  }

  /**
   * Get tracer configuration
   */
  getConfig(): Readonly<TracingConfig> {
    return this.config;
  }

  /**
   * Shutdown the tracer and all processors
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down tracer');

    const shutdownPromises = this.processors.map((processor) =>
      processor.shutdown().catch((err) => {
        logger.warn({ err, processorType: processor.constructor.name }, 'Processor shutdown failed');
      })
    );

    await Promise.all(shutdownPromises);
    logger.info('Tracer shutdown complete');
  }
}

/**
 * Global tracer instance (lazily initialized)
 */
let globalTracer: Tracer | null = null;

/**
 * Initialize the global tracer
 */
export function initTracer(config: Partial<TracingConfig> = {}): Tracer {
  if (globalTracer) {
    logger.warn('Global tracer already initialized, returning existing instance');
    return globalTracer;
  }

  globalTracer = new Tracer(config);
  return globalTracer;
}

/**
 * Get the global tracer (initializes with defaults if not set)
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

/**
 * Reset the global tracer (for testing)
 */
export async function resetTracer(): Promise<void> {
  if (globalTracer) {
    await globalTracer.shutdown();
    globalTracer = null;
  }
}
