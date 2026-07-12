/**
 * Synthesis Engine Metrics
 *
 * Sprint S-21: Synthesis Engine & Rate Limiting
 *
 * Prometheus metrics for monitoring:
 * - Token bucket exhaustion and waits (S-21.6)
 * - Discord 429 errors (S-21.8)
 * - Job processing metrics
 *
 * @see SDD §6.3.4-6.3.5
 */

import { SYNTHESIS_METRICS_PREFIX } from '@freeside/core/ports';

// =============================================================================
// Types
// =============================================================================

/**
 * Counter metric interface.
 */
export interface CounterMetric {
  inc(labels?: Record<string, string>): void;
  inc(value: number, labels?: Record<string, string>): void;
}

/**
 * Gauge metric interface.
 */
export interface GaugeMetric {
  set(value: number, labels?: Record<string, string>): void;
  inc(labels?: Record<string, string>): void;
  dec(labels?: Record<string, string>): void;
}

/**
 * Histogram metric interface.
 */
export interface HistogramMetric {
  observe(value: number, labels?: Record<string, string>): void;
}

/**
 * Complete synthesis metrics interface.
 */
export interface SynthesisMetrics {
  // Token Bucket Metrics (S-21.6)
  /** Counter: Token bucket exhausted (max wait exceeded) */
  tokenBucketExhausted: CounterMetric;
  /** Counter: Token bucket waits (had to wait for token) */
  tokenBucketWaits: CounterMetric;
  /** Counter: Tokens acquired successfully */
  tokensAcquired: CounterMetric;
  /** Gauge: Current tokens available in bucket */
  currentTokens: GaugeMetric;

  // Discord 429 Monitoring (S-21.8)
  /** Counter: Discord 429 rate limit errors */
  discord429Errors: CounterMetric;
  /** Counter: Discord 429 global rate limit errors (CRITICAL) */
  discord429GlobalErrors: CounterMetric;
  /** Histogram: Retry-After header values */
  discord429RetryAfter: HistogramMetric;

  // Job Processing Metrics
  /** Counter: Jobs enqueued by type */
  jobsEnqueued: CounterMetric;
  /** Counter: Jobs completed by type */
  jobsCompleted: CounterMetric;
  /** Counter: Jobs failed by type */
  jobsFailed: CounterMetric;
  /** Counter: Jobs retried */
  jobsRetried: CounterMetric;
  /** Gauge: Jobs currently waiting */
  jobsWaiting: GaugeMetric;
  /** Gauge: Jobs currently active */
  jobsActive: GaugeMetric;
  /** Histogram: Job processing duration */
  jobDuration: HistogramMetric;

  // Idempotency Metrics
  /** Counter: Idempotency key hits (duplicate prevented) */
  idempotencyHits: CounterMetric;
  /** Counter: Idempotency key misses (new job) */
  idempotencyMisses: CounterMetric;
}

// =============================================================================
// Metric Definitions
// =============================================================================

/**
 * Metric name definitions with descriptions.
 */
