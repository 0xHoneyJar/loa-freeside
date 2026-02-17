/**
 * State Machine Equivalence Test Suite (Task 2.3, Sprint 296; updated Sprint 303)
 *
 * Verifies arrakis's 4 protocol state machines against the loa-hounfour
 * canonical definitions via:
 *   1. Structural oracle comparison (normalized actual vs canonical-machines.json)
 *   2. Domain conformance (no protocol terminal state violations)
 *
 * Hash drift detection removed in Sprint 303 (Task 303.2) — replaced by
 * three-layer drift detection in drift-detection.test.ts.
 *
 * SDD refs: §3.1.2-3.1.4
 * Sprint refs: Task 2.3, Task 303.2
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESERVATION_MACHINE,
  REVENUE_RULE_MACHINE,
  PAYMENT_MACHINE,
  SYSTEM_CONFIG_MACHINE,
  STATE_MACHINES,
  isValidTransition,
  isTerminal,
} from '../../../src/packages/core/protocol/state-machines.js';

// =============================================================================
// Fixtures
// =============================================================================

const FIXTURES_DIR = join(__dirname, '../../fixtures');

const canonicalMachines = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'canonical-machines.json'), 'utf-8'),
) as {
  machines: Record<string, {
    name: string;
    initial: string;
    states: string[];
    transitions: Record<string, string[]>;
    terminal: string[];
  }>;
};

// =============================================================================
// Helpers
// =============================================================================

interface RawMachine {
  name: string;
  initial: string;
  transitions: Record<string, readonly string[]>;
  terminal: readonly string[];
}

function normalize(machine: RawMachine) {
  const states = Object.keys(machine.transitions).sort();
  const transitions: Record<string, string[]> = {};
  for (const state of states) {
    transitions[state] = [...machine.transitions[state]].sort();
  }
  return {
    name: machine.name,
    initial: machine.initial,
    states,
    transitions,
    terminal: [...machine.terminal].sort(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('State Machine Equivalence', () => {
  // ---------------------------------------------------------------------------
  // Structural Equivalence
  // ---------------------------------------------------------------------------

  describe('structural equivalence', () => {
    const machineEntries: [string, RawMachine][] = [
      ['credit_reservation', RESERVATION_MACHINE],
      ['revenue_rule', REVENUE_RULE_MACHINE],
      ['payment', PAYMENT_MACHINE],
      ['system_config', SYSTEM_CONFIG_MACHINE],
    ];

    for (const [canonicalName, machine] of machineEntries) {
      describe(canonicalName, () => {
        const actual = normalize(machine);
        const expected = canonicalMachines.machines[canonicalName];

        it('states match oracle', () => {
          expect(actual.states).toEqual(expected.states);
        });

        it('transitions match oracle', () => {
          expect(actual.transitions).toEqual(expected.transitions);
        });

        it('initial state matches oracle', () => {
          expect(actual.initial).toBe(expected.initial);
        });

        it('terminal states match oracle', () => {
          expect(actual.terminal).toEqual(expected.terminal);
        });
      });
    }

    it('all 4 machines present in STATE_MACHINES aggregate', () => {
      expect(Object.keys(STATE_MACHINES)).toHaveLength(4);
      expect(STATE_MACHINES).toHaveProperty('reservation');
      expect(STATE_MACHINES).toHaveProperty('revenue_rule');
      expect(STATE_MACHINES).toHaveProperty('payment');
      expect(STATE_MACHINES).toHaveProperty('system_config');
    });
  });

  // ---------------------------------------------------------------------------
  // Domain Conformance
  // ---------------------------------------------------------------------------

  describe('domain conformance', () => {
    it('reservation terminal states have no outgoing transitions', () => {
      for (const state of RESERVATION_MACHINE.terminal) {
        expect(RESERVATION_MACHINE.transitions[state]).toEqual([]);
        expect(isTerminal(RESERVATION_MACHINE, state)).toBe(true);
      }
    });

    it('payment: finished can transition to refunded (non-terminal)', () => {
      expect(isValidTransition(PAYMENT_MACHINE, 'finished', 'refunded')).toBe(true);
      expect(isTerminal(PAYMENT_MACHINE, 'finished')).toBe(false);
    });

    it('payment: refunded is truly terminal', () => {
      expect(PAYMENT_MACHINE.transitions['refunded']).toEqual([]);
      expect(isTerminal(PAYMENT_MACHINE, 'refunded')).toBe(true);
    });

    it('system_config mirrors revenue_rule structure', () => {
      const scNorm = normalize(SYSTEM_CONFIG_MACHINE);
      const rrNorm = normalize(REVENUE_RULE_MACHINE);
      expect(scNorm.states).toEqual(rrNorm.states);
      expect(scNorm.transitions).toEqual(rrNorm.transitions);
      expect(scNorm.terminal).toEqual(rrNorm.terminal);
    });

    it('no machine has unreachable states', () => {
      for (const [, machine] of Object.entries(STATE_MACHINES)) {
        const m = machine as RawMachine;
        const reachable = new Set<string>([m.initial]);
        const queue = [m.initial];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const next of m.transitions[current] ?? []) {
            if (!reachable.has(next)) {
              reachable.add(next);
              queue.push(next);
            }
          }
        }
        const allStates = Object.keys(m.transitions);
        for (const state of allStates) {
          expect(reachable.has(state)).toBe(true);
        }
      }
    });
  });
});
