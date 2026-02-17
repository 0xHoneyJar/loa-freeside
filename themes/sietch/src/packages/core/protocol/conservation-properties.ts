/**
 * Conservation Properties Module (Task 3.1, Sprint 297)
 *
 * Formalizes all 14 conservation invariants as first-class temporal properties
 * with enforcement metadata, error taxonomy, and LTL specifications.
 *
 * Each property defines:
 * - LTL formula (temporal logic specification)
 * - Universe/scope (per-lot, per-account, platform-wide)
 * - Enforcement mechanism classification
 * - Expected error codes for counterexample tests
 *
 * SDD refs: §3.2.2 Conservation properties
 * Sprint refs: Task 3.1
 *
 * @module packages/core/protocol/conservation-properties
 */

// =============================================================================
// Error Taxonomy
// =============================================================================

/** Error codes for application-enforced conservation violations */
export type ConservationErrorCode =
  | 'RECEIVABLE_BOUND_EXCEEDED'
  | 'BUDGET_OVERSPEND'
  | 'TERMINAL_STATE_VIOLATION'
  | 'TRANSFER_IMBALANCE'
  | 'DEPOSIT_BRIDGE_MISMATCH'
  | 'SHADOW_DIVERGENCE';

/** Failure codes for reconciliation-only invariants */
export type ReconciliationFailureCode =
  | 'LOT_CONSERVATION_DRIFT'
  | 'ACCOUNT_CONSERVATION_DRIFT'
  | 'PLATFORM_CONSERVATION_DRIFT'
  | 'BUDGET_CONSISTENCY_DRIFT'
  | 'TREASURY_INADEQUATE';

/**
 * Typed error for application-enforced conservation violations.
 * Counterexample tests assert on `error.code` rather than generic "throws".
 */
export class ConservationViolationError extends Error {
  readonly code: ConservationErrorCode;

  constructor(code: ConservationErrorCode, message: string) {
    super(`ConservationViolation [${code}]: ${message}`);
    this.name = 'ConservationViolationError';
    this.code = code;
  }
}

// =============================================================================
// Property Definition Types
// =============================================================================

/** Enforcement mechanism for a conservation property */
export type EnforcementMechanism =
  | 'DB CHECK'
  | 'DB UNIQUE'
  | 'Application'
  | 'Reconciliation-only';

/** Universe/scope for a conservation property */
export type PropertyUniverse = 'per-lot' | 'per-account' | 'cross-system' | 'platform-wide';

/** Kind of temporal property */
export type PropertyKind = 'safety' | 'liveness';

/**
 * A single conservation invariant as a first-class temporal property.
 */
export interface ConservationProperty {
  /** Invariant ID (I-1 through I-14) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the property guarantees */
  description: string;
  /** LTL specification */
  ltl: string;
  /** Universe/scope */
  universe: PropertyUniverse;
  /** Safety or liveness */
  kind: PropertyKind;
  /** Fairness model for liveness properties */
  fairnessModel?: string;
  /** How the property is enforced */
  enforcedBy: EnforcementMechanism[];
  /** Expected error code for application-enforced violations */
  expectedErrorCode?: ConservationErrorCode;
  /** Expected failure code for reconciliation-only invariants */
  reconciliationFailureCode?: ReconciliationFailureCode;
}

// =============================================================================
// The 14 Conservation Invariants
// =============================================================================

