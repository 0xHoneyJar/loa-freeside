/**
 * Arrakis Conviction Bridge — Circuit-Breaker Protected Integration
 *
 * Optional integration with Arrakis conviction scoring API.
 * Graceful degradation: approval proceeds without conviction score
 * when the circuit is open or requests fail.
 *
 * Governance Resilience Pattern (F-5 / Bridgebuilder PRAISE):
 *   This circuit breaker is a GOVERNANCE resilience pattern, not merely
 *   a reliability feature. The distinction matters:
 *
 *   - Microservice circuit breaker: protects the caller from a slow
 *     dependency. Opens when response time SLA is violated.
 *   - Governance circuit breaker: protects the community's ability to
 *     make decisions. Opens when the democratic process (external
 *     consensus via conviction scoring) becomes unavailable.
 *
 *   The fallback `{ score: null, fromFallback: true }` means "fall back
 *   to simpler but still legitimate governance" — not "skip governance."
 *   When external consensus fails, the community falls back to internal
 *   governance (admin approval). This matches Ostrom's fieldwork on
 *   commons governance systems: successful commons always have fallback
 *   mechanisms for when primary governance processes are disrupted.
 *
 *   Conway Automaton contrast: ungoverned agents stop when infrastructure
 *   fails; governed agents fall back to a less-autonomous but still-
 *   operational mode. The circuit breaker IS the governance guarantee —
 *   it ensures the community can always act, even when the most
 *   sophisticated decision mechanism is temporarily unavailable.
 *
 * Circuit breaker (IMP-002):
 *   - Timeout: 3s per request
 *   - Error threshold: 50%
 *   - Reset timeout: 30s
 *   - Retries: 1 with 500ms backoff
 *
 * @see SDD §1.6 Arrakis Client Circuit Breaker
 * @see Sprint 5, Task 5.7 (AC-5.7.1 through AC-5.7.5)
 * @module packages/services/arrakis-conviction-bridge
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Conviction score result */
export interface ConvictionResult {
  score: number | null;
  fromFallback: boolean;
}

/** Logger interface */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Metrics port */
export interface MetricsPort {
  putMetric(name: string, value: number, unit?: string): void;
}

/** Bridge configuration */
export interface ArrakisBridgeConfig {
  /** Arrakis API base URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in ms (default: 3000) — AC-5.7.1 */
  timeoutMs?: number;
  /** Error threshold percentage for circuit open (default: 50) — AC-5.7.1 */
  errorThresholdPercent?: number;
  /** Circuit reset timeout in ms (default: 30000) — AC-5.7.1 */
  resetTimeoutMs?: number;
  /** Retry backoff in ms (default: 500) — AC-5.7.2 */
  retryBackoffMs?: number;
  /** Max retries (default: 1) — AC-5.7.2 */
  maxRetries?: number;
}

