/**
 * Mode-aware Zod micro-USD validation schema for API gateway inputs.
 *
 * Two modes synchronized with PARSE_MICRO_USD_MODE:
 *   - legacy/shadow: Permissive — accepts what BigInt() accepts (no production breakage)
 *   - enforce/canonical: Strict — matches parseMicroUsd acceptance (non-negative integer
 *     string, no leading zeros except "0", max 18 digits)
 *
 * The gateway schema is always equal-or-tighter than parseBoundaryMicroUsd in the
 * corresponding mode. It must never accept a string that the boundary parser would reject.
 *
 * Part of the Commons Protocol — community-governed economic protocol for AI inference.
 *
 * @see PRD cycle-040 FR-3, AC-3.1–AC-3.6
 * @see SDD cycle-040 §3.3
 */

import { z } from 'zod';
import {
  resolveParseMode,
  MAX_SAFE_MICRO_USD,
  MAX_INPUT_LENGTH,
} from './parse-boundary-micro-usd.js';
import type { ParseMode } from './parse-boundary-micro-usd.js';

/**
 * Canonical micro-USD pattern: non-negative integer string.
 * - No leading zeros except bare "0"
 * - No whitespace, no plus sign, no decimal point
 * - Numeric bound enforced separately via BigInt comparison against
 *   MAX_SAFE_MICRO_USD — the SAME constant already enforced by
 *   parseBoundaryMicroUsd's safety floor (parse-boundary-micro-usd.ts:224).
 */
export const CANONICAL_MICRO_USD_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * Create a mode-aware micro-USD Zod schema.
 *
 * FR-3/FR-4 coordination: both this function and parseBoundaryMicroUsd()
 * delegate to resolveParseMode(), which caches the resolved mode at first
 * invocation (module-level singleton). This guarantees schema validation
 * and boundary parsing always operate in the same mode within a process,
 * consistent with the cold-restart constraint (SDD §3.4) — mode changes
 * require a process restart to take effect.
 *
 * @param mode - Parse mode override. If omitted, reads from PARSE_MICRO_USD_MODE env var.
 */
export function createMicroUsdSchema(mode?: ParseMode) {
  const resolvedMode = mode ?? resolveParseMode();

  if (resolvedMode === 'enforce') {
    // Canonical mode: strict validation matching parseMicroUsd acceptance.
    return z.string()
      .min(1, 'micro-USD value must not be empty')
      .max(MAX_INPUT_LENGTH, `micro-USD input exceeds max length (${MAX_INPUT_LENGTH})`)
      .regex(CANONICAL_MICRO_USD_PATTERN, 'micro-USD must be a non-negative integer string without leading zeros')
      .refine(
        (val) => {
          try {
            return BigInt(val) <= MAX_SAFE_MICRO_USD;
          } catch {
            return false;
          }
        },
        { message: `micro-USD value exceeds maximum (${MAX_SAFE_MICRO_USD})` },
      )
      .describe('Micro-USD amount (canonical mode)');
  }

  // Legacy/shadow mode: permissive — accepts any string that BigInt() would accept.
  // This preserves backward compatibility with production (NFR-3).
  return z.string()
    .min(1, 'micro-USD value must not be empty')
    .max(MAX_INPUT_LENGTH, `micro-USD input exceeds max length (${MAX_INPUT_LENGTH})`)
    .refine(
      (val) => {
        try {
          BigInt(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'micro-USD must be a valid integer string' },
    )
    .describe('Micro-USD amount (legacy mode)');
}

/**
 * Gateway error response for micro-USD validation failure.
 */
export interface MicroUsdValidationError {
  error: 'INVALID_MICRO_USD';
  message: string;
  field: string;
  mode: ParseMode;
}

/**
 * Build a structured 400 error for micro-USD validation failure.
 */
export function buildMicroUsdError(field: string, message: string, mode: ParseMode): MicroUsdValidationError {
  return {
    error: 'INVALID_MICRO_USD',
    message,
    field,
    mode,
  };
}
