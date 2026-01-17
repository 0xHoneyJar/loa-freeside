/**
 * OTLP Trace Exporter
 * Sprint S-13: Distributed Tracing
 *
 * Exports spans to OTLP-compatible backends (Grafana Tempo, Jaeger, etc.)
 * Uses OTLP/HTTP JSON format for compatibility.
 */

import pino from 'pino';
import type { SpanData, SpanAttributes, SpanEvent, TracingConfig } from './types.js';
import { SpanKind, SpanStatus, AttributeKeys } from './types.js';
import type { SpanProcessor } from './Tracer.js';

const logger = pino({ name: 'tracing:otlp' });

/**
 * OTLP Resource
 */
interface OTLPResource {
  attributes: OTLPAttribute[];
}

/**
 * OTLP Attribute (key-value)
 */
interface OTLPAttribute {
  key: string;
  value: OTLPAttributeValue;
}

/**
 * OTLP Attribute Value
 */
interface OTLPAttributeValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OTLPAttributeValue[] };
}

/**
 * OTLP Span
 */
interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTLPAttribute[];
  events: OTLPSpanEvent[];
  status: OTLPStatus;
}

/**
 * OTLP Span Event
 */
interface OTLPSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: OTLPAttribute[];
}

/**
 * OTLP Status
 */
interface OTLPStatus {
  code: number;
  message?: string;
}

/**
 * OTLP Instrumentation Scope
 */
interface OTLPInstrumentationScope {
  name: string;
  version: string;
}

/**
 * OTLP Scope Spans
 */
interface OTLPScopeSpans {
  scope: OTLPInstrumentationScope;
  spans: OTLPSpan[];
}

/**
 * OTLP Resource Spans
 */
interface OTLPResourceSpans {
  resource: OTLPResource;
  scopeSpans: OTLPScopeSpans[];
}

/**
 * OTLP Export Request
 */
interface OTLPExportRequest {
  resourceSpans: OTLPResourceSpans[];
}

/**
 * Convert milliseconds to nanoseconds string
 */
function msToNanos(ms: number): string {
  return (BigInt(ms) * BigInt(1_000_000)).toString();
}

/**
 * Convert SpanKind to OTLP kind
 */
function toOTLPSpanKind(kind: SpanKind): number {
  // OTLP uses 1-indexed kinds
  // 0 = UNSPECIFIED, 1 = INTERNAL, 2 = SERVER, 3 = CLIENT, 4 = PRODUCER, 5 = CONSUMER
  switch (kind) {
    case SpanKind.INTERNAL:
      return 1;
    case SpanKind.SERVER:
      return 2;
    case SpanKind.CLIENT:
      return 3;
    case SpanKind.PRODUCER:
      return 4;
    case SpanKind.CONSUMER:
      return 5;
    default:
      return 0;
  }
}

/**
 * Convert SpanStatus to OTLP status
 */
function toOTLPStatus(status: SpanStatus, message?: string): OTLPStatus {
  // OTLP: 0 = UNSET, 1 = OK, 2 = ERROR
  return {
    code: status,
    message,
  };
}

/**
 * Convert attribute value to OTLP format
 */
function toOTLPAttributeValue(value: SpanAttributes[string]): OTLPAttributeValue {
  if (value === undefined || value === null) {
    return { stringValue: '' };
  }

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intValue: value.toString() };
    }
    return { doubleValue: value };
  }

  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((v) => toOTLPAttributeValue(v)),
      },
    };
  }

  return { stringValue: String(value) };
}

/**
 * Convert attributes to OTLP format
 */
function toOTLPAttributes(attrs: SpanAttributes): OTLPAttribute[] {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key,
      value: toOTLPAttributeValue(value),
    }));
}

/**
 * Convert span event to OTLP format
 */
function toOTLPEvent(event: SpanEvent): OTLPSpanEvent {
  return {
    timeUnixNano: msToNanos(event.timestamp),
    name: event.name,
    attributes: event.attributes ? toOTLPAttributes(event.attributes) : [],
  };
}

/**
 * Convert SpanData to OTLP format
 */
function toOTLPSpan(span: SpanData): OTLPSpan {
  return {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    parentSpanId: span.context.parentSpanId,
    name: span.name,
    kind: toOTLPSpanKind(span.kind),
    startTimeUnixNano: msToNanos(span.startTime),
    endTimeUnixNano: msToNanos(span.endTime ?? span.startTime),
    attributes: toOTLPAttributes(span.attributes),
    events: span.events.map(toOTLPEvent),
    status: toOTLPStatus(span.status, span.statusMessage),
  };
}

