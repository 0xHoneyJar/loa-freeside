/**
 * Vendored loa-hounfour State Machine Definitions
 *
 * Canonical state machine definitions shared between arrakis and loa-finn.
 * Each state machine defines allowed transitions and terminal states.
 *
 * Vendored from: loa-hounfour (pinned commit — see VENDORED.md)
 *
 * @module packages/core/protocol/state-machines
 */

// =============================================================================
// State Machine Definition Type
// =============================================================================

export interface StateMachineDefinition<S extends string> {
  /** Human-readable name */
  name: string;
  /** Initial state */
  initial: S;
  /** Allowed transitions: state → list of reachable states */
  transitions: Record<S, readonly S[]>;
  /** States with no outgoing transitions */
  terminal: readonly S[];
}

// =============================================================================
// Reservation State Machine (Credit Lifecycle)
// =============================================================================

export type ReservationState = 'pending' | 'finalized' | 'released' | 'expired';

export const RESERVATION_MACHINE: StateMachineDefinition<ReservationState> = {
  name: 'credit_reservation',
  initial: 'pending',
  transitions: {
    pending: ['finalized', 'released', 'expired'],
    finalized: [],
    released: [],
    expired: [],
  },
  terminal: ['finalized', 'released', 'expired'],
};

// =============================================================================
// Revenue Rule State Machine (Governance Lifecycle)
// =============================================================================

export type RevenueRuleState =
  | 'draft'
  | 'pending_approval'
  | 'cooling_down'
  | 'active'
  | 'superseded'
  | 'rejected';

export const REVENUE_RULE_MACHINE: StateMachineDefinition<RevenueRuleState> = {
  name: 'revenue_rule',
  initial: 'draft',
  transitions: {
    draft: ['pending_approval'],
    pending_approval: ['cooling_down', 'rejected'],
    cooling_down: ['active', 'rejected'],
    active: ['superseded'],
    superseded: [],
    rejected: [],
  },
  terminal: ['superseded', 'rejected'],
};

// =============================================================================
// Payment State Machine
// =============================================================================

export type PaymentState =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

export const PAYMENT_MACHINE: StateMachineDefinition<PaymentState> = {
  name: 'payment',
  initial: 'waiting',
  transitions: {
    waiting: ['confirming', 'confirmed', 'sending', 'finished', 'failed', 'expired', 'partially_paid'],
    confirming: ['confirmed', 'sending', 'finished', 'failed'],
    confirmed: ['sending', 'finished', 'failed'],
    sending: ['finished', 'failed'],
    partially_paid: ['confirming', 'confirmed', 'sending', 'finished', 'failed', 'expired'],
    finished: ['refunded'],
    failed: [],
    refunded: [],
    expired: [],
  },
  terminal: ['failed', 'refunded', 'expired'],
};

// =============================================================================
// State Machine Utilities
// =============================================================================

/**
 * Check if a transition is valid for a given state machine.
 */
export function isValidTransition<S extends string>(
  machine: StateMachineDefinition<S>,
  from: S,
  to: S,
): boolean {
  const allowed = machine.transitions[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Check if a state is terminal (no outgoing transitions).
 */
export function isTerminal<S extends string>(
  machine: StateMachineDefinition<S>,
  state: S,
): boolean {
  return machine.terminal.includes(state);
}

/**
 * Aggregate map of all protocol state machines.
 */
export const STATE_MACHINES = {
  reservation: RESERVATION_MACHINE,
  revenue_rule: REVENUE_RULE_MACHINE,
  payment: PAYMENT_MACHINE,
} as const;
