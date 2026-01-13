/**
 * Simple Prometheus Metrics for Sietch Service
 *
 * Exposes metrics in Prometheus text format for monitoring
 *
 * Sprint 68: Added observability metrics:
 * - sietch_gossip_convergence_seconds (Task 68.3)
 * - sietch_fast_path_latency_ms (Task 68.4)
 * - sietch_mfa_* counters (Task 68.5)
 */

import { getHealthStatus } from '../db/index.js';
import * as queries from '../db/index.js';

// =============================================================================
// Histogram Configuration
// =============================================================================

/** Gossip convergence histogram buckets (seconds) - Task 68.3 */
const GOSSIP_CONVERGENCE_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

/** Fast-path latency histogram buckets (milliseconds) - Task 68.4 */
const FAST_PATH_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500];

// =============================================================================
// Histogram Data Structure
// =============================================================================

/**
 * Histogram data for a metric
 */
interface HistogramData {
  buckets: Map<number, number>; // bucket upper bound -> count
  sum: number;
  count: number;
}

/**
 * Create empty histogram data
 */
function createHistogram(buckets: number[]): HistogramData {
  const bucketMap = new Map<number, number>();
  for (const b of buckets) {
    bucketMap.set(b, 0);
  }
  bucketMap.set(Infinity, 0); // +Inf bucket
  return {
    buckets: bucketMap,
    sum: 0,
    count: 0,
  };
}

/**
 * Observe a value in a histogram
 */
function observeHistogram(histogram: HistogramData, value: number): void {
  histogram.sum += value;
  histogram.count++;

  // Increment all buckets where value <= bucket
  for (const [bucket, count] of histogram.buckets) {
    if (value <= bucket) {
      histogram.buckets.set(bucket, count + 1);
    }
  }
}

// =============================================================================
// Metrics Interface
// =============================================================================

interface Metrics {
  // HTTP metrics
  httpRequestsTotal: Map<string, number>;
  httpRequestDurationSum: Map<string, number>;
  httpRequestDurationCount: Map<string, number>;

  // Application metrics (updated on each scrape)
  membersTotal: number;
  naibSeatsTotal: number;
  naibSeatsFilled: number;
  waitlistRegistrations: number;
  alertsSentTotal: number;

  // Health metrics
  lastSuccessfulQueryTimestamp: number;
  gracePeriodActive: number;

  // Sprint 68 - Observability metrics
  // Task 68.3: Gossip convergence
  gossipConvergence: HistogramData;

  // Task 68.4: Fast-path latency (per operation type)
  fastPathLatency: Map<string, HistogramData>;

  // Task 68.5: MFA metrics (per method and tier)
  mfaAttemptTotal: Map<string, number>;
  mfaSuccessTotal: Map<string, number>;
  mfaTimeoutTotal: Map<string, number>;
}

const metrics: Metrics = {
  httpRequestsTotal: new Map(),
  httpRequestDurationSum: new Map(),
  httpRequestDurationCount: new Map(),
  membersTotal: 0,
  naibSeatsTotal: 7,
  naibSeatsFilled: 0,
  waitlistRegistrations: 0,
  alertsSentTotal: 0,
  lastSuccessfulQueryTimestamp: 0,
  gracePeriodActive: 0,

  // Sprint 68 metrics
  gossipConvergence: createHistogram(GOSSIP_CONVERGENCE_BUCKETS),
  fastPathLatency: new Map(),
  mfaAttemptTotal: new Map(),
  mfaSuccessTotal: new Map(),
  mfaTimeoutTotal: new Map(),
};

/**
 * Record an HTTP request for metrics
 */
export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationMs: number
): void {
  const key = `${method}|${route}|${status}`;

  metrics.httpRequestsTotal.set(
    key,
    (metrics.httpRequestsTotal.get(key) ?? 0) + 1
  );

  metrics.httpRequestDurationSum.set(
    key,
    (metrics.httpRequestDurationSum.get(key) ?? 0) + durationMs
  );

  metrics.httpRequestDurationCount.set(
    key,
    (metrics.httpRequestDurationCount.get(key) ?? 0) + 1
  );
}

// =============================================================================
// Sprint 68 Metric Recording Functions
// =============================================================================

/**
 * Record gossip convergence time (Task 68.3)
 *
 * Tracks how long it takes for state changes to propagate
 * from initiation to confirmation.
 *
 * Alert threshold: p99 > 2 seconds
 *
 * @param seconds - Time in seconds for state change propagation
 */
export function recordGossipConvergence(seconds: number): void {
  observeHistogram(metrics.gossipConvergence, seconds);
}

