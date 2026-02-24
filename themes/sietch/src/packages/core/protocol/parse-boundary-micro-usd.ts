/**
 * parseBoundaryMicroUsd — Dual-parse wrapper for protocol boundary hardening
 *
 * Implements the 3-stage rollout for parseMicroUsd adoption at protocol
 * boundary entry points (HTTP, DB, Redis, JWT).
 *
 * Stages:
 *   0: legacy  — BigInt() only (kill-switch)
 *   1: shadow  — Both parsers run, legacy result returned, divergences logged (default)
 *   2: enforce — Canonical result drives decisions, structured error on rejection
 *
 * Environment: PARSE_MICRO_USD_MODE=legacy|shadow|enforce (default: shadow)
 *
 * Safety floor (all modes): Rejects inputs exceeding safety bounds:
 *   - Max length: 50 characters
 *   - Max value: MAX_SAFE_MICRO_USD (1e15 micro-USD = $1B)
 *   - Non-ASCII characters
 *   - Context-aware: HTTP/JWT boundary inputs must be non-negative (>= 0)
 *   - ASCII whitespace rejected (not trimmed)
 *
 * @see grimoires/loa/sdd.md §3.6
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.1
 */

import { parseMicroUsd } from '@0xhoneyjar/loa-hounfour';
import type { ParseMicroUsdResult } from '@0xhoneyjar/loa-hounfour';

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum safe micro-USD value: $1B = 1e15 micro-USD.
 * Derived from max budget * max duration. Confirmed to exceed
 * observed p100 production values.
 */
export const MAX_SAFE_MICRO_USD = 1_000_000_000_000_000n; // $1B

/** Maximum input string length to prevent pathological parsing */
export const MAX_INPUT_LENGTH = 50;

/** Regex for non-ASCII characters */
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

/** Regex for ASCII whitespace */
const ASCII_WHITESPACE_REGEX = /[\t\n\r\f\v ]/;

// =============================================================================
// Types
// =============================================================================

/** Parse mode controlled by PARSE_MICRO_USD_MODE environment variable */
export type ParseMode = 'legacy' | 'shadow' | 'enforce';

/** Boundary context where parsing occurs */
export type BoundaryContext = 'http' | 'db' | 'redis' | 'jwt';

/**
 * Discriminated union result from parseBoundaryMicroUsd.
 *
 * In shadow mode, legacyResult is always populated and canonicalResult
 * is populated when the canonical parser ran. `diverged` indicates
 * whether the two parsers disagree.
 */
export type BoundaryParseResult =
  | {
      ok: true;
      value: bigint;
      mode: ParseMode;
      legacyResult: bigint;
      canonicalResult?: bigint;
      diverged?: boolean;
    }
  | {
      ok: false;
      reason: string;
      raw: string;
      mode: ParseMode;
      errorCode: BoundaryErrorCode;
    };

/** Structured error codes for boundary parse failures */
export type BoundaryErrorCode =
  | 'SAFETY_MAX_LENGTH'
  | 'SAFETY_MAX_VALUE'
  | 'SAFETY_NON_ASCII'
  | 'SAFETY_WHITESPACE'
  | 'SAFETY_NEGATIVE_AT_BOUNDARY'
  | 'LEGACY_PARSE_FAILURE'
  | 'CANONICAL_REJECTION'
  | 'ENFORCE_REJECTION';

/**
 * Logger interface for boundary parse operations.
 * Matches the standard pino-compatible logger shape.
 */
export interface BoundaryLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Metrics callback for shadow-mode instrumentation.
 * Called by parseBoundaryMicroUsd to emit counters.
 */
export interface BoundaryMetrics {
  shadowTotal(context: BoundaryContext): void;
  wouldRejectTotal(context: BoundaryContext): void;
  divergenceTotal(context: BoundaryContext): void;
}

/** No-op metrics implementation for when metrics are not configured */
const NO_OP_METRICS: BoundaryMetrics = {
  shadowTotal: () => {},
  wouldRejectTotal: () => {},
  divergenceTotal: () => {},
};

// =============================================================================
// Mode Resolution
// =============================================================================

/**
 * Resolve the parse mode from environment variable.
 * Default is 'shadow' if not set or invalid.
 */
export function resolveParseMode(): ParseMode {
  const env = process.env.PARSE_MICRO_USD_MODE;
  if (env === 'legacy' || env === 'shadow' || env === 'enforce') {
    return env;
  }
  return 'shadow';
}

// =============================================================================
// Safety Floor
// =============================================================================

/**
 * Safety floor check — runs in ALL modes (including shadow).
 * Returns an error code if the input violates safety bounds, or null if safe.
 *
 * @param raw - Raw input string
 * @param context - Boundary context (http/jwt enforce non-negative; db may see signed)
 */
