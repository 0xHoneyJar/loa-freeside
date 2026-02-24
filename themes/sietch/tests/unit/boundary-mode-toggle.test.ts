/**
 * Mode Toggle + Kill-Switch Verification Tests
 *
 * Tests for parseBoundaryMicroUsd mode transitions and kill-switch behavior.
 *
 * Coverage:
 *   - AC-4.5.1: Atomic deployment documentation (mode transition procedure)
 *   - AC-4.6.1: Kill-switch test — legacy mode bypasses canonical parser entirely
 *   - AC-4.6.2: Enforce mode — canonical parser drives decisions
 *   - AC-4.6.3: Cutover criteria documentation verification
 *   - Task 4.5: All 3 mode transitions tested
 *   - Task 4.6: Kill-switch: spy on parseMicroUsd, verify call count is 0 in legacy
 *
 * @see grimoires/loa/sprint.md Sprint 4, Tasks 4.5 + 4.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BoundaryLogger, BoundaryMetrics } from '../../src/packages/core/protocol/parse-boundary-micro-usd.js';
import { evaluateGraduation, DEFAULT_GRADUATION_CRITERIA, type GraduationCounters } from '../../src/packages/core/protocol/graduation.js';
import { BoundaryMetricsRegistry, METRIC_NAMES, resetBoundaryMetricsRegistry } from '../../src/packages/core/protocol/boundary-metrics.js';

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

function createMockMetrics(): BoundaryMetrics {
  return {
    shadowTotal: vi.fn(),
    wouldRejectTotal: vi.fn(),
    divergenceTotal: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mode Transition Tests (Task 4.5)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — mode transitions', () => {
  // We need to dynamically import to test with mocked parseMicroUsd
  let parseBoundaryMicroUsd: typeof import('../../src/packages/core/protocol/parse-boundary-micro-usd.js').parseBoundaryMicroUsd;

  beforeEach(async () => {
    const mod = await import('../../src/packages/core/protocol/parse-boundary-micro-usd.js');
    parseBoundaryMicroUsd = mod.parseBoundaryMicroUsd;
  });

  it('legacy → shadow transition: shadow mode runs both parsers', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();

    // legacy mode: only BigInt
    const legacyResult = parseBoundaryMicroUsd('1000', 'http', logger, metrics, 'legacy');
    expect(legacyResult.ok).toBe(true);
    if (legacyResult.ok) {
      expect(legacyResult.mode).toBe('legacy');
      expect(legacyResult.canonicalResult).toBeUndefined();
    }

    // shadow mode: both parsers run
    const shadowResult = parseBoundaryMicroUsd('1000', 'http', logger, metrics, 'shadow');
    expect(shadowResult.ok).toBe(true);
    if (shadowResult.ok) {
      expect(shadowResult.mode).toBe('shadow');
      expect(shadowResult.canonicalResult).toBe(1000n);
      expect(shadowResult.diverged).toBe(false);
    }
  });

  it('shadow → enforce transition: canonical drives decisions', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();

    // shadow: returns legacy result even when canonical would reject
    const shadowResult = parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'shadow');
    expect(shadowResult.ok).toBe(true); // legacy accepts leading zeros
    if (shadowResult.ok) {
      expect(shadowResult.value).toBe(100n); // legacy result
    }

    // enforce: canonical rejects leading zeros
    const enforceResult = parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'enforce');
    expect(enforceResult.ok).toBe(false);
    if (!enforceResult.ok) {
      expect(enforceResult.errorCode).toBe('ENFORCE_REJECTION');
    }
  });

  it('enforce → legacy rollback: legacy bypasses canonical', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();

    // enforce rejects leading zeros
    const enforceResult = parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'enforce');
    expect(enforceResult.ok).toBe(false);

    // rolling back to legacy: accepts leading zeros again
    const legacyResult = parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'legacy');
    expect(legacyResult.ok).toBe(true);
    if (legacyResult.ok) {
      expect(legacyResult.value).toBe(100n);
    }
  });

  it('all valid inputs accepted in all 3 modes', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();
    const validInputs = ['0', '1', '1000000', '999999999999999'];

    for (const input of validInputs) {
      for (const mode of ['legacy', 'shadow', 'enforce'] as const) {
        const result = parseBoundaryMicroUsd(input, 'http', logger, metrics, mode);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(BigInt(input));
        }
      }
    }
  });

  it('safety floor enforced in ALL modes', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();
    const safetyViolations = [
      { input: '1'.repeat(51), error: 'SAFETY_MAX_LENGTH' },
      { input: '-100', error: 'SAFETY_NEGATIVE_AT_BOUNDARY' },
    ];

    for (const { input, error } of safetyViolations) {
      for (const mode of ['legacy', 'shadow', 'enforce'] as const) {
        const result = parseBoundaryMicroUsd(input, 'http', logger, metrics, mode);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorCode).toBe(error);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Kill-Switch Verification (AC-4.6.1) — Spy-based
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — kill-switch verification (AC-4.6.1)', () => {
  it('legacy mode: canonical parseMicroUsd is NEVER called (spy verification)', async () => {
    // Mock the canonical parseMicroUsd import
    const parseMicroUsdSpy = vi.fn();

    // Use vi.hoisted + vi.mock pattern
    vi.doMock('@0xhoneyjar/loa-hounfour', () => ({
      parseMicroUsd: parseMicroUsdSpy,
    }));

    // Re-import to pick up the mock
    const { parseBoundaryMicroUsd: parseFn } = await import(
      '../../src/packages/core/protocol/parse-boundary-micro-usd.js'
    );

    const logger = createMockLogger();
    const metrics = createMockMetrics();

    // Run multiple parses in legacy mode
    parseFn('1000', 'http', logger, metrics, 'legacy');
    parseFn('0100', 'http', logger, metrics, 'legacy');
    parseFn('500000', 'http', logger, metrics, 'legacy');
    parseFn('+42', 'http', logger, metrics, 'legacy');
    parseFn('0', 'http', logger, metrics, 'legacy');

    // Canonical parser should NEVER have been called
    expect(parseMicroUsdSpy).not.toHaveBeenCalled();

    // Clean up mock
    vi.doUnmock('@0xhoneyjar/loa-hounfour');
  });

  it('legacy mode: inputs that canonical rejects are still accepted', async () => {
    const mod = await import('../../src/packages/core/protocol/parse-boundary-micro-usd.js');
    const logger = createMockLogger();

    // These inputs are rejected by canonical but accepted by BigInt()
    const canonicalRejections = ['0100', '+42'];

    for (const input of canonicalRejections) {
      const result = mod.parseBoundaryMicroUsd(input, 'http', logger, undefined, 'legacy');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.canonicalResult).toBeUndefined(); // No canonical result in legacy
      }
    }
  });

  it('legacy mode: no inputs that legacy accepts are rejected', async () => {
    const mod = await import('../../src/packages/core/protocol/parse-boundary-micro-usd.js');
    const logger = createMockLogger();

    // All valid BigInt strings (within safety bounds)
    const legacyAcceptable = ['0', '1', '100', '0100', '+42', '999999999999999'];

    for (const input of legacyAcceptable) {
      const result = mod.parseBoundaryMicroUsd(input, 'http', logger, undefined, 'legacy');
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Enforce Mode Verification (AC-4.6.2)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — enforce mode verification (AC-4.6.2)', () => {
  let parseBoundaryMicroUsd: any;

  beforeEach(async () => {
    const mod = await import('../../src/packages/core/protocol/parse-boundary-micro-usd.js');
    parseBoundaryMicroUsd = mod.parseBoundaryMicroUsd;
  });

  it('enforce mode: canonical drives decisions', () => {
    const logger = createMockLogger();

    const result = parseBoundaryMicroUsd('1000000', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('enforce');
      expect(result.canonicalResult).toBe(1000000n);
    }
  });

  it('enforce mode: inputs rejected by canonical return { ok: false }', () => {
    const logger = createMockLogger();

    const rejections = [
      { input: '0100', desc: 'leading zeros' },
      { input: '+100', desc: 'plus sign' },
      { input: '100.5', desc: 'float' },
      { input: '1e5', desc: 'scientific notation' },
      { input: '0xff', desc: 'hex' },
    ];

    for (const { input, desc } of rejections) {
      const result = parseBoundaryMicroUsd(input, 'http', logger, undefined, 'enforce');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('ENFORCE_REJECTION');
        expect(result.raw).toBe(input);
      }
    }
  });

  it('enforce mode: structured error includes reason', () => {
    const logger = createMockLogger();

    const result = parseBoundaryMicroUsd('0100', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Environment Variable Mode Resolution
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — env var mode resolution', () => {
  const originalEnv = process.env.PARSE_MICRO_USD_MODE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PARSE_MICRO_USD_MODE = originalEnv;
    } else {
      delete process.env.PARSE_MICRO_USD_MODE;
    }
  });

  it('PARSE_MICRO_USD_MODE=legacy activates legacy mode', async () => {
    process.env.PARSE_MICRO_USD_MODE = 'legacy';
    const { parseBoundaryMicroUsd } = await import(
      '../../src/packages/core/protocol/parse-boundary-micro-usd.js'
    );
    const logger = createMockLogger();

    // Leading zeros accepted = legacy mode active
    const result = parseBoundaryMicroUsd('0100', 'http', logger);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mode).toBe('legacy');
  });

  it('PARSE_MICRO_USD_MODE=enforce activates enforce mode', async () => {
    process.env.PARSE_MICRO_USD_MODE = 'enforce';
    const { parseBoundaryMicroUsd } = await import(
      '../../src/packages/core/protocol/parse-boundary-micro-usd.js'
    );
    const logger = createMockLogger();

    // Leading zeros rejected = enforce mode active
    const result = parseBoundaryMicroUsd('0100', 'http', logger);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mode).toBe('enforce');
  });
});

// ---------------------------------------------------------------------------
// Graduation Criteria Integration (AC-1.5, cycle-040 FR-1)
// ---------------------------------------------------------------------------

describe('graduation criteria — mode-toggle integration (AC-1.5)', () => {
  const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
  const NOW = Date.now();
  const DEPLOY_TIME = NOW - EIGHT_DAYS_MS;

  it('graduation gauge transitions 0→1 under simulated-ready state', () => {
    const registry = new BoundaryMetricsRegistry();
    const metrics = registry.toBoundaryMetrics();

    // Simulate shadow traffic with no divergence and no would-rejects
    for (let i = 0; i < 1000; i++) {
      metrics.shadowTotal('http');
    }

    const counters = registry.getGraduationCounters('http');
    expect(counters.shadowTotal).toBe(1000n);
    expect(counters.wouldRejectTotal).toBe(0n);
    expect(counters.divergenceTotal).toBe(0n);

    // Evaluate graduation — should be ready (all criteria met)
    const status = evaluateGraduation(
      'http',
      counters,
      DEPLOY_TIME,
      0,
      DEFAULT_GRADUATION_CRITERIA,
      NOW,
    );

    expect(status.ready).toBe(true);
    expect(status.criteria.divergenceRate.met).toBe(true);
    expect(status.criteria.observationWindow.met).toBe(true);
    expect(status.criteria.wouldRejectClean.met).toBe(true);
  });

  it('graduation returns not-ready when would-rejects exist recently', () => {
    const registry = new BoundaryMetricsRegistry();
    const metrics = registry.toBoundaryMetrics();

    // Simulate shadow traffic with some would-rejects
    for (let i = 0; i < 100; i++) {
      metrics.shadowTotal('http');
    }
    metrics.wouldRejectTotal('http'); // triggers lastWouldRejectTimestamp

    const counters = registry.getGraduationCounters('http');
    const lastRejectTs = registry.getLastWouldRejectTimestamp('http');

    expect(counters.wouldRejectTotal).toBe(1n);
    expect(lastRejectTs).toBeGreaterThan(0);

    // Evaluate — should NOT be ready (recent would-reject)
    const status = evaluateGraduation(
      'http',
      counters,
      DEPLOY_TIME,
      lastRejectTs,
      DEFAULT_GRADUATION_CRITERIA,
      NOW,
    );

    expect(status.ready).toBe(false);
    expect(status.criteria.wouldRejectClean.met).toBe(false);
  });

  it('graduation references default criteria thresholds (AC-1.1)', () => {
    expect(DEFAULT_GRADUATION_CRITERIA.maxDivergenceRatePpm).toBe(1000n); // 0.1%
    expect(DEFAULT_GRADUATION_CRITERIA.minObservationWindowMs).toBe(604_800_000); // 7 days
    expect(DEFAULT_GRADUATION_CRITERIA.wouldRejectConsecutiveWindowMs).toBe(259_200_000); // 72h
  });
});