/** Bridge dependencies */
export interface ArrakisBridgeDeps {
  logger: Logger;
  metrics: MetricsPort;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_ERROR_THRESHOLD_PERCENT = 50;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_BACKOFF_MS = 500;
const DEFAULT_MAX_RETRIES = 1;

/** Rolling window for circuit breaker stats */
const ROLLING_WINDOW_MS = 10_000;

// --------------------------------------------------------------------------
// Circuit Breaker State
// --------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  totalRequests: number;
  windowStart: number;
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createArrakisConvictionBridge(
  config: ArrakisBridgeConfig,
  deps: ArrakisBridgeDeps,
) {
  const { logger, metrics } = deps;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const errorThresholdPercent = config.errorThresholdPercent ?? DEFAULT_ERROR_THRESHOLD_PERCENT;
  const resetTimeoutMs = config.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
  const retryBackoffMs = config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  // Circuit breaker state
  const cb: CircuitBreakerState = {
    state: 'closed',
    failures: 0,
    successes: 0,
    lastFailureTime: 0,
    totalRequests: 0,
    windowStart: Date.now(),
  };

  function resetWindow(): void {
    cb.failures = 0;
    cb.successes = 0;
    cb.totalRequests = 0;
    cb.windowStart = Date.now();
  }

  function recordSuccess(): void {
    cb.successes++;
    cb.totalRequests++;
    if (cb.state === 'half_open') {
      cb.state = 'closed';
      resetWindow();
      logger.info('Circuit breaker closed (Arrakis)');
    }
  }

  function recordFailure(): void {
    const now = Date.now();

    // Check if rolling window has elapsed — reset before counting
    if (now - cb.windowStart > ROLLING_WINDOW_MS) {
      resetWindow();
    }

    cb.failures++;
    cb.totalRequests++;
    cb.lastFailureTime = now;

    // Check error threshold — AC-5.7.1
    if (cb.totalRequests >= 5) {
      const errorRate = (cb.failures / cb.totalRequests) * 100;
      if (errorRate >= errorThresholdPercent) {
        cb.state = 'open';
        logger.warn('Circuit breaker opened (Arrakis)', {
          errorRate,
          failures: cb.failures,
          total: cb.totalRequests,
        });
      }
    }
  }

  function isCircuitOpen(): boolean {
    if (cb.state === 'closed') return false;

    if (cb.state === 'open') {
      // Check reset timeout
      if (Date.now() - cb.lastFailureTime >= resetTimeoutMs) {
        cb.state = 'half_open';
        logger.info('Circuit breaker half-open (Arrakis)');
        return false;
      }
      return true;
    }

    // half_open allows one request through
    return false;
  }

  /**
   * Make a single HTTP request with timeout.
   */
  async function fetchWithTimeout(
    communityId: string,
    policyId: string,
  ): Promise<number> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = new URL(
        `/api/v1/conviction/${encodeURIComponent(communityId)}/${encodeURIComponent(policyId)}`,
        config.baseUrl,
      ).toString();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Arrakis API returned ${response.status}`);
      }

      const data = (await response.json()) as { conviction_score?: unknown };
      if (typeof data.conviction_score !== 'number') {
        throw new Error('Arrakis API returned invalid conviction_score');
      }

      return data.conviction_score;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get conviction score with circuit breaker and retry.
   *
   * AC-5.7.1: Circuit breaker with 3s timeout, 50% threshold, 30s reset
   * AC-5.7.2: 1 retry with 500ms backoff
   * AC-5.7.3: Fallback returns null score, logs warning
   * AC-5.7.4: Emits arrakis_fallback_count metric
   * AC-5.7.5: Score returned for storage in economic_policies
   */
  async function getConvictionScore(
    communityId: string,
    policyId: string,
  ): Promise<ConvictionResult> {
    // Circuit breaker check
    if (isCircuitOpen()) {
      logger.warn('Arrakis circuit open, using fallback', { communityId, policyId });
      metrics.putMetric('arrakis_fallback_count', 1);
      return { score: null, fromFallback: true };
    }

    // AC-5.7.2: Attempt with retry
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryBackoffMs));
        }

        const attemptStart = Date.now();
        const score = await fetchWithTimeout(communityId, policyId);
        recordSuccess();

        const latencyMs = Date.now() - attemptStart;
        metrics.putMetric('arrakis_conviction_latency_ms', latencyMs, 'Milliseconds');
        return { score, fromFallback: false };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.warn('Arrakis conviction request failed', {
          communityId,
          policyId,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          error: errorMessage,
        });

        recordFailure();
      }
    }

    // AC-5.7.3: Fallback — approval proceeds without conviction score
    logger.warn('Arrakis conviction exhausted retries, using fallback', {
      communityId,
      policyId,
    });

    // AC-5.7.4: Emit fallback metric
    metrics.putMetric('arrakis_fallback_count', 1);

    return { score: null, fromFallback: true };
  }

  return {
    getConvictionScore,
    /** Expose circuit state for health checks */
    getCircuitState: (): CircuitState => cb.state,
  };
}
