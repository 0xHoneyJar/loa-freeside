/**
 * Freeside Guard Types
 *
 * Types for billing guard responses in the Freeside inference pipeline.
 * loa-finn calls billing guards before executing inference; Freeside (arrakis)
 * implements the guards and returns these types.
 *
 * These are distinct from the canonical hounfour GuardResult type which models
 * agent lifecycle transition guards ({ valid: boolean; reason; guard }).
 * The Freeside GuardResult models billing reservation outcomes
 * ({ allowed: boolean; reservationId; reservedMicro; remainingMicro }).
 *
 * @module packages/core/protocol/guard-types
 */

// =============================================================================
// Guard Result
// =============================================================================

/**
 * Result of a billing guard check.
 * Returned by arrakis to loa-finn during the reserve phase.
 */
export interface GuardResult {
  /** Whether the guard check passed */
  allowed: boolean;
  /** Reason for denial (if allowed = false) */
  reason?: string;
  /** Reservation ID (if allowed = true) */
  reservationId?: string;
  /** Reserved amount in micro-USD (if allowed = true) */
  reservedMicro?: bigint;
  /** Remaining balance after reservation */
  remainingMicro?: bigint;
}

// =============================================================================
// Billing Guard Response
// =============================================================================

/**
 * Full billing guard response including metadata.
 * Used for S2S communication between arrakis and loa-finn.
 */
export interface BillingGuardResponse {
  /** Guard check result */
  guard: GuardResult;
  /** Billing mode in effect */
  billingMode: 'shadow' | 'soft' | 'live';
  /** Protocol version for compatibility checking */
  protocolVersion: string;
  /** Timestamp of the guard check */
  checkedAt: string;
}
