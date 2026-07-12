/**
 * takeover-confirmation Unit Tests
 *
 * The pure confirmation gate guarding an IRREVERSIBLE primary->exclusive takeover.
 * CRITICAL TEST (arrakis-25r6): the `community_name` step must FAIL CLOSED when the expected
 * name is missing/empty — the original `expectedValue && ...` guard let ANY input through,
 * silently skipping the "type your server name" safety check on a one-way takeover.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTakeoverStep,
  isTakeoverConfirmationComplete,
  type TakeoverConfirmationState,
  type TakeoverStep,
} from '../../../../../src/packages/adapters/coexistence/takeover-confirmation.js';

const NOW = new Date('2026-01-01T00:00:00Z');
const base = (completedSteps: TakeoverStep[] = []): TakeoverConfirmationState => ({
  communityId: 'c1',
  adminId: 'a1',
  completedSteps,
  startedAt: NOW,
  expiresAt: new Date('2026-01-01T00:05:00Z'), // 5 min after NOW
});

describe('validateTakeoverStep — community_name (arrakis-25r6)', () => {
  it('FAILS CLOSED when the expected name is empty (caller passes guild?.name ?? "")', () => {
    const r = validateTakeoverStep(base(), 'community_name', 'anything at all', '', NOW);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/server name unavailable|aborting/i);
  });

  it('FAILS CLOSED when the expected name is undefined', () => {
    const r = validateTakeoverStep(base(), 'community_name', 'anything', undefined, NOW);
    expect(r.valid).toBe(false);
  });

  it('passes only when the input matches the real expected name (case-insensitive)', () => {
    expect(validateTakeoverStep(base(), 'community_name', 'My Guild', 'my guild', NOW).valid).toBe(true);
    expect(validateTakeoverStep(base(), 'community_name', 'wrong', 'my guild', NOW).valid).toBe(false);
  });

  it('advances state on success (records communityNameConfirmed)', () => {
    const r = validateTakeoverStep(base(), 'community_name', 'My Guild', 'My Guild', NOW);
    expect(r.valid).toBe(true);
    expect(r.updatedConfirmation.communityNameConfirmed).toBe(true);
    expect(r.updatedConfirmation.completedSteps).toContain('community_name');
  });

  it('padded input is REJECTED — no .trim(); a one-way gate stays strict (intentional)', () => {
    // Deliberate: rejecting whitespace-padded input fails CLOSED (the safe direction for an
    // irreversible action). The admin retypes; the friction is acceptable on a one-way gate.
    expect(validateTakeoverStep(base(), 'community_name', '  My Guild  ', 'My Guild', NOW).valid).toBe(false);
  });
});

describe('full 3-step confirmation flow', () => {
  it('three real confirmations advance to complete (pins the delegation wiring)', () => {
    let c = base();
    let r = validateTakeoverStep(c, 'community_name', 'My Guild', 'My Guild', NOW);
    expect(r.valid).toBe(true);
    c = r.updatedConfirmation;
    r = validateTakeoverStep(c, 'acknowledge_risks', 'i understand', undefined, NOW);
    expect(r.valid).toBe(true);
    c = r.updatedConfirmation;
    r = validateTakeoverStep(c, 'rollback_plan', 'confirmed', undefined, NOW);
    expect(r.valid).toBe(true);
    c = r.updatedConfirmation;
    expect(isTakeoverConfirmationComplete(c)).toBe(true);
  });
});

describe('validateTakeoverStep — other gates unchanged', () => {
  it('acknowledge_risks requires the exact phrase', () => {
    expect(validateTakeoverStep(base(), 'acknowledge_risks', 'i understand', undefined, NOW).valid).toBe(true);
    expect(validateTakeoverStep(base(), 'acknowledge_risks', 'sure', undefined, NOW).valid).toBe(false);
  });

  it('rollback_plan requires "confirmed"', () => {
    expect(validateTakeoverStep(base(), 'rollback_plan', 'confirmed', undefined, NOW).valid).toBe(true);
    expect(validateTakeoverStep(base(), 'rollback_plan', 'ok', undefined, NOW).valid).toBe(false);
  });

  it('rejects an expired confirmation regardless of step', () => {
    const expired = { ...base(), expiresAt: new Date('2025-12-31T23:00:00Z') };
    const r = validateTakeoverStep(expired, 'community_name', 'My Guild', 'My Guild', NOW);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/expired/i);
  });

  it('rejects an unknown step', () => {
    const r = validateTakeoverStep(base(), 'bogus' as TakeoverStep, 'x', undefined, NOW);
    expect(r.valid).toBe(false);
  });
});

describe('isTakeoverConfirmationComplete', () => {
  it('true only when all three steps are completed', () => {
    expect(isTakeoverConfirmationComplete(base(['community_name', 'acknowledge_risks', 'rollback_plan']))).toBe(true);
    expect(isTakeoverConfirmationComplete(base(['community_name', 'acknowledge_risks']))).toBe(false);
    expect(isTakeoverConfirmationComplete(base([]))).toBe(false);
  });
});
