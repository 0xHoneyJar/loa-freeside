/**
 * WizardState Unit Tests
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Tests for wizard state transitions and helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  WizardState,
  VALID_TRANSITIONS,
  STATE_DISPLAY_NAMES,
  STATE_PROGRESS,
  isValidTransition,
  isTerminalState,
  getNextState,
  getPreviousState,
} from '../../../../src/packages/wizard/WizardState.js';

describe('WizardState', () => {
  describe('WizardState enum', () => {
    it('should have 10 states', () => {
      const states = Object.values(WizardState);
      expect(states).toHaveLength(10);
    });

    it('should include all required states', () => {
      expect(WizardState.INIT).toBe('INIT');
      expect(WizardState.CHAIN_SELECT).toBe('CHAIN_SELECT');
      expect(WizardState.ASSET_CONFIG).toBe('ASSET_CONFIG');
      expect(WizardState.ELIGIBILITY_RULES).toBe('ELIGIBILITY_RULES');
      expect(WizardState.ROLE_MAPPING).toBe('ROLE_MAPPING');
      expect(WizardState.CHANNEL_STRUCTURE).toBe('CHANNEL_STRUCTURE');
      expect(WizardState.REVIEW).toBe('REVIEW');
      expect(WizardState.DEPLOY).toBe('DEPLOY');
      expect(WizardState.COMPLETE).toBe('COMPLETE');
      expect(WizardState.FAILED).toBe('FAILED');
    });
  });

  describe('VALID_TRANSITIONS', () => {
    it('should define transitions for all states', () => {
      const states = Object.values(WizardState);
      for (const state of states) {
        expect(VALID_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(VALID_TRANSITIONS[state])).toBe(true);
      }
    });

    it('should allow INIT to transition to CHAIN_SELECT', () => {
      expect(VALID_TRANSITIONS[WizardState.INIT]).toContain(WizardState.CHAIN_SELECT);
    });

    it('should allow any state to transition to FAILED (except terminal)', () => {
      const nonTerminalStates = Object.values(WizardState).filter(
        (s) => s !== WizardState.COMPLETE && s !== WizardState.FAILED
      );
      for (const state of nonTerminalStates) {
        expect(VALID_TRANSITIONS[state]).toContain(WizardState.FAILED);
      }
    });

    it('should have no transitions from COMPLETE', () => {
      expect(VALID_TRANSITIONS[WizardState.COMPLETE]).toHaveLength(0);
    });

    it('should only allow INIT from FAILED', () => {
      expect(VALID_TRANSITIONS[WizardState.FAILED]).toEqual([WizardState.INIT]);
    });
  });

  describe('STATE_DISPLAY_NAMES', () => {
    it('should have display names for all states', () => {
      const states = Object.values(WizardState);
      for (const state of states) {
        expect(STATE_DISPLAY_NAMES[state]).toBeDefined();
        expect(typeof STATE_DISPLAY_NAMES[state]).toBe('string');
        expect(STATE_DISPLAY_NAMES[state].length).toBeGreaterThan(0);
      }
    });

    it('should have human-readable names', () => {
      expect(STATE_DISPLAY_NAMES[WizardState.INIT]).toBe('Getting Started');
      expect(STATE_DISPLAY_NAMES[WizardState.CHAIN_SELECT]).toBe('Blockchain Selection');
      expect(STATE_DISPLAY_NAMES[WizardState.COMPLETE]).toBe('Setup Complete');
    });
  });

  describe('STATE_PROGRESS', () => {
    it('should have progress for all states', () => {
      const states = Object.values(WizardState);
      for (const state of states) {
        expect(STATE_PROGRESS[state]).toBeDefined();
        expect(typeof STATE_PROGRESS[state]).toBe('number');
      }
    });

    it('should have 0% for INIT', () => {
      expect(STATE_PROGRESS[WizardState.INIT]).toBe(0);
    });

    it('should have 100% for COMPLETE', () => {
      expect(STATE_PROGRESS[WizardState.COMPLETE]).toBe(100);
    });

    it('should have 0% for FAILED', () => {
      expect(STATE_PROGRESS[WizardState.FAILED]).toBe(0);
    });

    it('should increase monotonically in normal flow', () => {
      const normalFlow = [
        WizardState.INIT,
        WizardState.CHAIN_SELECT,
        WizardState.ASSET_CONFIG,
        WizardState.ELIGIBILITY_RULES,
        WizardState.ROLE_MAPPING,
        WizardState.CHANNEL_STRUCTURE,
        WizardState.REVIEW,
        WizardState.DEPLOY,
        WizardState.COMPLETE,
      ];

      for (let i = 1; i < normalFlow.length; i++) {
        expect(STATE_PROGRESS[normalFlow[i]]).toBeGreaterThan(STATE_PROGRESS[normalFlow[i - 1]]);
      }
    });
  });

  describe('isValidTransition', () => {
    it('should return true for valid transitions', () => {
      expect(isValidTransition(WizardState.INIT, WizardState.CHAIN_SELECT)).toBe(true);
      expect(isValidTransition(WizardState.CHAIN_SELECT, WizardState.ASSET_CONFIG)).toBe(true);
      expect(isValidTransition(WizardState.DEPLOY, WizardState.COMPLETE)).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(isValidTransition(WizardState.INIT, WizardState.COMPLETE)).toBe(false);
      expect(isValidTransition(WizardState.CHAIN_SELECT, WizardState.DEPLOY)).toBe(false);
      expect(isValidTransition(WizardState.COMPLETE, WizardState.INIT)).toBe(false);
    });

    it('should allow back transitions', () => {
      expect(isValidTransition(WizardState.CHAIN_SELECT, WizardState.INIT)).toBe(true);
      expect(isValidTransition(WizardState.ASSET_CONFIG, WizardState.CHAIN_SELECT)).toBe(true);
    });

    it('should allow any non-terminal state to fail', () => {
      expect(isValidTransition(WizardState.INIT, WizardState.FAILED)).toBe(true);
      expect(isValidTransition(WizardState.REVIEW, WizardState.FAILED)).toBe(true);
      expect(isValidTransition(WizardState.DEPLOY, WizardState.FAILED)).toBe(true);
    });
  });

  describe('isTerminalState', () => {
    it('should return true for COMPLETE', () => {
      expect(isTerminalState(WizardState.COMPLETE)).toBe(true);
    });

    it('should return true for FAILED', () => {
      expect(isTerminalState(WizardState.FAILED)).toBe(true);
    });

    it('should return false for all other states', () => {
      const nonTerminalStates = Object.values(WizardState).filter(
        (s) => s !== WizardState.COMPLETE && s !== WizardState.FAILED
      );
      for (const state of nonTerminalStates) {
        expect(isTerminalState(state)).toBe(false);
      }
    });
  });

  describe('getNextState', () => {
    it('should return correct next state for normal flow', () => {
      expect(getNextState(WizardState.INIT)).toBe(WizardState.CHAIN_SELECT);
      expect(getNextState(WizardState.CHAIN_SELECT)).toBe(WizardState.ASSET_CONFIG);
      expect(getNextState(WizardState.ASSET_CONFIG)).toBe(WizardState.ELIGIBILITY_RULES);
      expect(getNextState(WizardState.ELIGIBILITY_RULES)).toBe(WizardState.ROLE_MAPPING);
      expect(getNextState(WizardState.ROLE_MAPPING)).toBe(WizardState.CHANNEL_STRUCTURE);
      expect(getNextState(WizardState.CHANNEL_STRUCTURE)).toBe(WizardState.REVIEW);
      expect(getNextState(WizardState.REVIEW)).toBe(WizardState.DEPLOY);
      expect(getNextState(WizardState.DEPLOY)).toBe(WizardState.COMPLETE);
    });

    it('should return null for COMPLETE', () => {
      expect(getNextState(WizardState.COMPLETE)).toBeNull();
    });

    it('should return null for FAILED', () => {
      expect(getNextState(WizardState.FAILED)).toBeNull();
    });
  });

  describe('getPreviousState', () => {
    it('should return correct previous state', () => {
      expect(getPreviousState(WizardState.CHAIN_SELECT)).toBe(WizardState.INIT);
      expect(getPreviousState(WizardState.ASSET_CONFIG)).toBe(WizardState.CHAIN_SELECT);
      expect(getPreviousState(WizardState.REVIEW)).toBe(WizardState.CHANNEL_STRUCTURE);
    });

    it('should return null for INIT', () => {
      expect(getPreviousState(WizardState.INIT)).toBeNull();
    });

    it('should return null for FAILED', () => {
      expect(getPreviousState(WizardState.FAILED)).toBeNull();
    });
  });
});
