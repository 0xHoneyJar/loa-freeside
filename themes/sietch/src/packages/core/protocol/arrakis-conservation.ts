/**
 * Arrakis Conservation Error Taxonomy Adapter
 *
 * Maps between arrakis conservation error codes and the canonical
 * loa-hounfour v7.0.0 conservation property schema.
 *
 * Arrakis uses typed ConservationViolationError with specific error codes.
 * v7.0.0 uses a different schema (invariant_id, ltl_formula, enforcement, etc.).
 * This adapter bridges both representations.
 *
 * Task: 300.6 (Sprint 300, cycle-034)
 * SDD ref: §3.5
 */

import {
  CANONICAL_CONSERVATION_PROPERTIES,
  type ConservationProperty as CanonicalConservationProperty,
  type EnforcementMechanism as CanonicalEnforcementMechanism,
} from '@0xhoneyjar/loa-hounfour/integrity';

// =============================================================================
// Arrakis Error Taxonomy (preserved from local conservation-properties.ts)
// =============================================================================

export type ConservationErrorCode =
  | 'RECEIVABLE_BOUND_EXCEEDED'
  | 'BUDGET_OVERSPEND'
  | 'TERMINAL_STATE_VIOLATION'
  | 'TRANSFER_IMBALANCE'
  | 'DEPOSIT_BRIDGE_MISMATCH'
  | 'SHADOW_DIVERGENCE';

export type ReconciliationFailureCode =
  | 'LOT_CONSERVATION_DRIFT'
  | 'ACCOUNT_CONSERVATION_DRIFT'
  | 'PLATFORM_CONSERVATION_DRIFT'
  | 'BUDGET_CONSISTENCY_DRIFT'
  | 'TREASURY_INADEQUATE';

export class ConservationViolationError extends Error {
  readonly code: ConservationErrorCode;

  constructor(code: ConservationErrorCode, message: string) {
    super(`ConservationViolation [${code}]: ${message}`);
    this.name = 'ConservationViolationError';
    this.code = code;
  }
}

// =============================================================================
// Schema Mapping: Arrakis ↔ Canonical
// =============================================================================

/** Arrakis enforcement mechanism values */
export type EnforcementMechanism =
  | 'DB CHECK'
  | 'DB UNIQUE'
  | 'Application'
  | 'Reconciliation-only';

/** Arrakis universe values */
export type PropertyUniverse = 'per-lot' | 'per-account' | 'cross-system' | 'platform-wide';

export type PropertyKind = 'safety' | 'liveness';

/** Arrakis conservation property interface */
export interface ConservationProperty {
  id: string;
  name: string;
  description: string;
  ltl: string;
  universe: PropertyUniverse;
  kind: PropertyKind;
  fairnessModel?: string;
  enforcedBy: EnforcementMechanism[];
  expectedErrorCode?: ConservationErrorCode;
  reconciliationFailureCode?: ReconciliationFailureCode;
}

// =============================================================================
// Mapping Tables
// =============================================================================

const UNIVERSE_MAP: Record<string, PropertyUniverse> = {
  'single_lot': 'per-lot',
  'account': 'per-account',
  'platform': 'platform-wide',
  'bilateral': 'cross-system',
};

const ENFORCEMENT_MAP: Record<CanonicalEnforcementMechanism, EnforcementMechanism> = {
  'db_check': 'DB CHECK',
  'db_unique': 'DB UNIQUE',
  'application': 'Application',
  'reconciliation': 'Reconciliation-only',
};

/** Map invariant_id to arrakis error code */
const ERROR_CODE_MAP: Record<string, ConservationErrorCode> = {
  'I-3': 'RECEIVABLE_BOUND_EXCEEDED',
  'I-5': 'BUDGET_OVERSPEND',
  'I-6': 'TRANSFER_IMBALANCE',
  'I-7': 'DEPOSIT_BRIDGE_MISMATCH',
  'I-8': 'TERMINAL_STATE_VIOLATION',
  'I-14': 'SHADOW_DIVERGENCE',
};

/** Map invariant_id to reconciliation failure code */
const RECON_CODE_MAP: Record<string, ReconciliationFailureCode> = {
  'I-1': 'LOT_CONSERVATION_DRIFT',
  'I-2': 'ACCOUNT_CONSERVATION_DRIFT',
  'I-4': 'PLATFORM_CONSERVATION_DRIFT',
  'I-5': 'BUDGET_CONSISTENCY_DRIFT',
  'I-13': 'TREASURY_INADEQUATE',
};

// =============================================================================
// Adapter Functions
// =============================================================================

/**
 * Convert a canonical v7.0.0 conservation property to arrakis format.
 */
export function fromCanonical(canonical: CanonicalConservationProperty): ConservationProperty {
  const id = canonical.invariant_id;
  const universe = UNIVERSE_MAP[canonical.universe];
  if (!universe) {
    console.warn(`[arrakis-conservation] Unmapped canonical universe '${canonical.universe}' for ${id}, defaulting to 'platform-wide'`);
  }
  const enforcement = ENFORCEMENT_MAP[canonical.enforcement];
  if (!enforcement) {
    console.warn(`[arrakis-conservation] Unmapped canonical enforcement '${canonical.enforcement}' for ${id}, defaulting to 'Application'`);
  }
  return {
    id,
    name: canonical.name,
    description: canonical.description,
    ltl: canonical.ltl_formula,
    universe: universe || 'platform-wide',
    kind: canonical.severity === 'warning' ? 'liveness' : 'safety',
    enforcedBy: [enforcement || 'Application'],
    expectedErrorCode: ERROR_CODE_MAP[id],
    reconciliationFailureCode: RECON_CODE_MAP[id],
  };
}

/**
 * Get all 14 canonical conservation properties in arrakis format.
 */
export function getCanonicalProperties(): readonly ConservationProperty[] {
  return CANONICAL_CONSERVATION_PROPERTIES.map(fromCanonical);
}

/**
 * Lookup a conservation property by ID from canonical source.
 */
export function getProperty(id: string): ConservationProperty | undefined {
  const canonical = CANONICAL_CONSERVATION_PROPERTIES.find(
    (p) => p.invariant_id === id
  );
  if (!canonical) return undefined;
  return fromCanonical(canonical);
}

/**
 * Get all properties enforced by a specific mechanism.
 */
export function getPropertiesByEnforcement(mechanism: EnforcementMechanism): ConservationProperty[] {
  return getCanonicalProperties().filter(p => p.enforcedBy.includes(mechanism));
}

// =============================================================================
// Re-export canonical for direct access
// =============================================================================

export { CANONICAL_CONSERVATION_PROPERTIES };
export type { CanonicalConservationProperty };
