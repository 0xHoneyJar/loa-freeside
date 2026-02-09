/**
 * Agent Gateway Observability
 * Sprint S5-T4: Structured logging, metrics, and alarms
 *
 * Provides a Pino child logger with agent-specific redaction paths
 * and a CloudWatch metrics emitter for agent gateway instrumentation.
 *
 * @see SDD §7.2 Observability
 */

import type { Logger } from 'pino';
import { createHash } from 'node:crypto';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Metric dimensions for CloudWatch */
export interface MetricDimensions {
  communityId?: string;
  modelAlias?: string;
  tier?: string;
  platform?: string;
}

/** Metric emitter interface (CloudWatch or stub) */
export interface MetricEmitter {
  emit(name: string, value: number, unit: MetricUnit, dimensions?: MetricDimensions): void;
}

export type MetricUnit = 'Count' | 'Milliseconds' | 'None';

/** Agent request metadata for structured logging */
export interface AgentRequestLog {
  traceId: string;
  tenantId: string;
  /** SHA-256 hash of wallet address — never log raw wallet */
  userWalletHash: string;
  tier: number;
  modelAlias: string;
  platform: string;
  channelId?: string;
  latencyMs?: number;
  costCents?: number;
  status?: 'success' | 'error' | 'rate_limited' | 'budget_exceeded';
  errorCode?: string;
}

// --------------------------------------------------------------------------
// Pino Redaction Paths
// --------------------------------------------------------------------------

/** Redaction paths for agent-specific PII/secrets */
export const AGENT_REDACTION_PATHS = [
  // Message content (user prompts and responses)
  'messages[*].content',
  'request.messages[*].content',
  'response.content',
  'response.thinking',
  // JWT tokens
  'jwt',
  'token',
  'authorization',
  'headers.authorization',
  // Raw wallet addresses (use hashed version)
  'userWallet',
  'walletAddress',
  'context.userWallet',
];

// --------------------------------------------------------------------------
// Logger Factory
// --------------------------------------------------------------------------

/**
 * Create an agent-scoped child logger with redaction.
 * Adds `component: 'agent-gateway'` to all log entries.
 */
export function createAgentLogger(parentLogger: Logger): Logger {
  return parentLogger.child(
    { component: 'agent-gateway' },
    {
      redact: {
        paths: AGENT_REDACTION_PATHS,
        censor: '[REDACTED]',
      },
    },
  );
}

// --------------------------------------------------------------------------
// Wallet Hashing
// --------------------------------------------------------------------------

/**
 * Hash a wallet address for safe logging.
 * Returns first 12 hex chars of SHA-256 — enough for log correlation,
 * but not reversible to the original address.
 */
export function hashWallet(wallet: string): string {
  return createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0, 12);
}

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------

/** CloudWatch metric names for agent gateway */
export const AGENT_METRICS = {
  REQUESTS_TOTAL: 'agent_requests_total',
  LATENCY_MS: 'agent_latency_ms',
  ERRORS_TOTAL: 'agent_errors_total',
  RATE_LIMIT_HITS: 'agent_rate_limit_hits',
  BUDGET_SPEND_CENTS: 'agent_budget_spend_cents',
  CIRCUIT_BREAKER_STATE: 'agent_circuit_breaker_state',
} as const;

/**
 * No-op metric emitter for environments without CloudWatch.
 */
export class NoopMetricEmitter implements MetricEmitter {
  emit(): void {
    // No-op
  }
}

/**
 * Structured metric emitter that logs metrics via Pino.
 * In production, a CloudWatch agent scrapes these structured logs.
 */
export class LogMetricEmitter implements MetricEmitter {
  constructor(private readonly logger: Logger) {}

  emit(name: string, value: number, unit: MetricUnit, dimensions?: MetricDimensions): void {
    this.logger.info(
      {
        _metric: true,
        metric: name,
        value,
        unit,
        ...dimensions,
      },
      `metric: ${name}`,
    );
  }
}

// --------------------------------------------------------------------------
// Request Logger Helper
// --------------------------------------------------------------------------

/**
 * Log a completed agent request with standardized metadata.
 * Emits both structured log and metrics.
 */
export function logAgentRequest(
  logger: Logger,
  metrics: MetricEmitter,
  entry: AgentRequestLog,
): void {
  const dimensions: MetricDimensions = {
    communityId: entry.tenantId,
    modelAlias: entry.modelAlias,
    platform: entry.platform,
  };

  // Structured log
  logger.info(
    {
      traceId: entry.traceId,
      tenantId: entry.tenantId,
      userWalletHash: entry.userWalletHash,
      tier: entry.tier,
      modelAlias: entry.modelAlias,
      platform: entry.platform,
      channelId: entry.channelId,
      latencyMs: entry.latencyMs,
      costCents: entry.costCents,
      status: entry.status,
      errorCode: entry.errorCode,
    },
    'agent-request',
  );

  // Emit metrics
  metrics.emit(AGENT_METRICS.REQUESTS_TOTAL, 1, 'Count', dimensions);

  if (entry.latencyMs != null) {
    metrics.emit(AGENT_METRICS.LATENCY_MS, entry.latencyMs, 'Milliseconds', dimensions);
  }

  if (entry.costCents != null && entry.costCents > 0) {
    metrics.emit(AGENT_METRICS.BUDGET_SPEND_CENTS, entry.costCents, 'Count', dimensions);
  }

  if (entry.status === 'error') {
    metrics.emit(AGENT_METRICS.ERRORS_TOTAL, 1, 'Count', dimensions);
  }

  if (entry.status === 'rate_limited') {
    metrics.emit(AGENT_METRICS.RATE_LIMIT_HITS, 1, 'Count', dimensions);
  }
}
