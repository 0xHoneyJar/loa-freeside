/**
 * Tests for getValidTransitions — the wizard state-machine transition accessor.
 *
 * getValidTransitions is the read side of the 8-step onboarding state machine
 * (INIT → CHAIN_SELECT → ... → DEPLOY). Its correctness is load-bearing: every
 * forward/back navigation in the wizard is gated by this exact table, so the
 * transitions must be pinned exactly — order included (idx0 = next step,
 * idx1 = previous step). A drifted edge here silently lets the wizard skip or
 * regress a step.
 */

import { describe, it, expect } from 'vitest';
import { getValidTransitions, WizardState } from './wizard.js';

const LINEAR_ORDER = [
  WizardState.INIT,
  WizardState.CHAIN_SELECT,
  WizardState.ASSET_CONFIG,
  WizardState.ELIGIBILITY_RULES,
  WizardState.ROLE_MAPPING,
  WizardState.CHANNEL_STRUCTURE,
  WizardState.REVIEW,
  WizardState.DEPLOY,
] as const;

describe('getValidTransitions', () => {
  it('returns the exact transition list (forward-first, back-second) for every state', () => {
    expect(getValidTransitions(WizardState.INIT)).toEqual([WizardState.CHAIN_SELECT]);
    expect(getValidTransitions(WizardState.CHAIN_SELECT)).toEqual([
      WizardState.ASSET_CONFIG,
      WizardState.INIT,
    ]);
    expect(getValidTransitions(WizardState.ASSET_CONFIG)).toEqual([
      WizardState.ELIGIBILITY_RULES,
      WizardState.CHAIN_SELECT,
    ]);
    expect(getValidTransitions(WizardState.ELIGIBILITY_RULES)).toEqual([
      WizardState.ROLE_MAPPING,
      WizardState.ASSET_CONFIG,
    ]);
    expect(getValidTransitions(WizardState.ROLE_MAPPING)).toEqual([
      WizardState.CHANNEL_STRUCTURE,
      WizardState.ELIGIBILITY_RULES,
    ]);
    expect(getValidTransitions(WizardState.CHANNEL_STRUCTURE)).toEqual([
      WizardState.REVIEW,
      WizardState.ROLE_MAPPING,
    ]);
    expect(getValidTransitions(WizardState.REVIEW)).toEqual([
      WizardState.DEPLOY,
      WizardState.CHANNEL_STRUCTURE,
    ]);
  });

  it('treats INIT as the entry step with no back-navigation', () => {
    const t = getValidTransitions(WizardState.INIT);
    expect(t).toHaveLength(1);
    expect(t[0]).toBe(WizardState.CHAIN_SELECT);
  });

  it('treats DEPLOY as terminal — no outgoing transitions', () => {
    expect(getValidTransitions(WizardState.DEPLOY)).toEqual([]);
  });

  it('places the next linear step first (forward edge) for all non-terminal states', () => {
    for (let i = 0; i < LINEAR_ORDER.length - 1; i++) {
      expect(getValidTransitions(LINEAR_ORDER[i]!)[0]).toBe(LINEAR_ORDER[i + 1]);
    }
  });

  it('places the previous linear step second (back edge) for interior states', () => {
    // INIT (entry) and DEPLOY (terminal) have no back edge; everything between does.
    for (let i = 1; i < LINEAR_ORDER.length - 1; i++) {
      expect(getValidTransitions(LINEAR_ORDER[i]!)[1]).toBe(LINEAR_ORDER[i - 1]);
    }
  });

  it('forbids illegal jumps: INIT cannot reach ASSET_CONFIG directly', () => {
    expect(getValidTransitions(WizardState.INIT)).not.toContain(WizardState.ASSET_CONFIG);
  });

  it('never returns a dangling target — every transition is a real WizardState', () => {
    const valid = new Set(Object.values(WizardState));
    for (const state of LINEAR_ORDER) {
      for (const target of getValidTransitions(state)) {
        expect(valid.has(target)).toBe(true);
      }
    }
  });

  it('falls back to an empty array for an unknown state', () => {
    expect(getValidTransitions('NOT_A_STATE' as WizardState)).toEqual([]);
  });
});