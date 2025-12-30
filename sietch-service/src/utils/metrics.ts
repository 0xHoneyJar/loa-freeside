/**
 * Simple Prometheus Metrics for Sietch Service
 *
 * Exposes metrics in Prometheus text format for monitoring
 */

import { getHealthStatus } from '../db/index.js';
import * as queries from '../db/index.js';

// Simple in-memory counters and gauges
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
