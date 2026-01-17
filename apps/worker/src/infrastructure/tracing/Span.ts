/**
 * Span Implementation
 * Sprint S-13: Distributed Tracing
 *
 * OpenTelemetry-compatible span for tracking operations.
 * Supports attributes, events, status, and child spans.
 */

import type { TraceContext, SpanData, SpanAttributes, SpanEvent } from './types.js';
import { SpanKind, SpanStatus } from './types.js';
import { createTraceContext, runWithTraceContext, getCurrentTraceContext } from './TraceContext.js';

/**
 * Span options for creation
 */
export interface SpanOptions {
  /** Span kind */
  kind?: SpanKind;
  /** Initial attributes */
  attributes?: SpanAttributes;
  /** Parent context (auto-detected if not provided) */
  parentContext?: TraceContext;
  /** Start time override (defaults to now) */
  startTime?: number;
}

/**
 * Span class representing a single traced operation
 */
export class Span {
  private readonly data: SpanData;
  private ended: boolean = false;
  private readonly onEnd?: (span: SpanData) => void;

  constructor(
    name: string,
    options: SpanOptions = {},
    onEnd?: (span: SpanData) => void
  ) {
    const parentContext = options.parentContext ?? getCurrentTraceContext();
    const context = createTraceContext(parentContext);

    this.data = {
      name,
      kind: options.kind ?? SpanKind.INTERNAL,
      context,
      startTime: options.startTime ?? Date.now(),
      status: SpanStatus.UNSET,
      attributes: { ...options.attributes },
      events: [],
    };

    this.onEnd = onEnd;
  }

  /**
   * Get the span's trace context
   */
  get context(): TraceContext {
    return this.data.context;
  }

  /**
   * Get span name
   */
  get name(): string {
    return this.data.name;
  }

  /**
   * Get span duration in milliseconds (0 if not ended)
   */
  get duration(): number {
    if (!this.data.endTime) {
      return 0;
    }
    return this.data.endTime - this.data.startTime;
  }

  /**
   * Check if span has ended
   */
  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * Set a single attribute
   */
  setAttribute(key: string, value: SpanAttributes[string]): this {
    if (this.ended) {
      return this;
    }
    this.data.attributes[key] = value;
    return this;
  }

  /**
   * Set multiple attributes
   */
  setAttributes(attributes: SpanAttributes): this {
    if (this.ended) {
      return this;
    }
    Object.assign(this.data.attributes, attributes);
    return this;
  }

  /**
   * Add an event to the span
   */
  addEvent(name: string, attributes?: SpanAttributes): this {
    if (this.ended) {
      return this;
    }
    const event: SpanEvent = {
      name,
      timestamp: Date.now(),
      attributes,
    };
    this.data.events.push(event);
    return this;
  }

  /**
   * Set span status to OK
   */
  setOk(): this {
    if (this.ended) {
      return this;
    }
    this.data.status = SpanStatus.OK;
    return this;
  }

  /**
   * Set span status to ERROR
   */
  setError(message?: string): this {
    if (this.ended) {
      return this;
    }
    this.data.status = SpanStatus.ERROR;
    if (message) {
      this.data.statusMessage = message;
    }
    return this;
  }

  /**
   * Record an exception
   */
  recordException(error: Error): this {
    if (this.ended) {
      return this;
    }

    this.setError(error.message);
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });

    return this;
  }

  /**
   * End the span
   */
  end(endTime?: number): void {
    if (this.ended) {
      return;
    }

    this.data.endTime = endTime ?? Date.now();
    this.ended = true;

    // Call the onEnd callback if provided
    if (this.onEnd) {
      this.onEnd(this.data);
    }
  }

  /**
   * Get span data (for export/logging)
   */
  getData(): Readonly<SpanData> {
    return this.data;
  }

  /**
   * Run a function within this span's context
   */
  run<T>(fn: () => T): T {
    return runWithTraceContext(this.context, fn);
  }

  /**
   * Run an async function within this span's context
   */
  async runAsync<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTraceContext(this.context, fn);
  }

  /**
   * Create a child span
   */
  createChild(name: string, options: Omit<SpanOptions, 'parentContext'> = {}): Span {
    return new Span(name, { ...options, parentContext: this.context }, this.onEnd);
  }
}

/**
 * NoOp Span for when tracing is disabled
 */
export class NoOpSpan extends Span {
  constructor() {
    super('noop', {}, undefined);
  }

  override setAttribute(): this {
    return this;
  }

  override setAttributes(): this {
    return this;
  }

  override addEvent(): this {
    return this;
  }

  override setOk(): this {
    return this;
  }

  override setError(): this {
    return this;
  }

  override recordException(): this {
    return this;
  }

  override end(): void {
    // NoOp
  }
}

/**
 * Utility to wrap a function with span tracking
 */
export function withSpan<T>(
  span: Span,
  fn: () => T
): T {
  try {
    const result = span.run(fn);
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
}

/**
 * Utility to wrap an async function with span tracking
 */
export async function withSpanAsync<T>(
  span: Span,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await span.runAsync(fn);
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
}