export const SYNTHESIS_METRIC_DEFINITIONS = {
  // Token Bucket
  tokenBucketExhausted: {
    name: `${SYNTHESIS_METRICS_PREFIX}token_bucket_exhausted_total`,
    help: 'Number of times token bucket exhausted (max wait exceeded)',
    type: 'counter',
  },
  tokenBucketWaits: {
    name: `${SYNTHESIS_METRICS_PREFIX}token_bucket_waits_total`,
    help: 'Number of times had to wait for token availability',
    type: 'counter',
  },
  tokensAcquired: {
    name: `${SYNTHESIS_METRICS_PREFIX}tokens_acquired_total`,
    help: 'Total tokens acquired from bucket',
    type: 'counter',
  },
  currentTokens: {
    name: `${SYNTHESIS_METRICS_PREFIX}token_bucket_current`,
    help: 'Current available tokens in bucket',
    type: 'gauge',
  },

  // Discord 429 (CRITICAL monitoring - S-21.8)
  discord429Errors: {
    name: `${SYNTHESIS_METRICS_PREFIX}discord_429_errors_total`,
    help: 'Discord 429 rate limit errors',
    type: 'counter',
    labels: ['endpoint', 'guild_id'],
  },
  discord429GlobalErrors: {
    name: `${SYNTHESIS_METRICS_PREFIX}discord_429_global_errors_total`,
    help: 'CRITICAL: Discord global 429 rate limit errors (can lead to ban)',
    type: 'counter',
  },
  discord429RetryAfter: {
    name: `${SYNTHESIS_METRICS_PREFIX}discord_429_retry_after_seconds`,
    help: 'Discord 429 Retry-After header values in seconds',
    type: 'histogram',
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  },

  // Job Processing
  jobsEnqueued: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_enqueued_total`,
    help: 'Total jobs enqueued',
    type: 'counter',
    labels: ['type'],
  },
  jobsCompleted: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_completed_total`,
    help: 'Total jobs completed successfully',
    type: 'counter',
    labels: ['type'],
  },
  jobsFailed: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_failed_total`,
    help: 'Total jobs failed',
    type: 'counter',
    labels: ['type', 'reason'],
  },
  jobsRetried: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_retried_total`,
    help: 'Total jobs retried',
    type: 'counter',
    labels: ['type'],
  },
  jobsWaiting: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_waiting`,
    help: 'Jobs currently waiting in queue',
    type: 'gauge',
  },
  jobsActive: {
    name: `${SYNTHESIS_METRICS_PREFIX}jobs_active`,
    help: 'Jobs currently being processed',
    type: 'gauge',
  },
  jobDuration: {
    name: `${SYNTHESIS_METRICS_PREFIX}job_duration_seconds`,
    help: 'Job processing duration in seconds',
    type: 'histogram',
    labels: ['type'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },

  // Idempotency
  idempotencyHits: {
    name: `${SYNTHESIS_METRICS_PREFIX}idempotency_hits_total`,
    help: 'Idempotency key hits (duplicates prevented)',
    type: 'counter',
  },
  idempotencyMisses: {
    name: `${SYNTHESIS_METRICS_PREFIX}idempotency_misses_total`,
    help: 'Idempotency key misses (new jobs)',
    type: 'counter',
  },
} as const;

// =============================================================================
// Mock Metrics Implementation
// =============================================================================

/**
 * Create no-op metrics for testing or when Prometheus not available.
 */
export function createNoOpMetrics(): SynthesisMetrics {
  const noOpCounter: CounterMetric = { inc: () => {} };
  const noOpGauge: GaugeMetric = { set: () => {}, inc: () => {}, dec: () => {} };
  const noOpHistogram: HistogramMetric = { observe: () => {} };

  return {
    tokenBucketExhausted: noOpCounter,
    tokenBucketWaits: noOpCounter,
    tokensAcquired: noOpCounter,
    currentTokens: noOpGauge,
    discord429Errors: noOpCounter,
    discord429GlobalErrors: noOpCounter,
    discord429RetryAfter: noOpHistogram,
    jobsEnqueued: noOpCounter,
    jobsCompleted: noOpCounter,
    jobsFailed: noOpCounter,
    jobsRetried: noOpCounter,
    jobsWaiting: noOpGauge,
    jobsActive: noOpGauge,
    jobDuration: noOpHistogram,
    idempotencyHits: noOpCounter,
    idempotencyMisses: noOpCounter,
  };
}

// =============================================================================
// Metrics Registry Helper
// =============================================================================

/**
 * Track a Discord 429 error.
 *
 * @param metrics - Synthesis metrics instance
 * @param error - Error response from Discord
 * @param endpoint - API endpoint that was called
 * @param guildId - Guild ID (if applicable)
 */
export function trackDiscord429Error(
  metrics: SynthesisMetrics,
  error: { global?: boolean; retryAfter?: number },
  endpoint: string,
  guildId?: string
): void {
  // Always track the 429
  metrics.discord429Errors.inc({ endpoint, guild_id: guildId ?? 'unknown' });

  // Track global 429s separately (CRITICAL)
  if (error.global) {
    metrics.discord429GlobalErrors.inc();
  }

  // Track retry-after value
  if (error.retryAfter !== undefined) {
    metrics.discord429RetryAfter.observe(error.retryAfter);
  }
}

/**
 * Track job lifecycle events.
 */
export const JobMetrics = {
  /**
   * Record job enqueued.
   */
  enqueued(metrics: SynthesisMetrics, type: string): void {
    metrics.jobsEnqueued.inc({ type });
  },

  /**
   * Record job completed.
   */
  completed(metrics: SynthesisMetrics, type: string, durationMs: number): void {
    metrics.jobsCompleted.inc({ type });
    metrics.jobDuration.observe(durationMs / 1000, { type });
  },

  /**
   * Record job failed.
   */
  failed(metrics: SynthesisMetrics, type: string, reason: string): void {
    metrics.jobsFailed.inc({ type, reason });
  },

  /**
   * Record job retried.
   */
  retried(metrics: SynthesisMetrics, type: string): void {
    metrics.jobsRetried.inc({ type });
  },

  /**
   * Update queue size gauges.
   */
  updateQueueSize(metrics: SynthesisMetrics, waiting: number, active: number): void {
    metrics.jobsWaiting.set(waiting);
    metrics.jobsActive.set(active);
  },
};
