/**
 * Distributed Tracing Types
 * Sprint S-13: Distributed Tracing
 *
 * Type definitions for OpenTelemetry-compatible distributed tracing.
 * Follows W3C Trace Context specification.
 */

/**
 * Trace context following W3C Trace Context specification
 * @see https://www.w3.org/TR/trace-context/
 */
export interface TraceContext {
  /** 32-character hex trace ID */
  traceId: string;
  /** 16-character hex span ID */
  spanId: string;
  /** Parent span ID (if child span) */
  parentSpanId?: string;
  /** Trace flags (sampled, etc.) */
  traceFlags: number;
  /** Trace state for vendor-specific data */
  traceState?: string;
}

/**
 * Span kind per OpenTelemetry specification
 */
export enum SpanKind {
  /** Internal operation */
  INTERNAL = 0,
  /** Server handling a request */
  SERVER = 1,
  /** Client making a request */
  CLIENT = 2,
  /** Message producer */
  PRODUCER = 3,
  /** Message consumer */
  CONSUMER = 4,
}

/**
 * Span status code
 */
export enum SpanStatus {
  /** Default status, not set */
  UNSET = 0,
  /** Success */
  OK = 1,
  /** Error */
  ERROR = 2,
}

/**
 * Span attributes following OpenTelemetry semantic conventions
 */
export interface SpanAttributes {
  [key: string]: string | number | boolean | string[] | number[] | boolean[] | undefined;
}

/**
 * Span event for recording point-in-time events
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

/**
 * Span data structure
 */
export interface SpanData {
  /** Span name */
  name: string;
  /** Span kind */
  kind: SpanKind;
  /** Trace context */
  context: TraceContext;
  /** Start time in milliseconds */
  startTime: number;
  /** End time in milliseconds (set when span ends) */
  endTime?: number;
  /** Span status */
  status: SpanStatus;
  /** Status message (for errors) */
  statusMessage?: string;
  /** Span attributes */
  attributes: SpanAttributes;
  /** Span events */
  events: SpanEvent[];
}

/**
 * Tracing configuration
 */
export interface TracingConfig {
  /** Service name for traces */
  serviceName: string;
  /** Service version */
  serviceVersion?: string;
  /** Environment (production, staging, development) */
  environment?: string;
  /** Enable tracing (can be disabled for performance) */
  enabled: boolean;
  /** Sampling rate (0.0 to 1.0) */
  samplingRate: number;
  /** OTLP endpoint URL (if exporting) */
  otlpEndpoint?: string;
  /** Maximum spans to buffer before export */
  maxExportBatchSize: number;
  /** Export interval in milliseconds */
  exportIntervalMs: number;
  /** Log spans to console (for development) */
  logSpans: boolean;
}

/**
 * Default tracing configuration
 */
export const DEFAULT_TRACING_CONFIG: TracingConfig = {
  serviceName: 'arrakis-worker',
  serviceVersion: '1.0.0',
  environment: 'development',
  enabled: true,
  samplingRate: 1.0, // Sample all traces by default
  maxExportBatchSize: 512,
  exportIntervalMs: 5000,
  logSpans: false,
};

/**
 * Semantic conventions for span names
 */
export const SpanNames = {
  /** NATS message processing */
  NATS_CONSUME: 'nats.consume',
  NATS_PUBLISH: 'nats.publish',
  NATS_ACK: 'nats.ack',
  /** Command processing */
  COMMAND_PROCESS: 'command.process',
  COMMAND_HANDLER: 'command.handler',
  /** Eligibility checks */
  ELIGIBILITY_CHECK: 'eligibility.check',
  ELIGIBILITY_RPC: 'eligibility.rpc',
  ELIGIBILITY_CACHE: 'eligibility.cache',
  /** Database operations */
  DB_QUERY: 'db.query',
  DB_TRANSACTION: 'db.transaction',
  /** Cache operations */
  CACHE_GET: 'cache.get',
  CACHE_SET: 'cache.set',
  CACHE_INVALIDATE: 'cache.invalidate',
  /** External calls */
  DISCORD_REST: 'discord.rest',
  RPC_CALL: 'rpc.call',
} as const;

/**
 * Semantic attribute keys following OpenTelemetry conventions
 */
export const AttributeKeys = {
  // Service
  SERVICE_NAME: 'service.name',
  SERVICE_VERSION: 'service.version',
  DEPLOYMENT_ENVIRONMENT: 'deployment.environment',
  // Messaging
  MESSAGING_SYSTEM: 'messaging.system',
  MESSAGING_DESTINATION: 'messaging.destination',
  MESSAGING_OPERATION: 'messaging.operation',
  MESSAGING_MESSAGE_ID: 'messaging.message.id',
  MESSAGING_CONSUMER_ID: 'messaging.consumer.id',
  // Discord
  DISCORD_GUILD_ID: 'discord.guild.id',
  DISCORD_USER_ID: 'discord.user.id',
  DISCORD_CHANNEL_ID: 'discord.channel.id',
  DISCORD_COMMAND: 'discord.command',
  DISCORD_EVENT_ID: 'discord.event.id',
  // Database
  DB_SYSTEM: 'db.system',
  DB_OPERATION: 'db.operation',
  DB_STATEMENT: 'db.statement',
  // Cache
  CACHE_HIT: 'cache.hit',
  CACHE_KEY: 'cache.key',
  // RPC
  RPC_METHOD: 'rpc.method',
  RPC_SERVICE: 'rpc.service',
  // HTTP
  HTTP_METHOD: 'http.method',
  HTTP_URL: 'http.url',
  HTTP_STATUS_CODE: 'http.status_code',
  // Error
  EXCEPTION_TYPE: 'exception.type',
  EXCEPTION_MESSAGE: 'exception.message',
  EXCEPTION_STACKTRACE: 'exception.stacktrace',
} as const;

/**
 * Trace flags
 */
export const TraceFlags = {
  /** Trace is not sampled */
  NONE: 0x00,
  /** Trace is sampled */
  SAMPLED: 0x01,
} as const;
