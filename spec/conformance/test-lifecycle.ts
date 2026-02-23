/**
 * Agent Lifecycle Conformance Tests
 *
 * Validates agent lifecycle state machine against golden vectors.
 * Tests valid transitions, invalid transitions, and terminal states.
 *
 * @see spec/vectors/agent-lifecycle.json
 * @see loa-hounfour v7.0.0 §3: Agent Lifecycle
 * @module spec/conformance/test-lifecycle
 */

import { describe, it, expect } from 'vitest';
import lifecycleVectors from '../vectors/agent-lifecycle.json';

// --------------------------------------------------------------------------
// State Machine (reference implementation)
// --------------------------------------------------------------------------

type AgentState = 'IDLE' | 'RESERVED' | 'ROUTING' | 'STREAMING' | 'FINALIZED' | 'FAILED' | 'CANCELLED';

const TERMINAL_STATES: ReadonlySet<AgentState> = new Set(['FINALIZED', 'FAILED', 'CANCELLED']);

/** Valid state transitions map: from → Set of valid to-states */
const VALID_TRANSITIONS: ReadonlyMap<AgentState, ReadonlySet<AgentState>> = new Map([
  ['IDLE', new Set(['RESERVED', 'FAILED'])],
  ['RESERVED', new Set(['ROUTING', 'FAILED', 'CANCELLED'])],
  ['ROUTING', new Set(['STREAMING', 'FAILED', 'CANCELLED'])],
  ['STREAMING', new Set(['FINALIZED', 'FAILED'])],
  // Terminal states: no outgoing transitions
  ['FINALIZED', new Set()],
  ['FAILED', new Set()],
  ['CANCELLED', new Set()],
]);

/**
 * Check if a state transition is valid.
 */
function isValidTransition(from: AgentState, to: AgentState): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  const validTargets = VALID_TRANSITIONS.get(from);
  return validTargets?.has(to) ?? false;
}

/**
 * Check if a state is terminal.
 */
function isTerminal(state: AgentState): boolean {
  return TERMINAL_STATES.has(state);
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Agent Lifecycle — Golden Vectors', () => {
  const vectors = lifecycleVectors.vectors;

  describe('Valid transition sequences', () => {
    for (const v of vectors) {
      const allValid = v.transitions.every(t => t.valid);
      const hasInvalid = v.transitions.some(t => !t.valid);

      if (allValid) {
        it(`${v.id}: ${v.description}`, () => {
          for (const t of v.transitions) {
            expect(isValidTransition(t.from as AgentState, t.to as AgentState)).toBe(true);
          }
        });
      }

      if (hasInvalid) {
        it(`${v.id}: ${v.description}`, () => {
          for (const t of v.transitions) {
            expect(isValidTransition(t.from as AgentState, t.to as AgentState)).toBe(t.valid);
          }
        });
      }
    }
  });

  describe('Terminal state enforcement', () => {
    for (const state of lifecycleVectors.terminal_states) {
      it(`${state} is a terminal state with no outgoing transitions`, () => {
        expect(isTerminal(state as AgentState)).toBe(true);

        // No valid transitions from terminal states
        for (const target of lifecycleVectors.states) {
          expect(isValidTransition(state as AgentState, target as AgentState)).toBe(false);
        }
      });
    }
  });

  describe('State machine completeness', () => {
    it('all states are covered by the transition map', () => {
      for (const state of lifecycleVectors.states) {
        expect(VALID_TRANSITIONS.has(state as AgentState)).toBe(true);
      }
    });

    it('non-terminal states have at least one outgoing transition', () => {
      for (const state of lifecycleVectors.states) {
        if (!TERMINAL_STATES.has(state as AgentState)) {
          const targets = VALID_TRANSITIONS.get(state as AgentState);
          expect(targets!.size).toBeGreaterThan(0);
        }
      }
    });

    it('every non-terminal state can reach a terminal state', () => {
      // BFS from each non-terminal state to verify reachability
      for (const startState of lifecycleVectors.states) {
        if (TERMINAL_STATES.has(startState as AgentState)) continue;

        const visited = new Set<string>();
        const queue = [startState];
        let reachesTerminal = false;

        while (queue.length > 0) {
          const current = queue.shift()!;
          if (visited.has(current)) continue;
          visited.add(current);

          if (TERMINAL_STATES.has(current as AgentState)) {
            reachesTerminal = true;
            break;
          }

          const targets = VALID_TRANSITIONS.get(current as AgentState);
          if (targets) {
            for (const target of targets) {
              queue.push(target);
            }
          }
        }

        expect(reachesTerminal).toBe(true);
      }
    });
  });
});
