/**
 * Boundary Metrics — Unit Tests
 *
 * Tests for the shadow-mode metrics instrumentation per Sprint 4, Task 4.2.
 *
 * Coverage:
 *   - AC-4.2.1: Counter registration and emission per boundary context
 *   - AC-4.2.2: Metric emission calls with expected names, values, and context labels
 *   - AC-4.2.3: Integration test: shadow mode + would-reject → counter incremented
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.2
 * @see grimoires/loa/sdd.md §3.6 IMP-003
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoundaryMetricsRegistry,
  METRIC_NAMES,
  BOUNDARY_CONTEXTS,
  getBoundaryMetricsRegistry,
  getBoundaryMetrics,
  resetBoundaryMetricsRegistry,
} from '../../src/packages/core/protocol/boundary-metrics.js';
import {
  parseBoundaryMicroUsd,
  type BoundaryContext,
  type BoundaryLogger,
} from '../../src/packages/core/protocol/parse-boundary-micro-usd.js';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): BoundaryLogger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Counter Registration Tests (AC-4.2.1)
// ---------------------------------------------------------------------------

describe('BoundaryMetricsRegistry — counter registration', () => {
  let registry: BoundaryMetricsRegistry;

  beforeEach(() => {
    registry = new BoundaryMetricsRegistry();
  });

  it('pre-registers all 3 metrics × 4 contexts = 12+ counters at construction', () => {
    const snapshot = registry.snapshot();
    const keys = Object.keys(snapshot);

    // At minimum: 3 core metrics × 4 contexts = 12
    // Plus additional metrics (mode_switch, error_total) × 4 = 8
    // Total: 20
    expect(keys.length).toBeGreaterThanOrEqual(12);

    // Verify each core metric has all 4 contexts
    for (const metricName of [
      METRIC_NAMES.SHADOW_TOTAL,
      METRIC_NAMES.WOULD_REJECT_TOTAL,
      METRIC_NAMES.DIVERGENCE_TOTAL,
    ]) {
      for (const context of BOUNDARY_CONTEXTS) {
        const key = `${metricName}:${context}`;
        expect(snapshot).toHaveProperty(key);
        expect(snapshot[key]).toBe(0);
      }
    }
  });

  it('all counters start at 0', () => {
    const snapshot = registry.snapshot();
    for (const value of Object.values(snapshot)) {
      expect(value).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Counter Increment Tests (AC-4.2.2)
// ---------------------------------------------------------------------------

describe('BoundaryMetricsRegistry — counter increment', () => {
  let registry: BoundaryMetricsRegistry;

  beforeEach(() => {
    registry = new BoundaryMetricsRegistry();
  });

  it('increments shadow_total for specific context', () => {
    registry.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');
    registry.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');
    registry.increment(METRIC_NAMES.SHADOW_TOTAL, 'db');

    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(2);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'db')).toBe(1);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'redis')).toBe(0);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'jwt')).toBe(0);
  });

  it('increments would_reject_total independently per context', () => {
    registry.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http');
    registry.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, 'jwt');
    registry.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, 'jwt');

    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http')).toBe(1);
    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'jwt')).toBe(2);
  });

  it('increments divergence_total independently', () => {
    registry.increment(METRIC_NAMES.DIVERGENCE_TOTAL, 'redis');

    expect(registry.get(METRIC_NAMES.DIVERGENCE_TOTAL, 'redis')).toBe(1);
    expect(registry.get(METRIC_NAMES.DIVERGENCE_TOTAL, 'http')).toBe(0);
  });

  it('records emissions in order', () => {
    registry.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');
    registry.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, 'db');

    const emissions = registry.getEmissions();
    expect(emissions).toHaveLength(2);
    expect(emissions[0].name).toBe(METRIC_NAMES.SHADOW_TOTAL);
    expect(emissions[0].context).toBe('http');
    expect(emissions[0].value).toBe(1);
    expect(emissions[1].name).toBe(METRIC_NAMES.WOULD_REJECT_TOTAL);
    expect(emissions[1].context).toBe('db');
    expect(emissions[1].value).toBe(1);
  });

  it('caps emissions at maxEmissions', () => {
    const smallRegistry = new BoundaryMetricsRegistry({ maxEmissions: 3 });
    for (let i = 0; i < 10; i++) {
      smallRegistry.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');
    }

    expect(smallRegistry.getEmissions()).toHaveLength(3);
    // Counter itself is not capped
    expect(smallRegistry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Reset Tests
// ---------------------------------------------------------------------------

describe('BoundaryMetricsRegistry — reset', () => {
  it('resets all counters and clears emissions', () => {
    const registry = new BoundaryMetricsRegistry();
    registry.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');
    registry.increment(METRIC_NAMES.WOULD_REJECT_TOTAL, 'db');

    registry.reset();

    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(0);
    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'db')).toBe(0);
    expect(registry.getEmissions()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// toBoundaryMetrics Adapter Tests (AC-4.2.2)
// ---------------------------------------------------------------------------

describe('BoundaryMetricsRegistry — toBoundaryMetrics adapter', () => {
  let registry: BoundaryMetricsRegistry;

  beforeEach(() => {
    registry = new BoundaryMetricsRegistry();
  });

  it('shadowTotal() increments the correct counter', () => {
    const metrics = registry.toBoundaryMetrics();
    metrics.shadowTotal('http');
    metrics.shadowTotal('http');
    metrics.shadowTotal('db');

    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(2);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'db')).toBe(1);
  });

  it('wouldRejectTotal() increments the correct counter', () => {
    const metrics = registry.toBoundaryMetrics();
    metrics.wouldRejectTotal('jwt');

    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'jwt')).toBe(1);
  });

  it('divergenceTotal() increments the correct counter', () => {
    const metrics = registry.toBoundaryMetrics();
    metrics.divergenceTotal('redis');

    expect(registry.get(METRIC_NAMES.DIVERGENCE_TOTAL, 'redis')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Singleton Tests
// ---------------------------------------------------------------------------

describe('Boundary metrics singleton', () => {
  beforeEach(() => {
    resetBoundaryMetricsRegistry();
  });

  it('getBoundaryMetricsRegistry returns the same instance', () => {
    const a = getBoundaryMetricsRegistry();
    const b = getBoundaryMetricsRegistry();
    expect(a).toBe(b);
  });

  it('resetBoundaryMetricsRegistry creates a fresh instance', () => {
    const a = getBoundaryMetricsRegistry();
    a.increment(METRIC_NAMES.SHADOW_TOTAL, 'http');

    resetBoundaryMetricsRegistry();

    const b = getBoundaryMetricsRegistry();
    expect(b).not.toBe(a);
    expect(b.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(0);
  });

  it('getBoundaryMetrics returns a working adapter', () => {
    const metrics = getBoundaryMetrics();
    metrics.shadowTotal('http');

    expect(getBoundaryMetricsRegistry().get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration Test: Shadow Mode + Would-Reject (AC-4.2.3)
// ---------------------------------------------------------------------------

describe('Integration: parseBoundaryMicroUsd with BoundaryMetricsRegistry', () => {
  let registry: BoundaryMetricsRegistry;
  let logger: BoundaryLogger;

  beforeEach(() => {
    registry = new BoundaryMetricsRegistry();
    logger = createMockLogger();
  });

  it('shadow mode increments shadow_total on every call', () => {
    const metrics = registry.toBoundaryMetrics();

    parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'shadow');
    parseBoundaryMicroUsd('500000', 'http', logger, metrics, 'shadow');
    parseBoundaryMicroUsd('200000', 'db', logger, metrics, 'shadow');

    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(2);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'db')).toBe(1);
  });

  it('shadow mode increments would_reject_total when canonical rejects (leading zeros)', () => {
    const metrics = registry.toBoundaryMetrics();

    // Leading zeros: BigInt('0100') = 100n, but parseMicroUsd('0100') rejects
    parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'shadow');

    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http')).toBe(1);
    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(1);
  });

  it('shadow mode increments would_reject_total for plus sign', () => {
    const metrics = registry.toBoundaryMetrics();

    parseBoundaryMicroUsd('+100', 'http', logger, metrics, 'shadow');

    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http')).toBe(1);
  });

  it('shadow mode does NOT increment would_reject for valid input', () => {
    const metrics = registry.toBoundaryMetrics();

    parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'shadow');

    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http')).toBe(0);
  });

  it('legacy mode does NOT increment any shadow counters', () => {
    const metrics = registry.toBoundaryMetrics();

    parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'legacy');
    parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'legacy');

    expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, 'http')).toBe(0);
    expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, 'http')).toBe(0);
  });

  it('tracks metrics per boundary context correctly', () => {
    const metrics = registry.toBoundaryMetrics();
    const contexts: BoundaryContext[] = ['http', 'db', 'redis', 'jwt'];

    for (const ctx of contexts) {
      parseBoundaryMicroUsd('0100', ctx, logger, metrics, 'shadow');
    }

    for (const ctx of contexts) {
      expect(registry.get(METRIC_NAMES.SHADOW_TOTAL, ctx)).toBe(1);
      expect(registry.get(METRIC_NAMES.WOULD_REJECT_TOTAL, ctx)).toBe(1);
    }
  });

  it('snapshot captures all counter state', () => {
    const metrics = registry.toBoundaryMetrics();

    parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'shadow');
    parseBoundaryMicroUsd('1000', 'db', logger, metrics, 'shadow');

    const snap = registry.snapshot();
    expect(snap[`${METRIC_NAMES.SHADOW_TOTAL}:http`]).toBe(1);
    expect(snap[`${METRIC_NAMES.SHADOW_TOTAL}:db`]).toBe(1);
    expect(snap[`${METRIC_NAMES.WOULD_REJECT_TOTAL}:http`]).toBe(1);
    expect(snap[`${METRIC_NAMES.WOULD_REJECT_TOTAL}:db`]).toBe(0);
  });
});
