/**
 * Request Lifecycle — State Machine Protocol Object
 * Cycle 019 Sprint 3, Task 3.1: Gateway lifecycle extraction
 *
 * Externalizes the implicit RECEIVED→VALIDATED→RESERVED→EXECUTING→FINALIZED
 * state machine from AgentGateway into a first-class protocol object.
 *
 * Each state transition is validated and recorded, providing:
 * - Invariant enforcement (no invalid transitions)
 * - Structured logging per transition
 * - Complete decision trail via getTrace()
 * - Duration tracking for latency metrics
 *
 * @see SDD §4.1 Agent Gateway Facade
 * @see Bridgebuilder Round 6, Finding #1 — State Machine Extraction
 */

import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type LifecycleState =
  | 'RECEIVED'
  | 'VALIDATED'
  | 'RESERVED'
  | 'EXECUTING'
  | 'FINALIZED'
  | 'FAILED';

export interface LifecycleEvent {
  from: LifecycleState;
  to: LifecycleState;
  timestamp: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Valid Transitions
// --------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<LifecycleState, ReadonlySet<LifecycleState>> = {
  RECEIVED:  new Set(['VALIDATED', 'FAILED']),
  VALIDATED: new Set(['RESERVED', 'FAILED']),
  RESERVED:  new Set(['EXECUTING', 'FAILED']),
  EXECUTING: new Set(['FINALIZED', 'FAILED']),
  FINALIZED: new Set(), // terminal
  FAILED:    new Set(), // terminal
};

// --------------------------------------------------------------------------
// RequestLifecycle
// --------------------------------------------------------------------------

export class RequestLifecycle {
  private state: LifecycleState = 'RECEIVED';
  private readonly trace: LifecycleEvent[] = [];
  private readonly startTime: number;
  private lastTransitionTime: number;
  private readonly traceId: string;
  private readonly log?: Logger;

  constructor(traceId: string, log?: Logger) {
    this.traceId = traceId;
    this.log = log;
    this.startTime = Date.now();
    this.lastTransitionTime = this.startTime;
  }

  // --------------------------------------------------------------------------
  // State Transitions
  // --------------------------------------------------------------------------

  /** Transition to VALIDATED after request parsing + authorization checks */
  validate(metadata?: Record<string, unknown>): void {
    this.transition('VALIDATED', metadata);
  }

  /** Transition to RESERVED after budget reservation succeeds */
  reserve(metadata?: Record<string, unknown>): void {
    this.transition('RESERVED', metadata);
  }

  /** Transition to EXECUTING when forwarding to loa-finn */
  execute(metadata?: Record<string, unknown>): void {
    this.transition('EXECUTING', metadata);
  }

  /** Transition to FINALIZED after budget finalization + response delivered */
  finalize(metadata?: Record<string, unknown>): void {
    this.transition('FINALIZED', metadata);
  }

  /** Transition to FAILED on any unrecoverable error */
  fail(metadata?: Record<string, unknown>): void {
    this.transition('FAILED', metadata);
  }

  // --------------------------------------------------------------------------
  // Introspection
  // --------------------------------------------------------------------------

  /** Current lifecycle state */
  getState(): LifecycleState {
    return this.state;
  }

  /** Total duration from RECEIVED to current state (ms) */
  getDuration(): number {
    return Date.now() - this.startTime;
  }

  /** Complete transition history for debugging */
  getTrace(): readonly LifecycleEvent[] {
    return this.trace;
  }

  /** Whether the lifecycle has reached a terminal state */
  isTerminal(): boolean {
    return this.state === 'FINALIZED' || this.state === 'FAILED';
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  private transition(to: LifecycleState, metadata?: Record<string, unknown>): void {
    const from = this.state;
    const allowed = VALID_TRANSITIONS[from];

    if (!allowed.has(to)) {
      throw new LifecycleError(
        `Invalid lifecycle transition: ${from} → ${to}`,
        from,
        to,
      );
    }

    const now = Date.now();
    const durationMs = now - this.lastTransitionTime;

    const event: LifecycleEvent = { from, to, timestamp: now, durationMs, metadata };
    this.trace.push(event);
    this.state = to;
    this.lastTransitionTime = now;

    // AC-3.4: Structured log with traceId on every transition
    this.log?.info(
      {
        traceId: this.traceId,
        lifecycle: { from, to, durationMs },
        ...(metadata ?? {}),
      },
      `lifecycle: ${from} → ${to}`,
    );
  }
}

// --------------------------------------------------------------------------
// Error
// --------------------------------------------------------------------------

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly from: LifecycleState,
    public readonly to: LifecycleState,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}
