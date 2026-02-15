/**
 * Vendored loa-hounfour Guard Types
 *
 * Types for billing guard responses used in the inference pipeline.
 * loa-finn calls billing guards before executing inference; arrakis
 * implements the guards and returns these types.
 *
 * Vendored from: loa-hounfour (pinned commit — see VENDORED.md)
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
