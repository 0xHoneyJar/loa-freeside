/**
 * User-Facing Error Messages
 * Sprint S1-T4: Localizable string table for agent gateway errors
 *
 * Error messages match PRD §4.5.1 — stored centrally, not hardcoded in handlers.
 *
 * @see PRD §4.5.1 Error Messages
 * @see SDD §6.2 Error Response Format
 */

import type { AgentErrorCode } from './types.js';

// --------------------------------------------------------------------------
// Error Message Definitions
// --------------------------------------------------------------------------

export interface ErrorMessageEntry {
  /** HTTP status code */
  httpStatus: number;
  /** User-facing message (may contain {placeholders}) */
  userMessage: string;
  /** Remediation hint for the user */
  remediation: string;
}

/** User-facing error messages keyed by error code */
export const AGENT_ERROR_MESSAGES: Record<AgentErrorCode, ErrorMessageEntry> = {
  RATE_LIMITED: {
    httpStatus: 429,
    userMessage: 'Slow down! Try again in {retry_after}s.',
    remediation: 'Auto-retry hint with countdown',
  },
  BUDGET_EXCEEDED: {
    httpStatus: 402,
    userMessage: "Your community's AI budget is used up for this month. Ask an admin to increase it.",
    remediation: 'Link to admin dashboard',
  },
  SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    userMessage: 'AI agents are taking a quick break. Try again in a moment.',
    remediation: 'Retry in 30s',
  },
  MODEL_FORBIDDEN: {
    httpStatus: 403,
    userMessage: "Your tier doesn't include this model. Upgrade your commitment to unlock it!",
    remediation: 'Tier upgrade path',
  },
  INVALID_REQUEST: {
    httpStatus: 400,
    userMessage: 'Something went wrong with that request. Try rephrasing.',
    remediation: 'Retry',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    userMessage: 'Oops — something unexpected happened. The team has been notified.',
    remediation: 'No user action needed',
  },
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Format an error message with placeholder substitution.
 *
 * @param code - Error code
 * @param params - Key-value pairs for {placeholder} replacement
 * @returns Formatted user message
 */
export function formatErrorMessage(
  code: AgentErrorCode,
  params?: Record<string, string | number>,
): string {
  let message = AGENT_ERROR_MESSAGES[code].userMessage;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      message = message.replace(`{${key}}`, String(value));
    }
  }
  return message;
}