export const CONSERVATION_PROPERTIES: readonly ConservationProperty[] = [
  // -------------------------------------------------------------------------
  // I-1: Per-lot conservation (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-1',
    name: 'Per-lot conservation',
    description: 'Each credit lot: available + reserved + consumed = original',
    ltl: '□(∀lot: lot.available + lot.reserved + lot.consumed = lot.original)',
    universe: 'per-lot',
    kind: 'safety',
    enforcedBy: ['DB CHECK', 'Application'],
    reconciliationFailureCode: 'LOT_CONSERVATION_DRIFT',
  },

  // -------------------------------------------------------------------------
  // I-2: Per-account conservation (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-2',
    name: 'Per-account conservation',
    description: 'Sum across all lots per account: sum(available + reserved + consumed) ≤ sum(original)',
    ltl: '□(∀acct: Σ(lot.available + lot.reserved + lot.consumed) ≤ Σ(lot.original))',
    universe: 'per-account',
    kind: 'safety',
    enforcedBy: ['DB CHECK', 'Application'],
    reconciliationFailureCode: 'ACCOUNT_CONSERVATION_DRIFT',
  },

  // -------------------------------------------------------------------------
  // I-3: Receivable bound (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-3',
    name: 'Receivable bound',
    description: 'Receivable balance never exceeds original amount',
    ltl: '□(∀receivable: receivable.balance ≤ receivable.original_amount)',
    universe: 'per-account',
    kind: 'safety',
    enforcedBy: ['Application'],
    expectedErrorCode: 'RECEIVABLE_BOUND_EXCEEDED',
  },

  // -------------------------------------------------------------------------
  // I-4: Platform conservation (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-4',
    name: 'Platform conservation',
    description: 'All funds accounted for: sum(lot_balances) + sum(receivables) ≤ sum(minted)',
    ltl: '□(Σ(lot_balances) + Σ(receivable_balances) ≤ Σ(minted) - Σ(expired))',
    universe: 'platform-wide',
    kind: 'safety',
    enforcedBy: ['Reconciliation-only'],
    reconciliationFailureCode: 'PLATFORM_CONSERVATION_DRIFT',
  },

  // -------------------------------------------------------------------------
  // I-5: Budget consistency (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-5',
    name: 'Budget consistency',
    description: 'Recorded spend matches windowed finalization sum',
    ltl: '□(∀budget: budget.current_spend = Σ(finalizations WHERE finalized_at ∈ window))',
    universe: 'cross-system',
    kind: 'safety',
    enforcedBy: ['Application', 'Reconciliation-only'],
    expectedErrorCode: 'BUDGET_OVERSPEND',
    reconciliationFailureCode: 'BUDGET_CONSISTENCY_DRIFT',
  },

  // -------------------------------------------------------------------------
  // I-6: Transfer symmetry (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-6',
    name: 'Transfer symmetry',
    description: 'Every completed transfer has matching transfer_in lot',
    ltl: '□(∀transfer: transfer.status=completed ⟹ ∃lot: lot.source=transfer)',
    universe: 'cross-system',
    kind: 'safety',
    enforcedBy: ['DB UNIQUE', 'Application'],
    expectedErrorCode: 'TRANSFER_IMBALANCE',
  },

  // -------------------------------------------------------------------------
  // I-7: TBA deposit bridge (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-7',
    name: 'TBA deposit bridge',
    description: 'Bridged deposits equal tba_deposit-sourced lots',
    ltl: '□(Σ(tba_deposits WHERE bridged) = Σ(lots WHERE source=tba_deposit))',
    universe: 'cross-system',
    kind: 'safety',
    enforcedBy: ['Application'],
    expectedErrorCode: 'DEPOSIT_BRIDGE_MISMATCH',
  },

  // -------------------------------------------------------------------------
  // I-8: Terminal absorption (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-8',
    name: 'Terminal absorption',
    description: 'Terminal states are absorbing (no outgoing transitions)',
    ltl: '□(∀sm, s: isTerminal(sm, s) ⟹ ¬∃s′: transition(s, s′))',
    universe: 'per-lot',
    kind: 'safety',
    enforcedBy: ['Application'],
    expectedErrorCode: 'TERMINAL_STATE_VIOLATION',
  },

  // -------------------------------------------------------------------------
  // I-9: Revenue rule mutual exclusion (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-9',
    name: 'Revenue rule mutual exclusion',
    description: 'At most 1 active revenue rule at any time',
    ltl: '□(count(rules WHERE status=active) ≤ 1)',
    universe: 'platform-wide',
    kind: 'safety',
    enforcedBy: ['DB UNIQUE', 'Application'],
  },

  // -------------------------------------------------------------------------
  // I-10: Lot monotonicity (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-10',
    name: 'Lot monotonicity',
    description: 'Original amount is immutable after creation',
    ltl: '□(∀lot: lot.original_micro = lot.original_micro@creation)',
    universe: 'per-lot',
    kind: 'safety',
    enforcedBy: ['DB CHECK'],
  },

  // -------------------------------------------------------------------------
  // I-11: Finalization atomicity (liveness)
  // -------------------------------------------------------------------------
  {
    id: 'I-11',
    name: 'Finalization atomicity',
    description: 'Finalize + distribution is all-or-nothing',
    ltl: '□(finalize_start ⟹ ◇(finalize_complete ∨ rollback_complete))',
    universe: 'per-lot',
    kind: 'liveness',
    fairnessModel: 'Transaction commit/rollback guaranteed by SQLite BEGIN IMMEDIATE',
    enforcedBy: ['Application'],
  },

  // -------------------------------------------------------------------------
  // I-12: Reservation termination (liveness)
  // -------------------------------------------------------------------------
  {
    id: 'I-12',
    name: 'Reservation termination',
    description: 'Every reservation reaches terminal state eventually',
    ltl: '□(∀r: r.status=pending ⟹ ◇(r.status ∈ {finalized, released, expired}))',
    universe: 'per-lot',
    kind: 'liveness',
    fairnessModel: 'ExpirationJob runs at least once after reservation TTL expires',
    enforcedBy: ['Application'],
  },

  // -------------------------------------------------------------------------
  // I-13: Treasury adequacy (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-13',
    name: 'Treasury adequacy',
    description: 'Treasury has sufficient balance for outstanding commitments',
    ltl: '□(treasury.balance ≥ Σ(outstanding_commitments))',
    universe: 'platform-wide',
    kind: 'safety',
    enforcedBy: ['Reconciliation-only'],
    reconciliationFailureCode: 'TREASURY_INADEQUATE',
  },

  // -------------------------------------------------------------------------
  // I-14: Shadow tracking (safety)
  // -------------------------------------------------------------------------
  {
    id: 'I-14',
    name: 'Shadow tracking',
    description: 'Shadow ledger mirrors real ledger for verification',
    ltl: '□(∀entry: shadow(entry) = real(entry))',
    universe: 'platform-wide',
    kind: 'safety',
    enforcedBy: ['Application'],
    expectedErrorCode: 'SHADOW_DIVERGENCE',
  },
] as const;

/**
 * Lookup a conservation property by ID.
 */
export function getProperty(id: string): ConservationProperty | undefined {
  return CONSERVATION_PROPERTIES.find(p => p.id === id);
}

/**
 * Get all properties enforced by a specific mechanism.
 */
export function getPropertiesByEnforcement(mechanism: EnforcementMechanism): ConservationProperty[] {
  return CONSERVATION_PROPERTIES.filter(p => p.enforcedBy.includes(mechanism));
}
