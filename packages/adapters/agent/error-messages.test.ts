/**
 * formatErrorMessage Tests
 *
 * Pins the real placeholder-substitution behavior of the user-facing error
 * message formatter (PRD §4.5.1). Pure function — no I/O, no mocks.
 */

import { describe, it, expect } from 'vitest';
import { formatErrorMessage, AGENT_ERROR_MESSAGES } from './error-messages.js';

describe('formatErrorMessage', () => {
  it('returns the raw message verbatim when no params are given (placeholders intact)', () => {
    expect(formatErrorMessage('RATE_LIMITED')).toBe(
      'Slow down! Try again in {retry_after}s.',
    );
  });

  it('returns the raw message when params is an empty object', () => {
    expect(formatErrorMessage('RATE_LIMITED', {})).toBe(
      'Slow down! Try again in {retry_after}s.',
    );
  });

  it('substitutes a numeric placeholder value (coerced via String())', () => {
    expect(formatErrorMessage('RATE_LIMITED', { retry_after: 30 })).toBe(
      'Slow down! Try again in 30s.',
    );
  });

  it('substitutes a string placeholder value as-is', () => {
    expect(formatErrorMessage('RATE_LIMITED', { retry_after: 'soon' })).toBe(
      'Slow down! Try again in soons.',
    );
  });

  it('ignores unknown param keys (no throw, message left unchanged)', () => {
    expect(
      formatErrorMessage('RATE_LIMITED', { not_a_placeholder: 'x' }),
    ).toBe('Slow down! Try again in {retry_after}s.');
  });

  it('ignores params entirely for codes that have no placeholders', () => {
    expect(formatErrorMessage('BUDGET_EXCEEDED', { retry_after: 5 })).toBe(
      "Your community's AI budget is used up for this month. Ask an admin to increase it.",
    );
  });

  it('selects the correct message for each error code', () => {
    expect(formatErrorMessage('SERVICE_UNAVAILABLE')).toBe(
      'AI agents are taking a quick break. Try again in a moment.',
    );
    expect(formatErrorMessage('MODEL_FORBIDDEN')).toBe(
      "Your tier doesn't include this model. Upgrade your commitment to unlock it!",
    );
    expect(formatErrorMessage('INVALID_REQUEST')).toBe(
      'Something went wrong with that request. Try rephrasing.',
    );
    expect(formatErrorMessage('INTERNAL_ERROR')).toBe(
      'Oops — something unexpected happened. The team has been notified.',
    );
  });

  it('matches the message table verbatim when no params are supplied', () => {
    for (const code of Object.keys(AGENT_ERROR_MESSAGES) as Array<
      keyof typeof AGENT_ERROR_MESSAGES
    >) {
      expect(formatErrorMessage(code)).toBe(
        AGENT_ERROR_MESSAGES[code].userMessage,
      );
    }
  });

  it('does NOT escape param values: $-patterns in the replacement are interpreted by String.prototype.replace', () => {
    // '$&' inserts the whole matched substring ('{retry_after}'), so the
    // placeholder is reconstructed. Documents that values are passed unescaped.
    expect(formatErrorMessage('RATE_LIMITED', { retry_after: '$&' })).toBe(
      'Slow down! Try again in {retry_after}s.',
    );
  });
});
