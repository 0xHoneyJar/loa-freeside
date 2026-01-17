/**
 * Distributed Tracing Module
 * Sprint S-13: Distributed Tracing
 *
 * OpenTelemetry-compatible distributed tracing for Arrakis workers.
 * Provides automatic instrumentation for NATS, custom spans, and OTLP export.
 *
 * @example
 * ```typescript
 * import { initTracer, getTracer, createCommandSpan } from './infrastructure/tracing';
 *
 * // Initialize at startup
 * initTracer({
 *   serviceName: 'arrakis-worker',
 *   otlpEndpoint: 'http://tempo:4318',
 * });
 *
 * // Use in handlers
 * const span = createCommandSpan('balance', guildId, userId);
 * try {
 *   await doWork();
 *   span.setOk();
 * } catch (err) {
 *   span.recordException(err);
 *   throw err;
 * } finally {
 *   span.end();
 * }
 * ```
 */

// Types
export type {
  TraceContext,
  SpanData,
  SpanAttributes,
  SpanEvent,
  TracingConfig,
} from './types.js';

export {
  SpanKind,
  SpanStatus,
  SpanNames,
  AttributeKeys,
  TraceFlags,
  DEFAULT_TRACING_CONFIG,
} from './types.js';

// Context management
export {
  generateTraceId,
  generateSpanId,
  createTraceContext,
  parseTraceparent,
  formatTraceparent,
  parseTracestate,
  getCurrentTraceContext,
  getCurrentContextStore,
  runWithTraceContext,
  runWithTraceContextAsync,
  getBaggage,
  setBaggage,
  getAllBaggage,
  getContextAttribute,
  setContextAttribute,
  getCorrelationId,
  isTraceSampled,
  extractTraceContextFromHeaders,
  injectTraceContextToHeaders,
} from './TraceContext.js';

// Span
export { Span, NoOpSpan, withSpan, withSpanAsync } from './Span.js';
export type { SpanOptions } from './Span.js';

// Tracer
export {
  Tracer,
  ConsoleSpanProcessor,
  BufferedSpanProcessor,
  initTracer,
  getTracer,
  resetTracer,
} from './Tracer.js';
export type { SpanProcessor } from './Tracer.js';

// NATS Instrumentation
export {
  instrumentNatsHandler,
  createCommandSpan,
  createEligibilitySpan,
  createRpcSpan,
  createCacheSpan,
  createDbSpan,
  createDiscordRestSpan,
  injectTraceHeaders,
  runWithNatsContext,
  logSpanSummary,
} from './NatsInstrumentation.js';
export type { NatsMessageAttributes, InstrumentedHandler } from './NatsInstrumentation.js';

// OTLP Export
export { OTLPSpanExporter, createOTLPExporter } from './OTLPExporter.js';
export type { OTLPExporterConfig } from './OTLPExporter.js';

// Eligibility Instrumentation
export {
  instrumentEligibilityHandler,
  instrumentEligibilityHandlers,
  createBalanceCheckSpan,
  createTokenBalanceCheckSpan,
  createRuleEvaluationSpan,
  createEligibilityCacheSpan,
  createEligibilityDbSpan,
  recordRpcLatency,
} from './instrumentEligibility.js';

// Correlation Logging
export {
  withTraceContext,
  createCorrelationLogger,
  traceContextSerializer,
  createTraceContextHook,
  traceContextMixin,
  createRequestLogger,
  wrapLoggerWithTraceContext,
  getTracingLoggerOptions,
} from './CorrelationLogger.js';