export function checkSafetyFloor(
  raw: string,
  context: BoundaryContext,
): { errorCode: BoundaryErrorCode; reason: string } | null {
  // 1. Max length check
  if (raw.length > MAX_INPUT_LENGTH) {
    return {
      errorCode: 'SAFETY_MAX_LENGTH',
      reason: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters (got ${raw.length})`,
    };
  }

  // 2. Non-ASCII check
  if (NON_ASCII_REGEX.test(raw)) {
    return {
      errorCode: 'SAFETY_NON_ASCII',
      reason: 'Input contains non-ASCII characters',
    };
  }

  // 3. ASCII whitespace check — reject, don't trim
  if (ASCII_WHITESPACE_REGEX.test(raw)) {
    return {
      errorCode: 'SAFETY_WHITESPACE',
      reason: 'Input contains ASCII whitespace (not trimmed — surface upstream data quality)',
    };
  }

  // 4. Try to parse as BigInt for value-based checks
  //    This is a pre-check — the actual parsing is done by the mode-specific logic
  let numericValue: bigint | null = null;
  try {
    numericValue = BigInt(raw);
  } catch {
    // Not a valid BigInt — will be caught by the parser
    return null;
  }

  // 5. Context-aware negativity check
  //    All non-DB boundaries must be non-negative (>= 0 enforced explicitly)
  //    DB context may encounter signed values — applies absolute-value bounds
  if (context !== 'db') {
    if (numericValue < 0n) {
      return {
        errorCode: 'SAFETY_NEGATIVE_AT_BOUNDARY',
        reason: `Negative value at ${context} boundary (value: ${raw})`,
      };
    }
  }

  // 6. Max value check (absolute value for DB context)
  const absValue = numericValue < 0n ? -numericValue : numericValue;
  if (absValue > MAX_SAFE_MICRO_USD) {
    return {
      errorCode: 'SAFETY_MAX_VALUE',
      reason: `Value exceeds MAX_SAFE_MICRO_USD (${MAX_SAFE_MICRO_USD}): ${raw}`,
    };
  }

  return null;
}

// =============================================================================
// Core Parser
// =============================================================================

/**
 * Parse a micro-USD string at a protocol boundary with 3-stage rollout.
 *
 * @param raw - Raw input string from external source
 * @param context - Boundary context (http, db, redis, jwt)
 * @param logger - Logger for divergence/rejection warnings
 * @param metrics - Optional metrics callback for shadow-mode counters
 * @param modeOverride - Override mode (for testing; defaults to env var)
 * @returns BoundaryParseResult discriminated union
 */
export function parseBoundaryMicroUsd(
  raw: string,
  context: BoundaryContext,
  logger: BoundaryLogger,
  metrics: BoundaryMetrics = NO_OP_METRICS,
  modeOverride?: ParseMode,
): BoundaryParseResult {
  const mode = modeOverride ?? resolveParseMode();

  // ── Safety floor — enforced in ALL modes ──────────────────────────────
  const safetyCheck = checkSafetyFloor(raw, context);
  if (safetyCheck) {
    logger.warn(
      { raw: raw.slice(0, 100), context, errorCode: safetyCheck.errorCode },
      `parseBoundaryMicroUsd safety floor rejection: ${safetyCheck.reason}`,
    );
    return {
      ok: false,
      reason: safetyCheck.reason,
      raw,
      mode,
      errorCode: safetyCheck.errorCode,
    };
  }

  // ── Stage 0: Legacy (kill-switch) ─────────────────────────────────────
  if (mode === 'legacy') {
    try {
      const value = BigInt(raw);
      return {
        ok: true,
        value,
        mode: 'legacy',
        legacyResult: value,
      };
    } catch {
      return {
        ok: false,
        reason: 'BigInt parse failure',
        raw,
        mode: 'legacy',
        errorCode: 'LEGACY_PARSE_FAILURE',
      };
    }
  }

  // ── Parse with both parsers ───────────────────────────────────────────
  const canonical: ParseMicroUsdResult = parseMicroUsd(raw);

  let legacyValue: bigint | null = null;
  try {
    legacyValue = BigInt(raw);
  } catch {
    // Legacy parser also rejected
  }

  // ── Stage 1: Shadow ───────────────────────────────────────────────────
  if (mode === 'shadow') {
    metrics.shadowTotal(context);

    // Log divergence: both accepted but different values
    if (canonical.valid && legacyValue !== null && canonical.amount !== legacyValue) {
      metrics.divergenceTotal(context);
      logger.warn(
        {
          raw,
          context,
          canonical: canonical.amount.toString(),
          legacy: legacyValue.toString(),
        },
        'parseMicroUsd divergence: canonical and legacy produced different values',
      );
    }

    // Log would-reject: canonical rejected but legacy accepted
    if (!canonical.valid && legacyValue !== null) {
      metrics.wouldRejectTotal(context);
      logger.warn(
        { raw, context, reason: canonical.reason, legacy: legacyValue.toString() },
        'parseMicroUsd would-reject: canonical rejects input that legacy accepts',
      );
    }

    // Return legacy result in shadow mode
    if (legacyValue !== null) {
      return {
        ok: true,
        value: legacyValue,
        mode: 'shadow',
        legacyResult: legacyValue,
        canonicalResult: canonical.valid ? canonical.amount : undefined,
        diverged: canonical.valid
          ? canonical.amount !== legacyValue
          : true, // canonical rejected = diverged
      };
    }

    // Both parsers rejected
    const errorCode: BoundaryErrorCode = canonical.valid
      ? 'LEGACY_PARSE_FAILURE'
      : 'CANONICAL_REJECTION';

    return {
      ok: false,
      reason: canonical.valid ? 'BigInt parse failure' : canonical.reason,
      raw,
      mode: 'shadow',
      errorCode,
    };
  }

  // ── Stage 2: Enforce ──────────────────────────────────────────────────
  if (canonical.valid) {
    return {
      ok: true,
      value: canonical.amount,
      mode: 'enforce',
      legacyResult: legacyValue ?? canonical.amount,
      canonicalResult: canonical.amount,
      diverged: legacyValue !== null ? canonical.amount !== legacyValue : false,
    };
  }

  // Canonical rejected — return structured error
  return {
    ok: false,
    reason: canonical.reason,
    raw,
    mode: 'enforce',
    errorCode: 'ENFORCE_REJECTION',
  };
}
