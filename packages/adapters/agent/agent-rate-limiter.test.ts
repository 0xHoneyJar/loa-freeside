/**
 * parseRateLimitResult Tests
 *
 * Pins the REAL invariants of the Lua-response parser for the agent rate
 * limiter. This is a fail-closed security boundary: only the exact string
 * 'ok' from the Lua script may produce allowed=true. Every other shape —
 * a known-but-exceeded dimension, a malformed/unknown dimension, an empty
 * response — MUST deny.
 *
 * Lua returns: [dimension, remaining, limit, retryAfterMs, resetAtMs]
 */

import { describe, it, expect } from 'vitest';
import { parseRateLimitResult } from './agent-rate-limiter.js';

describe('parseRateLimitResult', () => {
  describe('allow path (dimension === "ok")', () => {
    it('returns allowed with dimension null and fields parsed from raw', () => {
      const r = parseRateLimitResult(['ok', '42', '60', '999', '1700000000000']);
      expect(r).toEqual({
        allowed: true,
        dimension: null,
        remaining: 42,
        limit: 60,
        // retryAfterMs is FORCED to 0 on the allow path, ignoring raw[3]='999'
        retryAfterMs: 0,
        resetAtMs: 1700000000000,
      });
    });

    it('forces retryAfterMs to 0 even when the Lua response carries a non-zero value', () => {
      const r = parseRateLimitResult(['ok', '1', '2', '99999', '5']);
      expect(r.allowed).toBe(true);
      expect(r.retryAfterMs).toBe(0);
    });

    it('coerces non-numeric numeric fields to 0', () => {
      const r = parseRateLimitResult(['ok', 'abc', '', 'foo', 'bar']);
      expect(r).toEqual({
        allowed: true,
        dimension: null,
        remaining: 0,
        limit: 0,
        retryAfterMs: 0,
        resetAtMs: 0,
      });
    });
  });

  describe('deny path (known dimension exceeded)', () => {
    it('preserves the failed dimension and reads retryAfterMs from raw', () => {
      const r = parseRateLimitResult(['user', '0', '10', '3000', '1700000060000']);
      expect(r).toEqual({
        allowed: false,
        dimension: 'user',
        remaining: 0,
        limit: 10,
        retryAfterMs: 3000,
        resetAtMs: 1700000060000,
      });
    });

    it.each(['community', 'user', 'channel', 'burst'] as const)(
      'denies and preserves dimension "%s"',
      (dim) => {
        const r = parseRateLimitResult([dim, '1', '2', '3', '4']);
        expect(r.allowed).toBe(false);
        expect(r.dimension).toBe(dim);
      },
    );
  });

  describe('safeInt normalization', () => {
    it('clamps negatives to 0 and truncates fractional values', () => {
      const r = parseRateLimitResult([
        'channel',
        '-5',
        '20.9',
        '1500.7',
        '1700000000123.4',
      ]);
      expect(r).toEqual({
        allowed: false,
        dimension: 'channel',
        remaining: 0, // max(0, -5)
        limit: 20, // trunc(20.9)
        retryAfterMs: 1500, // trunc(1500.7)
        resetAtMs: 1700000000123, // trunc(...123.4)
      });
    });
  });

  describe('fail-closed on malformed input (security-critical)', () => {
    it('denies an unknown dimension and signals a 5s retry', () => {
      const before = Date.now();
      const r = parseRateLimitResult(['bogus', '5', '5', '5', '5']);
      const after = Date.now();
      expect(r.allowed).toBe(false);
      expect(r.dimension).toBe(null);
      expect(r.remaining).toBe(0);
      expect(r.limit).toBe(0);
      expect(r.retryAfterMs).toBe(5000);
      expect(r.resetAtMs).toBeGreaterThanOrEqual(before + 5000);
      expect(r.resetAtMs).toBeLessThanOrEqual(after + 5000);
    });

    it('is case-sensitive: "OK" is NOT "ok" and must deny (no allow leak)', () => {
      const r = parseRateLimitResult(['OK', '9', '9', '9', '9']);
      expect(r.allowed).toBe(false);
      expect(r.dimension).toBe(null);
    });

    it('denies an empty response array', () => {
      const r = parseRateLimitResult([]);
      expect(r.allowed).toBe(false);
      expect(r.dimension).toBe(null);
      expect(r.retryAfterMs).toBe(5000);
    });

    it('never produces allowed=true for any non-"ok" first element', () => {
      for (const head of ['', ' ok', 'ok ', 'OK', 'allowed', 'true', 'community', 'user']) {
        expect(parseRateLimitResult([head, '1', '1', '1', '1']).allowed).toBe(false);
      }
    });
  });
});