/**
 * Record fast-path latency (Task 68.4)
 *
 * Tracks latency for "fast path" operations:
 * - Redis cache hits
 * - Eligibility checks
 * - Other low-latency operations
 *
 * Alert thresholds:
 * - p99 > 50ms: warning
 * - p99 > 100ms: page
 *
 * @param operationType - Type of operation (e.g., 'redis_cache_hit', 'eligibility_check')
 * @param latencyMs - Latency in milliseconds
 */
export function recordFastPathLatency(operationType: string, latencyMs: number): void {
  if (!metrics.fastPathLatency.has(operationType)) {
    metrics.fastPathLatency.set(operationType, createHistogram(FAST_PATH_LATENCY_BUCKETS));
  }
  observeHistogram(metrics.fastPathLatency.get(operationType)!, latencyMs);
}

/**
 * Record MFA attempt (Task 68.5)
 *
 * @param method - MFA method ('totp', 'duo', 'backup')
 * @param tier - Risk tier ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
 */
export function recordMfaAttempt(method: string, tier: string): void {
  const key = `${method}|${tier}`;
  metrics.mfaAttemptTotal.set(key, (metrics.mfaAttemptTotal.get(key) ?? 0) + 1);
}

/**
 * Record MFA success (Task 68.5)
 *
 * @param method - MFA method ('totp', 'duo', 'backup')
 * @param tier - Risk tier ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
 */
export function recordMfaSuccess(method: string, tier: string): void {
  const key = `${method}|${tier}`;
  metrics.mfaSuccessTotal.set(key, (metrics.mfaSuccessTotal.get(key) ?? 0) + 1);
}

/**
 * Record MFA timeout (Task 68.5)
 *
 * Alert threshold: timeout_rate > 10% triggers investigation
 *
 * @param method - MFA method ('totp', 'duo', 'backup')
 * @param tier - Risk tier ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
 */
export function recordMfaTimeout(method: string, tier: string): void {
  const key = `${method}|${tier}`;
  metrics.mfaTimeoutTotal.set(key, (metrics.mfaTimeoutTotal.get(key) ?? 0) + 1);
}

/**
 * Update application metrics from database
 */
function updateApplicationMetrics(): void {
  try {
    // Get health status
    const health = getHealthStatus();
    metrics.lastSuccessfulQueryTimestamp = health.lastSuccessfulQuery
      ? health.lastSuccessfulQuery.getTime() / 1000
      : 0;
    metrics.gracePeriodActive = health.inGracePeriod ? 1 : 0;

    // Get member count
    const eligibility = queries.getCurrentEligibility();
    metrics.membersTotal = eligibility.filter(
      (e) => e.rank !== undefined && e.rank <= 69
    ).length;

    // Get Naib seat count
    const naibSeats = queries.getCurrentNaibSeats();
    metrics.naibSeatsFilled = naibSeats.length;

    // Get waitlist registrations
    const registrations = queries.getActiveWaitlistRegistrations();
    metrics.waitlistRegistrations = registrations.length;

    // Get alerts sent (approximate from stats)
    const alertStats = queries.getAlertStats();
    metrics.alertsSentTotal = alertStats.totalSent;
  } catch {
    // Ignore errors during metric collection
  }
}

/**
 * Generate Prometheus text format metrics
 */
