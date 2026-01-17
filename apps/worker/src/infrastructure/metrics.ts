/**
 * Worker Metrics
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Prometheus-compatible metrics for worker operations per SDD §10.1.2
 */

import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

// Create a dedicated registry
export const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// ==============================================================================
// Message Processing Metrics
// ==============================================================================

export const messagesProcessed = new Counter({
  name: 'worker_messages_processed_total',
  help: 'Total messages processed',
  labelNames: ['consumer', 'status', 'command'] as const,
  registers: [registry],
});

export const messageProcessingDuration = new Histogram({
  name: 'worker_message_processing_duration_seconds',
  help: 'Message processing duration in seconds',
  labelNames: ['consumer', 'command'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const activeMessages = new Gauge({
  name: 'worker_active_messages',
  help: 'Currently processing messages',
  labelNames: ['consumer'] as const,
  registers: [registry],
});

// ==============================================================================
// RPC Metrics (extended from Sprint S-2)
// ==============================================================================

export const rpcRequestDuration = new Histogram({
  name: 'worker_rpc_request_duration_seconds',
  help: 'RPC request duration in seconds',
  labelNames: ['provider', 'method'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const rpcCircuitBreakerState = new Gauge({
  name: 'worker_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['provider'] as const,
  registers: [registry],
});

// ==============================================================================
// ScyllaDB Metrics
// ==============================================================================

export const scyllaQueryDuration = new Histogram({
  name: 'worker_scylla_query_duration_seconds',
  help: 'ScyllaDB query duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const scyllaQueriesTotal = new Counter({
  name: 'worker_scylla_queries_total',
  help: 'Total ScyllaDB queries',
  labelNames: ['operation', 'status'] as const,
  registers: [registry],
});

export const scyllaCacheHitRate = new Gauge({
  name: 'worker_scylla_cache_hit_rate',
  help: 'ScyllaDB eligibility cache hit rate',
  registers: [registry],
});

// ==============================================================================
// Discord REST Metrics
// ==============================================================================

export const discordRestRequests = new Counter({
  name: 'worker_discord_rest_requests_total',
  help: 'Total Discord REST API requests',
  labelNames: ['method', 'status'] as const,
  registers: [registry],
});

export const discordRestDuration = new Histogram({
  name: 'worker_discord_rest_duration_seconds',
  help: 'Discord REST API request duration',
  labelNames: ['method'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const discordRateLimitHits = new Counter({
  name: 'worker_discord_rate_limit_hits_total',
  help: 'Discord rate limit hits',
  labelNames: ['endpoint'] as const,
  registers: [registry],
});

// ==============================================================================
// NATS Consumer Metrics
// ==============================================================================

export const natsConsumerLag = new Gauge({
  name: 'worker_nats_consumer_lag',
  help: 'NATS consumer message lag',
  labelNames: ['stream', 'consumer'] as const,
  registers: [registry],
});

export const natsAckLatency = new Histogram({
  name: 'worker_nats_ack_latency_seconds',
  help: 'NATS message acknowledgement latency',
  labelNames: ['stream'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [registry],
});

// ==============================================================================
// Health Metrics
// ==============================================================================

export const healthCheckStatus = new Gauge({
  name: 'worker_health_check_status',
  help: 'Health check status (1=healthy, 0=unhealthy)',
  labelNames: ['component'] as const,
  registers: [registry],
});

// ==============================================================================
// Helper Functions
// ==============================================================================

/**
 * Record message processing
 */
export function recordMessageProcessed(
  consumer: string,
  command: string,
  status: 'success' | 'error',
  durationSeconds: number,
): void {
  messagesProcessed.labels(consumer, status, command).inc();
  messageProcessingDuration.labels(consumer, command).observe(durationSeconds);
}

/**
 * Start tracking active message
 */
export function startActiveMessage(consumer: string): () => void {
  activeMessages.labels(consumer).inc();
  return () => activeMessages.labels(consumer).dec();
}

/**
 * Update circuit breaker state
 */
export function updateCircuitBreakerState(provider: string, state: 'closed' | 'halfOpen' | 'open'): void {
  const stateValue = state === 'closed' ? 0 : state === 'halfOpen' ? 1 : 2;
  rpcCircuitBreakerState.labels(provider).set(stateValue);
}

/**
 * Update health check status
 */
export function updateHealthStatus(component: string, healthy: boolean): void {
  healthCheckStatus.labels(component).set(healthy ? 1 : 0);
}

/**
 * Collect all metrics as string
 */
export async function collectMetrics(): Promise<string> {
  return registry.metrics();
}
