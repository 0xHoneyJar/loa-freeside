/**
 * Idempotency State Machine — Unified Key Lifecycle
 * Sprint S11-T0: Prerequisite spec for S11-T1, S11-T2, S11-T4 (Flatline SKP-002)
 *
 * Defines the single source of truth for idempotency key states, transitions,
 * and key derivation rules across all platforms (Discord, Telegram, HTTP API).
 *
 * ## State Machine
 *
 * ```
 * Key States:
 *   NEW            — Key has not been seen before
 *   ACTIVE         — Budget reserved, execution in progress
 *   COMPLETED      — Stream/invoke finished normally (usage event received)
 *   ABORTED        — Client disconnected before completion
 *   RESUME_LOST    — loa-finn returned 409 STREAM_RESUME_LOST (context expired)
 *
 * Transitions:
 *   NEW → ACTIVE:          First request with this key → budget.reserve() succeeds
 *   ACTIVE → ACTIVE:       Retry with same key → budget.reserve() returns ALREADY_RESERVED
 *   ACTIVE → COMPLETED:    Usage event received → budget.finalize() succeeds
 *   ACTIVE → ABORTED:      Client disconnects → reconciliation job scheduled
 *   ACTIVE → RESUME_LOST:  loa-finn returns 409 STREAM_RESUME_LOST
 *
 * Terminal States: COMPLETED, ABORTED (after reconciliation), RESUME_LOST
 * ```
 *
 * ## Key Reuse Rules
 *
 * | Scenario              | Key Behavior                     | Result                          |
 * |-----------------------|----------------------------------|---------------------------------|
 * | retry (same request)  | Reuse same key                   | ALREADY_RESERVED → idempotent   |
 * | SSE reconnect         | Reuse key + Last-Event-ID header | Resume stream from last event   |
 * | STREAM_RESUME_LOST    | Mint NEW key                     | Fresh execution, old → terminal |
 * | message edit          | Mint NEW key (append `:edit`)    | Fresh execution                 |
 * | platform retry        | Same platform event → same key   | ALREADY_RESERVED → idempotent   |
 *
 * ## SSE Reconnect Edge Cases
 *
 * | Scenario                              | Behavior                                  |
 * |---------------------------------------|-------------------------------------------|
 * | Reconnect WITHOUT Last-Event-ID       | Treated as retry (same key, idempotent)   |
 * | Reconnect WITH Last-Event-ID          | Resume from event (same key)              |
 * | Proxy strips Last-Event-ID            | Falls back to retry semantics (safe)      |
 * | Reconnect after STREAM_RESUME_LOST    | Gets 409, must mint new key               |
 *
 * @see SDD §4.6.1 STREAM_RESUME_LOST
 * @see SDD §9.4 Per-Platform Idempotency Key Derivation
 * @see Flatline SKP-002 (severity 880)
 */

// --------------------------------------------------------------------------
// Key States
// --------------------------------------------------------------------------

/** All possible states for an idempotency key */
export type IdempotencyKeyState =
  | 'NEW'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'ABORTED'
  | 'RESUME_LOST';

/** Valid state transitions for the idempotency state machine */
export const IDEMPOTENCY_TRANSITIONS: ReadonlyMap<
  IdempotencyKeyState,
  readonly IdempotencyKeyState[]
> = new Map([
  ['NEW', ['ACTIVE']],
  ['ACTIVE', ['ACTIVE', 'COMPLETED', 'ABORTED', 'RESUME_LOST']],
  ['COMPLETED', []],
  ['ABORTED', []],
  ['RESUME_LOST', []],
]);

/** States where the key lifecycle is finished */
export const TERMINAL_STATES: ReadonlySet<IdempotencyKeyState> = new Set<IdempotencyKeyState>([
  'COMPLETED',
  'ABORTED',
  'RESUME_LOST',
]);

// --------------------------------------------------------------------------
// Key Derivation
// --------------------------------------------------------------------------

/** Supported platforms for key derivation */
export type IdempotencyPlatform = 'discord' | 'telegram' | 'http';

/** Context for deriving a deterministic idempotency key */
export interface IdempotencyKeyContext {
  platform: IdempotencyPlatform;
  /** Platform-specific unique event identifier */
  eventId: string;
  /** Whether this is a message edit (triggers new key) */
  isEdit?: boolean;
}

/**
 * Derive a deterministic idempotency key from platform context.
 *
 * Platform key formats:
 * - Discord slash command: `discord:interaction:{interaction.id}`
 * - Discord message:      `discord:msg:{message.id}`
 * - Telegram update:      `telegram:update:{update_id}`
 * - HTTP API:             passthrough (caller provides key directly)
 *
 * Edit semantics: appending `:edit` produces a new key → fresh execution.
 *
 * @returns Deterministic key string, unique per platform event
 */
export function deriveIdempotencyKey(ctx: IdempotencyKeyContext): string {
  const base = `${ctx.platform}:${ctx.eventId}`;
  return ctx.isEdit ? `${base}:edit` : base;
}

// --------------------------------------------------------------------------
// State Transition Validation
// --------------------------------------------------------------------------

/**
 * Check whether a state transition is valid per the idempotency state machine.
 *
 * @returns true if the transition from → to is permitted
 */
export function isValidTransition(
  from: IdempotencyKeyState,
  to: IdempotencyKeyState,
): boolean {
  const allowed = IDEMPOTENCY_TRANSITIONS.get(from);
  return allowed != null && allowed.includes(to);
}

/**
 * Check whether a key state is terminal (no further transitions allowed).
 */
export function isTerminal(state: IdempotencyKeyState): boolean {
  return TERMINAL_STATES.has(state);
}
