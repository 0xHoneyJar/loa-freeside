/**
 * Mode-Aware Micro-USD Schema Tests
 *
 * Tests for createMicroUsdSchema() gateway validation per SDD §5.2.
 *
 * Coverage:
 *   - AC-3.1: Shared Zod schema with two modes
 *   - AC-3.2: Mode driven by resolveParseMode()
 *   - AC-3.6: Canonical + legacy test matrices
 *   - FR-3/FR-4 coordination: schema mode matches resolveParseMode()
 *
 * @see grimoires/loa/sdd.md §5.2
 * @see grimoires/loa/sprint.md Sprint 2, Tasks 2.1 + 2.3
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createMicroUsdSchema,
  buildMicroUsdError,
  CANONICAL_MICRO_USD_PATTERN,
} from '../../src/packages/core/protocol/micro-usd-schema.js';
import {
  MAX_SAFE_MICRO_USD,
  MAX_INPUT_LENGTH,
} from '../../src/packages/core/protocol/parse-boundary-micro-usd.js';

// ---------------------------------------------------------------------------
// Canonical/Enforce Mode (SDD §5.2)
// ---------------------------------------------------------------------------

describe('createMicroUsdSchema — canonical/enforce mode', () => {
  const schema = createMicroUsdSchema('enforce');

  it('accepts "100" — valid non-negative integer', () => {
    expect(schema.safeParse('100').success).toBe(true);
  });

  it('accepts "0" — zero is valid', () => {
    expect(schema.safeParse('0').success).toBe(true);
  });

  it('accepts MAX_SAFE_MICRO_USD exactly', () => {
    expect(schema.safeParse(String(MAX_SAFE_MICRO_USD)).success).toBe(true);
  });

  it('rejects MAX_SAFE_MICRO_USD + 1', () => {
    const result = schema.safeParse(String(MAX_SAFE_MICRO_USD + 1n));
    expect(result.success).toBe(false);
  });

  it('rejects "0100" — leading zeros', () => {
    expect(schema.safeParse('0100').success).toBe(false);
  });

  it('rejects " 100" — leading whitespace', () => {
    expect(schema.safeParse(' 100').success).toBe(false);
  });

  it('rejects "+100" — plus sign', () => {
    expect(schema.safeParse('+100').success).toBe(false);
  });

  it('rejects "-100" — negative', () => {
    expect(schema.safeParse('-100').success).toBe(false);
  });

  it('rejects "100.5" — decimal point', () => {
    expect(schema.safeParse('100.5').success).toBe(false);
  });

  it('rejects "" — empty string', () => {
    expect(schema.safeParse('').success).toBe(false);
  });

  it('rejects "abc" — non-numeric', () => {
    expect(schema.safeParse('abc').success).toBe(false);
  });

  it('rejects input exceeding MAX_INPUT_LENGTH', () => {
    const oversized = '1'.repeat(MAX_INPUT_LENGTH + 1);
    expect(schema.safeParse(oversized).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy/Shadow Mode (SDD §5.2)
// ---------------------------------------------------------------------------

describe('createMicroUsdSchema — legacy/shadow mode', () => {
  const schema = createMicroUsdSchema('legacy');

  it('accepts "100" — standard integer', () => {
    expect(schema.safeParse('100').success).toBe(true);
  });

  it('accepts "0100" — BigInt accepts leading zeros', () => {
    expect(schema.safeParse('0100').success).toBe(true);
  });

  it('accepts " 100" — BigInt trims whitespace', () => {
    expect(schema.safeParse(' 100').success).toBe(true);
  });

  it('accepts "+100" — BigInt accepts plus sign', () => {
    expect(schema.safeParse('+100').success).toBe(true);
  });

  it('accepts "-100" — BigInt accepts negative', () => {
    expect(schema.safeParse('-100').success).toBe(true);
  });

  it('rejects "100.5" — BigInt throws on decimal', () => {
    expect(schema.safeParse('100.5').success).toBe(false);
  });

  it('rejects "" — empty string', () => {
    expect(schema.safeParse('').success).toBe(false);
  });

  it('rejects "abc" — non-numeric', () => {
    expect(schema.safeParse('abc').success).toBe(false);
  });

  it('rejects input exceeding MAX_INPUT_LENGTH', () => {
    const oversized = '1'.repeat(MAX_INPUT_LENGTH + 1);
    expect(schema.safeParse(oversized).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mode Synchronization (AC-3.2)
// ---------------------------------------------------------------------------

describe('createMicroUsdSchema — mode synchronization', () => {
  const originalEnv = process.env.PARSE_MICRO_USD_MODE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PARSE_MICRO_USD_MODE = originalEnv;
    } else {
      delete process.env.PARSE_MICRO_USD_MODE;
    }
  });

  it('schema mode matches resolveParseMode() when no explicit mode given', () => {
    // Default mode is legacy when env var is not set
    const schema = createMicroUsdSchema();
    // Leading zeros accepted = legacy mode
    expect(schema.safeParse('0100').success).toBe(true);
  });

  it('explicit mode override works', () => {
    const legacySchema = createMicroUsdSchema('legacy');
    const enforceSchema = createMicroUsdSchema('enforce');

    // Legacy accepts leading zeros, enforce rejects
    expect(legacySchema.safeParse('0100').success).toBe(true);
    expect(enforceSchema.safeParse('0100').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CANONICAL_MICRO_USD_PATTERN regex
// ---------------------------------------------------------------------------

describe('CANONICAL_MICRO_USD_PATTERN', () => {
  it('matches bare "0"', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('0')).toBe(true);
  });

  it('matches "1234567890"', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('1234567890')).toBe(true);
  });

  it('does not match "0100" (leading zeros)', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('0100')).toBe(false);
  });

  it('does not match "+100"', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('+100')).toBe(false);
  });

  it('does not match "-100"', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('-100')).toBe(false);
  });

  it('does not match "100.5"', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('100.5')).toBe(false);
  });

  it('does not match empty string', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test('')).toBe(false);
  });

  it('does not match " 100" (whitespace)', () => {
    expect(CANONICAL_MICRO_USD_PATTERN.test(' 100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildMicroUsdError helper
// ---------------------------------------------------------------------------

describe('buildMicroUsdError', () => {
  it('returns structured error with correct fields', () => {
    const err = buildMicroUsdError('amountMicro', 'test message', 'legacy');
    expect(err).toEqual({
      error: 'INVALID_MICRO_USD',
      message: 'test message',
      field: 'amountMicro',
      mode: 'legacy',
    });
  });

  it('works with enforce mode', () => {
    const err = buildMicroUsdError('actualCostMicro', 'too large', 'enforce');
    expect(err.mode).toBe('enforce');
    expect(err.field).toBe('actualCostMicro');
  });
});
