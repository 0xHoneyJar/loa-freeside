/**
 * The order lifecycle state machine (pure).
 *
 * placed → routing → producing → fulfilled | failed. `fulfilled` and `failed` are
 * terminal. The audit invocation can refuse at any pre-terminal point, so every
 * non-terminal state may transition to `failed`. Producing events (0..n, one per
 * recipe step) are emitted WHILE in `producing` — they do not change the state, so
 * `producing → producing` is intentionally NOT a transition here (see store.appendEvent).
 *
 * Atomic, guarded transitions are how idempotency is enforced (SDD §13 H-3): the
 * orchestrator claims `placed → routing` via a compare-and-swap; a redelivered `placed`
 * finds the state already advanced, loses the CAS, and acks without re-running the audit.
 */

export const ORDER_STATES = ['placed', 'routing', 'producing', 'fulfilled', 'failed'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const TERMINAL: ReadonlySet<OrderState> = new Set<OrderState>(['fulfilled', 'failed']);

/** Allowed forward transitions. Any non-terminal state may fail-closed to `failed`. */
const TRANSITIONS: Readonly<Record<OrderState, ReadonlySet<OrderState>>> = {
  placed: new Set<OrderState>(['routing', 'failed']),
  routing: new Set<OrderState>(['producing', 'failed']),
  producing: new Set<OrderState>(['fulfilled', 'failed']),
  fulfilled: new Set<OrderState>(),
  failed: new Set<OrderState>(),
};

export function isTerminal(state: OrderState): boolean {
  return TERMINAL.has(state);
}

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].has(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: OrderState,
    readonly to: OrderState,
  ) {
    super(`illegal order transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Throws IllegalTransitionError if `from → to` is not an allowed transition. */
export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
