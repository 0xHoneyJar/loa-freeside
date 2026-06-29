import { describe, it, expect } from 'vitest';
import {
  ORDER_STATES,
  isTerminal,
  canTransition,
  assertTransition,
  IllegalTransitionError,
} from '../order-state.js';

describe('order-state machine', () => {
  it('marks only fulfilled and failed terminal', () => {
    expect(isTerminal('fulfilled')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    for (const s of ['placed', 'routing', 'producing'] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('allows the forward path placed→routing→producing→fulfilled', () => {
    expect(canTransition('placed', 'routing')).toBe(true);
    expect(canTransition('routing', 'producing')).toBe(true);
    expect(canTransition('producing', 'fulfilled')).toBe(true);
  });

  it('allows fail-closed to failed from every non-terminal state', () => {
    expect(canTransition('placed', 'failed')).toBe(true);
    expect(canTransition('routing', 'failed')).toBe(true);
    expect(canTransition('producing', 'failed')).toBe(true);
  });

  it('forbids skips, reversals, and transitions out of terminal states', () => {
    expect(canTransition('placed', 'producing')).toBe(false); // skip routing
    expect(canTransition('placed', 'fulfilled')).toBe(false); // skip to terminal
    expect(canTransition('producing', 'routing')).toBe(false); // reversal
    expect(canTransition('fulfilled', 'failed')).toBe(false); // out of terminal
    expect(canTransition('failed', 'producing')).toBe(false);
  });

  it('does not treat producing→producing as a transition (producing events do not change state)', () => {
    expect(canTransition('producing', 'producing')).toBe(false);
  });

  it('assertTransition throws IllegalTransitionError on an illegal pair', () => {
    expect(() => assertTransition('placed', 'fulfilled')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('routing', 'producing')).not.toThrow();
  });

  it('exposes exactly the five lifecycle states', () => {
    expect([...ORDER_STATES]).toEqual(['placed', 'routing', 'producing', 'fulfilled', 'failed']);
  });
});
