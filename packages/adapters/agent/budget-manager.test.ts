/**
 * parseReaperResult Tests
 *
 * Pins the real invariants of the budget-reaper result parser. This function
 * decodes the raw reply of `lua/budget-reaper.lua`, which returns one of:
 *   - {'REAPED', tostring(count), tostring(totalReclaimed)}  (success / empty)
 *   - {'INVALID_INPUT', '0', '0'}                            (bad args)
 * ioredis surfaces these Lua tables as a 0-indexed JS string[]:
 *   index 0 = status, index 1 = reaped count, index 2 = totalReclaimed (cents).
 *
 * Money-safety invariants under test (via the internal safeInt):
 *   - count / totalReclaimed can NEVER be negative (clamped to 0)
 *   - NaN / Infinity / non-numeric junk decodes to 0 (fail-safe)
 *   - fractional values truncate toward zero to integers
 *   - status is ALWAYS coerced to 'REAPED' (index 0 is not read)
 */

import { describe, it, expect } from 'vitest';
import { parseReaperResult, parseFinalizeResult } from './budget-manager.js';

describe('parseReaperResult', () => {
  it('decodes a normal success reply: count=index 1, totalReclaimed=index 2', () => {
    expect(parseReaperResult(['REAPED', '3', '150'])).toEqual({
      status: 'REAPED',
      count: 3,
      totalReclaimed: 150,
    });
  });

  it('decodes the "nothing reaped" reply', () => {
    expect(parseReaperResult(['REAPED', '0', '0'])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('always coerces status to REAPED — even when Lua returned INVALID_INPUT', () => {
    // The parser hardcodes status and never reads index 0, so a Lua-side
    // INVALID_INPUT reply is reported as REAPED with the (zero) payload.
    expect(parseReaperResult(['INVALID_INPUT', '0', '0'])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('reads count from index 1, not index 0', () => {
    // index 0 is ignored entirely; count must come from index 1.
    expect(parseReaperResult(['999', '7', '88'])).toEqual({
      status: 'REAPED',
      count: 7,
      totalReclaimed: 88,
    });
  });

  it('defaults missing indices to 0 (short array)', () => {
    expect(parseReaperResult(['REAPED'] as string[])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('defaults to all-zero on an empty array', () => {
    expect(parseReaperResult([] as string[])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('clamps negative values to 0 (reclaimed budget can never be negative)', () => {
    expect(parseReaperResult(['REAPED', '-5', '-100'])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('truncates fractional values toward zero to integers', () => {
    expect(parseReaperResult(['REAPED', '3.9', '150.7'])).toEqual({
      status: 'REAPED',
      count: 3,
      totalReclaimed: 150,
    });
  });

  it('decodes non-numeric / NaN junk to 0 (fail-safe)', () => {
    expect(parseReaperResult(['REAPED', 'abc', 'NaN'])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 0,
    });
  });

  it('rejects Infinity to 0 while preserving a valid sibling field', () => {
    expect(parseReaperResult(['REAPED', 'Infinity', '5'])).toEqual({
      status: 'REAPED',
      count: 0,
      totalReclaimed: 5,
    });
  });

  it('passes realistic large counts through unchanged', () => {
    expect(parseReaperResult(['REAPED', '42', '99999'])).toEqual({
      status: 'REAPED',
      count: 42,
      totalReclaimed: 99999,
    });
  });
});

/**
 * parseFinalizeResult Tests
 *
 * Pins the real invariants of the finalize() reply parser — the thin layer that
 * turns the budget-finalize.lua reply array `{status, actualCost}` into a typed
 * FinalizeResult. This sits on the money path (actualCost is committed cents), so
 * its fail-safe / clamping behavior is the load-bearing property under test.
 *
 * Lua contract (lua/budget-finalize.lua) returns one of:
 *   {'INVALID_INPUT','0'} | {'ALREADY_FINALIZED','0'}
 *   {'FINALIZED', tostring(actualCost)} | {'LATE_FINALIZE', tostring(actualCost)}
 */
describe('parseFinalizeResult', () => {
  describe('status mapping (each Lua reply passes through verbatim)', () => {
    it('FINALIZED with cost', () => {
      expect(parseFinalizeResult(['FINALIZED', '100'])).toEqual({
        status: 'FINALIZED',
        actualCost: 100,
      });
    });

    it('LATE_FINALIZE with cost', () => {
      expect(parseFinalizeResult(['LATE_FINALIZE', '50'])).toEqual({
        status: 'LATE_FINALIZE',
        actualCost: 50,
      });
    });

    it('ALREADY_FINALIZED with zero cost', () => {
      expect(parseFinalizeResult(['ALREADY_FINALIZED', '0'])).toEqual({
        status: 'ALREADY_FINALIZED',
        actualCost: 0,
      });
    });

    it('INVALID_INPUT with zero cost', () => {
      expect(parseFinalizeResult(['INVALID_INPUT', '0'])).toEqual({
        status: 'INVALID_INPUT',
        actualCost: 0,
      });
    });
  });

  describe('defaulting / robustness (caller casts `result as string[]`)', () => {
    it('missing status defaults to INVALID_INPUT', () => {
      expect(parseFinalizeResult([])).toEqual({
        status: 'INVALID_INPUT',
        actualCost: 0,
      });
    });

    it('status-only array yields cost 0', () => {
      expect(parseFinalizeResult(['FINALIZED'])).toEqual({
        status: 'FINALIZED',
        actualCost: 0,
      });
    });

    it('null raw does not throw (Redis may yield null)', () => {
      expect(parseFinalizeResult(null as unknown as string[])).toEqual({
        status: 'INVALID_INPUT',
        actualCost: 0,
      });
    });

    it('undefined raw does not throw', () => {
      expect(parseFinalizeResult(undefined as unknown as string[])).toEqual({
        status: 'INVALID_INPUT',
        actualCost: 0,
      });
    });
  });

  describe('actualCost money invariants (always a non-negative integer)', () => {
    it('clamps a negative cost to 0 — never a negative/refund', () => {
      expect(parseFinalizeResult(['FINALIZED', '-500']).actualCost).toBe(0);
      expect(parseFinalizeResult(['LATE_FINALIZE', '-1']).actualCost).toBe(0);
    });

    it('truncates fractional cents toward zero (does not round)', () => {
      expect(parseFinalizeResult(['FINALIZED', '50.9']).actualCost).toBe(50);
      expect(parseFinalizeResult(['FINALIZED', '0.99']).actualCost).toBe(0);
    });

    it('fails safe to 0 on non-numeric / non-finite cost (never NaN/Infinity)', () => {
      expect(parseFinalizeResult(['FINALIZED', 'abc']).actualCost).toBe(0);
      expect(parseFinalizeResult(['FINALIZED', 'Infinity']).actualCost).toBe(0);
      expect(parseFinalizeResult(['FINALIZED', '']).actualCost).toBe(0);
    });

    it('accepts a numeric cost (ioredis can coerce the reply to a JS number)', () => {
      expect(parseFinalizeResult(['FINALIZED', 250 as unknown as string])).toEqual({
        status: 'FINALIZED',
        actualCost: 250,
      });
    });
  });

  describe('status is not re-validated client-side (validation lives in Lua)', () => {
    // Guards the nullish-coalescing (`??`) default: only null/undefined fall back to
    // INVALID_INPUT. An empty-string status must survive verbatim — swapping `??` for
    // a falsy `||` would silently rewrite it to INVALID_INPUT.
    it('passes an empty-string status through unchanged', () => {
      expect(parseFinalizeResult(['' as never, '7'])).toEqual({
        status: '',
        actualCost: 7,
      });
    });

    it('passes an unknown status string through unchanged', () => {
      expect(parseFinalizeResult(['WEIRD' as never, '7'])).toEqual({
        status: 'WEIRD',
        actualCost: 7,
      });
    });
  });
});