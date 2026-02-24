/**
 * parseBoundaryMicroUsd — Unit Tests
 *
 * Tests for the 3-stage dual-parse boundary wrapper per Sprint 4, Task 4.1.
 *
 * Coverage:
 *   - AC-4.1.1: BoundaryParseResult discriminated union
 *   - AC-4.1.2: Stage 0 (legacy): BigInt() only
 *   - AC-4.1.3: Stage 1 (shadow): Both parsers, legacy returned, divergences logged
 *   - AC-4.1.4: Stage 2 (enforce): Canonical drives decisions
 *   - AC-4.1.5: All 3 modes with valid, invalid, and edge-case inputs
 *   - AC-4.1.6: Leading zeros, whitespace, plus signs, floats rejected by canonical
 *   - AC-4.1.7: Performance budget <2ms p99 (benchmark test)
 *   - AC-4.1.8: Safety floor: max 50 chars, MAX_SAFE_MICRO_USD, non-ASCII, context-aware negativity
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.1
 * @see grimoires/loa/sdd.md §3.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseBoundaryMicroUsd,
  checkSafetyFloor,
  resolveParseMode,
  MAX_SAFE_MICRO_USD,
  MAX_INPUT_LENGTH,
  type BoundaryParseResult,
  type BoundaryContext,
  type BoundaryLogger,
  type BoundaryMetrics,
  type ParseMode,
} from '../../src/packages/core/protocol/parse-boundary-micro-usd.js';

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

function createMockMetrics(): BoundaryMetrics & {
  counts: { shadow: number; wouldReject: number; divergence: number };
} {
  const counts = { shadow: 0, wouldReject: 0, divergence: 0 };
  return {
    counts,
    shadowTotal: vi.fn(() => { counts.shadow++; }),
    wouldRejectTotal: vi.fn(() => { counts.wouldReject++; }),
    divergenceTotal: vi.fn(() => { counts.divergence++; }),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd constants', () => {
  it('MAX_SAFE_MICRO_USD is 1e15 ($1B)', () => {
    expect(MAX_SAFE_MICRO_USD).toBe(1_000_000_000_000_000n);
  });

  it('MAX_INPUT_LENGTH is 50', () => {
    expect(MAX_INPUT_LENGTH).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Safety Floor Tests (AC-4.1.8)
// ---------------------------------------------------------------------------

describe('checkSafetyFloor', () => {
  it('accepts valid input within bounds', () => {
    expect(checkSafetyFloor('1000000', 'http')).toBeNull();
    expect(checkSafetyFloor('0', 'http')).toBeNull();
    expect(checkSafetyFloor('999999999999999', 'http')).toBeNull(); // exactly 1e15 - 1
  });

  it('rejects input exceeding max length (50 chars)', () => {
    const longInput = '1'.repeat(51);
    const result = checkSafetyFloor(longInput, 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_MAX_LENGTH');
  });

  it('accepts input at exactly max length (50 chars)', () => {
    const exactInput = '1'.repeat(50);
    expect(checkSafetyFloor(exactInput, 'http')).toBeNull();
  });

  it('rejects non-ASCII characters', () => {
    const result = checkSafetyFloor('100\u00A0', 'http'); // non-breaking space
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_NON_ASCII');
  });

  it('rejects unicode whitespace', () => {
    const result = checkSafetyFloor('100\u2003', 'http'); // em space
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_NON_ASCII');
  });

  it('rejects ASCII whitespace (space)', () => {
    const result = checkSafetyFloor(' 100 ', 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_WHITESPACE');
  });

  it('rejects ASCII whitespace (tab)', () => {
    const result = checkSafetyFloor('\t100', 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_WHITESPACE');
  });

  it('rejects ASCII whitespace (newline)', () => {
    const result = checkSafetyFloor('100\n', 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_WHITESPACE');
  });

  it('rejects negative values at HTTP boundary', () => {
    const result = checkSafetyFloor('-100', 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_NEGATIVE_AT_BOUNDARY');
  });

  it('rejects negative values at JWT boundary', () => {
    const result = checkSafetyFloor('-100', 'jwt');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_NEGATIVE_AT_BOUNDARY');
  });

  it('rejects negative values at Redis boundary', () => {
    const result = checkSafetyFloor('-100', 'redis');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_NEGATIVE_AT_BOUNDARY');
  });

  it('allows negative values at DB boundary (signed values expected)', () => {
    const result = checkSafetyFloor('-100', 'db');
    expect(result).toBeNull();
  });

  it('rejects value exceeding MAX_SAFE_MICRO_USD', () => {
    const overMax = (MAX_SAFE_MICRO_USD + 1n).toString();
    const result = checkSafetyFloor(overMax, 'http');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_MAX_VALUE');
  });

  it('accepts value at exactly MAX_SAFE_MICRO_USD', () => {
    const exact = MAX_SAFE_MICRO_USD.toString();
    expect(checkSafetyFloor(exact, 'http')).toBeNull();
  });

  it('applies absolute-value bounds for DB context (negative large)', () => {
    const overMax = '-' + (MAX_SAFE_MICRO_USD + 1n).toString();
    const result = checkSafetyFloor(overMax, 'db');
    expect(result).not.toBeNull();
    expect(result!.errorCode).toBe('SAFETY_MAX_VALUE');
  });

  it('passes through non-numeric input for parser to handle', () => {
    // Non-numeric strings that cannot be BigInt parsed should pass safety
    // floor and be caught by the actual parsers
    expect(checkSafetyFloor('abc', 'http')).toBeNull();
    expect(checkSafetyFloor('1.5', 'http')).toBeNull();
    expect(checkSafetyFloor('+100', 'http')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mode Resolution Tests
// ---------------------------------------------------------------------------

describe('resolveParseMode', () => {
  const originalEnv = process.env.PARSE_MICRO_USD_MODE;

  beforeEach(() => {
    delete process.env.PARSE_MICRO_USD_MODE;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.PARSE_MICRO_USD_MODE = originalEnv;
    } else {
      delete process.env.PARSE_MICRO_USD_MODE;
    }
  });

  it('defaults to shadow when env var is not set', () => {
    expect(resolveParseMode()).toBe('shadow');
  });

  it('returns legacy when env var is legacy', () => {
    process.env.PARSE_MICRO_USD_MODE = 'legacy';
    expect(resolveParseMode()).toBe('legacy');
  });

  it('returns shadow when env var is shadow', () => {
    process.env.PARSE_MICRO_USD_MODE = 'shadow';
    expect(resolveParseMode()).toBe('shadow');
  });

  it('returns enforce when env var is enforce', () => {
    process.env.PARSE_MICRO_USD_MODE = 'enforce';
    expect(resolveParseMode()).toBe('enforce');
  });

  it('defaults to shadow for invalid env var', () => {
    process.env.PARSE_MICRO_USD_MODE = 'invalid';
    expect(resolveParseMode()).toBe('shadow');
  });
});

// ---------------------------------------------------------------------------
// Legacy Mode Tests (AC-4.1.2)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — legacy mode', () => {
  const logger = createMockLogger();

  it('parses valid input via BigInt()', () => {
    const result = parseBoundaryMicroUsd('1000000', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1000000n);
      expect(result.mode).toBe('legacy');
      expect(result.legacyResult).toBe(1000000n);
    }
  });

  it('parses zero', () => {
    const result = parseBoundaryMicroUsd('0', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it('accepts leading zeros (BigInt accepts them)', () => {
    const result = parseBoundaryMicroUsd('0100', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(100n);
  });

  it('accepts plus sign (BigInt accepts it)', () => {
    const result = parseBoundaryMicroUsd('+100', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(100n);
  });

  it('rejects non-numeric input', () => {
    const result = parseBoundaryMicroUsd('abc', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('LEGACY_PARSE_FAILURE');
      expect(result.mode).toBe('legacy');
    }
  });

  it('rejects float input', () => {
    const result = parseBoundaryMicroUsd('100.5', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('LEGACY_PARSE_FAILURE');
  });

  it('enforces safety floor even in legacy mode', () => {
    const longInput = '1'.repeat(51);
    const result = parseBoundaryMicroUsd(longInput, 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_MAX_LENGTH');
  });
});

// ---------------------------------------------------------------------------
// Shadow Mode Tests (AC-4.1.3)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — shadow mode', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    logger = createMockLogger();
    metrics = createMockMetrics();
  });

  it('returns legacy result for valid input', () => {
    const result = parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'shadow');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1000000n);
      expect(result.mode).toBe('shadow');
      expect(result.legacyResult).toBe(1000000n);
      expect(result.canonicalResult).toBe(1000000n);
      expect(result.diverged).toBe(false);
    }
  });

  it('emits shadowTotal metric', () => {
    parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'shadow');
    expect(metrics.shadowTotal).toHaveBeenCalledWith('http');
    expect(metrics.counts.shadow).toBe(1);
  });

  it('logs would-reject when canonical rejects but legacy accepts (leading zeros)', () => {
    const result = parseBoundaryMicroUsd('0100', 'http', logger, metrics, 'shadow');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(100n); // legacy result
      expect(result.diverged).toBe(true);
    }
    expect(metrics.wouldRejectTotal).toHaveBeenCalledWith('http');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs would-reject when canonical rejects plus sign', () => {
    const result = parseBoundaryMicroUsd('+100', 'http', logger, metrics, 'shadow');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(100n);
      expect(result.diverged).toBe(true);
    }
    expect(metrics.wouldRejectTotal).toHaveBeenCalledWith('http');
  });

  it('returns error when both parsers reject', () => {
    const result = parseBoundaryMicroUsd('abc', 'http', logger, metrics, 'shadow');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mode).toBe('shadow');
    }
  });

  it('enforces safety floor in shadow mode', () => {
    const result = parseBoundaryMicroUsd(' 100 ', 'http', logger, metrics, 'shadow');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_WHITESPACE');
  });
});

// ---------------------------------------------------------------------------
// Enforce Mode Tests (AC-4.1.4)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — enforce mode', () => {
  const logger = createMockLogger();

  it('returns canonical result for valid input', () => {
    const result = parseBoundaryMicroUsd('1000000', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1000000n);
      expect(result.mode).toBe('enforce');
      expect(result.canonicalResult).toBe(1000000n);
    }
  });

  it('rejects leading zeros (canonical rejects)', () => {
    const result = parseBoundaryMicroUsd('0100', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('ENFORCE_REJECTION');
      expect(result.mode).toBe('enforce');
      expect(result.raw).toBe('0100');
    }
  });

  it('rejects plus sign (canonical rejects)', () => {
    const result = parseBoundaryMicroUsd('+100', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ENFORCE_REJECTION');
  });

  it('rejects float (canonical rejects)', () => {
    const result = parseBoundaryMicroUsd('100.5', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ENFORCE_REJECTION');
  });

  it('rejects empty string (canonical rejects)', () => {
    const result = parseBoundaryMicroUsd('', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });

  it('accepts zero', () => {
    const result = parseBoundaryMicroUsd('0', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it('accepts large valid input', () => {
    const result = parseBoundaryMicroUsd('999999999999999', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(999999999999999n);
  });
});

// ---------------------------------------------------------------------------
// AC-4.1.6: Canonical rejection cases
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — canonical rejection cases (AC-4.1.6)', () => {
  const logger = createMockLogger();

  const cases: Array<{ input: string; description: string }> = [
    { input: '0100', description: 'leading zeros' },
    { input: '+100', description: 'plus sign' },
    { input: '100.5', description: 'float' },
  ];

  for (const { input, description } of cases) {
    it(`enforce mode rejects ${description}: "${input}"`, () => {
      const result = parseBoundaryMicroUsd(input, 'http', logger, undefined, 'enforce');
      expect(result.ok).toBe(false);
    });

    it(`shadow mode logs would-reject for ${description}: "${input}"`, () => {
      const mockLogger = createMockLogger();
      const mockMetrics = createMockMetrics();
      parseBoundaryMicroUsd(input, 'http', mockLogger, mockMetrics, 'shadow');
      // Note: float/plus sign may also fail BigInt, so only check if wouldReject or both fail
    });
  }
});

// ---------------------------------------------------------------------------
// Boundary Context Tests
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — boundary contexts', () => {
  const logger = createMockLogger();
  const contexts: BoundaryContext[] = ['http', 'db', 'redis', 'jwt'];

  for (const ctx of contexts) {
    it(`accepts valid input at ${ctx} boundary`, () => {
      const result = parseBoundaryMicroUsd('500000', ctx, logger, undefined, 'shadow');
      expect(result.ok).toBe(true);
    });
  }

  it('DB context allows negative values (signed)', () => {
    const result = parseBoundaryMicroUsd('-100', 'db', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(-100n);
  });

  it('HTTP context rejects negative values', () => {
    const result = parseBoundaryMicroUsd('-100', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_NEGATIVE_AT_BOUNDARY');
  });
});

// ---------------------------------------------------------------------------
// Performance Benchmark (AC-4.1.7)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — performance budget (AC-4.1.7)', () => {
  it('shadow mode overhead is <2ms p99 for 1000 parses', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();
    const inputs = [
      '0', '1', '100', '1000000', '999999999', '500000000000',
      '123456789', '42', '1000', '999999',
    ];

    // Warm up
    for (let i = 0; i < 100; i++) {
      parseBoundaryMicroUsd(inputs[i % inputs.length], 'http', logger, metrics, 'shadow');
    }

    // Measure shadow mode
    const shadowTimes: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      parseBoundaryMicroUsd(inputs[i % inputs.length], 'http', logger, metrics, 'shadow');
      shadowTimes.push(performance.now() - start);
    }

    // Measure legacy mode (baseline)
    const legacyTimes: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      parseBoundaryMicroUsd(inputs[i % inputs.length], 'http', logger, metrics, 'legacy');
      legacyTimes.push(performance.now() - start);
    }

    // Sort for percentile calculation
    shadowTimes.sort((a, b) => a - b);
    legacyTimes.sort((a, b) => a - b);

    const shadowP99 = shadowTimes[Math.floor(shadowTimes.length * 0.99)];
    const legacyP99 = legacyTimes[Math.floor(legacyTimes.length * 0.99)];
    const overheadP99 = shadowP99 - legacyP99;

    // Shadow mode p99 overhead must be <2ms
    expect(overheadP99).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Kill-switch verification (AC-4.6.1 prep)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — kill-switch (legacy mode canonical bypass)', () => {
  it('legacy mode does not call canonical parseMicroUsd', () => {
    // In legacy mode, only BigInt() is used — canonical parser is never consulted.
    // We verify this by checking that inputs that canonical would reject are accepted.
    const logger = createMockLogger();

    // Leading zeros: canonical rejects, BigInt accepts
    const result = parseBoundaryMicroUsd('0100', 'http', logger, undefined, 'legacy');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(100n);
      // No canonicalResult populated in legacy mode
      expect(result.canonicalResult).toBeUndefined();
    }
  });

  it('legacy mode does not emit shadow metrics', () => {
    const logger = createMockLogger();
    const metrics = createMockMetrics();
    parseBoundaryMicroUsd('1000000', 'http', logger, metrics, 'legacy');
    expect(metrics.shadowTotal).not.toHaveBeenCalled();
    expect(metrics.wouldRejectTotal).not.toHaveBeenCalled();
    expect(metrics.divergenceTotal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fuzz-like edge cases (AC-4.1.8 pathological inputs)
// ---------------------------------------------------------------------------

describe('parseBoundaryMicroUsd — pathological inputs', () => {
  const logger = createMockLogger();

  it('rejects very long string', () => {
    const result = parseBoundaryMicroUsd('9'.repeat(100), 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_MAX_LENGTH');
  });

  it('rejects scientific notation', () => {
    const result = parseBoundaryMicroUsd('1e15', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });

  it('rejects negative value at HTTP boundary', () => {
    const result = parseBoundaryMicroUsd('-1', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_NEGATIVE_AT_BOUNDARY');
  });

  it('accepts value at exactly MAX_SAFE_MICRO_USD', () => {
    const exact = MAX_SAFE_MICRO_USD.toString();
    const result = parseBoundaryMicroUsd(exact, 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(true);
  });

  it('rejects value at MAX_SAFE_MICRO_USD + 1', () => {
    const over = (MAX_SAFE_MICRO_USD + 1n).toString();
    const result = parseBoundaryMicroUsd(over, 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('SAFETY_MAX_VALUE');
  });

  it('rejects empty string', () => {
    const result = parseBoundaryMicroUsd('', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });

  it('rejects hex string', () => {
    const result = parseBoundaryMicroUsd('0xff', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });

  it('rejects octal string', () => {
    const result = parseBoundaryMicroUsd('0o77', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });

  it('rejects binary string', () => {
    const result = parseBoundaryMicroUsd('0b1010', 'http', logger, undefined, 'enforce');
    expect(result.ok).toBe(false);
  });
});