export function getPrometheusMetrics(): string {
  // Update application metrics before scraping
  updateApplicationMetrics();

  const lines: string[] = [];

  // Helper to add a metric
  const addMetric = (
    name: string,
    type: 'counter' | 'gauge' | 'histogram',
    help: string,
    value: number | string,
    labels?: Record<string, string>
  ) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);

    if (labels && Object.keys(labels).length > 0) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}{${labelStr}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  };

  // HTTP request metrics
  lines.push('# HELP sietch_http_requests_total Total HTTP requests');
  lines.push('# TYPE sietch_http_requests_total counter');
  for (const [key, count] of metrics.httpRequestsTotal) {
    const [method, route, status] = key.split('|');
    lines.push(
      `sietch_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`
    );
  }

  // HTTP request duration (simplified histogram)
  lines.push('# HELP sietch_http_request_duration_ms HTTP request duration in milliseconds');
  lines.push('# TYPE sietch_http_request_duration_ms summary');
  for (const [key, sum] of metrics.httpRequestDurationSum) {
    const [method, route] = key.split('|');
    const count = metrics.httpRequestDurationCount.get(key) ?? 1;
    const avg = sum / count;
    lines.push(
      `sietch_http_request_duration_ms{method="${method}",route="${route}",quantile="avg"} ${avg.toFixed(2)}`
    );
  }

  // Application metrics
  addMetric(
    'sietch_members_total',
    'gauge',
    'Total number of eligible members',
    metrics.membersTotal
  );

  addMetric(
    'sietch_naib_seats_total',
    'gauge',
    'Total Naib seats available',
    metrics.naibSeatsTotal
  );

  addMetric(
    'sietch_naib_seats_filled',
    'gauge',
    'Number of Naib seats currently filled',
    metrics.naibSeatsFilled
  );

  addMetric(
    'sietch_waitlist_registrations',
    'gauge',
    'Number of active waitlist registrations',
    metrics.waitlistRegistrations
  );

  addMetric(
    'sietch_alerts_sent_total',
    'counter',
    'Total alerts sent',
    metrics.alertsSentTotal
  );

  // Health metrics
  addMetric(
    'sietch_last_successful_query_timestamp',
    'gauge',
    'Unix timestamp of last successful chain query',
    metrics.lastSuccessfulQueryTimestamp
  );

  addMetric(
    'sietch_grace_period_active',
    'gauge',
    'Whether the service is in grace period (1=yes, 0=no)',
    metrics.gracePeriodActive
  );

  // Node.js process metrics
  const memUsage = process.memoryUsage();
  addMetric(
    'nodejs_heap_size_total_bytes',
    'gauge',
    'Process heap size in bytes',
    memUsage.heapTotal
  );

  addMetric(
    'nodejs_heap_size_used_bytes',
    'gauge',
    'Process heap used in bytes',
    memUsage.heapUsed
  );

  addMetric(
    'nodejs_external_memory_bytes',
    'gauge',
    'Node.js external memory in bytes',
    memUsage.external
  );

  addMetric(
    'nodejs_process_uptime_seconds',
    'gauge',
    'Process uptime in seconds',
    process.uptime()
  );

  // ===========================================================================
  // Sprint 68 - Observability Metrics
  // ===========================================================================

  // Task 68.3: Gossip Convergence Histogram
  // Alert threshold: p99 > 2 seconds
  lines.push('# HELP sietch_gossip_convergence_seconds Time for state changes to propagate');
  lines.push('# TYPE sietch_gossip_convergence_seconds histogram');
  for (const [bucket, count] of metrics.gossipConvergence.buckets) {
    const le = bucket === Infinity ? '+Inf' : bucket.toString();
    lines.push(`sietch_gossip_convergence_seconds_bucket{le="${le}"} ${count}`);
  }
  lines.push(`sietch_gossip_convergence_seconds_sum ${metrics.gossipConvergence.sum}`);
  lines.push(`sietch_gossip_convergence_seconds_count ${metrics.gossipConvergence.count}`);

  // Task 68.4: Fast-Path Latency Histogram (per operation type)
  // Alert thresholds: p99 > 50ms (warning), p99 > 100ms (page)
  lines.push('# HELP sietch_fast_path_latency_ms Latency for fast-path operations');
  lines.push('# TYPE sietch_fast_path_latency_ms histogram');
  for (const [operationType, histogram] of metrics.fastPathLatency) {
    for (const [bucket, count] of histogram.buckets) {
      const le = bucket === Infinity ? '+Inf' : bucket.toString();
      lines.push(`sietch_fast_path_latency_ms_bucket{operation="${operationType}",le="${le}"} ${count}`);
    }
    lines.push(`sietch_fast_path_latency_ms_sum{operation="${operationType}"} ${histogram.sum}`);
    lines.push(`sietch_fast_path_latency_ms_count{operation="${operationType}"} ${histogram.count}`);
  }

  // Task 68.5: MFA Metrics (per method and tier)
  // Alert threshold: timeout_rate > 10% triggers investigation
  lines.push('# HELP sietch_mfa_attempt_total Total MFA verification attempts');
  lines.push('# TYPE sietch_mfa_attempt_total counter');
  for (const [key, count] of metrics.mfaAttemptTotal) {
    const [method, tier] = key.split('|');
    lines.push(`sietch_mfa_attempt_total{method="${method}",tier="${tier}"} ${count}`);
  }

  lines.push('# HELP sietch_mfa_success_total Total successful MFA verifications');
  lines.push('# TYPE sietch_mfa_success_total counter');
  for (const [key, count] of metrics.mfaSuccessTotal) {
    const [method, tier] = key.split('|');
    lines.push(`sietch_mfa_success_total{method="${method}",tier="${tier}"} ${count}`);
  }

  lines.push('# HELP sietch_mfa_timeout_total Total MFA verification timeouts');
  lines.push('# TYPE sietch_mfa_timeout_total counter');
  for (const [key, count] of metrics.mfaTimeoutTotal) {
    const [method, tier] = key.split('|');
    lines.push(`sietch_mfa_timeout_total{method="${method}",tier="${tier}"} ${count}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Express middleware to record HTTP request metrics
 */
export function metricsMiddleware() {
  return (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      // Normalize route path (remove IDs)
      const route = req.route?.path ?? req.path.replace(/[0-9a-f-]{36}/gi, ':id');
      recordHttpRequest(req.method, route, res.statusCode, duration);
    });

    next();
  };
}