/**
 * OTLP Exporter configuration
 */
export interface OTLPExporterConfig {
  /** OTLP endpoint URL */
  endpoint: string;
  /** Optional headers for authentication */
  headers?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Retry configuration */
  retry?: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}

/**
 * OTLP Span Exporter
 */
export class OTLPSpanExporter implements SpanProcessor {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;
  private readonly retry: Required<OTLPExporterConfig['retry']>;
  private readonly resourceAttributes: OTLPAttribute[];
  private readonly scope: OTLPInstrumentationScope;
  private buffer: SpanData[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private isShuttingDown: boolean = false;

  constructor(
    config: OTLPExporterConfig,
    tracingConfig: TracingConfig,
    maxBufferSize: number = 512,
    flushIntervalMs: number = 5000
  ) {
    this.endpoint = config.endpoint.endsWith('/v1/traces')
      ? config.endpoint
      : `${config.endpoint}/v1/traces`;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
    this.timeout = config.timeout ?? 10000;
    this.retry = config.retry ?? {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
    };
    this.maxBufferSize = maxBufferSize;
    this.flushIntervalMs = flushIntervalMs;

    // Resource attributes from tracing config
    this.resourceAttributes = [
      { key: AttributeKeys.SERVICE_NAME, value: { stringValue: tracingConfig.serviceName } },
      {
        key: AttributeKeys.SERVICE_VERSION,
        value: { stringValue: tracingConfig.serviceVersion ?? '1.0.0' },
      },
      {
        key: AttributeKeys.DEPLOYMENT_ENVIRONMENT,
        value: { stringValue: tracingConfig.environment ?? 'development' },
      },
    ];

    this.scope = {
      name: 'arrakis-tracing',
      version: '1.0.0',
    };

    this.startFlushInterval();

    logger.info({ endpoint: this.endpoint }, 'OTLP exporter initialized');
  }

  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        logger.warn({ err }, 'Failed to flush spans to OTLP');
      });
    }, this.flushIntervalMs);

    this.flushInterval.unref();
  }

  onStart(_span: SpanData): void {
    // OTLP exporter doesn't act on start
  }

  onEnd(span: SpanData): void {
    if (this.isShuttingDown) {
      return;
    }

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
      await this.export(spans);
      logger.debug({ count: spans.length }, 'Exported spans to OTLP');
    } catch (err) {
      // Re-add spans to buffer on failure (with limit)
      if (!this.isShuttingDown) {
        const remaining = this.maxBufferSize - this.buffer.length;
        if (remaining > 0) {
          this.buffer.unshift(...spans.slice(0, remaining));
        }
      }
      throw err;
    }
  }

  private async export(spans: SpanData[]): Promise<void> {
    const request: OTLPExportRequest = {
      resourceSpans: [
        {
          resource: {
            attributes: this.resourceAttributes,
          },
          scopeSpans: [
            {
              scope: this.scope,
              spans: spans.map(toOTLPSpan),
            },
          ],
        },
      ],
    };

    await this.sendWithRetry(request);
  }

  private async sendWithRetry(request: OTLPExportRequest): Promise<void> {
    let lastError: Error | null = null;
    let delay = this.retry.initialDelayMs;

    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        await this.send(request);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.retry.maxRetries) {
          logger.debug(
            { attempt, delay, err: lastError.message },
            'OTLP export failed, retrying'
          );
          await this.sleep(delay);
          delay = Math.min(delay * 2, this.retry.maxDelayMs);
        }
      }
    }

    throw lastError;
  }

  private async send(request: OTLPExportRequest): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        throw new Error(`OTLP export failed: ${response.status} ${response.statusText} - ${body}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    try {
      await this.flush();
    } catch (err) {
      logger.warn({ err }, 'Failed to flush spans during shutdown');
    }

    logger.info('OTLP exporter shut down');
  }
}

/**
 * Create an OTLP exporter from environment/config
 */
export function createOTLPExporter(
  tracingConfig: TracingConfig
): OTLPSpanExporter | null {
  const endpoint = tracingConfig.otlpEndpoint;

  if (!endpoint) {
    logger.debug('No OTLP endpoint configured, skipping exporter');
    return null;
  }

  return new OTLPSpanExporter(
    { endpoint },
    tracingConfig,
    tracingConfig.maxExportBatchSize,
    tracingConfig.exportIntervalMs
  );
}
